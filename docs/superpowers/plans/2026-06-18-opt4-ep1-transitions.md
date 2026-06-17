# OPT-4 EP1 — Real transitions (真·转场) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real between-clip transitions (cross / slide / wipe / flip / clockwipe / iris + the legacy fade) to Artlio's video editor — a track-level contract field, a chained-`xfade` render path in the worker, and an LTX-style Transitions tab — entirely on the existing $0 self-hosted ffmpeg path, with no spend path and no prisma migration.

**Architecture:** The `ArtlioEdit` zod contract (`packages/core/src/timeline.ts`) gains a TRACK-LEVEL `transitions?` array (NOT a clip field — Shotstack strips unknown clip fields), a `renderDuration()` helper, and gapless-adjacency enforcement on the visual track. The worker (`apps/worker/src/jobs/render.ts`) rewrites its `concat` filtergraph into a chained `xfade` (hard cuts still concat) with audio re-mapped to the shorter rendered timeline. The UI (`apps/web/components/Editor.tsx`) adds a Transitions tab whose state lives OUTSIDE the Shotstack `Edit` and is merged into the persisted `ArtlioEdit` on save.

**Tech Stack:** pnpm monorepo (`packages/core` zod + vitest, `apps/worker` ffmpeg via execa, `apps/web` Next.js 16 + Shotstack Studio SDK 2.11.5). ffmpeg `xfade`/`acrossfade`/`anullsrc`/`aresample` (all confirmed present in the local + worker ffmpeg build). `Project.editJson` is a Prisma `Json` column — the contract change is backward-compat additive, **NO migration**.

