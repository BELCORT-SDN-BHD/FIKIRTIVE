import { describe, expect, it } from "vitest";
import {
  reindexTransitionsAfterSplit,
  reindexTransitionsAfterDelete,
  reindexTransitionsAfterMove,
  reconcileTransitions,
  splitClipAt,
  rippleDeleteClip,
  moveClip,
  snapEdit,
  MIN_CLIP_SECONDS,
} from "./timeline-ops.js";
import { fikirtiveEdit, type FikirtiveClip, type FikirtiveEdit, type BetweenClipTransition } from "./timeline.js";

const t = (from: number, type = "cross", durationMs = 500): BetweenClipTransition => ({
  fromClipIndex: from,
  toClipIndex: from + 1,
  type: type as BetweenClipTransition["type"],
  durationMs,
});

describe("MIN_CLIP_SECONDS", () => {
  it("is a small positive constant", () => {
    expect(MIN_CLIP_SECONDS).toBeGreaterThan(0);
    expect(MIN_CLIP_SECONDS).toBeLessThan(1);
  });
});

describe("reindexTransitionsAfterSplit", () => {
  // splitting clip i inserts a new clip at i+1; clips at index > i shift +1.
  it("shifts transitions whose boundary is entirely after the split", () => {
    // clips [0,1,2,3]; transition 2->3. split clip 0 → 2->3 becomes 3->4.
    const out = reindexTransitionsAfterSplit([t(2)], 0);
    expect(out).toEqual([t(3)]);
  });
  it("keeps a transition before the split untouched", () => {
    // transition 0->1; split clip 3 → unchanged.
    expect(reindexTransitionsAfterSplit([t(0)], 3)).toEqual([t(0)]);
  });
  it("SHIFTS a transition on the split clip's tail to the second half (never dropped)", () => {
    // transition 1->2; split clip 1 → clip 1's tail (where 1->2 lived) becomes
    // clip 1b's tail at index 2, so 1->2 re-numbers to 2->3. The 1->2 boundary
    // is a real gapless pair of unrelated clips and must NOT be lost.
    // (Diverges from the plan's contradictory "DROPS" test — see report.)
    expect(reindexTransitionsAfterSplit([t(1)], 1)).toEqual([t(2)]);
  });
  it("keeps the transition INTO the split clip and shifts the one AFTER it", () => {
    // clips [0,1,2]; transitions 0->1 and 1->2. split clip 1.
    // 0->1 (ends at clip 1's head) stays 0->1; 1->2 (starts at clip 1's tail,
    // now clip 2's tail) becomes 2->3.
    const out = reindexTransitionsAfterSplit([t(0), t(1)], 1);
    expect(out).toEqual([t(0), t(2)]);
  });
});

describe("reindexTransitionsAfterDelete", () => {
  // deleting clip i removes it; clips at index > i shift -1.
  it("drops transitions that touch the deleted clip and decrements those after", () => {
    // clips [0,1,2,3]; transitions 0->1, 1->2, 2->3. delete clip 1.
    // 0->1 touches 1 → drop; 1->2 touches 1 → drop; 2->3 → 1->2.
    const out = reindexTransitionsAfterDelete([t(0), t(1), t(2)], 1);
    expect(out).toEqual([t(1)]);
  });
  it("keeps transitions entirely before the deleted clip", () => {
    expect(reindexTransitionsAfterDelete([t(0)], 3)).toEqual([t(0)]);
  });
  it("drops the only transition when it touches the deleted clip", () => {
    expect(reindexTransitionsAfterDelete([t(0)], 0)).toEqual([]);
    expect(reindexTransitionsAfterDelete([t(0)], 1)).toEqual([]);
  });
});

