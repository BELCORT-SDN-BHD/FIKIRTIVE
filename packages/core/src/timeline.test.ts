import { describe, expect, it } from "vitest";
import { artlioEdit, editDuration, renderJobData, srcToStorageKey, storageKeyToSrc } from "./timeline.js";

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneEdit = (): any => structuredClone(validEdit);

const validEdit = {
  timeline: {
    tracks: [
      {
        clips: [
          { asset: { type: "video", src: SRC, trim: 1.5 }, start: 0, length: 4 },
          { asset: { type: "video", src: SRC }, start: 4, length: 3, transition: { in: "fade" } },
        ],
      },
      {
        clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 7 }],
      },
    ],
  },
  output: { format: "mp4" },
};

describe("artlioEdit contract", () => {
  it("accepts a valid two-clip edit with music and applies defaults", () => {
    const parsed = artlioEdit.parse(validEdit);
    expect(parsed.output.resolution).toBe("1080");
    expect(parsed.output.fps).toBe(25);
    expect(parsed.timeline.background).toBe("#000000");
    expect(editDuration(parsed)).toBe(7);
  });

  it("rejects overlapping clips on one track", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips[1].start = 2; // overlaps clip 1 (0..4)
    expect(() => artlioEdit.parse(bad)).toThrow(/overlap/);
  });

  it("rejects a second visual track (scope boundary)", () => {
    const bad = cloneEdit();
    bad.timeline.tracks.push({
      clips: [{ asset: { type: "image", src: `/files/u/founder/${HASH}.png` }, start: 0, length: 2 }],
    });
    expect(() => artlioEdit.parse(bad)).toThrow(/visual track/);
  });

  it("rejects external URLs — only app-relative /files sources", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips[0].asset.src = "https://evil.example/x.mp4";
    expect(() => artlioEdit.parse(bad)).toThrow(/app-relative/);
  });

  it("rejects audio clips mixed into a visual track", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips.push({
      asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` },
      start: 8,
      length: 1,
    });
    expect(() => artlioEdit.parse(bad)).toThrow(/own track/);
  });

  it("round-trips src ↔ storage key", () => {
    expect(storageKeyToSrc(srcToStorageKey(SRC))).toBe(SRC);
    expect(srcToStorageKey(SRC)).toBe(`u/founder/${HASH}.mp4`);
  });

  // ---- codex review hardening (2026-06-11) ----

  it("rejects non-finite and out-of-cap numbers", () => {
    for (const patch of [
      (b: ReturnType<typeof cloneEdit>) => (b.timeline.tracks[0].clips[0].length = Infinity),
      (b: ReturnType<typeof cloneEdit>) => (b.timeline.tracks[0].clips[0].length = NaN),
      (b: ReturnType<typeof cloneEdit>) => (b.timeline.tracks[0].clips[0].start = -1),
      (b: ReturnType<typeof cloneEdit>) => (b.timeline.tracks[0].clips[0].length = 601), // > 10 min/clip
      (b: ReturnType<typeof cloneEdit>) => (b.timeline.tracks[0].clips[0].asset.trim = 1e9),
    ]) {
      const bad = cloneEdit();
      patch(bad);
      expect(() => artlioEdit.parse(bad)).toThrow();
    }
  });

  it("rejects a timeline over the 30-minute cap", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips = Array.from({ length: 4 }, (_, i) => ({
      asset: { type: "video", src: SRC },
      start: i * 590,
      length: 590,
    }));
    expect(() => artlioEdit.parse(bad)).toThrow(/cap is/);
  });

  it("strips unknown fields on parse — the parsed value is the canonical contract", () => {
    const dirty = cloneEdit();
    dirty.timeline.cache = true; // Shotstack extras we don't support
    dirty.timeline.tracks[0].clips[0].effect = "zoomIn";
    dirty.timeline.tracks[0].clips[0].asset.crop = { top: 0.1 };
    dirty.output.quality = "high";
    const parsed = artlioEdit.parse(dirty);
    expect(JSON.stringify(parsed)).not.toMatch(/cache|zoomIn|crop|quality/);
  });

  it("does not let __proto__ keys poison the parsed object", () => {
    const dirty = JSON.parse(
      JSON.stringify(cloneEdit()).replace('"timeline"', '"__proto__":{"polluted":1},"timeline"'),
    );
    const parsed = artlioEdit.parse(dirty);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toMatch(/polluted/);
  });

  it("rejects asset type ↔ extension mismatches", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[1].clips[0].asset.src = SRC; // audio asset pointing at .mp4
    expect(() => artlioEdit.parse(bad)).toThrow(/audio asset src/);
    const bad2 = cloneEdit();
    bad2.timeline.tracks[0].clips[0].asset.src = `/files/u/founder/${HASH}.mp3`;
    expect(() => artlioEdit.parse(bad2)).toThrow(/video asset src/);
  });

  it("transition rules: visual-only, default duration, min clip length", () => {
    const parsed = artlioEdit.parse(validEdit);
    expect(parsed.timeline.tracks[0]!.clips[1]!.transition?.duration).toBe(0.5);

    const onAudio = cloneEdit();
    onAudio.timeline.tracks[1].clips[0].transition = { in: "fade" };
    expect(() => artlioEdit.parse(onAudio)).toThrow(/visual-track only/);

    const tooShort = cloneEdit();
    tooShort.timeline.tracks[0].clips[1].length = 0.8; // < 2×0.5s fade
    expect(() => artlioEdit.parse(tooShort)).toThrow(/too short for its/);
  });

  it("validates renderJobData", () => {
    expect(() => renderJobData.parse({})).toThrow();
    expect(() => renderJobData.parse({ renderJobId: "" })).toThrow();
    expect(renderJobData.parse({ renderJobId: "abc" }).renderJobId).toBe("abc");
  });
});
