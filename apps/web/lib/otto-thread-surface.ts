/**
 * otto-thread-surface.ts —— 一条对话是**从哪个门**开出来的,只有这一份权威。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14 那一行);触发 = Codex 全 beta
 * 审计 P1-010(商家在 /billing 展开侧栏 Otto,面板接着聊的是一条画布对话
 * 「Professional Male Model Image」)。
 *
 * 病根不在面板,在「面板一打开接着聊哪一条」这个判据本身:它只按 project 取最近一条
 * (`otto-panel-seed.ts`),而 project 与商家正在看哪一页毫无关系。画布对话与侧栏对话
 * 从来没有被分开登记过,所以面板没有任何依据可以只续自己那一批。
 *
 * 这个文件就是那份依据。`ChatThread.surface` 这一列 #879 step 1 已经预埋(nullable、
 * 至今没有任何写入方),这一票开始**写它**:
 *   · `canvas` —— 画布那一侧开的(Create 入口、剪辑入口、前门 `/otto`);
 *   · `panel`  —— 全局侧栏面板自己开的。
 *
 * **老行诚实登记**:这一票之前的每一行都是 `surface = null`,没有任何办法回溯它当初是
 * 从哪个门开的。一律按 `canvas` 读(`isPanelThread` 只认字面量 `panel`)—— 宁可让面板
 * 少续一条老对话(商家在列表里点一下就能打开),也不要让它继续把一条画布对话当成
 * 「你刚才在聊的那条」自动摊开。
 *
 * **只信服务端判定**:客户端可以声明自己在哪个门(位置),但声明必须过
 * `coerceThreadSurface` 这一道闸 —— 认不出来的一律落回 `canvas`,不是原样落库。与
 * `coworkTurnRequest` 对 `surface` 的既有纪律同一条(#879 step 1:「the client may
 * declare where it is, never who it is」),身份列(actorId / visibility)照旧无客户端入口。
 */

/** 一条对话可能的来源。写库只写这两个字面量之一。 */
export const CHAT_THREAD_SURFACES = ["canvas", "panel"] as const;

export type ChatThreadSurface = (typeof CHAT_THREAD_SURFACES)[number];

/**
 * 认不出来就是画布 —— 与老行 `null` 同一档。
 *
 * 面板是这里唯一「被自动续上」的一侧,所以默认值必须偏向**不自动续**那一边:猜错成
 * `panel` 会让一条来路不明的对话在商家每一页上自动摊开,猜错成 `canvas` 只是让他多点一下。
 */
export const DEFAULT_THREAD_SURFACE: ChatThreadSurface = "canvas";

/** 把任何一个来源声明(客户端传的、库里读的)收成这两个字面量之一。 */
export function coerceThreadSurface(raw: unknown): ChatThreadSurface {
  return CHAT_THREAD_SURFACES.includes(raw as ChatThreadSurface)
    ? (raw as ChatThreadSurface)
    : DEFAULT_THREAD_SURFACE;
}

/**
 * 这一条是侧栏面板自己的对话吗。
 *
 * `null`(老行)与任何认不出来的值都是 `false`。面板「打开时接着聊哪一条」只问这一句 ——
 * 它是一个**自动动作**的判据,拿不准就不做,所以未知归到「不自动续」这一边。
 */
export function isPanelThread(surface: string | null | undefined): boolean {
  return surface === "panel";
}

/**
 * 这一条**确知**是画布对话吗。
 *
 * 判官 P2-1:它不是 `isPanelThread` 的反面。「不是 panel」里混着两种东西 —— 确知是画布的
 * (`"canvas"`),和**来路不明**的老行(`null`,这一票之前写的每一条)。把后者也标成
 * 「Canvas」是在替一件查不出来的事作证:那句话我们并不知道它真不真。
 *
 * 所以界面上**说出口**的两件事(列表徽章、头部「Canvas · …」)只认这一句;而「面板要不要
 * 自动续它」那个不出声的决定仍然用 `isPanelThread`(未知 → 不自动续),两边行为不变。
 */
export function isCanvasThread(surface: string | null | undefined): boolean {
  return surface === "canvas";
}
