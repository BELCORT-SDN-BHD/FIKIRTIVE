/**
 * otto-panel-activity.ts —— 「本页有进行中的对话吗」,客户端这一侧的一次读。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14)。
 *
 * 这条读取存在的理由,是把面板展开的第二个条件从**近似**换成真信号。2026-09-04 那一轮
 * 拿深链 `?otto=1` 当「这一页有活动对话」用,Founder 当天追认它是近似:`?otto=1` 说的是
 * 「商家点名要开面板」,与「有没有一段正在跑的对话」是两件事。真判据在服务端
 * (`lib/thread-activity.ts` 的 `hasPendingPanelThread`),这里只负责去问一次。
 *
 * **不新增轮询**(#544 的纪律,`lib/balance-refresh.ts` 顶部同一条):问一次就够 ——
 * 「这次到访要不要展开」是到达那一刻的判断,`OttoPanelHost` 每次整页加载挂载一次,软导航
 * 不卸载,所以「每次挂载问一次」= 「每次到访问一次」。面板真开起来之后,会话那一侧自己
 * 有取数(`loadOttoPanelSeed`),不需要这条读再盯着。
 *
 * 失败一律读成「没有活动对话」:面板是随处可见的一层壳,它的展开信号读不到只该让面板保持
 * 收起(商家点一下 launcher 就开),不该把商家正在看的那一页也一起带走。
 */

/** 服务端答的那一句。多余的字段一律不看 —— 契约就这一格。 */
function pendingFrom(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as { pending?: unknown }).pending === true;
}

/**
 * 问一次:这个商家现在有没有一条**面板自己的**对话正在跑。
 *
 * 不带任何参数 —— 租户与 project 一律由服务端的 principal 决定(`requireOwner()`),
 * 客户端连 `ownerId` 这个词都不出现。`signal` 用来在卸载时取消。
 */
export async function fetchPanelThreadPending(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/otto/thread-activity", { signal, cache: "no-store" });
    if (!res.ok) return false;
    return pendingFrom(await res.json());
  } catch {
    return false;
  }
}
