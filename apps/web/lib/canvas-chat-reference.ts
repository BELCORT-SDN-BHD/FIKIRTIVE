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