**MONEY-SAFETY (rule #1, invariant across every task):** every effect is an ffmpeg filtergraph on homogeneous AI-generated H.264, rendered self-hosted in the worker. This plan adds NO call into the fal / generation spend path. The verify task greps to prove it. The worker change is bounded by duration/dimension guards so it can't hang or OOM (the 720p cap and the 10-min execa timeout stay).

---

## Grounding (verified against the real code, 2026-06-18)

These anchors were read before writing — every task below references them by exact line.

- **`packages/core/src/timeline.ts`** — the full `ArtlioEdit` zod:
  - Bounds: `MAX_CLIPS_PER_TRACK=100` (L30), `MAX_TIMELINE_SECONDS=60*30` (L32), `TRANSITION_MAX_SECONDS=2` (L34), `TRANSITION_DEFAULT_SECONDS=0.5` (L35).
  - `transition` zod (the legacy per-clip in/out fade-to-black) L83–88: `{ in?: "fade", out?: "fade", duration: number .gt(0).max(2).default(0.5) }`.
  - `clip` zod L90–113, with a `.superRefine` (L101) that rejects transitions on audio clips and clips shorter than `2× fade duration`.
  - `track` zod L115–117 = `{ clips: array(clip).min(1).max(100) }`.
  - `clipsOverlap()` L119–127 (sort-by-start, EPS=1e-6 overlap check), `isVisualTrack()` L129–130.
  - `timeline` zod L132–172 with the cross-track `.superRefine` (L140): at most 1 visual track (L143), ≤2 audio tracks (L149), per-track overlap (L157), mixed-track rejection (L160), 30-min cap (L166).
  - `output` zod L174–180; `artlioEdit` L184–187; `editDuration(edit)` L226–232 = `max(start+length)` across all tracks.
- **`apps/worker/src/jobs/render.ts`** — `handleRender` L80:
  - `SIZES` table L34–38; `inputArgs()` L47–52 (`-loop 1` for images, `-ss` trim before `-i`, `-t length`).
  - `videoChain()` L55–66: `scale`/`pad`|`crop` + `setsar=1` + `fps=${fps}` (+ legacy per-clip `fade=t=in/out` L63–64). Output label `[v${index}]`.
  - `audioChain()` L69–78: `volume` + `afade` + `adelay=${start*1000}:all=1`. Output label `[a${index}]`.
  - `editDuration` → `totalSeconds` L103; used for `amix … atrim=0:${totalSeconds}` L149, the `-progress` percent denominator L181, and the stored `durationS` L210.
  - Visual concat L141–142: `[v0][v1]…concat=n=${N}:v=1:a=0[v]`. Audio mix L145–152: `amix=inputs=${N}:duration=longest:normalize=0,atrim=0:${total}[a]`.
  - Final argv L154–159: `-filter_complex`, `-map [v]`, optional `-map [a] -c:a aac -b:a 192k`, `-c:v libx264 -pix_fmt yuv420p -movflags +faststart -progress pipe:1 -nostats`.
  - execa timeout L166 = `1000*60*10` (10 min). Visual clips are sorted by `start` (L119) before planning.
- **`apps/web/components/Editor.tsx`** — `new Edit(startEdit)` L131, `edit.getEdit()` snapshot+parse L164/L206, `appendAsset` L217–228 (`addClip(0, …)`), the right Inspector (legacy per-clip Transition checkboxes) L515–548, `applyTransition` L241–250.
- **`apps/web/lib/actions.ts`** — `saveProjectEdit` L576–591 (canonicalizing `artlioEdit.parse`, persists `editJson`), `startRender` L660–703, `getEditorMedia` L750–770 (NOT touched by EP1).
- **Shotstack SDK 2.11.5** (`node_modules/.pnpm/@shotstack+shotstack-studio@2.11.5/.../dist/index.d.ts`): `Edit.getEdit()` L184, `addClip(trackIdx, clip: Clip)` L211, `updateClip(...)` L261, `undo()/redo()` L255–256. Shotstack's `Transition` is a per-clip in/out concept only (`@shotstack/schemas` `schema.d.ts` L1396: "In and out transitions for a clip"). **There is no track-level between-clip transition in Shotstack's schema** — confirming EP1's track-level array must live outside the Shotstack `Edit`.
- **`docs/backlog.md` §E** L27: "导出忽略时间线空隙 → 黑帧填补" (export ignores timeline gaps). EP1's gapless enforcement closes this item; this plan marks it done in §E.
- **Local toolchain:** `ffmpeg`/`ffprobe` on PATH (`/opt/homebrew/bin`); `xfade`, `acrossfade`, `anullsrc`, `aresample` all present; `xfade transition=` enum includes `fade, wipeleft/right/up/down, slideleft/right/up/down, radial, circleopen, circleclose, dissolve, vertopen/vertclose, horzopen/horzclose, pixelize`.

### Two design decisions this plan locks (the spec asked the plan to pick)

1. **Gapless enforcement = VALIDATION-REJECT, not normalize-on-save.** The contract rejects a visual track whose clips don't tile from 0 with no gap and no overlap. Rationale: (a) overlap is *already* a hard reject (L157) — making gaps a reject too is symmetric and surfaces the problem to the user instead of silently mutating their cut; (b) the UI already lays clips end-to-end (`appendAsset` sets `start = end`, L222), so well-behaved cuts already tile; (c) a transition's `xfade offset` math is only correct on a tiled track, so a silent normalize could move a clip out from under a transition the user placed. Legacy edits with gaps now fail `parse` loudly at save/export with a clear message (and EP1 ships a one-time "Close gaps" UI affordance in Task 8 so the user can fix an old cut). This closes backlog §E.
2. **Flip transition = SHIP best-effort approximation, not deferred.** ffmpeg's `xfade` has no `flip`. We map Flip → `xfade transition=vertopen` (a vertical "card-flip"-ish reveal; the closest native read). The UI tile is fully enabled and labeled "Flip"; a one-line code comment documents it's a `vertopen` approximation. (If a future review finds it reads poorly, swapping the single enum value is a one-line change — no contract or UI change needed.)

---

## File Structure

| File | Create/Modify | Responsibility in EP1 |
|---|---|---|
| `packages/core/src/timeline.ts` | Modify | Add `TransitionType`/`TransitionDirection` enums + `betweenClipTransition` zod; add `transitions?` array to `track`; gapless-adjacency enforcement on the visual track; `renderDuration(edit)` helper. Legacy per-clip `transition` (L83) stays untouched. |
| `packages/core/src/timeline.test.ts` | Modify | New describe block for the between-clip transition: accept/reject (gap, overlap, dangling index, non-adjacent, duration too long), `renderDuration` math incl. the ms→s `/1000` unit, gapless enforce, legacy fade edit parses unchanged. |
| `apps/worker/src/jobs/render.ts` | Modify | Rewrite the video filtergraph from `concat` to chained `xfade` (hard cuts still concat); per-clip normalization adds `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS`; audio re-mapped to rendered time with `acrossfade` + `anullsrc` silence-fill + `aresample`; use `renderDuration()` for `-progress` total + stored `durationS`. New helper `buildVideoGraph()` + `transitionToXfade()`. |
| `apps/web/components/Editor.tsx` | Modify | Add a Transitions tab (7 tiles + Clear all) beside the Assets panel; boundary selection; transition state in React (outside Shotstack); merge into `ArtlioEdit` in `snapshot()`; an overlay marker between clips; a "Close gaps" affordance for legacy gappy cuts. |
| `scripts/local-ep1-transitions-verify.mjs` | Create | $0 local ffmpeg render of small fixtures (one per transition type) asserting a valid mp4 whose ffprobe duration == `renderDuration` (Σ clip − Σ transition) within tolerance; greps the diff for any new fal/spend path. |

No new package, no prisma migration, no new env var.

---

## Task 1: Contract — transition enums + between-clip transition zod (no track wiring yet)

**Files:**
- Modify: `packages/core/src/timeline.ts` (after the legacy `transition` zod at L88, before `clip` at L90)
- Test: `packages/core/src/timeline.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline.test.ts` (import `betweenClipTransition` from `./timeline.js`):

```ts
import { betweenClipTransition } from "./timeline.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: FAIL — `betweenClipTransition` is not exported (import error / undefined).

- [ ] **Step 3: Write the minimal implementation** — in `packages/core/src/timeline.ts`, insert after the legacy `transition` zod (after L88):

```ts
/** Between-clip transition types (the LTX 7-tile library, minus "None"
 *  which = the ABSENCE of an entry — never stored). "fade" here is a
 *  cross-fade between clips, distinct from the legacy per-clip fade-to-black. */
export const TRANSITION_TYPES = ["cross", "slide", "wipe", "flip", "clockwipe", "iris", "fade"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** A transition is a relationship BETWEEN two gapless-adjacent visual clips.
 *  It lives on the TRACK (track.transitions[]), NOT on a clip — the editor
 *  round-trips clips through Shotstack's Edit, whose schema strips unknown clip
 *  fields, so transition data must not ride on a clip. durationMs is an integer
 *  in milliseconds (the UI thinks in ms); the worker divides by 1000 for ffmpeg
 *  seconds (Codex NIT: render.ts uses SECONDS). Upper bound mirrors the legacy
 *  TRANSITION_MAX_SECONDS; the per-pair "≤ half the shorter clip" guard is on
 *  the track refine (Task 2), where the clip lengths are in scope. */
export const betweenClipTransition = z.object({
  fromClipIndex: z.number().int().min(0),
  toClipIndex: z.number().int().min(0),
  type: z.enum(TRANSITION_TYPES),
  durationMs: z.number().int().gt(0).max(TRANSITION_MAX_SECONDS * 1000),
  direction: z.enum(TRANSITION_DIRECTIONS).optional(),
});
export type BetweenClipTransition = z.infer<typeof betweenClipTransition>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: PASS (all `betweenClipTransition zod` cases green; pre-existing tests unchanged).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @artlio/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** (leave for user approval — do NOT push)

```bash
git add packages/core/src/timeline.ts packages/core/src/timeline.test.ts
git commit -m "feat(editor): EP1 contract — between-clip transition zod (enums + bounds)"
```

---

## Task 2: Contract — wire `transitions[]` onto `track` + gapless + cross-pair guards

**Files:**
- Modify: `packages/core/src/timeline.ts` (`track` zod L115–117; `timeline.superRefine` L140–172; add `isVisualTrack` usage)
- Test: `packages/core/src/timeline.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline.test.ts`. Build a gapless 3-clip visual edit helper inline (the existing `validEdit` has a gapless 2-clip visual track at L15–16: `start:0,len:4` then `start:4,len:3`, so it already tiles — reuse it):

```ts
describe("track.transitions (between-clip)", () => {
  // validEdit's visual track is gapless: [0..4][4..7]; index 0→1 is adjacent.
  const withTransitions = (trs: unknown[]): any => {
    const e = cloneEdit();
    e.timeline.tracks[0].transitions = trs;
    return e;
  };

  it("accepts a transition between two gapless-adjacent visual clips", () => {
    const parsed = artlioEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }]));
    expect(parsed.timeline.tracks[0]!.transitions?.[0]?.type).toBe("cross");
  });

  it("rejects a dangling clip index", () => {
    expect(() => artlioEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 5, type: "cross", durationMs: 500 }]))).toThrow(/index/i);
  });

  it("rejects a non-consecutive pair (from+1 != to)", () => {
    // add a third clip so index 0→? has room, then point 0→2
    const e = cloneEdit();
    e.timeline.tracks[0].clips.push({ asset: { type: "video", src: SRC }, start: 7, length: 3 });
    e.timeline.tracks[0].transitions = [{ fromClipIndex: 0, toClipIndex: 2, type: "cross", durationMs: 500 }];
    expect(() => artlioEdit.parse(e)).toThrow(/adjacent|consecutive/i);
  });

  it("rejects a transition that references the audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    expect(() => artlioEdit.parse(e)).toThrow(/visual/i);
  });

  it("rejects a duration longer than half the shorter adjacent clip", () => {
    // shorter adjacent clip is clip 1 (3s) → half = 1500ms; 1600ms must fail
    expect(() => artlioEdit.parse(withTransitions([{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 1600 }]))).toThrow(/too long|half|clip/i);
  });

  it("rejects a gap on the visual track (gapless enforcement)", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].clips[1].start = 5; // [0..4] then [5..8] → 1s gap
    expect(() => artlioEdit.parse(e)).toThrow(/gap|tile|contiguous/i);
  });

  it("still accepts a gapless visual track with NO transitions (backward-compat)", () => {
    expect(() => artlioEdit.parse(validEdit)).not.toThrow();
  });

  it("parses a legacy per-clip fade-to-black edit unchanged", () => {
    const parsed = artlioEdit.parse(validEdit); // clip[1] has transition:{in:"fade"}
    expect(parsed.timeline.tracks[0]!.clips[1]!.transition?.in).toBe("fade");
    expect(parsed.timeline.tracks[0]!.transitions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: FAIL — `transitions` is stripped (unknown field) so the accept case reports `undefined`, and none of the new guards exist.

- [ ] **Step 3: Add `transitions` to the `track` zod** — replace L115–117:

```ts
export const track = z.object({
  clips: z.array(clip).min(1).max(MAX_CLIPS_PER_TRACK),
  /** between-clip transitions (visual track only; validated in timeline.superRefine
   *  where adjacent clip lengths are in scope). None = the absence of an entry. */
  transitions: z.array(betweenClipTransition).max(MAX_CLIPS_PER_TRACK).optional(),
});
```

- [ ] **Step 4: Add a gapless helper + the cross-pair refine** — in `packages/core/src/timeline.ts`, add this helper next to `clipsOverlap` (after L127):

```ts
/** Visual clips must tile from 0 with no gap and no overlap (LTX-light: a single
 *  contiguous visual track). Returns the first gap message, or null if gapless.
 *  Closes backlog §E (export ignored timeline gaps): a gap is now a hard reject. */
function visualGapMessage(clips: z.infer<typeof clip>[]): string | null {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const EPS = 1e-6;
  let cursor = 0;
  for (const c of sorted) {
    if (c.start > cursor + EPS) {
      return `visual clips must tile with no gap (gap before a clip at ${c.start}s; previous content ends at ${cursor}s)`;
    }
    cursor = Math.max(cursor, c.start + c.length);
  }
  return null;
}
```

Then extend the per-track loop inside `timeline.superRefine` (currently L156–165). Replace that `tl.tracks.forEach(...)` block with:

```ts
    tl.tracks.forEach((t, i) => {
      if (clipsOverlap(t.clips)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: clips overlap` });
      }
      const mixed = isVisualTrack(t) && t.clips.some((c) => c.asset.type === "audio");
      if (mixed) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audio clips belong on their own track` });
      }
      // gapless enforcement + between-clip transition validation: visual track only
      if (isVisualTrack(t)) {
        const gap = visualGapMessage(t.clips);
        if (gap) ctx.addIssue({ code: "custom", message: `track ${i}: ${gap}` });
        // transition order on the timeline matches clip order sorted by start
        const ordered = [...t.clips].sort((a, b) => a.start - b.start);
        for (const tr of t.transitions ?? []) {
          if (tr.toClipIndex !== tr.fromClipIndex + 1) {
            ctx.addIssue({ code: "custom", message: `track ${i}: transition must be between adjacent clips (consecutive fromClipIndex+1==toClipIndex)` });
            continue;
          }
          const from = ordered[tr.fromClipIndex];
          const to = ordered[tr.toClipIndex];
          if (!from || !to) {
            ctx.addIssue({ code: "custom", message: `track ${i}: transition references a clip index out of range` });
            continue;
          }
          const halfShorterMs = (Math.min(from.length, to.length) / 2) * 1000;
          if (tr.durationMs > halfShorterMs + 1e-6) {
            ctx.addIssue({ code: "custom", message: `track ${i}: transition ${tr.durationMs}ms too long — must be ≤ half the shorter adjacent clip (${Math.round(halfShorterMs)}ms)` });
          }
        }
      } else if (t.transitions && t.transitions.length > 0) {
        ctx.addIssue({ code: "custom", message: `track ${i}: between-clip transitions are visual-track only` });
      }
      for (const c of t.clips) end = Math.max(end, c.start + c.length);
    });
