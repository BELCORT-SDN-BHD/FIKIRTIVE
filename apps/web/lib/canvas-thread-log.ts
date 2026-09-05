/**
 * canvas-thread-log —— 画布上**节点级付费动作**落进这块画布对话历史的那一处写点。
 *
 * ## 为什么有这个文件
 *
 * Founder 2026-09-04 20:45 裁决(编排者代记)：「画布即对话 → 落成规则。画布上任何付费
 * 出图出片都写进这张画布的对话历史（请求、确认、结果），刷新与换浏览器都在。」
 *
 * #1211(ENGINE-A3)已经把**主输入框**那条路搬进对话：送出即 `startStreamedThread`，
 * USER 一条、卡一张、结果一条，全部落库。但节点级那几条付费路——卡上的「再来一张」
 * (`FlowCanvas.runImageEvolve`)、Animate、视频「照这条再来一次」、t2v 弹窗——只把
 * `threadId` 当标签挂到 `GenJob` 上（`gen-actions.ts` 的 cowork tag），**既不落 USER
 * 也不落卡**：刷新之后那条对话里什么都没有，商家只在画布上看得见一张卡。这个文件补的
 * 就是那两行。
 *
 * ## 它写什么、不写什么
 *
 * 写：一条 USER（这一下按的是什么动作 + 商家自己那句话）＋一张 **GEN_CARD**（钱数与规格
 * 是这一趟真的会扣的那一份）。卡上写 `genJobId` —— 这一格就是「这张卡已经批过了」的
 * durable 说法（`deriveCardState`：有 genJobId ⇒ working/done/failed，永远不是 idle，
 * 于是 `OttoPlanCard.approve()` 那道闸自己就关上了）。
 *
 * 不写：**结果**。结果那一条一直都由 worker 写（`apps/worker/src/jobs/gen.ts`
 * 的 `appendCoworkResult`，GEN_RESULT / TURN_ERROR，按 `ChatMessage(genJobId)` 部分唯一
 * 索引 effectively-once），而它认的判据是 `job.threadId` —— 节点级这几条路本来就带着
 * threadId，所以结果那一半从来就是通的。这里不碰它。
 *
 * ## 钱
 *
 * 一分钱都不动：两行都是 ChatMessage，没有 reserve / settle / refund，账本零新增行。
 * 卡面那个数由调用方从**同一份** `pricedGenCredits`／`displayCredits` 传进来（`startGen`
 * 里那一个 `displayedCost`），这里绝不自己再算一遍 —— 卡面与预扣额只许有一个来源。
 *
 * ## 措辞
 *
 * 动作原话是**闭集**，由服务端从这一趟请求的形状自己判（`canvasPaidActionOf`），不收
 * 客户端送来的自由文本：历史是商家自己的记录，不该由浏览器随便往里写字。
 */
import { buildSpecChips, newId, type SpecChipParams } from "@fikirtive/core";

/** 节点级付费动作的闭集 —— 键是判据，值是落进 USER 消息的那句话（English sentence case）。 */
export const CANVAS_PAID_ACTION_TEXT = {
  /** 卡上的「再来一张 / 改这张图」——带着这张图当底图的一次付费出图。 */
  makeAnother: "Make another like this",
  /** 画布上一次没有底图的付费出图。 */
  makeImage: "Make an image",
  /** 卡上的 Animate —— 拿这张图当首帧的一次付费出片。 */
  animate: "Animate this",
  /** t2v 弹窗 / 视频「照这条再来一次」—— 没有首帧的一次付费出片。 */
  makeVideo: "Make a video",
} as const;

export type CanvasPaidAction = keyof typeof CANVAS_PAID_ACTION_TEXT;

/**
 * 这一趟付费请求是哪一个节点级动作。
 *
 * 判据只有请求本身的两格（要出的是图还是片、带不带底图），所以浏览器改不动它，
 * 也不可能与真正上路的那一趟说两件事。
 */
export function canvasPaidActionOf(kind: "image" | "video", hasSourceImage: boolean): CanvasPaidAction {
  if (kind === "video") return hasSourceImage ? "animate" : "makeVideo";
  return hasSourceImage ? "makeAnother" : "makeImage";
}

