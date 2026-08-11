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

/** pg-boss `getQueues()` 每行里我们真正用到的字段(只取这几个,便于测试构造)。 */
export type DeadLetterQueueRow = {
  name: string;
  /** created + retry：等着被人捞走的 */
  queuedCount: number;
  /** startAfter 还没到的 */
  deferredCount: number;
  /** 已被 fetch、还没 complete 的 */
  activeCount: number;
};

export type DeadLetterOffender = { queue: string; count: number };

export type DeadLetterCensus = {
  /** true = 七条死信队列一条不剩。这是唯一的告警判据。 */
  healthy: boolean;
  /** 全部死信条数之和。 */
  total: number;
  /** 非零的队列,按条数降序、同数按名字升序。 */
  offenders: DeadLetterOffender[];
  /**
   * 名单里有、但 pg-boss 里查不到的队列。**不告警**:web 侧的 producer handle 只
   * 建六条(ingest.dlq 归 worker 建),全新数据库在 worker 首次启动前少一条是正常
   * 状态,把它算成故障只会训练人忽略这个探针。留在 payload 里供人诊断。
   */
  missing: string[];
};

/** 负数、小数、NaN 一律按 0 处理 —— 探针不该因为一个畸形计数把自己弄崩。 */
function depth(row: DeadLetterQueueRow): number {
  const sum = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  return sum(row.queuedCount) + sum(row.deferredCount) + sum(row.activeCount);
}

/**
 * 把 pg-boss 的队列行化成一句可以直接决定「要不要叫人」的结论。
 * 名单外的队列一律忽略 —— 这个探针只负责死信,不负责正常队列的积压。
 */
export function censusDeadLetters(rows: readonly DeadLetterQueueRow[]): DeadLetterCensus {
  const known = new Set<string>(DEAD_LETTER_QUEUES);
  const seen = new Set<string>();
  const offenders: DeadLetterOffender[] = [];
  let total = 0;

  for (const row of rows) {
    if (!known.has(row.name) || seen.has(row.name)) continue;
    seen.add(row.name);
    const count = depth(row);
    total += count;
    if (count > 0) offenders.push({ queue: row.name, count });
  }

  offenders.sort((a, b) => b.count - a.count || a.queue.localeCompare(b.queue));

  return {
    healthy: total === 0,
    total,
    offenders,
    missing: DEAD_LETTER_QUEUES.filter((name) => !seen.has(name)),
  };
}

/**
 * Sentry 事件的标题。**故意不带条数**:Sentry 按标题分组,把 "3" 写进标题会让同一个
 * 故障每变一次条数就开一个新 issue,alert rule 也就跟着重复轰炸。条数放在 payload 里。
 */
export function deadLetterAlertTitle(census: DeadLetterCensus): string {
  const queues = census.offenders.map((o) => o.queue).join(", ");
  return `Dead-letter queues are not empty: ${queues || "unknown"}`;
}
