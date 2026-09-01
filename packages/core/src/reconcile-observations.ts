/**
 * 对账观察行的 ActionEvent 契约(MONEY-A12,规格 §7.5)。
 *
 * 为什么这四行必须住在 core:写观察行的是 worker 的哨兵
 * (`apps/worker/src/jobs/stripe-reconcile.ts`),关闭它的是 web 的 admin 动作
 * (`apps/web/lib/reconcile-actions.ts`)—— 两个进程、两个包,而它们说的必须是**同一行**。
 * 把 id 前缀各抄一份,就是「哨兵永远看不见人已经关掉的缺口」这种事故的标准起点。
 *
 * 三种行,一个缺口最多各一条:
 *   · 观察行 `stripe_unreconciled:<sessionId>`         —— 首见时写,主键即「见过没见过」。
 *   · 关闭行 `stripe_unreconciled_closed:<sessionId>`  —— 人工关闭,或哨兵发现账本已补上。
 *   · 报警节流行(哨兵自己的私事,不在这里)          —— 见 stripe-reconcile.ts。
 */

/** 首见缺口时写下的观察行。 */
export const RECONCILE_OBSERVED_TYPE = "credits.purchase.unreconciled";
/** 缺口了结:人工关闭,或账本行已经补上(哨兵自动关闭)。 */
export const RECONCILE_CLOSED_TYPE = "credits.purchase.unreconciled.closed";

/** 观察行的主键 —— 由 Checkout Session id 派生,所以「见过没见过」由数据库唯一约束回答。 */
export function reconcileObservationId(sessionId: string): string {
  return `stripe_unreconciled:${sessionId}`;
}

/** 关闭行的主键 —— 同样由 session id 派生:同一个缺口关两次,第二次撞主键,不产生第二条事实。 */
export function reconcileClosureId(sessionId: string): string {
  return `stripe_unreconciled_closed:${sessionId}`;
}
