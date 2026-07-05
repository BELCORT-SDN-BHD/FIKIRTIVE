import { describe, expect, it } from "vitest";
import { canvasComposerReferenceForNode, shouldIgnoreCanvasVideoReferenceClick } from "../canvas-chat-reference";

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
});
