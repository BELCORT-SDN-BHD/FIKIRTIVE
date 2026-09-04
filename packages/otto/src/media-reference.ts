/**
 * media-reference —— 一件媒体参考回执的**唯一**构造处(纯函数,零 I/O)。
 *
 * 回执是商家在按下 `Generate · N credits` 之前读到的那一行:上车的到底是哪一件、它叫什么、
 * 长什么样、来自哪一块画布。`planCardGate` 把「卡上有 id 却没有回执」判成不可批准,所以
 * **每一个铸卡入口都得会造它**。
 *
 * 在这之前只有一个入口会造(`validateOttoTurnReferences`,apps/web),名字与缩略图的口径就
 * 写死在那个函数里。Codex E2E-CRE-PAV-004 的两步接力多了第二个铸卡入口(服务端在 Step 1
 * 出图之后自己铸第二张卡),那一份回执必须与商家在第一张卡上读到的**逐字同源** —— 两份
 * 口径就是两种说法,而商家会以为是两件不同的东西。所以口径搬到这里,两边都调它。
 *
 * 只做映射:不查库、不判归属、不选型、不报价。归属与可用性由调用方在读那一行时判定。
 */
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import type { OttoMediaReference } from "./context.js";

/** 商家读得懂的一行名字。素材当初的提示词太长就截断,空的就退回类型词。 */
export function referenceLabel(prompt: string, kind: "image" | "video"): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return kind === "video" ? "Video" : "Image";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

/** 画布读不到名字时回执上写的那一句 —— 回执可以少一个好名字,不能少一行。 */
export const UNTITLED_CANVAS_NAME = "Untitled canvas";

/**
 * 一件已经确认属于这个 owner 的素材 → 它的回执。
 *
 * `previewUrl` 是同源、内容寻址的 `/files/<key>`(不是会过期的签名链接),所以把它冻进卡里
 * 是安全的:租户校验在读取那一刻由 `/files` 自己做。
 */
export function mediaReferenceReceipt(input: {
  generationId: string;
  kind: "image" | "video";
  /** 这件素材当初的提示词 —— 回执上那个名字的来源。 */
  prompt: string;
  sourceProjectId: string;
  /** 画布名;空/读不到就传 undefined,这里退回 `UNTITLED_CANVAS_NAME`。 */
  sourceProjectName?: string | null;
  /** 它出生的那块画布是不是商家此刻这一块。 */
  sameCanvas: boolean;
  asset: { ownerId: string; contentHash: string; ext: string };
}): OttoMediaReference {
  return {
    generationId: input.generationId,
    kind: input.kind,
    label: referenceLabel(input.prompt, input.kind),
    sourceProjectId: input.sourceProjectId,
    sourceProjectName: input.sourceProjectName?.trim() || UNTITLED_CANVAS_NAME,
    sameCanvas: input.sameCanvas,
    previewUrl: storageKeyToSrc(
      storageKey(input.asset.ownerId, input.asset.contentHash, input.asset.ext.toLowerCase()),
    ),
  };
}