/** 落进 USER 消息的那一句：动作原话 + 商家自己写的那段。 */
export function canvasPaidActionText(action: CanvasPaidAction, prompt: string): string {
  const words = prompt.trim();
  return words ? `${CANVAS_PAID_ACTION_TEXT[action]}: ${words}` : CANVAS_PAID_ACTION_TEXT[action];
}

/** 这张卡上除 `structuredPrompt` 之外要冻下来的那几格。 */
export type CanvasPaidCardInput = {
  kind: "image" | "video";
  /** 槽位名。与 Otto 铸的卡同一格；`toChatMessageDTO` 在送到浏览器之前把它剥掉。 */
  model: string;
  /** 这一趟真会跑的那份 params —— 卡面规格条目由它派生（`buildSpecChips`，唯一一次）。 */
  params: SpecChipParams;
  /** 带底图（编辑底图 / 首帧）。只影响卡面措辞，不影响钱。 */
  hasSourceImage: boolean;
  /** 商家这一趟真的送上路的那段话。 */
  prompt: string;
  entityIds: string[];
  variantSel: Record<string, string> | null;
  /** `displayCredits(pricedGenCredits(...))` —— 调用方算好的那一个数，这里不重算。 */
  estimatedCredits: number;
};

/** 一张画布节点级付费卡的 payload（与 Otto 路同形，少的几格在文件抬头说明）。 */
export function buildCanvasPaidCardPayload(input: CanvasPaidCardInput): Record<string, unknown> {
  return {
    kind: input.kind,
    model: input.model,
    params: { ...input.params },
    // `reason` 是审计/路由说明，永远不渲染（`toChatMessageDTO` 剥掉）。这条路上没有模型
    // 选型可解释 —— 动作是商家自己按的那个键，所以照实写这一句。
    reason: `canvas node action (${canvasPaidActionOf(input.kind, input.hasSourceImage)})`,
    specChips: buildSpecChips(input.kind, input.params, input.hasSourceImage),
    downgraded: false,
    structuredPrompt: input.prompt,
    entityIds: [...input.entityIds],
    variantSel: input.variantSel ?? {},
    estimatedCredits: input.estimatedCredits,
    // 这张卡记录的是一次**已经批过、已经扣过**的动作。带上这一格，
    // `startCoworkGen` 就把它挡在付费入口之外（fail closed，见 gen-actions.ts）。
    canvasAction: canvasPaidActionOf(input.kind, input.hasSourceImage),
  };
}

/** 落库需要的最小事务接口 —— 只用到 chatMessage 的两个方法，测试可以直接喂 `prisma`。 */
export type CanvasThreadLogTx = {
  chatMessage: {
    findFirst(args: unknown): Promise<{ seq: number } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

export type CanvasPaidLogInput = CanvasPaidCardInput & {
  threadId: string;
  ownerId: string;
  /** 这一趟建出来的那一行任务。写在卡上 = 这张卡已经批过了，谁也不能再按一次。 */
  genJobId: string;
};

/**
 * 把一次画布节点级付费动作写进这条线程：USER 一条、已批准的卡一张。
 *
 * **必须在调用方那笔事务里跑**（`startGen` 的钱事务）：两行与 GenJob 同生同死 ——
 * 建了任务却没有历史，或者有历史却没有任务，两种都不许出现。重放（同一个 actionId
 * 再来一次）在 `startGen` 更早的 `canvasHistoryVerdict` 那一支就返回了，根本走不到这里，
 * 所以同一个动作不会落两次。
 */
export async function appendCanvasPaidAction(
  tx: CanvasThreadLogTx,
  input: CanvasPaidLogInput,
): Promise<void> {
  const { threadId, ownerId, genJobId } = input;
  const last = await tx.chatMessage.findFirst({
    where: { threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const action = canvasPaidActionOf(input.kind, input.hasSourceImage);
  await tx.chatMessage.create({
    data: {
      id: newId(),
      threadId,
      ownerId,
      role: "USER",
      kind: "TEXT",
      seq,
      text: canvasPaidActionText(action, input.prompt),
    },
  });
  await tx.chatMessage.create({
    data: {
      id: newId(),
      threadId,
      ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq: seq + 1,
      text: "",
      genJobId,
      payload: buildCanvasPaidCardPayload(input),
    },
  });
}
