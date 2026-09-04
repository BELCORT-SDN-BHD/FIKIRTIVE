export type OttoComposerReferenceKind = "image" | "refVideo";
export type OttoComposerReferencePreviewKind = "image" | "video";

export type OttoComposerReference = {
  requestId?: string;
  generationId: string;
  src: string;
  kind: OttoComposerReferenceKind;
  previewKind: OttoComposerReferencePreviewKind;
  label: string;
};

export const MAX_OTTO_COMPOSER_REFERENCES = 8;

export type OttoComposerTurnReferencePayload = {
  sourceGenerationId?: string;
  sourceGenerationIds?: string[];
  referenceVideoGenerationId?: string;
  referenceVideoGenerationIds?: string[];
};

export function upsertComposerReference<T extends { generationId: string }>(
  refs: T[],
  ref: T,
): T[] {
  const withoutExisting = refs.filter((r) => r.generationId !== ref.generationId);
  return [...withoutExisting, ref].slice(-MAX_OTTO_COMPOSER_REFERENCES);
}

export function upsertComposerReferences<T extends { generationId: string }>(
  refs: T[],
  nextRefs: T[],
): T[] {
  return nextRefs.reduce((acc, ref) => upsertComposerReference(acc, ref), refs);
}

export function removeComposerReference<T extends { generationId: string }>(
  refs: T[],
  generationId: string,
): T[] {
  return refs.filter((ref) => ref.generationId !== generationId);
}

export function composerReferencePayload(
  refs: { generationId: string; kind: OttoComposerReferenceKind }[],
): OttoComposerTurnReferencePayload {
  const imageIds = [...new Set(refs.filter((ref) => ref.kind === "image").map((ref) => ref.generationId))];
  const videoIds = [...new Set(refs.filter((ref) => ref.kind === "refVideo").map((ref) => ref.generationId))];
  return {
    ...(imageIds[0] ? { sourceGenerationId: imageIds[0], sourceGenerationIds: imageIds } : {}),
    ...(videoIds[0] ? { referenceVideoGenerationId: videoIds[0], referenceVideoGenerationIds: videoIds } : {}),
  };
}

export function composerReferencesPlaceholder(refs: { kind: OttoComposerReferenceKind }[]): string {
  if (refs.length === 0) return "Reply to Otto…";
  if (refs.length === 1) return `Tell Otto what to do with this ${refs[0]!.kind === "refVideo" ? "video" : "image"}…`;
  return `Tell Otto what to do with these ${refs.length} references…`;
}

/**
 * WHAT THE CANVAS SAYS ABOUT NEEDING A CONVERSATION (#548).
 *
 * Every paid action on the board works without an Otto chat — generate an image, make a video
 * from a prompt, make a video from a picture, make another take of one. Exactly one action still
 * needs a conversation, because a reference has nowhere to go without one: handing cards to Otto.
 *
 * The walkthrough found the board with three different answers to the same question. Two paid
 * actions charged and delivered; two others answered with a red error ("Open an Otto chat
 * first."); the video tool said nothing at all. Three shapes of the same fact, none of them
 * offered before the merchant pressed anything. The paid actions and the dead key were fixed at
 * the root (a canvas generation no longer takes a thread at all, and the video tool opens its own
 * composer); this is the last piece — the one remaining dependency, said BEFORE the press, in the
 * same words it is said after it. One sentence, one source: a control whose tooltip and whose
 * answer disagree is the same defect wearing different clothes.
 */
export const CANVAS_OTTO_CHAT_REQUIRED = "Start a conversation with Otto first, then send these over.";

/** The title the "Send to Otto" control carries right now — its own state, before any press. */
export function canvasSendToOttoTitle(input: { chatOpen: boolean; many: boolean }): string {
  if (!input.chatOpen) return CANVAS_OTTO_CHAT_REQUIRED;
  return input.many ? "Hand these to Otto as references" : "Hand this to Otto as a reference";
}

/**
 * Codex QA-CRE-FE9-013 —— 芯片上那几个字。
 *
 * 走查里 composer 上只写着 `Image ref`:商家从 Library 一次点了两张相似的产品图,分不清
 * 哪一张在车上,也无从在发送前发现自己选错了。素材有名字(它当初的提示词)时就用它,
 * 没有名字才退回类型词 —— 一个占位词不该是常态。
 */
export function composerReferenceLabel(
  name: string | null | undefined,
  kind: OttoComposerReferenceKind,
): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return kind === "refVideo" ? "Video ref" : "Image ref";
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed;
}

export function canvasComposerReferenceForNode(input: {
  type: string | null | undefined;
  generationId: string | null | undefined;
  src: string | null | undefined;
  /** 商家读得懂的名字(素材当初的提示词)。缺席就退回 `Image ref` / `Video ref`。 */
  name?: string | null;
}): Omit<OttoComposerReference, "requestId"> | null {
  if (!input.generationId || !input.src) return null;
  if (input.type === "image") {
    return {
      generationId: input.generationId,
      src: input.src,
      kind: "image",
      previewKind: "image",
      label: composerReferenceLabel(input.name, "image"),
    };
  }
  if (input.type === "video") {
    return {
      generationId: input.generationId,
      src: input.src,
      kind: "refVideo",
      previewKind: "video",
      label: composerReferenceLabel(input.name, "refVideo"),
    };
  }
  return null;
}
