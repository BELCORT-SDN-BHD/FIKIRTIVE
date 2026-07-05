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

export function canvasComposerReferenceForNode(input: {
  type: string | null | undefined;
  generationId: string | null | undefined;
  src: string | null | undefined;
}): Omit<OttoComposerReference, "requestId"> | null {
  if (!input.generationId || !input.src) return null;
  if (input.type === "image") {
    return {
      generationId: input.generationId,
      src: input.src,
      kind: "image",
      previewKind: "image",
      label: "Image ref",
    };
  }
  if (input.type === "video") {
    return {
      generationId: input.generationId,
      src: input.src,
      kind: "refVideo",
      previewKind: "video",
      label: "Video ref",
    };
  }
  return null;
}

export function shouldIgnoreCanvasVideoReferenceClick(input: {
  targetTagName: string | null | undefined;
  controlsVisible: boolean;
}): boolean {
  return input.controlsVisible && input.targetTagName?.toLowerCase() === "video";
}
