import { describe, expect, it } from "vitest";
import { canvasComposerReferenceForNode, composerReferencePayload, composerReferencesPlaceholder, shouldIgnoreCanvasVideoReferenceClick, upsertComposerReferences } from "../canvas-chat-reference";

describe("canvasComposerReferenceForNode", () => {
  it("maps image canvas nodes to image references for Otto", () => {
    expect(canvasComposerReferenceForNode({ type: "image", generationId: "gen_img", src: "/files/img.png" })).toEqual({
      generationId: "gen_img",
      src: "/files/img.png",
      kind: "image",
      previewKind: "image",
      label: "Image ref",
    });
  });

  it("maps video canvas nodes to whole-video references for Otto", () => {
    expect(canvasComposerReferenceForNode({ type: "video", generationId: "gen_vid", src: "/files/clip.mp4" })).toEqual({
      generationId: "gen_vid",
      src: "/files/clip.mp4",
      kind: "refVideo",
      previewKind: "video",
      label: "Video ref",
    });
  });

  it("rejects nodes that cannot be sent as chat references", () => {
    expect(canvasComposerReferenceForNode({ type: "text", generationId: "gen_text", src: "/files/nope" })).toBeNull();
    expect(canvasComposerReferenceForNode({ type: "image", generationId: null, src: "/files/img.png" })).toBeNull();
    expect(canvasComposerReferenceForNode({ type: "video", generationId: "gen_vid", src: null })).toBeNull();
  });

  it("ignores native video-control clicks when controls are visible", () => {
    expect(shouldIgnoreCanvasVideoReferenceClick({ targetTagName: "video", controlsVisible: true })).toBe(true);
    expect(shouldIgnoreCanvasVideoReferenceClick({ targetTagName: "VIDEO", controlsVisible: true })).toBe(true);
    expect(shouldIgnoreCanvasVideoReferenceClick({ targetTagName: "video", controlsVisible: false })).toBe(false);
    expect(shouldIgnoreCanvasVideoReferenceClick({ targetTagName: "button", controlsVisible: true })).toBe(false);
  });

  it("appends multiple canvas references without losing earlier selections", () => {
    const refs = upsertComposerReferences([], [
      { generationId: "gen-img", kind: "image" as const, previewKind: "image" as const, src: "/img.png", label: "Image ref" },
      { generationId: "gen-vid", kind: "refVideo" as const, previewKind: "video" as const, src: "/clip.mp4", label: "Video ref" },
    ]);
    expect(refs.map((ref) => ref.generationId)).toEqual(["gen-img", "gen-vid"]);
    expect(composerReferencesPlaceholder(refs)).toBe("Tell Otto what to do with these 2 references…");
  });

  it("builds the strict Otto turn payload with all selected image and video refs", () => {
    expect(composerReferencePayload([
      { generationId: "gen-img-1", kind: "image" },
      { generationId: "gen-vid-1", kind: "refVideo" },
      { generationId: "gen-img-2", kind: "image" },
    ])).toEqual({
      sourceGenerationId: "gen-img-1",
      sourceGenerationIds: ["gen-img-1", "gen-img-2"],
      referenceVideoGenerationId: "gen-vid-1",
      referenceVideoGenerationIds: ["gen-vid-1"],
    });
  });
});
