/**
 * Dead-letter census (#793 — 上线债#1「仪表盘点亮」).
 *
 * 七条队列都配了 `deadLetter`,但没有任何东西消费那七条死信队列 —— 这是设计:一条
 * 死信 = 系统已经放弃的活。放弃本身没有错,**没人知道系统放弃了什么**才是错。在这
 * 之前死信队列只建不看,一条卡住的 render / gen / publish 可以躺到商家来投诉为止。
 *
 * 这个文件只做纯粹的两件事:①把七条死信队列的名字集中成单一来源;②把「队列深度」
 * 这堆数字化成一个可以直接告警的结论。真正的读取(pg-boss)与上报(Sentry)在
 * `apps/web/lib/dlq-watch.ts`,那边可以被 mock,这边可以被穷举测试。
 */
import { INGEST_DLQ, RENDER_DLQ, CAPTION_DLQ } from "./timeline.js";
import { REFGEN_DLQ } from "./refgen.js";
import { GEN_DLQ, RESEARCH_DLQ } from "./gen.js";
import { PUBLISH_DLQ } from "./publish.js";

/**
 * 每一条配了 deadLetter 的队列,它的死信目标都必须出现在这里。新增队列时,
 * `dead-letters.test.ts` 会拿 `*_QUEUE_POLICY.deadLetter` 反查,漏一条就红。
 */
export const DEAD_LETTER_QUEUES = [
  INGEST_DLQ,
  RENDER_DLQ,
  REFGEN_DLQ,
  GEN_DLQ,
  CAPTION_DLQ,
  RESEARCH_DLQ,
  PUBLISH_DLQ,
] as const;

/**
 * 一条死信队列的现状。字段名沿用 pg-boss 的词汇,值由 `dlq-watch.ts` 直接查 job 表得出
 * (r2:不再读 pg-boss 在 queue 表里的缓存计数,那份计数只有 worker 的 supervisor 会刷新)。
 */
export type DeadLetterQueueRow = {
  name: string;
  /** created + retry,且 startAfter 已到：等着被人捞走的 */
  queuedCount: number;
  /** created + retry,但 startAfter 还没到的 */
  deferredCount: number;
  /** 已被 fetch、还没 complete 的 */
  activeCount: number;
};

export type DeadLetterOffender = { queue: string; count: number };

/**
 * 探针只有三种答案,和 runbook、HTTP 状态码逐字对齐:
 *   `clear`     — 七条队列**全部查得到,且全部为空**(唯一的 200)
 *   `backed-up` — 至少一条有死信
 *   `unknown`   — 有队列查不到,或某条的计数不可信 ⇒ **证明不了 clear**
 *
 * `unknown` 是 r2 的修正点(判官 r1 P1-1)。原先缺席的队列被算作健康:`ingest.dlq`
 * 整条不见了,探针照样回 200 clear —— 一个查不到自己要看的东西却报平安的探针,比没有
 * 探针更坏。「我看不到」和「我看到了,是空的」必须是两句不同的话。
 */
export type DeadLetterStatus = "clear" | "backed-up" | "unknown";

export type DeadLetterCensus = {
  /** 唯一的告警判据:`clear` 才是 200。 */
  status: DeadLetterStatus;
  /** 查得到、且计数可信的那些队列的死信条数之和。 */
  total: number;
  /** 非零的队列,按条数降序、同数按名字升序。 */
  offenders: DeadLetterOffender[];
  /** 名单里有、但查询没返回的队列(队列还没建、或名字被改过)。⇒ `unknown` */
  missing: string[];
  /** 返回了、但计数不是非负整数的队列(读到畸形数据本身就是故障)。⇒ `unknown` */
  malformed: string[];
};

/**
 * 一条队列的死信深度;**计数不可信时返回 null**。
 *
 * 原先负数 / 小数 / NaN 一律折成 0,于是「读到了垃圾」和「读到了 0」变成同一句话 ——
 * 探针最不该做的就是把读不懂的东西说成平安。折 0 已被 `malformed` 取代。
 */
function depth(row: DeadLetterQueueRow): number | null {
  const counts = [row.queuedCount, row.deferredCount, row.activeCount];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * 把队列行化成一句可以直接决定「要不要叫人」的结论。
 * 名单外的队列一律忽略 —— 这个探针只负责死信,不负责正常队列的积压。
 */
export function censusDeadLetters(rows: readonly DeadLetterQueueRow[]): DeadLetterCensus {
  const known = new Set<string>(DEAD_LETTER_QUEUES);
  const seen = new Set<string>();
  const offenders: DeadLetterOffender[] = [];
  const malformed: string[] = [];
  let total = 0;

  for (const row of rows) {
    if (!known.has(row.name) || seen.has(row.name)) continue;
    seen.add(row.name);
    const count = depth(row);
    if (count === null) {
      malformed.push(row.name);
      continue;
    }
    total += count;
    if (count > 0) offenders.push({ queue: row.name, count });
  }

  offenders.sort((a, b) => b.count - a.count || a.queue.localeCompare(b.queue));
  const missing = DEAD_LETTER_QUEUES.filter((name) => !seen.has(name));

  // 已经确知有活被放弃时,说 `backed-up` 比说 `unknown` 更有行动价值 —— 两者都是 503,
  // 差别只在那句话指向哪个动作。查不到的队列仍留在 payload 里,一并进 Sentry。
  const status: DeadLetterStatus =
    total > 0 ? "backed-up" : missing.length > 0 || malformed.length > 0 ? "unknown" : "clear";

  return { status, total, offenders, missing, malformed };
}

/**
 * Sentry 事件的标题。**故意不带条数**:Sentry 按标题分组,把 "3" 写进标题会让同一个
 * 故障每变一次条数就开一个新 issue,alert rule 也就跟着重复轰炸。条数放在 payload 里。
 *
 * 两句标题,因为它们要人做的事不同:队列有货 = 去看那些活为什么被放弃;队列读不到 =
 * 去看队列本身(worker 建了没、名字改了没、库通不通)。
 */
export function deadLetterAlertTitle(census: DeadLetterCensus): string {
  if (census.status === "unknown") {
    const unreadable = [...census.missing, ...census.malformed].sort();
    return `Dead-letter queues could not be read: ${unreadable.join(", ") || "unknown"}`;
  }
  const queues = census.offenders.map((o) => o.queue).join(", ");
  return `Dead-letter queues are not empty: ${queues || "unknown"}`;
}
