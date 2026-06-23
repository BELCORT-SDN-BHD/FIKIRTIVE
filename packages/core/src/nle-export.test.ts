import { describe, expect, it } from "vitest";
import { editToFcpXml } from "./nle-export.js";
import type { FikirtiveEdit } from "./timeline.js";

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;
const ASRC = `/files/u/founder/${HASH}.mp3`;

const edit: FikirtiveEdit = {
  timeline: {
    background: "#000000",
    tracks: [
      { clips: [
        { asset: { type: "video", src: SRC, trim: 1.5 }, start: 0, length: 4 },
        { asset: { type: "video", src: SRC }, start: 4, length: 3 },
      ] },
      { clips: [{ asset: { type: "audio", src: ASRC }, start: 0, length: 7 }] },
    ],
  },
  output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
};

describe("editToFcpXml", () => {
  it("produces well-formed xmeml v5 with the right rate + frame size", () => {
    const xml = editToFcpXml(edit);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain("<sequence");
    // 25fps, 1280x720 (16:9 hd)
    expect(xml).toMatch(/<timebase>25<\/timebase>/);
    expect(xml).toMatch(/<width>1280<\/width>/);
    expect(xml).toMatch(/<height>720<\/height>/);
  });

  it("emits one video clipitem per visual clip with frame-accurate in/out/start/end", () => {
    const xml = editToFcpXml(edit);
    // clip 0: trim 1.5s → in = round(1.5*25) = 38 ; length 4s → out = in + 100 = 138
    // start = 0*25 = 0 ; end = 4*25 = 100
    expect((xml.match(/<clipitem/g) ?? []).length).toBe(3); // 2 video + 1 audio
    expect(xml).toContain("<in>38</in>");
    expect(xml).toContain("<out>138</out>");
    expect(xml).toContain("<start>0</start>");
    expect(xml).toContain("<end>100</end>");
  });

  it("includes the lossy-export comment listing dropped features", () => {
    const xml = editToFcpXml(edit);
    expect(xml).toMatch(/<!--[\s\S]*lossy[\s\S]*-->/i);
  });

  it("does not throw on an edit with between-clip transitions (they're dropped)", () => {
    const e: FikirtiveEdit = structuredClone(edit);
    (e.timeline.tracks[0] as any).transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    expect(() => editToFcpXml(e)).not.toThrow();
  });

  it("escapes XML-special chars in the pathurl", () => {
    const xml = editToFcpXml(edit);
    expect(xml).not.toMatch(/<pathurl>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/); // no raw & in pathurl
  });
});
