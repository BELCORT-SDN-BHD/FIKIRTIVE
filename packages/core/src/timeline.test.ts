import { describe, expect, it } from "vitest";
import { artlioEdit, editDuration, srcToStorageKey, storageKeyToSrc } from "./timeline.js";

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
});
