/**
 * #775 —— 「这段提示词要引擎做哪一件事」的**唯一**判据。
 *
 * 住在 core,因为读它的不止一处,而且那几处全都在钱路上:
 *   · `genRequest`(付费 schema)—— 锚在片子上的请求必须真的带着那条片子,比例必须跟着它;
 *   · `gen-from-card`(卡 → 付费请求)—— 锚定卡的比例不接受任何覆盖;
 *   · `@fikirtive/otto` 的能力表与铸卡侧 —— 写这段字的那一端。
 *
 * 判据抄成两份,「商家批准的」与「引擎执行的」就会在某一天开始各说各话 ——
 * #775 判官 r3 逮到的正是这一类:铸卡侧管得好好的,执行侧根本没问过同一个问题。
 *
 * ── 为什么判据是提示词,不是一个声明字段 ─────────────────────────────────
 * 官方 2.5 代把「改这条片子」和「照着它做一条新的」当成两种任务,而任务类型是引擎
 * **从提示词里读出来的**。所以那段字就是事实本身:它在卡上冻结、批准后原样上路。
 * 任何跟在它旁边的声明字段都可能被漏传或传错,而它不会。
 */

/**
 * 那条片子在提示词里的名字。
 *
 * 付费请求里承载整段片子的位置只有一个(`VideoRequest.refVideoUrl`,单值;适配器把它
 * push 成唯一一个 `role:"reference_video"` 部件),所以编号恒为 1 —— 这不是我们挑的
 * 常量,是那个字段的形状决定的。`packages/generation/src/byteplus.test.ts` 有一条
 * 「一趟只送得出一条片子」的断言钉着它。
 */
export const VIDEO_CLIP_TOKEN = "<Video_1>";

/** 官方严格编辑句的开头。后面接的是「改什么」。 */
export const VIDEO_EDIT_OPENING = `Strictly edit ${VIDEO_CLIP_TOKEN}, and modify`;
/** 官方延长句的开头。后面接方向词与「接什么」。 */
export const VIDEO_EXTEND_OPENING = `Extend ${VIDEO_CLIP_TOKEN}`;

/** 锚在一条已有片子上的两个动作。 */
export type AnchoredVideoAction = "editClip" | "extendClip";

const OPENINGS: readonly (readonly [AnchoredVideoAction, string])[] = [
  ["editClip", VIDEO_EDIT_OPENING],
  ["extendClip", VIDEO_EXTEND_OPENING],
];

/**
 * 这段提示词是不是以官方开头起头的;是的话,是哪一个动作。认不出来回 `null`(**不猜**)。
 *
 * ── 结束边界(判官 r3 P2)────────────────────────────────────────────────
 * 光用 `startsWith` 不够:`Strictly edit <Video_1>, and modifyX …` 会被当成严格编辑,
 * 而那既不是装配器产出的形状,也不是官方句式。装配器产出的永远是
 * 「开头 + **一个空格** + 内容」(`${opening} ${…}.`),所以边界就是那个空格 ——
 * 判据取自装配器真会写出来的形状,不是随手加的一条正则。
 *
 * 认得比写得宽,就等于替引擎猜它会怎么读那段字;而这个判断的下游是**收费**。
 */
export function anchoredVideoAction(prompt: string): AnchoredVideoAction | null {
  const head = prompt.trimStart();
  for (const [action, opening] of OPENINGS) {
    // 开头之后必须紧跟一个空格,且空格后面还得有内容 —— 空壳开头不是一条指令。
    if (head.startsWith(`${opening} `) && head.length > opening.length + 1) return action;
  }
  return null;
}

/** 这段提示词要动的是商家自己那条片子吗。 */
export function isAnchoredVideoPrompt(prompt: string): boolean {
  return anchoredVideoAction(prompt) !== null;
}

// ---------------------------------------------------------------------------
// #922 缺口 B 前置 —— beta 期间哪一个动作开着,哪一个关着
// ---------------------------------------------------------------------------

/**
 * **下架名单**:key 在表上 = 这个动作现在关着,value = 商家读到的那一句。
 *
 * ── Founder 裁决(2026-08-14,部署窗口现场)────────────────────────────────
 * 「beta 期间下架续写动作的两面入口(手动 + Otto 提案),剪辑保留。」
 *
 * 依据是同一天的引擎实测(#922):引擎的 `duration` 是**成片总长**,不是增量,而本仓契约
 * 把参考视频的出片时长硬钉 5 秒(`GEN_VIDEO_SECONDS`)。于是对一条 5-6 秒的参考片
 * ——我们自己出的片全是 5 秒—— 续写,拿回来的整条就是原片的重演(实测首 5 秒 SSIM 0.954),
 * 新内容 0 秒,而商家照付 16 credits。剪辑不受这件事影响:它本来就是「同一条片子,改一处」。
 *
 * ── 为什么名单住在这里 ──────────────────────────────────────────────────
 * 读它的有三处,而且分散在三层:Otto 的能力表(提案那一端)、商家手动入口(界面那一端)、
 * 以及付费 schema `genRequest`(花钱那一端)。抄成三份,某一天就会有一处忘了改 ——
 * 而忘掉的那一处很可能正是收费的那一处。所以判据只有这一份,三处都从这里读。
 *
 * ── 恢复条件 ────────────────────────────────────────────────────────────
 * #922 缺口 B(续写时长脱离 5 秒硬钉 + 相应定价)裁决落地后,删掉 `extendClip` 那一行即可 ——
 * 上面三处会同时跟着开门,不需要再去改它们中的任何一处。
 */
export const ANCHORED_ACTION_UNAVAILABLE: Readonly<Partial<Record<AnchoredVideoAction, string>>> = {
  extendClip:
    "Carrying a clip on is switched off for now — changing something inside a clip you already have still works.",
};

/**
 * 这个动作现在关着吗。关着回**给商家看的那句话**,开着回 `null`。
 *
 * 回的是一句话而不是一个布尔,是因为每一处「关着」都要对商家开口,而三处各写一句就是
 * 三种说法 —— 商家在对话里听见的、在素材库里看见的、和确认时撞上的会互相矛盾。
 */
export function anchoredActionUnavailableReason(action: AnchoredVideoAction): string | null {
  return ANCHORED_ACTION_UNAVAILABLE[action] ?? null;
}
