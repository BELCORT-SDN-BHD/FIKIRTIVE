import { describe, expect, it } from "vitest";
import {
  fikirtiveEdit,
  AUDIO_ROLES,
  betweenClipTransition,
  editDuration,
  foreignEditSrcs,
  renderDuration,
  renderJobData,
  srcToStorageKey,
  storageKeyToSrc,
} from "./timeline.js";

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

describe("fikirtiveEdit contract", () => {
  it("accepts a valid two-clip edit with music and applies defaults", () => {
    const parsed = fikirtiveEdit.parse(validEdit);
    expect(parsed.output.resolution).toBe("hd"); // 720p default cap (1080 OOM'd ffmpeg)
    expect(parsed.output.fps).toBe(25);
    expect(parsed.timeline.background).toBe("#000000");
    expect(editDuration(parsed)).toBe(7);
  });

  it("rejects overlapping clips on one track", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips[1].start = 2; // overlaps clip 1 (0..4)
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/overlap/);
  });

  it("rejects a second visual track (scope boundary)", () => {
    const bad = cloneEdit();
    bad.timeline.tracks.push({
      clips: [{ asset: { type: "image", src: `/files/u/founder/${HASH}.png` }, start: 0, length: 2 }],
    });
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/visual track/);
  });

  it("rejects external URLs — only app-relative /files sources", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips[0].asset.src = "https://evil.example/x.mp4";
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/app-relative/);
  });

  it("rejects audio clips mixed into a visual track", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips.push({
      asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` },
      start: 8,
      length: 1,
    });
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/own track/);
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
      expect(() => fikirtiveEdit.parse(bad)).toThrow();
    }
  });

  it("rejects a timeline over the 30-minute cap", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[0].clips = Array.from({ length: 4 }, (_, i) => ({
      asset: { type: "video", src: SRC },
      start: i * 590,
      length: 590,
    }));
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/cap is/);
  });

  it("strips unknown fields on parse — the parsed value is the canonical contract", () => {
    const dirty = cloneEdit();
    dirty.timeline.cache = true; // Shotstack extras we don't support
    dirty.timeline.tracks[0].clips[0].effect = "zoomIn";
    dirty.timeline.tracks[0].clips[0].asset.crop = { top: 0.1 };
    dirty.output.quality = "high";
    const parsed = fikirtiveEdit.parse(dirty);
    expect(JSON.stringify(parsed)).not.toMatch(/cache|zoomIn|crop|quality/);
  });

  it("does not let __proto__ keys poison the parsed object", () => {
    const dirty = JSON.parse(
      JSON.stringify(cloneEdit()).replace('"timeline"', '"__proto__":{"polluted":1},"timeline"'),
    );
    const parsed = fikirtiveEdit.parse(dirty);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toMatch(/polluted/);
  });

  it("rejects asset type ↔ extension mismatches", () => {
    const bad = cloneEdit();
    bad.timeline.tracks[1].clips[0].asset.src = SRC; // audio asset pointing at .mp4
    expect(() => fikirtiveEdit.parse(bad)).toThrow(/audio asset src/);
    const bad2 = cloneEdit();
    bad2.timeline.tracks[0].clips[0].asset.src = `/files/u/founder/${HASH}.mp3`;
    expect(() => fikirtiveEdit.parse(bad2)).toThrow(/video asset src/);
  });

  it("transition rules: visual-only, default duration, min clip length", () => {
    const parsed = fikirtiveEdit.parse(validEdit);
    expect(parsed.timeline.tracks[0]!.clips[1]!.transition?.duration).toBe(0.5);

    const onAudio = cloneEdit();
    onAudio.timeline.tracks[1].clips[0].transition = { in: "fade" };
    expect(() => fikirtiveEdit.parse(onAudio)).toThrow(/visual-track only/);

    const tooShort = cloneEdit();
    tooShort.timeline.tracks[0].clips[1].length = 0.8; // < 2×0.5s fade
    expect(() => fikirtiveEdit.parse(tooShort)).toThrow(/too short for its/);
  });

  it("validates renderJobData", () => {
    expect(() => renderJobData.parse({})).toThrow();
    expect(() => renderJobData.parse({ renderJobId: "" })).toThrow();
    expect(renderJobData.parse({ renderJobId: "abc" }).renderJobId).toBe("abc");
  });
});

// ---- OPT-4 EP1: real between-clip transitions (2026-06-18) ----

describe("betweenClipTransition zod", () => {
  it("accepts a minimal cross transition and defaults nothing extra", () => {
    const t = betweenClipTransition.parse({ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 });
    expect(t.type).toBe("cross");
    expect(t.durationMs).toBe(500);
    expect(t.direction).toBeUndefined();
  });

  it("accepts a directional slide", () => {
    const t = betweenClipTransition.parse({ fromClipIndex: 0, toClipIndex: 1, type: "slide", durationMs: 300, direction: "left" });
    expect(t.direction).toBe("left");
  });

  it("rejects type 'none' (absence = no transition entry)", () => {
    expect(() => betweenClipTransition.parse({ fromClipIndex: 0, toClipIndex: 1, type: "none", durationMs: 500 })).toThrow();
  });

  it("rejects non-integer / non-adjacent / out-of-bound indices and durations", () => {
    const base = { fromClipIndex: 0, toClipIndex: 1, type: "fade", durationMs: 500 };
    expect(() => betweenClipTransition.parse({ ...base, fromClipIndex: 1.5 })).toThrow();
    expect(() => betweenClipTransition.parse({ ...base, fromClipIndex: -1 })).toThrow();
    expect(() => betweenClipTransition.parse({ ...base, durationMs: 0 })).toThrow();
    expect(() => betweenClipTransition.parse({ ...base, durationMs: 2001 })).toThrow(); // > TRANSITION_MAX_SECONDS*1000
    expect(() => betweenClipTransition.parse({ ...base, durationMs: 1.5 })).toThrow(); // must be int
  });
});

describe("track.transitions (between-clip)", () => {
  // validEdit's visual track is gapless: [0..4][4..7]; index 0→1 is adjacent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withTransitions = (trs: unknown[]): any => {
    const e = cloneEdit();
    e.timeline.tracks[0].transitions = trs;
    return e;
  };

  it("accepts a transition between two gapless-adjacent visual clips", () => {
    const parsed = fikirtiveEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }]));
    expect(parsed.timeline.tracks[0]!.transitions?.[0]?.type).toBe("cross");
  });

  it("rejects a dangling clip index", () => {
    expect(() => fikirtiveEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 5, type: "cross", durationMs: 500 }]))).toThrow(/index|adjacent/i);
  });

  it("rejects a non-consecutive pair (from+1 != to)", () => {
    // add a third clip so index 0→? has room, then point 0→2
    const e = cloneEdit();
    e.timeline.tracks[0].clips.push({ asset: { type: "video", src: SRC }, start: 7, length: 3 });
    e.timeline.tracks[0].transitions = [{ fromClipIndex: 0, toClipIndex: 2, type: "cross", durationMs: 500 }];
    expect(() => fikirtiveEdit.parse(e)).toThrow(/adjacent|consecutive/i);
  });

  it("rejects a transition that references the audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].clips.push({ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 7, length: 3 });
    e.timeline.tracks[1].transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    expect(() => fikirtiveEdit.parse(e)).toThrow(/visual/i);
  });

  it("rejects a duration longer than half the shorter adjacent clip", () => {
    // shorter adjacent clip is clip 1 (3s) → half = 1500ms; 1600ms must fail
    expect(() => fikirtiveEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 1600 }]))).toThrow(/too long|half|clip/i);
  });

  it("rejects a transition on a non-gapless adjacent pair (LOCAL gapless check)", () => {
    // introduce a gap before clip 1, then place a transition across that gap
    const e = cloneEdit();
    e.timeline.tracks[0].clips[1].start = 5; // [0..4] then [5..8] → 1s gap
    e.timeline.tracks[0].transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    expect(() => fikirtiveEdit.parse(e)).toThrow(/gap|tile|contiguous|adjacent/i);
  });

  it("rejects two transitions on the same boundary (duplicate fromClipIndex)", () => {
    // renderDuration sums all entries but the worker collapses by fromClipIndex into
    // one xfade — a duplicate boundary would double-count the subtracted overlap.
    const dup = withTransitions([
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
      { fromClipIndex: 0, toClipIndex: 1, type: "wipe", durationMs: 300 },
    ]);
    expect(() => fikirtiveEdit.parse(dup)).toThrow(/duplicate|at most one|boundary/i);
  });

  it("accepts transitions on distinct boundaries of a 3-clip track", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips = [
      { asset: { type: "video", src: SRC }, start: 0, length: 4 },
      { asset: { type: "video", src: SRC }, start: 4, length: 4 },
      { asset: { type: "video", src: SRC }, start: 8, length: 4 },
    ];
    e.timeline.tracks[1].clips[0].length = 12;
    e.timeline.tracks[0].transitions = [
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
      { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 500 },
    ];
    expect(() => fikirtiveEdit.parse(e)).not.toThrow();
  });

  it("still accepts a visual track WITH a gap but NO transitions (backward-compat)", () => {
    // legacy saved edits may contain gaps (renderer ignores start); a gap with no
    // transition must still parse — gapless is enforced LOCALLY per transition, NOT globally.
    const e = cloneEdit();
    e.timeline.tracks[0].clips[1].start = 5; // 1s gap, no transitions
    expect(() => fikirtiveEdit.parse(e)).not.toThrow();
  });

  it("still accepts a gapless visual track with NO transitions (backward-compat)", () => {
    expect(() => fikirtiveEdit.parse(validEdit)).not.toThrow();
  });

  it("parses a legacy per-clip fade-to-black edit unchanged", () => {
    const parsed = fikirtiveEdit.parse(validEdit); // clip[1] has transition:{in:"fade"}
    expect(parsed.timeline.tracks[0]!.clips[1]!.transition?.in).toBe("fade");
    expect(parsed.timeline.tracks[0]!.transitions).toBeUndefined();
  });
});

describe("renderDuration", () => {
  it("equals editDuration when there are no transitions", () => {
    const parsed = fikirtiveEdit.parse(validEdit); // editDuration = 7
    expect(renderDuration(parsed)).toBe(7);
  });

  it("subtracts the sum of transition durations, converting ms→seconds", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    const parsed = fikirtiveEdit.parse(e);
    // 7s timeline − 0.5s overlap = 6.5s rendered
    expect(renderDuration(parsed)).toBeCloseTo(6.5, 6);
  });

  it("subtracts across multiple transitions on a 3-clip track", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips = [
      { asset: { type: "video", src: SRC }, start: 0, length: 4 },
      { asset: { type: "video", src: SRC }, start: 4, length: 4 },
      { asset: { type: "video", src: SRC }, start: 8, length: 4 },
    ];
    e.timeline.tracks[1].clips[0].length = 12;
    e.timeline.tracks[0].transitions = [
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
      { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 1000 },
    ];
    const parsed = fikirtiveEdit.parse(e);
    // 12s − (0.5 + 1.0) = 10.5s
    expect(renderDuration(parsed)).toBeCloseTo(10.5, 6);
  });
});

describe("track.audioRole (ducking opt-in)", () => {
  it("AUDIO_ROLES is exactly voice + music", () => {
    expect([...AUDIO_ROLES].sort()).toEqual(["music", "voice"]);
  });

  it("accepts audioRole on an audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].audioRole = "music"; // track[1] is the audio track
    const parsed = fikirtiveEdit.parse(e);
    expect((parsed.timeline.tracks[1] as any).audioRole).toBe("music");
  });

  it("rejects audioRole on a visual track", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].audioRole = "voice"; // track[0] is visual
    expect(() => fikirtiveEdit.parse(e)).toThrow(/audio track|visual/i);
  });

  it("rejects more than one music track", () => {
    const e = cloneEdit();
    // add a 2nd audio track and mark both music (timeline allows ≤2 audio tracks)
    e.timeline.tracks[1].audioRole = "music";
    e.timeline.tracks.push({ clips: [{ asset: { type: "audio", src: SRC.replace(".mp4", ".mp3") }, start: 0, length: 4 }], audioRole: "music" });
    expect(() => fikirtiveEdit.parse(e)).toThrow(/one music|single music/i);
  });

  it("accepts one music + one voice audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].audioRole = "voice";
    e.timeline.tracks.push({ clips: [{ asset: { type: "audio", src: SRC.replace(".mp4", ".mp3") }, start: 0, length: 4 }], audioRole: "music" });
    expect(() => fikirtiveEdit.parse(e)).not.toThrow();
  });

  it("still parses a legacy edit with NO audioRole (backward-compat)", () => {
    expect(() => fikirtiveEdit.parse(validEdit)).not.toThrow();
    expect((fikirtiveEdit.parse(validEdit).timeline.tracks[1] as any).audioRole).toBeUndefined();
  });

  it("parses output presets (resolution/aspectRatio/fps)", () => {
    const e = cloneEdit();
    e.output = { format: "mp4", resolution: "1080", aspectRatio: "9:16", fps: 30 };
    const parsed = fikirtiveEdit.parse(e);
    expect(parsed.output).toEqual({ format: "mp4", resolution: "1080", aspectRatio: "9:16", fps: 30 });
  });
});

/**
 * #780 r2b — the owner check the CONTRACT deliberately does not make.
 *
 * `mediaSrc` pins the SHAPE of a src and says nothing about whose owner segment it carries,
 * because this schema is parsed at both ends and neither end's owner is knowable here. That
 * gap is real and it was exploitable: a hand-written cut naming another org's key parsed
 * clean, saved, and rendered. `foreignEditSrcs` is the second, explicit step every caller
 * that persists or acts on an edit now takes — against the owner IT authenticated.
 */
describe("foreignEditSrcs (cross-tenant guard for a whole edit)", () => {
  it("says nothing is foreign when every clip lives in that owner's namespace", () => {
    expect(foreignEditSrcs(fikirtiveEdit.parse(validEdit), "founder")).toEqual([]);
  });

  it("catches a foreign VISUAL clip", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips[1].asset.src = `/files/u/neighbour/${HASH}.mp4`;
    expect(foreignEditSrcs(fikirtiveEdit.parse(e), "founder")).toEqual([`/files/u/neighbour/${HASH}.mp4`]);
  });

  it("catches a foreign MUSIC bed — an audio track is a file we fetch too", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].clips[0].asset.src = `/files/u/neighbour/${HASH}.mp3`;
    expect(foreignEditSrcs(fikirtiveEdit.parse(e), "founder")).toHaveLength(1);
  });

  it("is not fooled by an owner segment that merely STARTS with the real one", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips[0].asset.src = `/files/u/founder-two/${HASH}.mp4`;
    expect(foreignEditSrcs(fikirtiveEdit.parse(e), "founder")).toHaveLength(1);
  });

  it("reports every foreign src, not just the first — the caller refuses the whole document", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips[0].asset.src = `/files/u/neighbour/${HASH}.mp4`;
    e.timeline.tracks[1].clips[0].asset.src = `/files/u/neighbour/${HASH}.mp3`;
    expect(foreignEditSrcs(fikirtiveEdit.parse(e), "founder")).toHaveLength(2);
  });
});
