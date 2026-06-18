import { describe, expect, it } from "vitest";
import { artlioEdit } from "./timeline.js";

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneEdit = (): any => structuredClone(baseEdit);

// one 6s visual clip — editDuration = 6
const baseEdit = {
  timeline: {
    tracks: [{ clips: [{ asset: { type: "video", src: SRC }, start: 0, length: 6 }] }],
  },
  output: { format: "mp4" },
};

describe("EP3 captions[] + textOverlays[] contract (additive, bounded)", () => {
  it("backward-compat: an edit with NO captions/textOverlays still parses", () => {
    const parsed = artlioEdit.parse(baseEdit);
    expect(parsed.timeline.captions).toBeUndefined();
    expect(parsed.timeline.textOverlays).toBeUndefined();
  });

  it("captions happy path round-trips", () => {
    const ok = cloneEdit();
    ok.timeline.captions = [
      { startMs: 0, lengthMs: 1500, text: "hello" },
      { startMs: 1500, lengthMs: 1500, text: "world" },
    ];
    const parsed = artlioEdit.parse(ok);
    expect(parsed.timeline.captions).toEqual([
      { startMs: 0, lengthMs: 1500, text: "hello" },
      { startMs: 1500, lengthMs: 1500, text: "world" },
    ]);
  });

  it("textOverlays happy path round-trips (with style)", () => {
    const ok = cloneEdit();
    ok.timeline.textOverlays = [
      { startMs: 500, lengthMs: 2000, text: "TITLE", position: "top", style: { fontSize: 48, color: "#ffffff" } },
    ];
    const parsed = artlioEdit.parse(ok);
    expect(parsed.timeline.textOverlays).toEqual([
      { startMs: 500, lengthMs: 2000, text: "TITLE", position: "top", style: { fontSize: 48, color: "#ffffff" } },
    ]);
  });

  it("textOverlay applies position/style defaults (bottom, 48px, #ffffff) when omitted", () => {
    const ok = cloneEdit();
    ok.timeline.textOverlays = [{ startMs: 0, lengthMs: 2000, text: "DEFAULTS" }];
    const parsed = artlioEdit.parse(ok);
    expect(parsed.timeline.textOverlays).toEqual([
      { startMs: 0, lengthMs: 2000, text: "DEFAULTS", position: "bottom", style: { fontSize: 48, color: "#ffffff" } },
    ]);
  });

  it("textOverlay applies nested style defaults when style is present as {}", () => {
    const ok = cloneEdit();
    ok.timeline.textOverlays = [{ startMs: 0, lengthMs: 2000, text: "STYLE", style: {} }];
    const parsed = artlioEdit.parse(ok);
    expect(parsed.timeline.textOverlays?.[0]?.style).toEqual({ fontSize: 48, color: "#ffffff" });
  });

  // bounds reject (the codex rule: every number finite + bounded)
  it("rejects a caption with lengthMs 0 (gt(0))", () => {
    const bad = cloneEdit();
    bad.timeline.captions = [{ startMs: 0, lengthMs: 0, text: "x" }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects a negative startMs (min(0))", () => {
    const bad = cloneEdit();
    bad.timeline.captions = [{ startMs: -1, lengthMs: 100, text: "x" }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects a caption lengthMs above MAX_CLIP_SECONDS*1000", () => {
    const bad = cloneEdit();
    bad.timeline.captions = [{ startMs: 0, lengthMs: 60 * 10 * 1000 + 1, text: "x" }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects caption text over MAX_CAPTION_CHARS", () => {
    const bad = cloneEdit();
    bad.timeline.captions = [{ startMs: 0, lengthMs: 100, text: "a".repeat(501) }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects overlay fontSize above MAX_FONT_PX", () => {
    const bad = cloneEdit();
    bad.timeline.textOverlays = [{ startMs: 0, lengthMs: 100, text: "x", style: { fontSize: 201 } }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects a non-hex overlay color", () => {
    const bad = cloneEdit();
    bad.timeline.textOverlays = [{ startMs: 0, lengthMs: 100, text: "x", style: { color: "red" } }];
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  // bounds-in-context (validated in timeline.superRefine where editDuration is in scope)
  it("rejects a caption window that runs past editDuration", () => {
    const bad = cloneEdit(); // editDuration = 6s
    bad.timeline.captions = [{ startMs: 5000, lengthMs: 2000, text: "overflow" }]; // ends at 7s > 6s
    expect(() => artlioEdit.parse(bad)).toThrow(/caption window ends past the timeline/);
  });

  it("rejects a text overlay window that runs past editDuration", () => {
    const bad = cloneEdit(); // editDuration = 6s
    bad.timeline.textOverlays = [{ startMs: 5000, lengthMs: 2000, text: "overflow" }]; // ends at 7s > 6s
    expect(() => artlioEdit.parse(bad)).toThrow(/text overlay window ends past the timeline/);
  });

  // count caps
  it("rejects more than MAX_CAPTIONS cues", () => {
    const bad = cloneEdit();
    bad.timeline.captions = Array.from({ length: 501 }, () => ({ startMs: 0, lengthMs: 100, text: "x" }));
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  it("rejects more than MAX_OVERLAYS overlays", () => {
    const bad = cloneEdit();
    bad.timeline.textOverlays = Array.from({ length: 51 }, () => ({ startMs: 0, lengthMs: 100, text: "x" }));
    expect(() => artlioEdit.parse(bad)).toThrow();
  });

  // canonicalizing: a plain zod object strips unknown cue fields
  it("strips an unknown extra field on a caption cue", () => {
    const ok = cloneEdit();
    ok.timeline.captions = [{ startMs: 0, lengthMs: 100, text: "x", bogus: 1 }];
    const parsed = artlioEdit.parse(ok);
    expect(parsed.timeline.captions?.[0]).not.toHaveProperty("bogus");
    expect(parsed.timeline.captions?.[0]).toEqual({ startMs: 0, lengthMs: 100, text: "x" });
  });
});