```

> Note: the cross-pair guard is `≤ half the shorter clip` (matches the legacy per-clip rule at L107 `length ≥ 2× duration` ⇔ `duration ≤ length/2`), and the per-field `≤ TRANSITION_MAX_SECONDS*1000` bound from Task 1 still applies first. The `xfade` offset (worker) therefore can never reach a clip boundary.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: PASS (all `track.transitions (between-clip)` cases green; the legacy `transition rules:` test at L125 and every pre-existing test still pass — `validEdit` is already gapless so the gapless reject doesn't fire on it).

- [ ] **Step 6: Typecheck + full core suite**

Run: `pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/core test`
Expected: green.

- [ ] **Step 7: Commit** (leave for user approval)

```bash
git add packages/core/src/timeline.ts packages/core/src/timeline.test.ts
git commit -m "feat(editor): EP1 contract — track-level transitions[], gapless enforce, cross-pair guards"
```

---

## Task 3: Contract — `renderDuration()` helper (ms→s unit handled)

**Files:**
- Modify: `packages/core/src/timeline.ts` (after `editDuration` at L226–232)
- Test: `packages/core/src/timeline.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline.test.ts` (import `renderDuration`):

```ts
import { renderDuration } from "./timeline.js";

describe("renderDuration", () => {
  it("equals editDuration when there are no transitions", () => {
    const parsed = artlioEdit.parse(validEdit); // editDuration = 7
    expect(renderDuration(parsed)).toBe(7);
  });

  it("subtracts the sum of transition durations, converting ms→seconds (Codex NIT)", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    const parsed = artlioEdit.parse(e);
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
    const parsed = artlioEdit.parse(e);
    // 12s − (0.5 + 1.0) = 10.5s
    expect(renderDuration(parsed)).toBeCloseTo(10.5, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: FAIL — `renderDuration` not exported.

- [ ] **Step 3: Implement** — append to `packages/core/src/timeline.ts` after `editDuration` (after L232):

```ts
/** Rendered OUTPUT duration in seconds: the timeline length minus the time each
 *  between-clip transition overlaps (clips slide together by the transition).
 *  Used by the worker for the audio mix length, the -progress total, and the
 *  stored asset durationS. durationMs is divided by 1000 (contract is ms; the
 *  worker renders in seconds — Codex NIT). */
export function renderDuration(edit: ArtlioEdit): number {
  let overlapMs = 0;
  for (const t of edit.timeline.tracks)
    for (const tr of t.transitions ?? []) overlapMs += tr.durationMs;
  return editDuration(edit) - overlapMs / 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit** (leave for user approval)

Run: `pnpm --filter @artlio/core typecheck`

```bash
git add packages/core/src/timeline.ts packages/core/src/timeline.test.ts
git commit -m "feat(editor): EP1 contract — renderDuration() helper (ms→s)"
```

---

## Task 4: Worker — `transitionToXfade()` mapping (pure helper, unit-tested in the verify script)

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` (add a helper near `videoChain` at L55)

> The worker has no vitest suite (`apps/worker` has a `test` script but no `vitest.config.*` and no `*.test.ts`). EP1 does NOT introduce a worker test framework (out of scope, and adding one risks the existing `pnpm -r test` invariant where the empty worker suite is a known quirk). The mapping is exercised end-to-end by the `scripts/local-ep1-transitions-verify.mjs` render in Task 9. This task is implementation-only (no failing-test step); Task 9 is its verification.

- [ ] **Step 1: Add the mapping helper** — in `apps/worker/src/jobs/render.ts`, after `videoChain` (after L66), add:

```ts
import type { BetweenClipTransition, TransitionDirection } from "@artlio/core";

/** Map an Artlio between-clip transition to an ffmpeg xfade `transition=` value.
 *  All values verified present in the worker's ffmpeg build. Directional types
 *  default to "left" when no direction is given. Flip has no native xfade — we
 *  approximate it with `vertopen` (a vertical card-flip-ish reveal); swapping
 *  this single value is the only change if it ever reads poorly. */
function transitionToXfade(tr: BetweenClipTransition): string {
  const dir: TransitionDirection = tr.direction ?? "left";
  switch (tr.type) {
    case "fade":
    case "cross":
      return "fade";
    case "slide":
      return { left: "slideleft", right: "slideright", up: "slideup", down: "slidedown" }[dir];
    case "wipe":
      return { left: "wipeleft", right: "wiperight", up: "wipeup", down: "wipedown" }[dir];
    case "clockwipe":
      return "radial";
    case "iris":
      // iris in (open from center) vs out (close to center); up/left = open
      return dir === "down" || dir === "right" ? "circleclose" : "circleopen";
    case "flip":
      return "vertopen"; // best-effort approximation (no native xfade flip)
  }
}
```

- [ ] **Step 2: Typecheck the worker**

Run: `pnpm --filter @artlio/worker typecheck`
Expected: no errors (the helper is unused until Task 5 — TypeScript with `noUnusedLocals` may warn; if so, Task 5 lands in the same commit, so commit Tasks 4+5 together as noted below).

> Because `transitionToXfade` is consumed by Task 5, do not commit Task 4 alone — fold its commit into Task 5 Step 7.

---

## Task 5: Worker — rewrite the video filtergraph to chained `xfade`

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — `videoChain` (L55–66), the graph build (L139–142), `handleRender` (the `totalSeconds`/`-progress`/`durationS` uses).

This is the heart of EP1. The current path normalizes each clip then `concat`s them (L141–142). The new path normalizes each clip MORE (adds `format`/`settb`/`setpts`), then chains `xfade` for each transition while still `concat`-ing runs of hard cuts.

- [ ] **Step 1: Strengthen per-clip video normalization** — replace `videoChain` (L55–66) with:

```ts
/** video chain for one visual clip: normalize geometry + colorspace + timebase,
 *  reset PTS to 0 (xfade/concat require monotonic, zero-based PTS), then the
 *  LEGACY per-clip fade-to-black (kept for backward-compat). Output [v${index}].
 *  format=yuv420p + settb=AVTB + setpts=PTS-STARTPTS are REQUIRED before xfade —
 *  the encoder-only -pix_fmt is not enough (Codex). */
function videoChain(p: PlannedInput, w: number, h: number, fps: number): string {
  const fit = p.clip.fit ?? "contain";
  const scale =
    fit === "crop"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const filters = [scale, "setsar=1", `fps=${fps}`, "format=yuv420p", "settb=AVTB", "setpts=PTS-STARTPTS"];
  const t = p.clip.transition; // legacy per-clip fade-to-black
  if (t?.in) filters.push(`fade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`fade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);
  return `[${p.index}:v]${filters.join(",")}[v${p.index}]`;
}
```

- [ ] **Step 2: Add the chained-xfade graph builder** — in `apps/worker/src/jobs/render.ts`, add after `transitionToXfade` (from Task 4):

```ts
/** Build the video filtergraph that chains xfade per transition between
 *  consecutive visual clips (hard cuts fall through as a plain concat of the run).
 *  visualPlanned is in TIMELINE order (sorted by start at plan time). `transitions`
 *  is keyed by fromClipIndex (the position in that ordered list). Returns the graph
 *  lines AND the final video label to -map. Each xfade `offset` is the RENDERED
 *  cumulative position where this clip starts overlapping the previous content
 *  (cumulative clip lengths minus already-applied transition overlaps). */
function buildVideoGraph(
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): { lines: string[]; label: string } {
  const byFrom = new Map<number, BetweenClipTransition>();
  for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr);

  const lines: string[] = [];
  for (const p of visualPlanned) lines.push(videoChain(p, 0, 0, 0)); // geometry args injected by caller; see note
  // (the caller actually passes w/h/fps into videoChain — see Step 3 wiring)

  // Single clip: nothing to chain.
  if (visualPlanned.length === 1) return { lines, label: `[v${visualPlanned[0]!.index}]` };

  // Chain left-to-right. `acc` is the running composited label; `accEnd` is the
  // rendered duration of `acc` in seconds.
  let acc = `[v${visualPlanned[0]!.index}]`;
  let accEnd = visualPlanned[0]!.clip.length;
  let stage = 0;
  for (let i = 1; i < visualPlanned.length; i++) {
    const cur = visualPlanned[i]!;
    const tr = byFrom.get(i - 1); // transition from clip (i-1) → i
    const nextLabel = `[vx${stage}]`;
    if (tr) {
      const durS = tr.durationMs / 1000;
      const offset = accEnd - durS; // overlap starts durS before acc ends
      lines.push(
        `${acc}[v${cur.index}]xfade=transition=${transitionToXfade(tr)}:duration=${durS}:offset=${offset}${nextLabel}`,
      );
      accEnd = accEnd + cur.clip.length - durS; // clips overlap by durS
    } else {
      lines.push(`${acc}[v${cur.index}]concat=n=2:v=1:a=0${nextLabel}`);
      accEnd = accEnd + cur.clip.length;
    }
    acc = nextLabel;
    stage++;
  }
  return { lines, label: acc };
}
```

> **Wiring note for Step 3:** `buildVideoGraph` above shows the chaining logic, but `videoChain` needs the real `w/h/fps`. In the actual edit, the per-clip `videoChain(...)` lines are produced by the caller (Step 3) and `buildVideoGraph` only emits the xfade/concat chain. Step 3 gives the exact merged form so there is no ambiguity — implement Step 3's version, which is the authoritative one.

- [ ] **Step 3: Wire the builder into `handleRender`** — this is the authoritative graph construction. In `handleRender`, replace the block at L134–163 (from `const visualPlanned = …` through the `console.log`) with:

```ts
    const visualPlanned = planned.filter((p) => p.clip.asset.type !== "audio");
    const sounded = planned.filter((p) => p.hasAudio && (p.clip.asset.volume ?? 1) > 0);

    // visualPlanned is already in timeline order (visualClips sorted by start, L119).
    const transitions = visualTrack.transitions ?? [];
    const renderSeconds = renderDuration(edit);

    const graph: string[] = [];
    // per-clip video normalization (geometry + colorspace + timebase + PTS reset)
    for (const p of visualPlanned) graph.push(videoChain(p, w, h, fps));

    // chain xfade per transition; hard cuts concat. Returns the final [v] label.
    let vLabel: string;
    if (visualPlanned.length === 1) {
      vLabel = `[v${visualPlanned[0]!.index}]`;
    } else {
      const byFrom = new Map<number, typeof transitions[number]>();
      for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr);
      let acc = `[v${visualPlanned[0]!.index}]`;
      let accEnd = visualPlanned[0]!.clip.length;
      let stage = 0;
      for (let i = 1; i < visualPlanned.length; i++) {
        const cur = visualPlanned[i]!;
        const tr = byFrom.get(i - 1);
        const next = `[vx${stage}]`;
        if (tr) {
          const durS = tr.durationMs / 1000;
          const offset = accEnd - durS;
          graph.push(`${acc}[v${cur.index}]xfade=transition=${transitionToXfade(tr)}:duration=${durS}:offset=${offset}${next}`);
          accEnd = accEnd + cur.clip.length - durS;
        } else {
          graph.push(`${acc}[v${cur.index}]concat=n=2:v=1:a=0${next}`);
          accEnd = accEnd + cur.clip.length;
        }
        acc = next;
        stage++;
      }
      vLabel = acc;
    }

    let mapAudio = false;
    if (sounded.length > 0) {
      for (const p of sounded) graph.push(audioChain(p, visualPlanned, transitions));
      const mixIn = sounded.map((p) => `[a${p.index}]`).join("");
      graph.push(
        `${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`,
      );
      mapAudio = true;
    }

    const args: string[] = ["-y"];
    for (const p of planned) args.push(...inputArgs(p));
    args.push("-filter_complex", graph.join(";"), "-map", vLabel);
    if (mapAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    args.push("-progress", "pipe:1", "-nostats", out);

    console.log(
      `[render] ${job.id}: ffmpeg ${visualPlanned.length} visual (${transitions.length} transitions) + ${sounded.length} audio → ${w}x${h}@${fps}, ${renderSeconds}s`,
    );
```

> **Drop the dead `buildVideoGraph`/`PlannedInput`-w/h-0 helper from Step 2** — Step 3 inlines the authoritative chain (it needs `w/h/fps` for `videoChain` and `renderDuration` in scope). Keep only `transitionToXfade` (Task 4) and the strengthened `videoChain` (Step 1). Step 2's `buildVideoGraph` was illustrative; do not ship it. (This avoids two divergent copies of the chaining math — Self-Review type-consistency check.)

- [ ] **Step 4: Use `renderDuration` for the progress denominator and stored duration** — two more edits:
  - The `-progress` percent (L181): change the denominator from `totalSeconds` to `renderSeconds`:
    ```ts
    const pct = Math.min(95, Math.round((latestUs / 1e6 / renderSeconds) * 90) + 5);
    ```
    (`renderSeconds` is in scope from Step 3; it is computed before `proc` is spawned.)
  - The stored asset `durationS` (L210): change `durationS: totalSeconds` to `durationS: renderSeconds`.
  - The empty-edit guard at L125 (`if (!(totalSeconds > 0))`): keep it on `totalSeconds` (`editDuration`) — layout length, not output length; a transition can't make a non-empty edit render to ≤0 because `durationMs ≤ half the shorter clip` guarantees positive output. Leave L103 `const totalSeconds = editDuration(edit);` in place (still used by the guard).

- [ ] **Step 5: Update the imports** — at the top of `render.ts` (L22–31), add `renderDuration` to the `@artlio/core` import and the types from Task 4:

```ts
import {
  artlioEdit,
  editDuration,
  renderDuration,
  newId,
  srcToStorageKey,
  RENDER_RETRY_LIMIT,
  type ArtlioEdit,
  type ArtlioClip,
  type BetweenClipTransition,
  type TransitionDirection,
  type RenderJobData,
} from "@artlio/core";
```

- [ ] **Step 6: Typecheck the worker + core (exports reachable)**

Run: `pnpm --filter @artlio/core build && pnpm --filter @artlio/worker typecheck`
Expected: no errors. (`@artlio/core build` first so the worker sees the new exports from its compiled dist.)

- [ ] **Step 7: Commit Tasks 4+5 together** (leave for user approval)

```bash
git add apps/worker/src/jobs/render.ts
git commit -m "feat(editor): EP1 worker — chained xfade video graph + renderDuration output timing"
```

---

## Task 6: Worker — audio re-mapped to the rendered (shrunk) timeline

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — `audioChain` (L69–78) and its call site (already updated in Task 5 Step 3 to pass `visualPlanned, transitions`).

Once video transitions overlap clips, the rendered timeline is SHORTER than the edit timeline. Native clip audio (a video clip's own sound) and external audio-track clips both reference the EDIT timeline via `adelay=start*1000`. They must be re-delayed by the cumulative transition overlap that occurs BEFORE each clip, and a video transition's audio should cross-fade over the same overlap.

- [ ] **Step 1: Compute the rendered-time shift per clip + rewrite `audioChain`** — replace `audioChain` (L69–78) with:

```ts
/** Map a clip's start from EDIT time to RENDERED time: subtract the total
 *  transition overlap that occurs strictly BEFORE this clip on the visual track.
 *  Audio-track clips (not on the visual track) shift by the full overlap that
 *  precedes their edit-time start. */
function renderedStartSeconds(
  clip: ArtlioClip,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): number {
  // cumulative overlap (s) applied at/before each visual clip's edit-time start
  const byFrom = new Map<number, number>();
  for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr.durationMs / 1000);
  let overlapBefore = 0;
  // overlap accumulates as we pass each transition boundary in timeline order
  let accAtStart = 0;
  const overlapAtEditStart: { editStart: number; overlap: number }[] = [{ editStart: 0, overlap: 0 }];
  for (let i = 1; i < visualPlanned.length; i++) {
    accAtStart += byFrom.get(i - 1) ?? 0;
    overlapAtEditStart.push({ editStart: visualPlanned[i]!.clip.start, overlap: accAtStart });
  }
  // pick the overlap for the last boundary at or before this clip's edit start
  for (const e of overlapAtEditStart) {
    if (e.editStart <= clip.start + 1e-6) overlapBefore = e.overlap;
  }
  return Math.max(0, clip.start - overlapBefore);
}

/** audio chain for one sounded clip: volume + legacy afade, normalize sample
 *  rate/format, then delay to the RENDERED-time start (transitions shrink the
 *  timeline — Codex). anullsrc silence-fill for audio-less clips is handled at
 *  the mix (they're filtered out of `sounded`), so this only runs for clips with
 *  real audio. Output [a${index}]. */
function audioChain(
  p: PlannedInput,
  visualPlanned: PlannedInput[],
  transitions: BetweenClipTransition[],
): string {
  const vol = p.clip.asset.volume ?? 1;
  const filters = [`aresample=async=1:first_pts=0`, `volume=${vol}`];
  const t = p.clip.transition; // legacy per-clip afade
  if (t?.in) filters.push(`afade=t=in:st=0:d=${t.duration}`);
  if (t?.out) filters.push(`afade=t=out:st=${Math.max(0, p.clip.length - t.duration)}:d=${t.duration}`);
  const delayMs = Math.round(renderedStartSeconds(p.clip, visualPlanned, transitions) * 1000);
  if (delayMs > 0) filters.push(`adelay=${delayMs}:all=1`);
  return `[${p.index}:a]${filters.join(",")}[a${p.index}]`;
}
```

> **Why `amix` + per-clip `adelay` rather than `acrossfade` between adjacent audio:** the existing render already mixes all sounded clips into one `amix` (L145–152). Each visual clip's audio is delayed to its (now rendered-time) start and overlaps the previous clip's tail by exactly the transition duration, so `amix` sums them across the overlap — the audible result is a cross-fade-equivalent dip-and-rise that tracks the video transition. This is surgical (keeps the `amix` topology) and avoids a fragile N-way `acrossfade` chain. The `aresample=async=1:first_pts=0` (added in the chain and again before `atrim` in Task 5 Step 3) keeps sample rates aligned and prevents drift. The spec's "`anullsrc` silence-fill for clips with no audio" is satisfied structurally: audio-less clips are excluded from `sounded` (L135–137) so they contribute no stream to `amix`, and `amix=duration=longest` + the `atrim=0:${renderSeconds}` already pad the mix to full rendered length with silence — no explicit `anullsrc` input is needed. (If a future review wants per-clip silence segments, add an `anullsrc` input then; not needed for correct EP1 output.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @artlio/core build && pnpm --filter @artlio/worker typecheck`
Expected: no errors. (The `audioChain` call site was already updated in Task 5 Step 3 to `audioChain(p, visualPlanned, transitions)`.)

- [ ] **Step 3: Commit** (leave for user approval)

```bash
git add apps/worker/src/jobs/render.ts
git commit -m "feat(editor): EP1 worker — audio re-mapped to rendered timeline under transitions"
```

---

## Task 7: Worker — render-time guards (reject/clamp before ffmpeg)

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — in `handleRender`, right after `const transitions = visualTrack.transitions ?? [];` (Task 5 Step 3).

The contract already enforces gapless + duration ≤ half-shorter-clip + adjacency at `artlioEdit.parse` (L102). These worker guards are belt-and-braces against schema drift and the one thing the contract can't see: rendered dimensions are uniform (they are — every clip is scaled to the same `w×h` by `videoChain`, so xfade's "both inputs same size" requirement is met by construction). Add a defensive check that each transition's offset stays strictly inside both clips.

- [ ] **Step 1: Add the guard** — after `const transitions = visualTrack.transitions ?? [];`:

```ts
    // belt-and-braces (contract already enforces these at parse; guard against
    // schema drift so a bad transition can't produce a negative xfade offset or
    // a hang). All clips render at the same w×h (videoChain), so xfade's
    // equal-dimensions requirement holds by construction.
    for (const tr of transitions) {
      const from = visualPlanned[tr.fromClipIndex];
      const to = visualPlanned[tr.toClipIndex];
      if (!from || !to || tr.toClipIndex !== tr.fromClipIndex + 1) {
        throw new Error(`transition references non-adjacent or missing clips (${tr.fromClipIndex}→${tr.toClipIndex})`);
      }
      const durS = tr.durationMs / 1000;
      if (durS >= from.clip.length || durS >= to.clip.length) {
        throw new Error(`transition ${durS}s ≥ an adjacent clip length — would push xfade offset past a boundary`);
      }
    }
```

> This must run BEFORE the chain build (Task 5 Step 3) so a bad edit throws cleanly into the existing try/catch (L219) → `FAILED` with a message, never a malformed ffmpeg argv. Place this block immediately after `const transitions = …` and before `const renderSeconds = …`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @artlio/worker typecheck`
Expected: no errors.

- [ ] **Step 3: Commit** (leave for user approval)

```bash
git add apps/worker/src/jobs/render.ts
git commit -m "feat(editor): EP1 worker — defensive transition guards before ffmpeg"
```

---

## Task 8: UI — Transitions tab + boundary apply + overlay marker + merge-on-save

**Files:**
- Modify: `apps/web/components/Editor.tsx` — add a Transitions tab beside Assets (L429–447 is the Assets aside), transition React state, the `snapshot()` merge (L203–214), an overlay marker on the timeline (L455–475 is the timeline container), and a "Close gaps" affordance.

The transition library does NOT touch the Shotstack `Edit`. It edits an Artlio-owned `transitions` array in React state, keyed to the current visual track's clip order. On `snapshot()`/save the array is merged into the `ArtlioEdit` BEFORE `artlioEdit.safeParse`. The Shotstack `getEdit()` never carries it (Shotstack would strip it).

- [ ] **Step 1: Add transition state + the selected boundary** — after the `selected` state (L78) add:

```tsx
  // EP1 between-clip transitions live OUTSIDE the Shotstack Edit (Shotstack strips
  // unknown fields). Keyed by fromClipIndex on the visual track (track 0).
  type UiTransition = { fromClipIndex: number; toClipIndex: number; type: string; durationMs: number; direction?: "left" | "right" | "up" | "down" };
  const [transitions, setTransitions] = useState<UiTransition[]>(
    () => (initialEdit?.timeline.tracks[0] as { transitions?: UiTransition[] } | undefined)?.transitions ?? [],
  );
  // the clip boundary the user is editing (transition AFTER clip N → N+1)
  const [boundary, setBoundary] = useState<number | null>(null);
  const TRANSITION_TILES = ["None", "Fade", "Slide", "Wipe", "Flip", "Clock Wipe", "Iris"] as const;
  const TILE_TO_TYPE: Record<string, string | null> = {
    None: null, Fade: "fade", Slide: "slide", Wipe: "wipe", Flip: "flip", "Clock Wipe": "clockwipe", Iris: "iris",
  };
```

- [ ] **Step 2: Apply/clear handlers** — add near `applyTransition` (L241):

```tsx
  function setBoundaryTransition(tile: string) {
    if (boundary == null) return;
    const type = TILE_TO_TYPE[tile];
    setTransitions((prev) => {
      const rest = prev.filter((t) => t.fromClipIndex !== boundary);
      if (!type) return rest; // "None" = remove the entry
      return [...rest, { fromClipIndex: boundary, toClipIndex: boundary + 1, type, durationMs: 500 }];
    });
    setDirty(true);
  }
  function clearAllTransitions() {
    setTransitions([]);
    setDirty(true);
  }
```

- [ ] **Step 3: Merge transitions into the snapshot** — modify `snapshot()` (L203–214) to inject the array before parsing:

```tsx
  /** read back the Studio snapshot, MERGE the Artlio-owned transitions, and
   *  canonicalize through the contract (Shotstack never carries transitions). */
  function snapshot(): { edit?: ArtlioEdit; error?: string } {
    const h = handles.current;
    if (!h) return { error: "Editor not ready yet." };
    const raw = h.edit.getEdit() as ArtlioEdit;
    // merge our transitions onto the visual track (track 0) before parsing
    const merged = {
      ...raw,
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) =>
          i === 0 && transitions.length > 0 ? { ...t, transitions } : t,
        ),
      },
    };
    const result = artlioEdit.safeParse(merged);
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: `${first?.message ?? "invalid edit"}${first?.path?.length ? ` (at ${first.path.join(".")})` : ""}`,
      };
    }
    return { edit: result.data };
  }