describe("reindexTransitionsAfterMove", () => {
  // a move/reorder changes the sorted-by-start order; transitions are recomputed
  // by mapping each (fromClip,toClip) IDENTITY pair to its new adjacent indices,
  // dropping any pair that is no longer adjacent in the new order.
  it("recomputes indices and drops pairs no longer adjacent", () => {
    // old order ids [A,B,C], transition A->B (0->1) and B->C (1->2).
    // new order ids [B,A,C]: A->B no longer adjacent (B at 0, A at 1: B before A)
    //   → drop. B->C: B at 0, C at 2 → not adjacent → drop.
    const oldIds = ["A", "B", "C"];
    const newIds = ["B", "A", "C"];
    const out = reindexTransitionsAfterMove([t(0), t(1)], oldIds, newIds);
    expect(out).toEqual([]);
  });
  it("keeps a pair that stays adjacent and re-numbers it", () => {
    // old [A,B,C] transition A->B (0->1). new [C,A,B]: A at 1, B at 2 → adjacent,
    // same order A before B → keep as 1->2.
    const out = reindexTransitionsAfterMove([t(0)], ["A", "B", "C"], ["C", "A", "B"]);
    expect(out).toEqual([t(1)]);
  });
  it("returns [] for empty input", () => {
    expect(reindexTransitionsAfterMove([], ["A"], ["A"])).toEqual([]);
  });
});

describe("reconcileTransitions", () => {
  // reconcile maps index-based transitions across a NATIVE clip-list change
  // (Shotstack drag-reorder/trim) by clip IDENTITY: each transition survives iff
  // its two original clips stay a gapless-adjacent, long-enough pair in the new
  // timeline order; otherwise it's dropped. Prefers a clip `id`, else asset.src +
  // occurrence index.
  const C = (start: number, length: number, src: string, id?: string): FikirtiveClip =>
    ({ asset: { type: "video", src, ...(id ? {} : {}) }, start, length, ...(id ? { id } : {}) }) as unknown as FikirtiveClip;
  const S1 = "/files/u/founder/" + "a".repeat(64) + ".mp4";
  const S2 = "/files/u/founder/" + "b".repeat(64) + ".mp4";
  const S3 = "/files/u/founder/" + "c".repeat(64) + ".mp4";

  it("keeps a transition whose two clips stay gapless-adjacent, re-numbering by new position", () => {
    // prev [A,B,C] with A->B (0->1). native trim shortens A but order holds.
    const prev = [C(0, 4, S1), C(4, 4, S2), C(8, 4, S3)];
    const next = [C(0, 2, S1), C(2, 4, S2), C(6, 4, S3)]; // A trimmed to 2s, re-tiled
    const out = reconcileTransitions(prev, next, [t(0)]);
    expect(out).toEqual([t(0)]); // A,B still 0,1 and gapless
  });

  it("drops a transition whose clips are no longer adjacent after a reorder", () => {
    // prev [A,B,C] A->B (0->1); native reorder to [A,C,B] → A,B no longer adjacent.
    const prev = [C(0, 4, S1), C(4, 4, S2), C(8, 4, S3)];
    const next = [C(0, 4, S1), C(4, 4, S3), C(8, 4, S2)]; // [A,C,B]
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([]);
  });

  it("re-numbers a transition to its clips' new indices after a reorder keeps them adjacent", () => {
    // prev [A,B,C] A->B (0->1); reorder to [C,A,B] → A,B at indices 1,2.
    const prev = [C(0, 4, S1), C(4, 4, S2), C(8, 4, S3)];
    const next = [C(0, 4, S3), C(4, 4, S1), C(8, 4, S2)]; // [C,A,B]
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([t(1)]);
  });

  it("drops a transition whose pair becomes gapped (a native trim opened a gap)", () => {
    const prev = [C(0, 4, S1), C(4, 4, S2)];
    const next = [C(0, 4, S1), C(5, 4, S2)]; // B pushed right → 1s gap under the transition
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([]);
  });

  it("drops a transition whose pair is now too short for its duration", () => {
    // A->B 500ms; native trim shrinks B to 0.5s (half = 0.25s = 250ms < 500ms).
    const prev = [C(0, 4, S1), C(4, 4, S2)];
    const next = [C(0, 4, S1), C(4, 0.5, S2)];
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([]);
  });

  it("drops a transition whose clip was removed (identity gone)", () => {
    const prev = [C(0, 4, S1), C(4, 4, S2), C(8, 4, S3)];
    const next = [C(0, 4, S1), C(4, 4, S3)]; // B removed
    expect(reconcileTransitions(prev, next, [t(1)])).toEqual([]); // B->C, B gone
  });

  it("uses clip id when present to disambiguate duplicate srcs", () => {
    // two clips share src S1; ids x,y keep them distinct across a reorder.
    const prev = [C(0, 4, S1, "x"), C(4, 4, S1, "y"), C(8, 4, S2, "z")];
    const next = [C(0, 4, S1, "y"), C(4, 4, S1, "x"), C(8, 4, S2, "z")]; // swap x,y
    // transition was x->y (0->1). after swap y is 0, x is 1 → y before x, not the
    // original x->y order → drop.
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([]);
  });

  it("keeps a transition between UNIQUE-src clips with no id (src alone is identity)", () => {
    // distinct srcs, no ids; a pure trim keeps order → src identifies each → keep.
    const prev = [C(0, 4, S1), C(4, 4, S2)];
    const next = [C(0, 3, S1), C(3, 4, S2)]; // S1 trimmed, order holds
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([t(0)]);
  });

  it("DROPS a transition between DUPLICATE-src clips with no id (ambiguous → never wrong-remap) — Codex P1", () => {
    // two clips share src S1, no ids; a reorder swaps them. Occurrence index is
    // positional, so a naive remap would keep 0->1 but now point at the REVERSED
    // pair. With no stable identity we must drop, not mis-attach.
    const prev = [C(0, 4, S1), C(4, 4, S1)];
    const next = [C(0, 4, S1), C(4, 4, S1)]; // same srcs, no way to tell post-swap
    expect(reconcileTransitions(prev, next, [t(0)])).toEqual([]);
  });

  it("returns [] for empty transitions", () => {
    expect(reconcileTransitions([C(0, 4, S1)], [C(0, 4, S1)], [])).toEqual([]);
  });
});

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;
// a gapless 2-clip visual edit + an audio track, mirroring contract validEdit.
const baseEdit = (): FikirtiveEdit =>
  fikirtiveEdit.parse({
    timeline: {
      tracks: [
        {
          clips: [
            { asset: { type: "video", src: SRC, trim: 1.5 }, start: 0, length: 4 },
            { asset: { type: "video", src: SRC }, start: 4, length: 6 },
          ],
          transitions: [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }],
        },
        { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 10 }] },
      ],
    },
    output: { format: "mp4" },
  });

