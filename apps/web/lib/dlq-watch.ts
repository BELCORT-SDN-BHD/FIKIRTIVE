import "server-only";
import * as Sentry from "@sentry/node";
import { prisma } from "@fikirtive/db";
import {
  DEAD_LETTER_QUEUES,
  censusDeadLetters,
  deadLetterAlertTitle,
  type DeadLetterCensus,
  type DeadLetterQueueRow,
} from "@fikirtive/core";
import { READY_DATABASE_TIMEOUT_MS, bestEffort, singleFlight } from "@/lib/health";

/**
 * 死信巡检(#793 — 上线债#1).
 *
 * 七条死信队列只建不看:一条被系统放弃的 render / gen / publish 可以躺到商家来投诉
 * 为止。这里补上「看」。
 *
 * 为什么巡检住在 web 而不是 worker 的 reaper tick(票面原话)——巡检最需要出声的那
 * 一刻,恰恰是 worker 卡死或崩溃重启的那一刻;跑在 worker 里的巡检那时正好也不跑,
 * 于是最该响的时候最安静。放在 web 侧,一个外部探针就能同时替 web、DB 和死信三件事
 * 作证,worker 死透了它照样出声。代价是探针必须真的被人拉——这一条写进 runbook 的
 * 生产残留清单,由 Founder 在窗口内接上。
 */

/**
 * 探针可能被人每秒拉一次;两次真查之间至少隔这么久,免得一个免鉴权路由变成 DB 压力源。
 *
 * r3(判官 r2 P1):同一条窗口也是**失败读**的负缓存 TTL —— 库故障期间,一次挂住或
 * 拒绝的查询不该让下一个请求立刻再发一条。查得到和查不到共用同一份缓存,`checkDeadLetters`
 * 不需要认识第二套节流规则。
 */
export const DEAD_LETTER_CACHE_MS = 30_000;

let cached: { at: number; census: DeadLetterCensus } | undefined;
/** 同一时刻至多一趟「查询 + 写缓存 + 上报」在途;见 `checkDeadLetters`。 */
let pending: Promise<DeadLetterCensus> | undefined;

/**
 * 一条队列都读不到时的答案。与「查到了,但缺一条」共用同一个 `unknown` 分支
 * (`censusDeadLetters([])`:七条队列全部落进 `missing`)—— 调用方只需要认得一种
 * 失败形状,免鉴权路由也就不用把 DB 的原始报错吐出去。
 */
const UNREADABLE_CENSUS: DeadLetterCensus = censusDeadLetters([]);

/**
 * 直接查 job 表(r2 — 判官 r1 P1-2)。同一时刻只允许一个在途查询(r3 — 判官 r2 P1,
 * 与 `/api/health`·`/api/ready` 的 `singleFlight` 同一模式,见 lib/health.ts):冷启动
 * 或缓存到期时,N 个并发请求共享这一次查询,而不是各发一条 SELECT 把连接池堆满。
 *
 * 原先走的是 `PgBoss.getQueues()`,那读的是 `pgboss.queue` 表里的**缓存计数**
 * (`queued_count` / `deferred_count` / `active_count`),而刷新那份缓存的是 pg-boss 的
 * supervisor;web 侧的句柄是 `supervise: false`(它只负责发活),所以刷新只可能来自
 * worker。于是「worker 写完死信就死了」这一路——恰恰是本探针存在的理由——web 会无限期
 * 地读到 0 并回 200,承诺的「worker 死透了它照样出声」在最需要的那一刻恰好失效。
 *
 * 现在这里问的是 job 表本身,与 worker 死活无关。顺带断掉另一条:读一次死信不再需要
 * `getBoss()`,也就不再有免鉴权 GET 触发 pg-boss 冷启动、跑一串 `createQueue` 写入的
 * 那条路径 —— 这是一个只读 SELECT。查 `pgboss.job` 与 gen/refgen/research 三个 reaper
 * 的存活判定同一手法(apps/worker/src/jobs/*.ts)。
 *
 * 三个计数互不重叠(pg-boss 自己的 queued 是含 deferred 的,那样加总会重复计数):
 * queued = 该跑还没跑,deferred = 还没到点,active = 正在跑。死信队列没有消费者,实际
 * 永远落在 queued,另外两个留着是为了「有货」这件事不会因为形态不同而漏报。
 */