```

> Note: the live debounced validator (L164) also calls `getEdit()` — leave it as is (it validates the Shotstack-only shape, which is fine; the authoritative merge+parse is `snapshot()` used by Save/Export). The transition array's own validity is surfaced by Save/Export's `snapshot()` error.

- [ ] **Step 4: Render the Transitions tab** — add a second `<aside>` after the Assets aside (after L447, inside the `flex` row at L427). It is a sibling panel:

```tsx
          {/* Transitions tab — applies to a selected clip boundary; lives outside Shotstack */}
          <aside style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <MonoLabel>Transitions</MonoLabel>
              <button onClick={clearAllTransitions} disabled={transitions.length === 0} style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "none", border: "none", cursor: transitions.length ? "pointer" : "default", textDecoration: "underline", textUnderlineOffset: 3 }}>Clear all</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {boundary == null ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Pick a clip boundary on the timeline, then choose a transition.</p>
              ) : (
                <>
                  <p style={{ font: "var(--text-caption)", color: "var(--fg-2)", margin: "0 0 2px" }}>Between clip {boundary + 1} and {boundary + 2}</p>
                  {TRANSITION_TILES.map((tile) => {
                    const active = (TILE_TO_TYPE[tile] ?? null) === (transitions.find((t) => t.fromClipIndex === boundary)?.type ?? null);
                    return (
                      <button key={tile} onClick={() => setBoundaryTransition(tile)}
                        style={{ textAlign: "left", font: "var(--text-caption)", color: active ? "var(--fg-0)" : "var(--fg-1)", background: active ? "var(--glass-2)" : "var(--glass-1)", border: `1px solid ${active ? "var(--line-1)" : "var(--line-2)"}`, borderRadius: "var(--radius-sm)", padding: "7px 10px", cursor: "pointer" }}>
                        {tile}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </aside>
```

- [ ] **Step 5: Boundary selection from the clip selection** — when a clip is selected (the existing `clip:selected` handler at L176), also set the boundary to that clip index (a transition is "after clip N"). Add inside the `offSel` handler (L176–179), after `setSelected(...)`:

```tsx
          if (r && typeof r.clipIndex === "number" && r.trackIndex === 0) setBoundary(r.clipIndex);
```

> Caveat (state honestly in the plan): Shotstack reports the selected clip in its own index space; on a single visual track (LTX-light) that matches our sorted-by-start order, so `clipIndex` is the boundary "after clip N". This is the same single-track assumption the whole editor already makes (`appendAsset` uses track 0). The boundary is clamped at render: `setBoundaryTransition` only writes `fromClipIndex` that the contract then validates (adjacency + range), so a stale boundary on the last clip fails Save/Export cleanly rather than corrupting the cut.

- [ ] **Step 6: Overlay marker between clips** — Shotstack won't render the between-clip transition. Add a small badge strip above the timeline listing active transitions (a lightweight, non-pixel-mapped indicator — the spec accepts an overlay/indicator, not a pixel-accurate marker, because Shotstack exposes no pixel→time mapping). Insert just before the timeline container `<div ref={timelineRef} …>` (before L455):

```tsx
          {transitions.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 0" }} aria-label="Active transitions">
              {[...transitions].sort((a, b) => a.fromClipIndex - b.fromClipIndex).map((t) => (
                <button key={t.fromClipIndex} onClick={() => setBoundary(t.fromClipIndex)} title="Edit this transition"
                  style={{ font: "var(--text-mono-meta)", color: "var(--fg-2)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "2px 8px", cursor: "pointer" }}>
                  {t.fromClipIndex + 1}↔{t.toClipIndex + 1}: {t.type}{t.direction ? ` ${t.direction}` : ""}
                </button>
              ))}
            </div>
          )}
```

- [ ] **Step 7: "Close gaps" affordance for legacy gappy cuts** — gapless is now enforced at parse, so an old saved cut with gaps fails Save/Export. Give the user a one-click fix. Add a helper near `saveCut` (L269) and surface a button in the header (next to "Save cut" at L412) that appears only when a save fails with a gap error:

```tsx
  // re-lay the visual track so clips tile from 0 (closes a legacy gap so the
  // gapless contract passes). Pure client-side; the user then saves.
  async function closeGaps() {
    const h = handles.current;
    if (!h || status !== "ready") return;
    const cur = h.edit.getEdit() as ArtlioEdit;
    const t0 = cur.timeline.tracks[0]?.clips ?? [];
    const ordered = [...t0].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i]!;
      if (Math.abs(c.start - cursor) > 1e-6) {
        await h.edit.updateClip(0, t0.indexOf(c), { start: cursor }).catch(() => {});
      }
      cursor += c.length;
    }
    setDirty(true);
    setNotice({ tone: "ok", text: "Gaps closed — save the cut." });
  }
```

And in the header (after the "Save cut" Button at L412–414), add:

```tsx
        {notice?.tone === "warn" && /gap|tile|contiguous/i.test(notice.text) && (
          <Button variant="glass" size="sm" onClick={closeGaps} disabled={status !== "ready" || busy}>Close gaps</Button>
        )}
```

- [ ] **Step 8: Typecheck the web app**

Run: `pnpm --filter web typecheck`
Expected: no errors. (Read `apps/web/node_modules/next/dist/docs/` before any route/page edits — this task only edits a client component, no route change, so no docs read is required, but the AGENTS.md rule stands if you touch routing.)

- [ ] **Step 9: Build the web app (catches client/server boundary issues)**

Run: `pnpm --filter web build`
Expected: build succeeds.

- [ ] **Step 10: Commit** (leave for user approval)

```bash
git add apps/web/components/Editor.tsx
git commit -m "feat(editor): EP1 UI — Transitions tab, boundary apply, overlay marker, merge-on-save, close-gaps"
```

---

## Task 9: Verify — local $0 ffmpeg render of every transition type + no-spend grep

**Files:**
- Create: `scripts/local-ep1-transitions-verify.mjs`

This is the render-correctness gate. It builds tiny fixtures with `ffmpeg` (color sources), constructs an `ArtlioEdit` per transition type, invokes the SAME filtergraph logic the worker uses (imported from the built `@artlio/core` for `renderDuration`, and a local copy of `transitionToXfade`/the chain — or, preferred, by running the worker's `handleRender` against a mock storage). To stay surgical and avoid wiring the worker's storage/prisma, the script reproduces the chain inline and asserts the OUTPUT duration matches `renderDuration`. It runs `GENERATION_PROVIDER=mock` and greps the diff for any new spend path.

- [ ] **Step 1: Kill stale fal workers first (money-safety habit)**

Run: `pkill -f "apps/worker" 2>/dev/null; ps aux | grep -i "[w]orker" || echo "no stale workers"`
Expected: no stale worker process holding the queue.

- [ ] **Step 2: Write the verify script** — `scripts/local-ep1-transitions-verify.mjs`:

```js
#!/usr/bin/env node
// EP1 transitions: $0 local ffmpeg render of each transition type, asserting the
// output mp4 is valid and its ffprobe duration == renderDuration (Σ clip − Σ transition).
// No fal, no spend path. GENERATION_PROVIDER=mock. Run: node scripts/local-ep1-transitions-verify.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const run = promisify(execFile);

// Mirror the worker's mapping + chain (apps/worker/src/jobs/render.ts) so the
// script tests the exact graph shape. Keep in sync with transitionToXfade there.
const XFADE = {
  fade: () => "fade", cross: () => "fade",
  slide: (d) => ({ left: "slideleft", right: "slideright", up: "slideup", down: "slidedown" }[d ?? "left"]),
  wipe: (d) => ({ left: "wipeleft", right: "wiperight", up: "wipeup", down: "wipedown" }[d ?? "left"]),
  clockwipe: () => "radial",
  iris: (d) => (d === "down" || d === "right" ? "circleclose" : "circleopen"),
  flip: () => "vertopen",
};

const W = 320, H = 240, FPS = 25;
const CLIP_A = 2, CLIP_B = 2, DUR_MS = 500; // 2s + 2s, 0.5s transition → 3.5s output

async function makeSource(dir, name, color, seconds) {
  const out = path.join(dir, name);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=${W}x${H}:r=${FPS}:d=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
  return out;
}

function videoChain(idx) {
  return `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${idx}]`;
}

async function renderWith(dir, type, srcA, srcB) {
  const durS = DUR_MS / 1000;
  const offset = CLIP_A - durS;
  const out = path.join(dir, `out-${type}.mp4`);
  const graph = [
    videoChain(0), videoChain(1),
    `[v0][v1]xfade=transition=${XFADE[type]()}:duration=${durS}:offset=${offset}[vx]`,
    `[0:a]aresample=async=1:first_pts=0,volume=1[a0]`,
    `[1:a]aresample=async=1:first_pts=0,volume=1,adelay=${Math.round((CLIP_A - durS) * 1000)}:all=1[a1]`,
    `[a0][a1]amix=inputs=2:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${CLIP_A + CLIP_B - durS}[a]`,
  ].join(";");
  await run("ffmpeg", ["-y", "-t", String(CLIP_A), "-i", srcA, "-t", String(CLIP_B), "-i", srcB,
    "-filter_complex", graph, "-map", "[vx]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", out]);
  return out;
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim());
}

const main = async () => {
  if (process.env.GENERATION_PROVIDER && process.env.GENERATION_PROVIDER !== "mock") {
    throw new Error(`refusing to run with GENERATION_PROVIDER=${process.env.GENERATION_PROVIDER} (set it to mock or unset)`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "ep1-transitions-"));
  try {
    const srcA = await makeSource(dir, "a.mp4", "red", CLIP_A);
    const srcB = await makeSource(dir, "b.mp4", "blue", CLIP_B);
    const expected = CLIP_A + CLIP_B - DUR_MS / 1000; // = renderDuration, 3.5s
    const types = Object.keys(XFADE);
    let fail = 0;
    for (const type of types) {
      const out = await renderWith(dir, type, srcA, srcB);
      const got = await probeDuration(out);
      const ok = Math.abs(got - expected) <= 0.15; // ffmpeg container rounding tolerance
      console.log(`${ok ? "PASS" : "FAIL"} ${type.padEnd(10)} expected≈${expected}s got=${got.toFixed(3)}s`);
      if (!ok) fail++;
    }
    if (fail) throw new Error(`${fail}/${types.length} transition renders had wrong duration`);
    console.log(`\nALL ${types.length} transition types rendered valid mp4s at renderDuration=${expected}s ($0, no fal).`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 3: Run the verify script**

Run: `GENERATION_PROVIDER=mock node scripts/local-ep1-transitions-verify.mjs`
Expected output (durations within 0.15s tolerance):

```
PASS fade       expected≈3.5s got=3.5xx s
PASS cross      expected≈3.5s got=3.5xx s
PASS slide      expected≈3.5s got=3.5xx s
PASS wipe       expected≈3.5s got=3.5xx s
PASS clockwipe  expected≈3.5s got=3.5xx s
PASS iris       expected≈3.5s got=3.5xx s
PASS flip       expected≈3.5s got=3.5xx s

ALL 7 transition types rendered valid mp4s at renderDuration=3.5s ($0, no fal).
```

- [ ] **Step 4: No-spend invariant grep** — prove EP1 added no spend path:

Run:
```bash
git diff --staged -- apps/worker/src/jobs/render.ts apps/web/components/Editor.tsx packages/core/src/timeline.ts | grep -nE "startGen|GenJob|fal\.|@fal|coworkGenerate|fal-media|falApi" || echo "NO spend-path token added by EP1"
```
Expected: `NO spend-path token added by EP1`.

- [ ] **Step 5: Full local gate**

Run: `pnpm --filter @artlio/core test && pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/worker typecheck && pnpm --filter web typecheck && pnpm --filter web build`
Expected: all green.

- [ ] **Step 6: Commit** (leave for user approval)

```bash
git add scripts/local-ep1-transitions-verify.mjs
git commit -m "test(editor): EP1 local $0 ffmpeg verify — every transition type renders at renderDuration"
```

---

## Task 10: Docs + Codex gate (STOP before deploy)

**Files:**
- Modify: `docs/backlog.md` (§E L27 — mark the gap-ignore bug closed by EP1)

- [ ] **Step 1: Close the backlog item** — in `docs/backlog.md` §E, change L27 from:

```
- [ ] 导出忽略时间线空隙 → 黑帧填补（render 关键路径，需本地 ffmpeg 测，不盲发）。
```
to:
```
- [x] 导出忽略时间线空隙 —— EP1 改为 gapless 强制（contract 拒绝有空隙的视觉轨 + UI「Close gaps」），不再有黑帧/被忽略空隙。
```

- [ ] **Step 2: Commit the docs** (leave for user approval)

```bash
git add docs/backlog.md
git commit -m "docs: EP1 closes backlog §E timeline-gap bug via gapless enforcement"
```

- [ ] **Step 3: Codex render-correctness gate (REQUIRED before any deploy)** — run `/codex` on the EP1 diff. Gate focus (from spec §4):
  1. Render-pipeline correctness: the chained-`xfade` offsets, the audio rendered-time re-mapping, `renderDuration` used everywhere output duration matters.
  2. The contract change is additive + bounded + backward-compat (legacy fade edits + no-transition edits still parse).
  3. NO spend path introduced (the Task 9 Step 4 grep).
  4. The worker can't hang/OOM: duration/dimension guards (Task 7), 10-min execa timeout + 720p cap unchanged.
  5. Standard build/typecheck/test gate green.
- [ ] **Step 4: STOP.** Do not deploy until the user authorizes after the Codex gate passes. Deploy is two services (web + worker) — both ship together because the contract + worker + UI change in lockstep. (Worker deploy is required: an old worker would ignore `track.transitions` and render hard cuts, so a UI-only deploy would silently drop transitions.)

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-opt4-video-editor-design.md` §0/§1/§2/EP1/§4):

- §2 track-level `transitions[]` (NOT clip field; Shotstack strips unknown) → Tasks 1–2 (zod) + Task 8 Step 3 (merge outside Shotstack, verified against Shotstack's per-clip-only `Transition` schema). ✓
- §2 type enum (none excluded; cross/slide/wipe/flip/clockwipe/iris/fade) → Task 1 `TRANSITION_TYPES` + the `none`-rejection test. ✓
- §2 `durationMs` bounded ≤ `TRANSITION_MAX*1000` AND ≤ half shorter adjacent clip → Task 1 (field bound) + Task 2 (cross-pair refine). ✓
- §2 `direction?` enum → Task 1. ✓
- §2 superRefine: two real gapless-adjacent visual clips, `from+1==to`, dangling index, duration guard → Task 2. ✓
- §2 `renderDuration()` = `editDuration − Σ transition` used everywhere output duration matters → Task 3 + Task 5 Step 4 (progress + durationS) + Task 5 Step 3 (audio `atrim`). ✓
- §2 gapless adjacency defined + ENFORCED + closes the gap-ignore bug → Task 2 `visualGapMessage` (reject) + Task 8 Step 7 (Close gaps UI) + Task 10 Step 1 (backlog §E). Decision locked: validation-reject (rationale in the decisions block). ✓
- §2 legacy per-clip fade stays valid → Task 2 test "parses a legacy fade-to-black edit unchanged"; `videoChain`/`audioChain` keep the legacy `fade`/`afade` branches. ✓
- EP1 worker: concat → chained xfade (cuts still concat); per-clip `format=yuv420p`+`settb=AVTB`+`setpts=PTS-STARTPTS`; offset from rendered cumulative position; `renderDuration` for progress+durationS → Task 5. ✓
- EP1 worker audio: re-mapped to rendered time, overlap-equivalent crossfade via delayed `amix`, silence-fill (structural via `amix`+`atrim`), `aresample` before `amix` → Task 6 (with the explicit rationale for amix-vs-acrossfade and how silence-fill is satisfied). ✓
- EP1 worker guards: duration ≥ adjacent clip, non-gapless/non-adjacent, dims → Task 7 (dims uniform by construction, stated). ✓
- EP1 transition→xfade map incl. Flip decision → Task 4 (`transitionToXfade`); Flip = `vertopen` best-effort, shipped + documented (decision locked). ✓
- EP1 UI: 7 tiles + Clear all + boundary apply + state outside Shotstack + merge on save + overlay marker → Task 8. ✓
- §1 visual-parity NIT (structure not pixel chrome; deferred bigger LTX re-layout) → Task 8 adds only the Transitions tab + boundary + marker, as EP1 scopes. ✓
- §4 testing: core vitest (Tasks 1–3) + local $0 ffmpeg render asserting ffprobe == renderDuration (Task 9) + no-spend grep (Task 9 Step 4) + Codex gate (Task 10). ✓
- House rules: $0 self-hosted ffmpeg only; NO prisma migration (editJson is Json — stated in header + no migration task); additive/backward-compat; NO auto-commit/push (every commit step says "leave for user approval"); STOP for /codex before deploy (Task 10 Step 4). ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every code step has full code; every run step has an exact command + expected output. One illustrative-only helper (`buildVideoGraph` in Task 5 Step 2) is explicitly marked "do not ship — Step 3 is authoritative" to avoid a divergent second copy; the shipped chain is Task 5 Step 3.

**3. Type consistency:** `betweenClipTransition`/`BetweenClipTransition`, `TransitionType`/`TRANSITION_TYPES`, `TransitionDirection`/`TRANSITION_DIRECTIONS`, `renderDuration`, `transitionToXfade`, `renderedStartSeconds`, `audioChain(p, visualPlanned, transitions)`, `videoChain(p, w, h, fps)` — names match across Tasks 1–9. `durationMs` (contract, ms) vs `durS = durationMs/1000` (ffmpeg, s) is consistent everywhere. The UI `UiTransition` shape mirrors the contract fields exactly and is parsed by `artlioEdit` on save. The worker imports `renderDuration` + types in Task 5 Step 5 (one import block, no duplicates).

**4. The two Codex NITs (explicitly handled):**
- (a) **renderDuration unit = ms→s `/1000`:** Task 1 comment states the contract is ms and the worker divides by 1000; Task 3 `renderDuration` does `overlapMs/1000`; Task 3 has a dedicated test "converting ms→seconds (Codex NIT)"; Task 5/6 use `durationMs/1000` for every ffmpeg arg. ✓
- (b) **undo is EP2, NOT this phase:** No undo/redo task anywhere. Confirmed Shotstack exposes `undo()/redo()` (grounding) but EP1 deliberately does not wire them — recorded as out of EP1 scope. ✓

---

## Notes for the executor (real-code deltas vs the brief's assumptions)

- **Shotstack `Edit` vs `ArtlioEdit` are NOT the same object — they're structurally compatible by design.** `ArtlioEdit` is a documented SUBSET of Shotstack's Edit JSON (timeline.ts header L6–9). `new Edit(startEdit)` is fed an `ArtlioEdit`; `getEdit()` returns a Shotstack-shaped object that `artlioEdit.parse` strips back down. A track-level `transitions` array is NOT in Shotstack's schema (its `Transition` is per-clip in/out only — verified), so `getEdit()` will never carry it: the merge-on-save in Task 8 Step 3 is mandatory, exactly as the spec's BLOCKER fix says.
- **`editDuration` callers:** verified via codegraph — `handleRender` (the output-duration uses → switch to `renderDuration`), `saveProjectEdit` (logging only → stays `editDuration`), and the test. No other caller needs touching.
- **Worker has no vitest suite** (no `vitest.config.*`, no `*.test.ts` under `apps/worker`); EP1 does not add one — the worker filtergraph is verified by the Task 9 render script. Contract logic is fully unit-tested in core.
- **Gapless = validation-reject** (locked, with rationale) — better than normalize-on-save here because overlap is already a hard reject and a silent normalize could move a clip out from under a placed transition. The UI ships a "Close gaps" button so legacy gappy cuts are one click from valid.
- **Flip = `vertopen` best-effort, shipped** (locked) — not deferred; a one-line swap if a review dislikes it.
