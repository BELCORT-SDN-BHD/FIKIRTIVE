import "server-only";
import * as Sentry from "@sentry/node";
import {
  DEAD_LETTER_QUEUES,
  censusDeadLetters,
  deadLetterAlertTitle,
  type DeadLetterCensus,
} from "@fikirtive/core";
import { getBoss } from "@/lib/queue";

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

/** 探针可能被人每秒拉一次;两次真查之间至少隔这么久,免得一个免鉴权路由变成 DB 压力源。 */
export const DEAD_LETTER_CACHE_MS = 30_000;

let cached: { at: number; census: DeadLetterCensus } | undefined;

/** 真查一次 pg-boss。只读:不建队列、不改任何一行。 */
async function readDeadLetterCensus(): Promise<DeadLetterCensus> {
  const boss = await getBoss();
  const rows = await boss.getQueues([...DEAD_LETTER_QUEUES]);
  return censusDeadLetters(
    rows.map((q) => ({
      name: q.name,
      queuedCount: q.queuedCount,
      deferredCount: q.deferredCount,
      activeCount: q.activeCount,
    })),
  );
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
      total: census.total,
      offenders: census.offenders.map((o) => `${o.queue}=${o.count}`).join(" "),
      missing: census.missing.join(" "),
    },
  });
}

/**
 * 巡检一次(带缓存)。非空时顺手上报一次 —— 缓存窗口同时也是上报节流窗口,所以一个
 * 一直堵着的死信队列不会把 Sentry 刷爆。
 */
export async function checkDeadLetters(now: number = Date.now()): Promise<DeadLetterCensus> {
  if (cached && now - cached.at < DEAD_LETTER_CACHE_MS && now >= cached.at) return cached.census;
  const census = await readDeadLetterCensus();
  cached = { at: now, census };
  if (!census.healthy) report(census);
  return census;
}