const queryJobTable = singleFlight(async (): Promise<DeadLetterQueueRow[]> => {
  return prisma.$queryRaw<DeadLetterQueueRow[]>`
    SELECT q.name,
           (count(j.id) FILTER (WHERE j.state < 'active' AND j.start_after <= now()))::int AS "queuedCount",
           (count(j.id) FILTER (WHERE j.state < 'active' AND j.start_after > now()))::int AS "deferredCount",
           (count(j.id) FILTER (WHERE j.state = 'active'))::int AS "activeCount"
      FROM pgboss.queue q
      LEFT JOIN pgboss.job j ON j.name = q.name AND j.state <= 'active'
     WHERE q.name = ANY(${[...DEAD_LETTER_QUEUES]}::text[])
     GROUP BY q.name`;
});

/**
 * 查询带有界等待(r3 — 判官 r2 P1,预算与 `/api/ready` 同量级:`READY_DATABASE_TIMEOUT_MS`)。
 * 一条挂住的查询不该把探针一起拖住,也不该在库故障期把每个请求都拖到平台超时。超时与
 * 失败是同一个答案 —— fail closed 不变:答不出「查到了」,那就是 `unknown`,从不假装
 * 看见了自己没看见的东西。
 */
async function readDeadLetterCensus(): Promise<DeadLetterCensus> {
  const rows = await bestEffort(queryJobTable, READY_DATABASE_TIMEOUT_MS);
  return rows ? censusDeadLetters(rows) : UNREADABLE_CENSUS;
}

/**
 * 上报。**不带商家标识、不带 job payload** —— 死信里躺的是商家的活,标题与 payload
 * 只说「哪条队列、几条」,谁的活要去 admin 面按权限查。
 */
function report(census: DeadLetterCensus): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureMessage(deadLetterAlertTitle(census), {
    level: "error",
    tags: { probe: "dead-letters" },
    extra: {
      status: census.status,
      total: census.total,
      offenders: census.offenders.map((o) => `${o.queue}=${o.count}`).join(" "),
      missing: census.missing.join(" "),
      malformed: census.malformed.join(" "),
    },
  });
}

/**
 * 巡检一次(带缓存)。**不是 `clear` 就上报一次** —— 队列读不到和队列有货都要有人知道
 * (r2:原先只有「有货」出声,缺席的队列悄无声息)。缓存窗口同时是上报节流窗口,所以一个
 * 一直堵着的死信队列不会把 Sentry 刷爆。
 *
 * r3(判官 r2 P1):查询、写缓存、决定要不要上报,三件事绑在同一趟在途 promise 里 ——
 * 冷启动或缓存到期时,并发到达的请求共享这一趟,而不是各跑各的、各报各的 Sentry。
 * `queryJobTable` 那层 `singleFlight` 只管底层 SELECT;这里再包一层,是因为「写缓存」
 * 和「上报」也必须只发生一次 —— 否则 N 个并发请求会各自算出同一份 census、各自调用一次
 * `report()`,Sentry 照样被并发请求刷屏,即使底层只查了一次库。
 */
export async function checkDeadLetters(now: number = Date.now()): Promise<DeadLetterCensus> {
  if (cached && now - cached.at < DEAD_LETTER_CACHE_MS && now >= cached.at) return cached.census;
  if (pending) return pending;
  const attempt = readDeadLetterCensus()
    .then((census) => {
      cached = { at: now, census };
      if (census.status !== "clear") report(census);
      return census;
    })
    .finally(() => {
      if (pending === attempt) pending = undefined;
    });
  pending = attempt;
  return attempt;
}