describe("splitClipAt", () => {
  it("replaces one clip with two whose lengths sum to the original", () => {
    const out = splitClipAt(baseEdit(), 0, 1, 7); // split the 2nd clip (4..10) at t=7
    const clips = out.timeline.tracks[0]!.clips;
    expect(clips).toHaveLength(3);
    const a = clips[1]!;
    const b = clips[2]!;
    expect(a.start).toBe(4);
    expect(a.length).toBeCloseTo(3, 6); // 4..7
    expect(b.start).toBeCloseTo(7, 6);
    expect(b.length).toBeCloseTo(3, 6); // 7..10
    expect(a.length + b.length).toBeCloseTo(6, 6); // == original
  });

  it("advances trim on the tail half by (atSeconds - start)", () => {
    const out = splitClipAt(baseEdit(), 0, 0, 1.5); // split clip 0 (0..4, trim 1.5) at t=1.5
    const a = out.timeline.tracks[0]!.clips[0]!;
    const b = out.timeline.tracks[0]!.clips[1]!;
    expect(a.asset.trim).toBe(1.5); // head keeps original trim
    expect(b.asset.trim).toBeCloseTo(1.5 + 1.5, 6); // tail seeks further into source
  });

  it("SHIFTS a transition on the split clip's tail to the second half", () => {
    // base transition 0->1; split clip 0 (0..4) at t=2 → [0a,0b,1]; the 0->1
    // cross-fade lived at clip 0's tail, now clip 0b's tail at index 1 → 1->2.
    // (Diverges from the plan's contradictory "DROPS" test — see report.)
    const out = splitClipAt(baseEdit(), 0, 0, 2);
    expect(out.timeline.tracks[0]!.transitions).toEqual([
      { fromClipIndex: 1, toClipIndex: 2, type: "cross", durationMs: 500 },
    ]);
  });

  it("keeps a transition before the split and re-numbers one after", () => {
    // build [c0,c1,c2] gapless with transitions 0->1 and 1->2; split clip 1.
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC }, start: 0, length: 4 },
              { asset: { type: "video", src: SRC }, start: 4, length: 4 },
              { asset: { type: "video", src: SRC }, start: 8, length: 4 },
            ],
            transitions: [
              { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
              { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 500 },
            ],
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 12 }] },
        ],
      },
      output: { format: "mp4" },
    });
    const out = splitClipAt(e, 0, 1, 6); // split middle clip
    const trs = out.timeline.tracks[0]!.transitions!;
    // 0->1 stays (into clip 1's head); 1->2 (clip1 tail → clip2) becomes 2->3.
    expect(trs).toEqual([
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
      { fromClipIndex: 2, toClipIndex: 3, type: "wipe", durationMs: 500 },
    ]);
  });

  it("rejects a split that would make either half shorter than MIN_CLIP_SECONDS", () => {
    expect(() => splitClipAt(baseEdit(), 0, 0, 0.01)).toThrow(/too short|min|outside|range/i);
    expect(() => splitClipAt(baseEdit(), 0, 0, 3.999)).toThrow(/too short|min/i);
  });

  it("DROPS a transition the split leaves too short for its duration (never throws)", () => {
    // base transition 0->1 (500ms; clip0 is 4s, half = 2s, fine). Split clip0 at
    // t=3.9 → head 3.9s, tail 0.1s (== MIN, so the min-clip guard passes). The
    // 0->1 cross-fade shifts to clip0b(0.1s)->clip1; half the shorter clip is
    // 0.05s = 50ms < the 500ms transition → it would fail the EP1 parse guard.
    // Fix 4: drop that now-invalid transition rather than shift-then-throw, so the
    // op always returns a parse-valid edit with the rest of the cut intact.
    const out = splitClipAt(baseEdit(), 0, 0, 3.9);
    expect(out.timeline.tracks[0]!.clips).toHaveLength(3);
    expect(out.timeline.tracks[0]!.transitions ?? []).toEqual([]); // invalidated → dropped
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("keeps a transition the split leaves long enough (only drops the invalidated one)", () => {
    // build [c0,c1,c2] gapless, transitions 0->1 (into c1's head, untouched by a
    // c1 tail-split) and 1->2 (c1 tail -> c2). Split c1 near its tail so the 1->2
    // pair becomes too short and is dropped, but 0->1 survives.
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC }, start: 0, length: 4 },
              { asset: { type: "video", src: SRC }, start: 4, length: 4 },
              { asset: { type: "video", src: SRC }, start: 8, length: 4 },
            ],
            transitions: [
              { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
              { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 500 },
            ],
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 12 }] },
        ],
      },
      output: { format: "mp4" },
    });
    const out = splitClipAt(e, 0, 1, 7.5); // c1 tail = 0.5s (≥ MIN), but < 1s so too short for the 500ms 1->2 wipe
    expect(out.timeline.tracks[0]!.transitions).toEqual([
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }, // survives
    ]);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("rejects an out-of-range atSeconds or clipIndex", () => {
    expect(() => splitClipAt(baseEdit(), 0, 0, 5)).toThrow(/outside|range/i); // 5 not inside 0..4
    expect(() => splitClipAt(baseEdit(), 0, 9, 2)).toThrow(/clip|range/i);
  });

  it("returns an edit that re-parses clean (incl. EP1 guards)", () => {
    const out = splitClipAt(baseEdit(), 0, 1, 7);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("clamps a legacy per-clip fade the split leaves too short, never throwing — Codex P2", () => {
    // a 4s clip with a 0.5s fade-IN; split at 0.6s → head 0.6s. The contract needs
    // length ≥ fade*2 (≥ 1.0s for a 0.5s fade), so the head's fade must shrink to
    // ≤ 0.3s instead of failing parse. The tail (3.4s) carries no fade here.
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          { clips: [{ asset: { type: "video", src: SRC }, start: 0, length: 4, transition: { in: "fade", duration: 0.5 } }] },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 4 }] },
        ],
      },
      output: { format: "mp4" },
    });
    expect(() => splitClipAt(e, 0, 0, 0.6)).not.toThrow();
    const out = splitClipAt(e, 0, 0, 0.6);
    const head = out.timeline.tracks[0]!.clips[0]!;
    expect(head.length).toBeCloseTo(0.6, 6);
    expect(head.transition?.in).toBe("fade");
    expect(head.transition?.duration).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("does not mutate the input edit", () => {
    const e = baseEdit();
    const before = JSON.stringify(e);
    splitClipAt(e, 0, 1, 7);
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("rippleDeleteClip", () => {
  it("removes the clip and shifts downstream starts left by its length", () => {
    // [0..4][4..10]; ripple-delete clip 0 (len 4) → clip 1 slides to [0..6].
    const out = rippleDeleteClip(baseEdit(), 0, 0);
    const clips = out.timeline.tracks[0]!.clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]!.start).toBe(0);
    expect(clips[0]!.length).toBe(6);
  });

  it("closes the gap so the track stays gapless", () => {
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC }, start: 0, length: 3 },
              { asset: { type: "video", src: SRC }, start: 3, length: 3 },
              { asset: { type: "video", src: SRC }, start: 6, length: 3 },
            ],
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 9 }] },
        ],
      },
      output: { format: "mp4" },
    });
    const out = rippleDeleteClip(e, 0, 1); // delete the middle clip
    const clips = out.timeline.tracks[0]!.clips;
    expect(clips.map((c) => c.start)).toEqual([0, 3]); // [0..3][3..6], gapless
  });

  it("drops transitions touching the deleted clip and decrements later ones", () => {
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC }, start: 0, length: 4 },
              { asset: { type: "video", src: SRC }, start: 4, length: 4 },
              { asset: { type: "video", src: SRC }, start: 8, length: 4 },
              { asset: { type: "video", src: SRC }, start: 12, length: 4 },
            ],
            transitions: [
              { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
              { fromClipIndex: 2, toClipIndex: 3, type: "wipe", durationMs: 500 },
            ],
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 16 }] },
        ],
      },
      output: { format: "mp4" },
    });
    const out = rippleDeleteClip(e, 0, 1); // delete clip 1 (touches 0->1)
    // 0->1 touches 1 → drop; 2->3 → decremented to 1->2.
    expect(out.timeline.tracks[0]!.transitions).toEqual([
      { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 500 },
    ]);
  });

  it("rejects deleting the last remaining clip on a track (min 1 clip)", () => {
    const e = fikirtiveEdit.parse({
      timeline: { tracks: [{ clips: [{ asset: { type: "video", src: SRC }, start: 0, length: 4 }] }] },
      output: { format: "mp4" },
    });
    expect(() => rippleDeleteClip(e, 0, 0)).toThrow(/last|empty|at least|≥1/i);
  });

  it("returns an edit that re-parses clean and does not mutate the input", () => {
    const e = baseEdit();
    const before = JSON.stringify(e);
    const out = rippleDeleteClip(e, 0, 0);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("moveClip", () => {
  const threeClip = (): FikirtiveEdit =>
    fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC, trim: 0 }, start: 0, length: 3 }, // A
              { asset: { type: "video", src: SRC, trim: 1 }, start: 3, length: 4 }, // B
              { asset: { type: "video", src: SRC, trim: 2 }, start: 7, length: 5 }, // C
            ],
            transitions: [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }], // A->B
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 12 }] },
        ],
      },
      output: { format: "mp4" },
    });

  it("reorders and re-tiles the track gapless from 0", () => {
    const out = moveClip(threeClip(), 0, 2, 0); // move C to the front: [C,A,B]
    const clips = out.timeline.tracks[0]!.clips;
    expect(clips.map((c) => c.asset.trim)).toEqual([2, 0, 1]); // C,A,B by trim tag
    expect(clips.map((c) => c.start)).toEqual([0, 5, 8]); // 5 + 3 = re-tiled gapless
  });

  it("drops a transition whose pair is no longer adjacent", () => {
    // A->B transition; move C between them → [A,C,B], A and B no longer adjacent.
    const out = moveClip(threeClip(), 0, 2, 1); // [A,C,B]
    expect(out.timeline.tracks[0]!.transitions ?? []).toEqual([]);
  });

  it("keeps and re-numbers a transition whose pair stays adjacent", () => {
    // A->B transition; move C to front → [C,A,B], A,B still adjacent → 1->2.
    const out = moveClip(threeClip(), 0, 2, 0);
    expect(out.timeline.tracks[0]!.transitions).toEqual([
      { fromClipIndex: 1, toClipIndex: 2, type: "cross", durationMs: 500 },
    ]);
  });

  it("is a no-op (re-parse-valid) when from === to", () => {
    const out = moveClip(threeClip(), 0, 1, 1);
    expect(out.timeline.tracks[0]!.clips.map((c) => c.asset.trim)).toEqual([0, 1, 2]);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("rejects out-of-range indices", () => {
    expect(() => moveClip(threeClip(), 0, 5, 0)).toThrow(/range/i);
    expect(() => moveClip(threeClip(), 0, 0, 9)).toThrow(/range/i);
  });

  it("does not mutate the input", () => {
    const e = threeClip();
    const before = JSON.stringify(e);
    moveClip(e, 0, 2, 0);
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("snapEdit", () => {
  it("closes a sub-threshold gap by re-tiling the visual track", () => {
    // [0..4] then a 0.05s gap [4.05..8.05] — within 0.15 threshold → re-tiled to [4..8].
    const e = fikirtiveEdit.parse({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: "video", src: SRC }, start: 0, length: 4 },
              { asset: { type: "video", src: SRC }, start: 4.05, length: 4 },
            ],
          },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 8 }] },
        ],
      },
      output: { format: "mp4" },
    });
    const out = snapEdit(e);
    expect(out.timeline.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 4]);
  });

  it("snaps a near-zero first start to exactly 0", () => {
    const e = fikirtiveEdit.parse({
      timeline: { tracks: [{ clips: [{ asset: { type: "video", src: SRC }, start: 0.03, length: 4 }] }] },
      output: { format: "mp4" },
    });
    expect(snapEdit(e).timeline.tracks[0]!.clips[0]!.start).toBe(0);
  });

  it("leaves an already-tiled track unchanged and re-parses valid", () => {
    const out = snapEdit(baseEdit());
    expect(out.timeline.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 4]);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("preserves transitions (re-tiling keeps gapless pairs valid)", () => {
    const out = snapEdit(baseEdit());
    expect(out.timeline.tracks[0]!.transitions).toEqual([
      { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// FUZZ: random sequences of split/ripple/move/snap on random gapless+transition
// visual edits. Every result must re-parse valid (incl. EP1 guards) and every
// transition must reference an adjacent gapless pair in timeline order.
// ---------------------------------------------------------------------------
describe("fuzz: random op sequences stay parse-valid + transitions consistent", () => {
  // deterministic PRNG (mulberry32) so failures reproduce.
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomEdit(rand: () => number): FikirtiveEdit {
    const n = 2 + Math.floor(rand() * 5); // 2..6 visual clips
    const clips: unknown[] = [];
    let start = 0;
    const lengths: number[] = [];
    for (let i = 0; i < n; i++) {
      const len = 2 + Math.floor(rand() * 4); // 2..5s each (room for a 0.5s fade)
      lengths.push(len);
      clips.push({ asset: { type: "video", src: SRC, trim: Math.floor(rand() * 3) }, start, length: len });
      start += len;
    }
    // add transitions on a random subset of boundaries (≤ half shorter clip; 0.5s ok)
    const transitions: BetweenClipTransition[] = [];
    for (let i = 0; i < n - 1; i++) {
      if (rand() < 0.5) {
        transitions.push({ fromClipIndex: i, toClipIndex: i + 1, type: "cross", durationMs: 500 });
      }
    }
    const total = start;
    return fikirtiveEdit.parse({
      timeline: {
        tracks: [
          { clips, ...(transitions.length ? { transitions } : {}) },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: total }] },
        ],
      },
      output: { format: "mp4" },
    });
  }

  // assert each transition references a gapless-adjacent pair in timeline order.
  function transitionsConsistent(edit: FikirtiveEdit): void {
    for (const track of edit.timeline.tracks) {
      const trs = track.transitions ?? [];
      if (trs.length === 0) continue;
      const ordered = [...track.clips].sort((a, b) => a.start - b.start);
      const seenFrom = new Set<number>();
      for (const tr of trs) {
        expect(seenFrom.has(tr.fromClipIndex)).toBe(false); // unique boundary
        seenFrom.add(tr.fromClipIndex);
        expect(tr.toClipIndex).toBe(tr.fromClipIndex + 1); // adjacency
        const from = ordered[tr.fromClipIndex];
        const to = ordered[tr.toClipIndex];
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        // gapless-adjacent: later clip starts exactly where the earlier ends
        expect(Math.abs(to!.start - (from!.start + from!.length))).toBeLessThanOrEqual(1e-6);
      }
    }
  }

  it("survives 200 random op sequences", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      let edit = randomEdit(rand);
      const ops = 3 + Math.floor(rand() * 8); // 3..10 ops per sequence
      for (let k = 0; k < ops; k++) {
        const clips = edit.timeline.tracks[0]!.clips;
        const order = [...clips].sort((a, b) => a.start - b.start);
        const choice = Math.floor(rand() * 5);
        try {
          if (choice === 0) {
            // split a random clip at a random valid-ish point — INCLUDING clips a
            // transition touches. With the drop-if-invalid rule (Fix 4), a split
            // strictly inside the clip with both halves ≥ MIN must NEVER throw on
            // account of a transition; it drops the invalidated one instead.
            const idx = Math.floor(rand() * order.length);
            const c = order[idx]!;
            const at = c.start + MIN_CLIP_SECONDS + rand() * (c.length - 2 * MIN_CLIP_SECONDS);
            const touched = (edit.timeline.tracks[0]!.transitions ?? []).some(
              (tr) => tr.fromClipIndex === idx || tr.toClipIndex === idx,
            );
            if (touched) {
              // assert the transitioned split never throws (drop, don't throw)
              expect(() => splitClipAt(edit, 0, idx, at)).not.toThrow();
            }
            edit = splitClipAt(edit, 0, idx, at);
          } else if (choice === 1) {
            if (order.length <= 1) continue; // can't ripple the last clip
            const idx = Math.floor(rand() * order.length);
            edit = rippleDeleteClip(edit, 0, idx);
          } else if (choice === 2) {
            if (order.length <= 1) continue;
            const from = Math.floor(rand() * order.length);
            const to = Math.floor(rand() * order.length);
            edit = moveClip(edit, 0, from, to);
          } else if (choice === 3) {
            // simulate a NATIVE reorder/trim: shuffle + re-tile + jitter lengths,
            // then reconcile the transitions against the new clip list by identity.
            const prevClips = order;
            const shuffled = [...order];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(rand() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
            }
            let cursor = 0;
            const nextClips = shuffled.map((c) => {
              const len = Math.max(MIN_CLIP_SECONDS, c.length + (rand() - 0.5)); // jitter
              const placed = { ...c, start: cursor, length: len };
              cursor += len;
              return placed;
            });
            const reconciled = reconcileTransitions(
              prevClips,
              nextClips,
              edit.timeline.tracks[0]!.transitions ?? [],
            );
            const total = cursor;
            edit = fikirtiveEdit.parse({
              ...edit,
              timeline: {
                ...edit.timeline,
                tracks: [
                  { clips: nextClips, ...(reconciled.length ? { transitions: reconciled } : {}) },
                  { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: total }] },
                ],
              },
            });
          } else {
            edit = snapEdit(edit);
          }
        } catch {
          // ops legitimately throw on degenerate inputs (too-short split, etc.);
          // a throw must NOT corrupt `edit` (ops are pure → input unchanged).
        }
        // INVARIANT after every op: the edit re-parses + transitions consistent.
        expect(() => fikirtiveEdit.parse(edit)).not.toThrow();
        transitionsConsistent(edit);
      }
    }
  });
});
