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
