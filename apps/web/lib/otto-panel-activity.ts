/**
 * otto-panel-activity.ts —— 「这个商家有进行中的面板对话吗」,客户端这一侧的一次读,
 * 外加「商家这一程已经自己把面板关掉了」这一句本地记号。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14)。
 *
 * 这条读取存在的理由,是把面板展开的第二个条件从**近似**换成真信号。2026-09-04 那一轮
 * 拿深链 `?otto=1` 当「这一页有活动对话」用,Founder 当天追认它是近似:`?otto=1` 说的是
 * 「商家点名要开面板」,与「有没有一段正在跑的对话」是两件事。真判据在服务端
 * (`lib/thread-activity.ts` 的 `hasPendingPanelThread`),这里只负责去问一次。
 *
 * **口径是全店,不是本页**(#1200 判官 P2-1/P2-2):服务端那一句按 `ownerId` 查,不带
 * project;面板落座那一侧(`otto-panel-seed.ts`)因此也放宽到全店 —— 两处口径必须是同一
 * 句话,否则「有在跑的对话」把面板顶开、面板却在当前 project 里选不到任何一条,商家看到
 * 的是凭空弹出来的一块空面板。
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

/**
 * 「商家这一程已经自己把面板关掉了」的记号(#1200 判官 P2-4)。
 *
 * 现场:一单生成在跑,商家从 /create 进画布再回来,每一次整页加载都重问一次上面那句,
 * 答案还是「有」,于是刚刚被他关掉的面板又被顶开一次 —— 同一个信号在一程里反复推翻他的
 * 动作。自动展开是**建议**,商家的手是**决定**:关过一次,这一程就不再自动开。
 *
 * 存 `sessionStorage` 不存 localStorage:寿命就是这一个标签页这一程,新开标签页、明天再来
 * 都重新算 —— 与「这次到访要不要展开」本来就是一次性判断同一个口径。深链 `?otto=1` 不受
 * 影响:那是商家点名要开,不是自动展开。
 *
 * 读写一律 try/catch:隐私模式下取 `sessionStorage` 本身就会抛,而记不住只该退回「没关过」
 * (最多多开一次面板),不该让整层壳崩掉。
 */
export const OTTO_PANEL_DISMISSED_KEY = "fikirtive:otto-panel-dismissed:v1";

/** 记下「商家自己关的」。写不进去就算了 —— 记号是锦上添花,不是能不能用的前提。 */
export function rememberPanelDismissed(): void {
  try {
    window.sessionStorage.setItem(OTTO_PANEL_DISMISSED_KEY, "1");
  } catch {
    /* 隐私模式/配额满:记不住,下一次到访最多多开一次面板 */
  }
}

/** 这一程商家关过面板吗。读不到一律当「没关过」。 */
export function panelDismissedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(OTTO_PANEL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
