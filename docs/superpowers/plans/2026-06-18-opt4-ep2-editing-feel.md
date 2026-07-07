# OPT-4 EP2 — Editing feel (编辑手感) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Fikirtive's video editor CapCut-style editing feel — **split at the playhead**, **ripple-delete**, **snapping**, and **trim polish** — as PURE contract operations on `FikirtiveEdit`, plus ONE authoritative undo/redo stack whose source of truth is the contract JSON (not Shotstack's internal command history). Every op returns a `parse`-valid edit that keeps the EP1 `track.transitions[]` array correctly re-indexed. Entirely $0: no spend path, no prisma migration.

**Architecture:** The heart of EP2 is a new pure module `packages/core/src/timeline-ops.ts` — `splitClipAt`, `rippleDeleteClip`, `moveClip`, and the transition-reindex helpers they share. Each takes an `FikirtiveEdit` (already parsed) and returns a NEW edit that re-parses clean through `fikirtiveEdit.parse` (including the EP1 gapless-adjacency, adjacency `from+1==to`, duplicate-boundary, and "≤ half the shorter clip" guards). The UI (`apps/web/components/Editor.tsx`) wires these ops to gestures: split uses the Shotstack transport playhead (`Edit.playbackTime`) + the selected clip; ripple-delete removes the selected clip; both mutate the Fikirtive edit and reload it into the Shotstack `Edit` via `Edit.loadEdit(...)`, re-applying the EP1 React transition state. A single bounded undo stack snapshots the merged `FikirtiveEdit` and `loadEdit`s a snapshot on undo/redo — Shotstack's own `undo()/redo()` is NOT used (it can't see custom contract ops).

**Tech Stack:** pnpm monorepo (`packages/core` zod + vitest, `apps/web` Next.js 16 + `@shotstack/shotstack-studio` 2.11.5). `Project.editJson` is a Prisma `Json` column — EP2 adds NO contract FIELDS at all (only pure functions + UI), so **NO migration**. `apps/web` AGENTS.md rule: read `node_modules/next/dist/docs/` before any route/page edit — EP2 touches only a client component (`Editor.tsx`), no routing.

**MONEY-SAFETY (rule #1, invariant across every task):** EP2 adds only (a) pure functions in `packages/core` and (b) client-side gesture wiring in `Editor.tsx`. The spend path is `startGen` (`apps/web/lib/gen-actions.ts:28`), reached ONLY from `coworkGenerate` (`apps/web/lib/cowork-actions.ts:563`); the editor save/render path (`saveProjectEdit`/`startRender` → pg-boss → worker ffmpeg) never calls it and EP2 does not change that. The verify task greps to prove no spend token is added. No worker change at all in EP2 (the EP1 worker already renders `track.transitions`; EP2 only changes how the contract is EDITED in the browser).

---

## Grounding (verified against the real code, 2026-06-18)

Every task below references these by exact symbol/line. All were read (codegraph + Read) before writing.

### The EP1-shipped contract (`packages/core/src/timeline.ts`, 333 lines) — what EP2 ops MUST keep valid

- `clip` zod L117–140: `{ asset, start, length>0 (≤MAX_CLIP_SECONDS), transition?, fit? }`, with a `.superRefine` (L128) that rejects legacy per-clip `transition` on audio clips and on clips shorter than `2× transition.duration`.
- `track` zod L142–150: `{ clips: array(clip).min(1).max(100), transitions?: array(betweenClipTransition).max(100) }`.
- `betweenClipTransition` zod L108–115: `{ fromClipIndex:int≥0, toClipIndex:int≥0, type∈TRANSITION_TYPES, durationMs:int>0 ≤ TRANSITION_MAX_SECONDS*1000, direction? }`.
- `timeline.superRefine` L173–261 — the cross-clip guards EP2 ops must satisfy. **For the visual track only**, when `t.transitions` is non-empty (L203):
  - transition indices address clips **in timeline order, sorted by `start`** (`ordered` L208).
  - **duplicate-boundary reject** (L212–221): a `Set<number> seenFrom` — each `fromClipIndex` may appear at most once.
  - **adjacency reject** (L222–228): `toClipIndex === fromClipIndex + 1`.
  - **range reject** (L229–233): both `ordered[from]` and `ordered[to]` must exist.
  - **gapless-adjacent reject** (L235–242): `|to.start − (from.start + from.length)| ≤ EPS` — the later clip starts exactly where the earlier ends. **This is LOCAL** — only a transitioned pair must be gapless; a track may otherwise contain gaps (legacy edits). EP2's ops must NOT introduce a gap *under a transition*.
  - **"≤ half the shorter clip" reject** (L243–249): `durationMs ≤ (min(from.length,to.length)/2)*1000`.
  - per-track **overlap reject** L190–193 (`clipsOverlap`, sort-by-start, EPS=1e-6) and **mixed-track reject** L194–197.
  - 30-min cap L255–260.
- `editDuration(edit)` L316–321 = `max(start+length)` across all tracks; `renderDuration(edit)` L328–333 = `editDuration − Σ transitions.durationMs/1000`.
- Bounds: `MAX_CLIPS_PER_TRACK=100` (L30), `MAX_CLIP_SECONDS=60*10` (L31), `MAX_TIMELINE_SECONDS=60*30` (L32), `TRANSITION_MAX_SECONDS=2` (L34).
- `packages/core/src/index.ts` re-exports the contract symbols + types (`fikirtiveEdit`, `FikirtiveEdit`, `FikirtiveClip`, `BetweenClipTransition`, `editDuration`, `renderDuration`, …). EP2 adds the new ops to this barrel.

### The EP1-shipped test harness (`packages/core/src/timeline.test.ts`, 302 lines) — reuse, don't reinvent

- `import { describe, expect, it } from "vitest"` L1; imports from `"./timeline.js"` L2–10.
- `const HASH = "a".repeat(64)` L12; `const SRC = `/files/u/founder/${HASH}.mp4`` L13.
- `const cloneEdit = (): any => structuredClone(validEdit)` L16 (note: defined BEFORE `validEdit` but only CALLED inside `it(...)`, so hoisting is fine — EP2's new test file will define its own).
- `validEdit` L18–33: visual track `[{start:0,len:4,trim:1.5}, {start:4,len:3,transition:{in:"fade"}}]` (gapless) + an audio track `[{start:0,len:7}]`.
- `package.json` scripts (`@fikirtive/core`): `build`=`tsc -p tsconfig.json`, `typecheck`=`tsc … --noEmit`, `test`=`vitest run`. Run one file with `pnpm --filter @fikirtive/core test -- <name>`.

### `apps/web/components/Editor.tsx` (697 lines) — the EP1 UI EP2 wires into

- `StudioEdit` interface L20–25 — the typed subset the component uses today: `getEdit`, `addClip`, `updateClip`, `events.on`. **EP2 widens this** to also use `loadEdit`, `deleteClip`, `playbackTime`, `seek`, `getClip` (all real on the SDK — see SDK grounding).
- `type UiTransition` L37 = `{ fromClipIndex, toClipIndex, type:string, durationMs:number, direction? }` — the React-state mirror of `betweenClipTransition`, kept OUTSIDE Shotstack.
- `const [transitions, setTransitions]` L95–97 — seeded from `initialEdit.timeline.tracks[0].transitions`.
- `const [selected, setSelected]` L89; `const [boundary, setBoundary]` L99.
- Studio init effect L127–226: dynamic `import("@shotstack/shotstack-studio")` L147 → `new Edit(startEdit)` L152 → `canvas/ui/timeline/controls` → `edit.events.on("edit:changed", …)` debounced live-validate L181–188 → `edit.events.on("clip:selected", …)` L197–205 (sets `selected` and, for track 0, `setBoundary(r.clipIndex)`) → `handles.current = { edit, dispose }` L209.
- `snapshot()` L232–253 — reads `h.edit.getEdit()`, **merges** the React `transitions` onto track 0 (L240–242), `fikirtiveEdit.safeParse`. **This is the canonical "merged FikirtiveEdit" EP2's undo stack snapshots.**
- `appendAsset(clip)` L256–267 — `getEdit()` → `addClip(0, {asset,start:end,length})`.
- `applyTransition`/`applyVolume`/`syncSelectedFromEdit` L273–304 — patch via `updateClip` then re-read.
- `setBoundaryTransition`/`setBoundaryDuration`/`clearAllTransitions` L308–331 — mutate the React `transitions` array.
- `closeGaps()` L336–351 — re-lays track 0 so clips tile from 0 (per-clip `updateClip(0, idx, {start})`), the existing "reload-free" mutation pattern EP2 follows where possible.
- `saveCut()` L355–378 → `snapshot()` → `saveProjectEdit`. `exportCut()` L380–402 → save-if-dirty → `snapshot()` → `startRender`.
- Header buttons L498–508 (Save cut / Close gaps / Export MP4); the Assets aside L520–538; the Transitions aside L540–580; the Studio canvas + timeline containers L582–619; the Clip Inspector aside L659–692.

### Shotstack SDK 2.11.5 — the REAL surface (read in full from `index.d.ts`; runtime-confirmed in the bundle)

The EP1 plan's grounding **understated** this. Verified in `node_modules/.pnpm/@shotstack+shotstack-studio@2.11.5/node_modules/@shotstack/shotstack-studio/dist/index.d.ts` AND grepped in the compiled `shotstack-studio.es.js`:

- **Playhead / transport (CONFIRMED present):** `Edit.playbackTime: number` (public field, `index.d.ts` L137, 26 hits in the bundle), `Edit.totalDuration: number` (L138), `Edit.seek(target)` (L174), `play()/pause()/stop()` (L172–175). `ButtonClickPayload.position` is documented as "Current playback position in seconds" (L7–8). **→ split-at-playhead is feasible via `Edit.playbackTime`.**
- **Clip ops (CONFIRMED):** `deleteClip(trackIdx, clipIdx)` (L236, 6 bundle hits), `canDeleteClip(trackIdx, clipIdx)` (L235), `updateClip(trackIdx, clipIdx, Partial<Clip>)` (L261), `getClip(trackIdx, clipIdx)` (L227), `addClip(trackIdx, clip)` (L211), plus `*ById` variants `getClipById`/`moveClipById(clipId, toTrackIndex, newStart?)`/`deleteClipById`/`updateClipById` (L191–210).
- **Hot-reload (CONFIRMED, the key EP2 primitive):** `Edit.loadEdit(edit: EditConfig): Promise<void>` (L179, 2 bundle hits) — "Reload the edit with a new configuration (hot-reload)." EP2 uses this to push a post-op contract back into the live editor after a custom split/ripple/undo.
- **Undo/redo (present, but DELIBERATELY UNUSED):** `Edit.undo()`/`Edit.redo()` (L255–256), `Edit.MAX_HISTORY_SIZE` (L133), events `edit:undo`/`edit:redo` (L399, `EditEventMap` L461–466). **EP2 does NOT call these** — Shotstack's history only records Shotstack-issued commands (addClip/deleteClip/updateClip); our split/ripple are CUSTOM ops applied via `loadEdit`, which Shotstack's history would not capture (and `loadEdit` likely clears/desyncs it). Mixing the two stacks is the exact "two sources of truth" Codex flagged. EP2 keeps ONE stack — ours, on the contract.
- **`Timeline` class (the limit):** public methods are only `load()`, `dispose()`, `zoomIn()`, `zoomOut()` (`index.d.ts` L583–604). **NO public pixel→time mapping** — re-confirmed in the DnD spec `docs/superpowers/specs/2026-06-13-editor-storyboard-drag-drop-design.md` L25 ("exposes `addClip(trackIdx, clip)` but **no public pixel→time mapping**; reverse-engineering canvas coordinates is fragile"). **→ snapping cannot read drag-pixel X; it must work in contract-time (Task 7).**
- **Events used:** `edit.events.on("edit:changed" | "clip:selected" | "selection:cleared", …)` (the `ReadonlyEventEmitter` L532–536; `EditEvent` map L381–412). `edit:changed` fires `{source, timestamp}` (L457–460).

### Two design decisions this plan LOCKS (the brief asked the plan to pick)

1. **Snapping = snap-on-COMMIT in contract-time, NOT live drag-pixel snapping.** Shotstack exposes no pixel→time map (grounding above), so EP2 cannot intercept a drag mid-gesture and snap the ghost. Instead, snapping is applied to the *result* of an op/edit: after any op that sets a `start` or `length`, a pure `snapEdit(edit, threshold)` rounds each near-coincident clip edge to the neighbor edge / the playhead time / 0, within a small time threshold (default 0.15s). This is deterministic, testable, and contract-only. The two places it runs: (a) the split point snaps to the playhead and to clip edges before `splitClipAt`; (b) after a Shotstack-native trim/move drag fires `edit:changed`, the debounced handler runs `snapEdit` on the merged edit and `loadEdit`s the snapped result back. The plan states honestly that this is "snap-on-drop", not the live-drag snap of a pixel-mapped NLE. (Rationale: the live snap is impossible on this SDK without reverse-engineering PIXI coords — explicitly rejected by the DnD spec and §0.3 "probe then custom".)
2. **Trim polish = KEEP Shotstack's built-in drag-trim, ADD a contract-side post-process.** Shotstack already drags clip edges to retrim (its `updateClip` path emits `edit:changed`). EP2 does NOT replace that. It adds the `snapEdit` post-process (decision 1) so a near-edge trim lands exactly on the neighbor, AND ensures a trim that lands under a transition keeps the pair valid (the transition's "≤ half shorter clip" guard is re-checked on save; if a trim makes a clip too short for its transition, `snapshot()` surfaces the contract error and the existing UI shows it — no silent corruption). No custom trim handle is built (YAGNI; the SDK's is sufficient). If a future review wants a custom trim handle, that's its own task.

---

## File Structure

| File | Create/Modify | Responsibility in EP2 |
|---|---|---|
| `packages/core/src/timeline-ops.ts` | **Create** | The pure heart of EP2: `reindexTransitionsAfterSplit`, `reindexTransitionsAfterDelete`, `reindexTransitionsAfterMove` (transition re-index helpers); `splitClipAt`, `rippleDeleteClip`, `moveClip` (the ops); `snapEdit` (contract-time snapping); `MIN_CLIP_SECONDS`. Every op returns a NEW `FikirtiveEdit` that re-parses valid. No I/O, no Shotstack, no spend. |
| `packages/core/src/timeline-ops.test.ts` | **Create** | vitest for every op + every re-index case (split / ripple / move) + snapping + re-parse-valid + backward-compat (no-transition edits) + the subtle transition-index cases (drop the split boundary's transition, decrement indices after a ripple-delete, recompute after a move). This is the bulk of EP2's safety. |
| `packages/core/src/index.ts` | Modify | Re-export the new ops + `MIN_CLIP_SECONDS` from `./timeline-ops.js`. |
| `apps/web/components/Editor.tsx` | Modify | Widen `StudioEdit` (add `loadEdit`/`deleteClip`/`playbackTime`/`seek`/`getClip`); add ONE undo/redo stack (bounded) keyed on the merged `FikirtiveEdit`; `reloadFromEdit(edit)` helper (`loadEdit` + re-seed React `transitions`); wire Split / Ripple-delete buttons + snap-on-`edit:changed`; keyboard (Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z, S=split, ripple=delete-selected). All mutate the Fikirtive edit → reload → keep transitions in sync. $0. |
| `scripts/local-ep2-ops-verify.mjs` | **Create** | A $0 Node check: import the built ops, run a fuzz of split/ripple/move on random gapless+transition edits asserting every result `fikirtiveEdit.parse`s clean and transitions stay consistent; grep the diff for any spend-path token. (No ffmpeg needed — EP2 changes no render path.) |

No new package, **no prisma migration, no new contract field, no new env var, no worker change.**

---

## Task 1: Core — `MIN_CLIP_SECONDS` + the transition re-index helpers (TDD)

The subtlest correctness risk in EP2 is stale transition indices. Build the re-index helpers FIRST, in isolation, and TDD them hard. They operate on a single track's `transitions[]` array (index space = clips sorted by `start`, matching `timeline.superRefine`'s `ordered`).

**Files:**
- Create: `packages/core/src/timeline-ops.ts`
- Create: `packages/core/src/timeline-ops.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/core/src/timeline-ops.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  reindexTransitionsAfterSplit,
  reindexTransitionsAfterDelete,
  reindexTransitionsAfterMove,
  MIN_CLIP_SECONDS,
} from "./timeline-ops.js";
import type { BetweenClipTransition } from "./timeline.js";

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
  it("DROPS the transition that sat on the split boundary (it is invalidated)", () => {
    // transition 1->2; split clip 1 → the 1|2 boundary is now 1|1b, the old
    // transition no longer references a real adjacent pair → drop it.
    expect(reindexTransitionsAfterSplit([t(1)], 1)).toEqual([]);
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
    // old [A,B,C] transition B->C (1->2). new [C,A,B] — A,B still adjacent? B at 2,
    // A at 1 → adjacent (1->2) but order is A then B, transition was B->C not A->B,
    // so B->C: B at 2, C at 0 → not adjacent → drop. Use a clearer keeper:
    // old [A,B,C] transition A->B (0->1). new [C,A,B]: A at 1, B at 2 → adjacent,
    // same order A before B → keep as 1->2.
    const out = reindexTransitionsAfterMove([t(0)], ["A", "B", "C"], ["C", "A", "B"]);
    expect(out).toEqual([t(1)]);
  });
  it("returns [] for empty input", () => {
    expect(reindexTransitionsAfterMove([], ["A"], ["A"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: FAIL — `timeline-ops.js` does not exist (import/resolve error).

- [ ] **Step 3: Write the minimal implementation** — create `packages/core/src/timeline-ops.ts`:

```ts
import { fikirtiveEdit, type FikirtiveEdit, type FikirtiveClip, type BetweenClipTransition } from "./timeline.js";

/** A split/trim can never produce a clip shorter than this (avoids zero/negative
 *  length and clips too short for a fade). Below the smallest sane edit unit. */
export const MIN_CLIP_SECONDS = 0.1;

/** Transition indices live in TIMELINE order (clips sorted by start) — the same
 *  space `timeline.superRefine` validates. These helpers keep that array correct
 *  after an op changes the clip count/order. A transition is ALWAYS the adjacent
 *  pair (fromClipIndex, fromClipIndex+1); we rebuild from `fromClipIndex` only. */

/** Splitting clip `splitIndex` inserts a new clip at `splitIndex+1`, so every
 *  clip after `splitIndex` shifts +1. The transition that sat ON the split
 *  boundary (fromClipIndex === splitIndex) is invalidated (its pair is now the
 *  two split halves with no user transition between them) and dropped. */
export function reindexTransitionsAfterSplit(
  transitions: BetweenClipTransition[],
  splitIndex: number,
): BetweenClipTransition[] {
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    if (tr.fromClipIndex === splitIndex) continue; // boundary invalidated → drop
    const shift = tr.fromClipIndex > splitIndex ? 1 : 0;
    const from = tr.fromClipIndex + shift;
    out.push({ ...tr, fromClipIndex: from, toClipIndex: from + 1 });
  }
  return out;
}

/** Deleting clip `delIndex` drops any transition that TOUCHES it (fromClipIndex
 *  === delIndex || === delIndex-1, i.e. the boundary before or after it) and
 *  decrements every transition whose boundary is entirely after it. */
export function reindexTransitionsAfterDelete(
  transitions: BetweenClipTransition[],
  delIndex: number,
): BetweenClipTransition[] {
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    if (tr.fromClipIndex === delIndex || tr.toClipIndex === delIndex) continue; // touches → drop
    const shift = tr.fromClipIndex > delIndex ? -1 : 0;
    const from = tr.fromClipIndex + shift;
    out.push({ ...tr, fromClipIndex: from, toClipIndex: from + 1 });
  }
  return out;
}

/** A move/reorder changes the sorted-by-start order. Recompute each transition by
 *  its CLIP IDENTITY: the pair (oldIds[from], oldIds[to]) keeps its transition iff
 *  those two clips are still consecutive AND in the same order in `newIds`;
 *  otherwise the pair no longer abuts and the transition is dropped. */
export function reindexTransitionsAfterMove(
  transitions: BetweenClipTransition[],
  oldIds: string[],
  newIds: string[],
): BetweenClipTransition[] {
  const newPos = new Map<string, number>();
  newIds.forEach((id, i) => newPos.set(id, i));
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    const fromId = oldIds[tr.fromClipIndex];
    const toId = oldIds[tr.toClipIndex];
    if (fromId === undefined || toId === undefined) continue;
    const nf = newPos.get(fromId);
    const nt = newPos.get(toId);
    if (nf === undefined || nt === undefined) continue;
    if (nt !== nf + 1) continue; // no longer consecutive (or reversed) → drop
    out.push({ ...tr, fromClipIndex: nf, toClipIndex: nf + 1 });
  }
  return out;
}
```

> **Why "drop the boundary transition on split":** the contract requires a transition's two clips be gapless-adjacent and the duration ≤ half the SHORTER clip. After a split, the two halves are shorter and the user's intent for that boundary is ambiguous (they cut IN the middle of a cross-fade). Dropping is the only safe, unambiguous choice that always re-parses. The UI can re-apply a transition to either new half if the user wants one. This is documented in the test ("DROPS the transition that sat on the split boundary").

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: PASS (all re-index + `MIN_CLIP_SECONDS` cases green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @fikirtive/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** (leave for user approval — do NOT push)

```bash
git add packages/core/src/timeline-ops.ts packages/core/src/timeline-ops.test.ts
git commit -m "feat(editor): EP2 core — transition re-index helpers (split/delete/move) + MIN_CLIP_SECONDS"
```

---

## Task 2: Core — `splitClipAt` (pure op; sums lengths, adjusts trim, re-indexes transitions, re-parses)

**Files:**
- Modify: `packages/core/src/timeline-ops.ts`
- Modify: `packages/core/src/timeline-ops.test.ts`

`splitClipAt(edit, trackIndex, clipIndex, atSeconds)` replaces one clip with two. `clipIndex` is the index **in timeline order (sorted by start)** on that track — the same space the contract and the UI use. `atSeconds` is a TIMELINE time. Clip A = `[start, atSeconds]` keeps the original `trim`; clip B = `[atSeconds, start+length]` gets `trim += (atSeconds − start)` (so B continues seamlessly into the source). Both halves must be ≥ `MIN_CLIP_SECONDS`; the two lengths sum to the original. The legacy per-clip `transition` (fade) stays on clip A only (the head retains its fade-in; the tail's fade-out, if any, moves to B). Then `reindexTransitionsAfterSplit` runs and the whole edit re-parses.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline-ops.test.ts`:

```ts
import { splitClipAt } from "./timeline-ops.js";
import { fikirtiveEdit, type FikirtiveEdit } from "./timeline.js";

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

  it("DROPS the transition on the split boundary and shifts later transitions", () => {
    // base transition 0->1; split clip 0 → it becomes the 0|0b boundary, dropped.
    const out = splitClipAt(baseEdit(), 0, 0, 2);
    expect(out.timeline.tracks[0]!.transitions ?? []).toEqual([]);
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
    expect(() => splitClipAt(baseEdit(), 0, 0, 0.01)).toThrow(/too short|min/i);
    expect(() => splitClipAt(baseEdit(), 0, 0, 3.999)).toThrow(/too short|min/i);
  });

  it("rejects an out-of-range atSeconds or clipIndex", () => {
    expect(() => splitClipAt(baseEdit(), 0, 0, 5)).toThrow(/outside|range/i); // 5 not inside 0..4
    expect(() => splitClipAt(baseEdit(), 0, 9, 2)).toThrow(/clip|range/i);
  });

  it("returns an edit that re-parses clean (incl. EP1 guards)", () => {
    const out = splitClipAt(baseEdit(), 0, 1, 7);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
  });

  it("does not mutate the input edit", () => {
    const e = baseEdit();
    const before = JSON.stringify(e);
    splitClipAt(e, 0, 1, 7);
    expect(JSON.stringify(e)).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: FAIL — `splitClipAt` not exported.

- [ ] **Step 3: Implement `splitClipAt`** — append to `packages/core/src/timeline-ops.ts`:

```ts
/** Split the clip at `clipIndex` (timeline order, sorted by start) on track
 *  `trackIndex` at timeline time `atSeconds`. Returns a NEW edit with that clip
 *  replaced by two gapless halves; the tail's `trim` advances so it continues
 *  the source seamlessly. Transitions are re-indexed (the boundary transition is
 *  dropped). Throws if the split point isn't strictly inside the clip or either
 *  half would be < MIN_CLIP_SECONDS. The result re-parses through fikirtiveEdit. */
export function splitClipAt(
  edit: FikirtiveEdit,
  trackIndex: number,
  clipIndex: number,
  atSeconds: number,
): FikirtiveEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`split: track ${trackIndex} out of range`);
  // operate in timeline (sorted-by-start) order so indices match the contract
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const clip = ordered[clipIndex];
  if (!clip) throw new Error(`split: clip ${clipIndex} out of range`);

  const end = clip.start + clip.length;
  if (!(atSeconds > clip.start && atSeconds < end)) {
    throw new Error(`split: ${atSeconds}s is outside clip range [${clip.start}, ${end}]`);
  }
  const headLen = atSeconds - clip.start;
  const tailLen = end - atSeconds;
  if (headLen < MIN_CLIP_SECONDS || tailLen < MIN_CLIP_SECONDS) {
    throw new Error(`split: each half must be ≥ ${MIN_CLIP_SECONDS}s (got ${headLen}s / ${tailLen}s — too short)`);
  }

  const head: FikirtiveClip = {
    ...structuredClone(clip),
    length: headLen,
    // head keeps its trim and any legacy fade-IN; drop a legacy fade-OUT (moves to tail)
    transition: clip.transition?.in ? { ...clip.transition, out: undefined } : undefined,
  };
  const tail: FikirtiveClip = {
    ...structuredClone(clip),
    start: atSeconds,
    length: tailLen,
    asset: { ...structuredClone(clip.asset), trim: (clip.asset.trim ?? 0) + headLen },
    // tail keeps any legacy fade-OUT; drop the fade-IN
    transition: clip.transition?.out ? { ...clip.transition, in: undefined } : undefined,
  };

  const nextClips = [...ordered.slice(0, clipIndex), head, tail, ...ordered.slice(clipIndex + 1)];
  const nextTransitions = reindexTransitionsAfterSplit(track.transitions ?? [], clipIndex);

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: FikirtiveEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return fikirtiveEdit.parse(nextEdit); // canonicalize + enforce EP1 guards
}
```

> Note: the legacy per-clip `transition` superRefine (L128) rejects a clip shorter than `2× transition.duration`. If a head/tail keeps a 0.5s fade but is < 1s, `fikirtiveEdit.parse` throws — surfaced honestly as a split error. `MIN_CLIP_SECONDS=0.1` is below the smallest fade-bearing clip, so a non-fade split never trips it; a fade-bearing split that lands too short fails cleanly (the UI shows the contract message). That is correct: you can't keep a 0.5s fade on a 0.3s clip.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit** (leave for user approval)

Run: `pnpm --filter @fikirtive/core typecheck`

```bash
git add packages/core/src/timeline-ops.ts packages/core/src/timeline-ops.test.ts
git commit -m "feat(editor): EP2 core — splitClipAt pure op (sum lengths, advance trim, reindex transitions)"
```

---

## Task 3: Core — `rippleDeleteClip` (remove + close the gap + re-index transitions)

**Files:**
- Modify: `packages/core/src/timeline-ops.ts`
- Modify: `packages/core/src/timeline-ops.test.ts`

`rippleDeleteClip(edit, trackIndex, clipIndex)` removes the clip (timeline order) and shifts every DOWNSTREAM clip's `start` LEFT by the removed clip's `length`, closing the gap. Transitions touching the removed clip are dropped; later transitions decrement. The result keeps gapless-adjacency where it held before (a ripple preserves tiling), so transitioned pairs stay valid.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline-ops.test.ts`:

```ts
import { rippleDeleteClip } from "./timeline-ops.js";

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
    expect(() => rippleDeleteClip(e, 0, 0)).toThrow(/last|empty|at least/i);
  });

  it("returns an edit that re-parses clean and does not mutate the input", () => {
    const e = baseEdit();
    const before = JSON.stringify(e);
    const out = rippleDeleteClip(e, 0, 0);
    expect(() => fikirtiveEdit.parse(out)).not.toThrow();
    expect(JSON.stringify(e)).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: FAIL — `rippleDeleteClip` not exported.

- [ ] **Step 3: Implement `rippleDeleteClip`** — append to `packages/core/src/timeline-ops.ts`:

```ts
/** Remove the clip at `clipIndex` (timeline order) on track `trackIndex` and
 *  shift every downstream clip's start LEFT by the removed length (close the
 *  gap). Transitions touching the removed clip are dropped; later ones decrement.
 *  Throws if it would empty the track (the contract requires ≥1 clip). Re-parses. */
export function rippleDeleteClip(edit: FikirtiveEdit, trackIndex: number, clipIndex: number): FikirtiveEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`ripple-delete: track ${trackIndex} out of range`);
  if (track.clips.length <= 1) throw new Error(`ripple-delete: cannot remove the last clip on a track (≥1 required)`);

  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const removed = ordered[clipIndex];
  if (!removed) throw new Error(`ripple-delete: clip ${clipIndex} out of range`);

  const nextClips = ordered
    .filter((_, i) => i !== clipIndex)
    .map((c, i) => (i >= clipIndex ? { ...c, start: c.start - removed.length } : c));
  const nextTransitions = reindexTransitionsAfterDelete(track.transitions ?? [], clipIndex);

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: FikirtiveEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return fikirtiveEdit.parse(nextEdit);
}
```

> Note: ripple shifts downstream clips after filtering, so the indices align — `i >= clipIndex` in the filtered array is exactly the set of clips that were after the removed one. Audio-track clips on OTHER tracks are not shifted (a ripple is per-visual-track in LTX-light; the audio track's own clips are independent). This matches the worker's per-clip `renderedStartSeconds` re-mapping (transitions only shrink the visual track), so audio alignment is the worker's job at render, not the op's.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit** (leave for user approval)

Run: `pnpm --filter @fikirtive/core typecheck`

```bash
git add packages/core/src/timeline-ops.ts packages/core/src/timeline-ops.test.ts
git commit -m "feat(editor): EP2 core — rippleDeleteClip pure op (close gap, reindex transitions)"
```

---

## Task 4: Core — `moveClip` (reorder + re-tile + identity-based transition re-index)

**Files:**
- Modify: `packages/core/src/timeline-ops.ts`
- Modify: `packages/core/src/timeline-ops.test.ts`

`moveClip(edit, trackIndex, fromIndex, toIndex)` reorders the clip from one timeline position to another, then RE-TILES the track so it stays gapless from 0 (starts recomputed by cumulative length). Transitions are re-indexed by clip IDENTITY (`reindexTransitionsAfterMove`) — a transition survives only if its two clips remain consecutive in the new order. Because the contract has no stable clip id, identity is established by a temporary index→token map built from the PRE-move order (the op owns both orders, so it passes real tokens to the helper).

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline-ops.test.ts`:

```ts
import { moveClip } from "./timeline-ops.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: FAIL — `moveClip` not exported.

- [ ] **Step 3: Implement `moveClip`** — append to `packages/core/src/timeline-ops.ts`:

```ts
/** Move the clip at timeline position `fromIndex` to `toIndex` on track
 *  `trackIndex`, then RE-TILE the track gapless from 0 (starts = cumulative
 *  length). Transitions are re-indexed by clip identity — one survives only if
 *  its two clips stay consecutive in the new order. Returns a re-parsed edit. */
export function moveClip(edit: FikirtiveEdit, trackIndex: number, fromIndex: number, toIndex: number): FikirtiveEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`move: track ${trackIndex} out of range`);
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  if (fromIndex < 0 || fromIndex >= ordered.length || toIndex < 0 || toIndex >= ordered.length) {
    throw new Error(`move: index out of range (from ${fromIndex}, to ${toIndex}, len ${ordered.length})`);
  }

  // identity tokens for the transition re-index (the contract has no clip id)
  const oldIds = ordered.map((_, i) => `c${i}`);
  const moving = ordered[fromIndex]!;
  const movingId = oldIds[fromIndex]!;
  const withoutFrom = ordered.filter((_, i) => i !== fromIndex);
  const idsWithoutFrom = oldIds.filter((_, i) => i !== fromIndex);
  const newOrdered = [...withoutFrom.slice(0, toIndex), moving, ...withoutFrom.slice(toIndex)];
  const newIds = [...idsWithoutFrom.slice(0, toIndex), movingId, ...idsWithoutFrom.slice(toIndex)];

  // re-tile gapless from 0
  let cursor = 0;
  const nextClips = newOrdered.map((c) => {
    const placed = { ...c, start: cursor };
    cursor += c.length;
    return placed;
  });
  const nextTransitions = reindexTransitionsAfterMove(track.transitions ?? [], oldIds, newIds);

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: FikirtiveEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return fikirtiveEdit.parse(nextEdit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit** (leave for user approval)

Run: `pnpm --filter @fikirtive/core typecheck`

```bash
git add packages/core/src/timeline-ops.ts packages/core/src/timeline-ops.test.ts
git commit -m "feat(editor): EP2 core — moveClip pure op (reorder, re-tile gapless, identity reindex)"
```

---

## Task 5: Core — `snapEdit` (contract-time snapping) + barrel export

**Files:**
- Modify: `packages/core/src/timeline-ops.ts`
- Modify: `packages/core/src/timeline-ops.test.ts`
- Modify: `packages/core/src/index.ts`

`snapEdit(edit, threshold?)` rounds each visual-track clip edge that is within `threshold` seconds of a "snap target" (a neighbor's edge, time 0, or — when provided — the playhead) onto that target, RE-TILING to stay gapless. This is the contract-time, snap-on-commit approach (decision 1: no pixel→time map exists). It returns a re-parsed edit. The simplest correct form for LTX-light's single tiled visual track: re-tile (so adjacent edges coincide exactly) and snap the FIRST clip's start to 0 — i.e. it normalizes a near-tiled track to exactly tiled. An optional `snapTimes` array (e.g. `[playhead]`) lets a future caller round a clip start to a marker; for EP2 the default behavior (re-tile + start at 0) is what split/trim need.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline-ops.test.ts`:

```ts
import { snapEdit } from "./timeline-ops.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: FAIL — `snapEdit` not exported.

- [ ] **Step 3: Implement `snapEdit`** — append to `packages/core/src/timeline-ops.ts`:

```ts
/** Default snap threshold (seconds): an edge within this of a target snaps to it. */
export const SNAP_THRESHOLD_SECONDS = 0.15;

/** Contract-time snapping (snap-on-commit; Shotstack exposes no pixel→time map).
 *  For LTX-light's single tiled visual track, "snap" = if the track is within
 *  `threshold` of being perfectly tiled-from-0, re-tile it exactly (close tiny
 *  gaps, pin the first start to 0). A gap LARGER than threshold is left alone (a
 *  deliberate gap, not a snap miss). Audio tracks are untouched. Re-parses. */
export function snapEdit(edit: FikirtiveEdit, threshold = SNAP_THRESHOLD_SECONDS): FikirtiveEdit {
  const tracks = edit.timeline.tracks.map((track) => {
    const isVisual = track.clips.some((c) => c.asset.type !== "audio");
    if (!isVisual) return track;
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    // decide whether the track is "near-tiled": every boundary gap ≤ threshold
    let cursor = 0;
    let nearTiled = true;
    for (const c of ordered) {
      if (Math.abs(c.start - cursor) > threshold) {
        nearTiled = false;
        break;
      }
      cursor += c.length;
    }
    if (!nearTiled) return track; // a real gap — don't snap it shut
    // re-tile exactly from 0
    let t = 0;
    const clips = ordered.map((c) => {
      const placed = { ...c, start: t };
      t += c.length;
      return placed;
    });
    return { ...track, clips };
  });
  return fikirtiveEdit.parse({ ...edit, timeline: { ...edit.timeline, tracks } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fikirtive/core test -- timeline-ops`
Expected: PASS.

- [ ] **Step 5: Export the ops from the package barrel** — in `packages/core/src/index.ts`, add a new export block after the `./timeline.js` block (after the `} from "./timeline.js";` line):

```ts
export {
  splitClipAt,
  rippleDeleteClip,
  moveClip,
  snapEdit,
  reindexTransitionsAfterSplit,
  reindexTransitionsAfterDelete,
  reindexTransitionsAfterMove,
  MIN_CLIP_SECONDS,
  SNAP_THRESHOLD_SECONDS,
} from "./timeline-ops.js";
```

- [ ] **Step 6: Typecheck + build + full core suite**

Run: `pnpm --filter @fikirtive/core typecheck && pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/core test`
Expected: green (the `build` makes the new exports available to `apps/web` from `dist`).

- [ ] **Step 7: Commit** (leave for user approval)

```bash
git add packages/core/src/timeline-ops.ts packages/core/src/timeline-ops.test.ts packages/core/src/index.ts
git commit -m "feat(editor): EP2 core — snapEdit (contract-time snap) + barrel exports"
```

---

## Task 6: UI — widen `StudioEdit`, add `reloadFromEdit`, and the ONE authoritative undo/redo stack

**Files:**
- Modify: `apps/web/components/Editor.tsx`

This task adds the single source of truth for editing history: a bounded stack of merged `FikirtiveEdit` snapshots. Undo/redo `loadEdit`s a snapshot and re-seeds the React `transitions`. Shotstack's own `undo()/redo()` is NOT wired (decision in grounding).

- [ ] **Step 1: Widen the `StudioEdit` interface** — replace L20–25 (`interface StudioEdit { … }`) with the surface EP2 uses (all members verified on the SDK):

```tsx
interface StudioEdit {
  getEdit: () => unknown;
  addClip: (trackIdx: number, clip: unknown) => Promise<void>;
  updateClip: (trackIdx: number, clipIdx: number, updates: unknown) => Promise<void>;
  deleteClip: (trackIdx: number, clipIdx: number) => Promise<void>;
  /** hot-reload a whole edit config (used to push a custom contract op back) */
  loadEdit: (edit: unknown) => Promise<void>;
  /** current transport position in seconds (public field on Edit) */
  playbackTime: number;
  seek: (target: number) => void;
  getClip: (trackIdx: number, clipIdx: number) => unknown;
  events: { on: (e: string, cb: (payload?: unknown) => void) => (() => void) | void };
}
```

- [ ] **Step 2: Add the undo/redo stack state** — after the `boundary` state (L99), add:

```tsx
  // EP2 ONE authoritative history: a bounded stack of merged-FikirtiveEdit snapshots.
  // Shotstack's own undo()/redo() is NOT used — it only records Shotstack-issued
  // commands and can't see our custom split/ripple contract ops (which we apply
  // via loadEdit). Mixing the two stacks = two sources of truth; we keep one.
  const HISTORY_MAX = 50;
  const undoStack = useRef<FikirtiveEdit[]>([]);
  const redoStack = useRef<FikirtiveEdit[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistoryButtons = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };
```

- [ ] **Step 3: Add `currentMergedEdit()`, `pushHistory()`, `reloadFromEdit()`** — add near `snapshot()` (after L253). `currentMergedEdit` is the merge logic factored out of `snapshot()` so history and ops share it:

```tsx
  /** the live Shotstack edit MERGED with the React transitions (no parse) — the
   *  exact object the undo stack snapshots and the ops consume. */
  function currentMergedEdit(): FikirtiveEdit | null {
    const h = handles.current;
    if (!h) return null;
    const raw = h.edit.getEdit() as FikirtiveEdit;
    return {
      ...raw,
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) =>
          i === 0 && transitions.length > 0 ? { ...t, transitions } : t,
        ),
      },
    };
  }

  /** snapshot the CURRENT state onto the undo stack (call BEFORE applying an op).
   *  Bounded; pushing a new op clears the redo branch. */
  function pushHistory() {
    const cur = currentMergedEdit();
    if (!cur) return;
    undoStack.current.push(cur);
    if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
    redoStack.current = [];
    syncHistoryButtons();
  }

  /** load a post-op FikirtiveEdit into the live editor: hot-reload Shotstack with the
   *  clips/output, then re-seed the React transition state from the edit (Shotstack
   *  strips track-level transitions, so they live in React — re-seed on every
   *  reload to keep them in sync). */
  async function reloadFromEdit(next: FikirtiveEdit) {
    const h = handles.current;
    if (!h) return;
    await h.edit.loadEdit(next);
    const nextTransitions = (next.timeline.tracks[0] as { transitions?: UiTransition[] } | undefined)?.transitions ?? [];
    setTransitions(nextTransitions);
    setDirty(true);
  }
```

- [ ] **Step 4: Update `snapshot()` to reuse `currentMergedEdit`** — replace the body of `snapshot()` (L232–253) so the merge isn't duplicated:

```tsx
  function snapshot(): { edit?: FikirtiveEdit; error?: string } {
    const merged = currentMergedEdit();
    if (!merged) return { error: "Editor not ready yet." };
    const result = fikirtiveEdit.safeParse(merged);
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: `${first?.message ?? "invalid edit"}${first?.path?.length ? ` (at ${first.path.join(".")})` : ""}`,
      };
    }
    return { edit: result.data };
  }
```

- [ ] **Step 5: Add `undo()` / `redo()`** — add after `reloadFromEdit`:

```tsx
  async function undo() {
    if (undoStack.current.length === 0) return;
    const cur = currentMergedEdit();
    const prev = undoStack.current.pop()!;
    if (cur) redoStack.current.push(cur);
    syncHistoryButtons();
    await reloadFromEdit(prev);
  }
  async function redo() {
    if (redoStack.current.length === 0) return;
    const cur = currentMergedEdit();
    const next = redoStack.current.pop()!;
    if (cur) undoStack.current.push(cur);
    syncHistoryButtons();
    await reloadFromEdit(next);
  }
```

- [ ] **Step 6: Typecheck + build** (the SDK widening + history wiring; no UI buttons yet — Task 8)

Run: `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck`
Expected: no errors. (`handles.current.edit` is cast to `StudioEdit` at L209 — `edit as unknown as StudioEdit` — so the widened members are visible. `playbackTime` is a field, not a method, so the cast carries it through.)

> Note: `clip:selected` already sets `boundary` for track 0 (L203); EP2's split/ripple read `selected` for the clip index. No new selection plumbing needed in this task.

- [ ] **Step 7: Commit** (leave for user approval)

```bash
git add apps/web/components/Editor.tsx
git commit -m "feat(editor): EP2 UI — widen StudioEdit, reloadFromEdit, single authoritative undo/redo stack"
```

---

## Task 7: UI — snap-on-`edit:changed` for native trim/move (contract-time)

**Files:**
- Modify: `apps/web/components/Editor.tsx`

Shotstack's built-in clip drag (trim edge / move) fires `edit:changed`. EP2 hooks that to (a) push history for the native edit and (b) run `snapEdit` on the merged edit, reloading the snapped result if it changed. This is the "trim polish + snapping" wiring (decisions 1 & 2). It is debounced and guarded against feedback loops (the `loadEdit` from a snap itself fires `edit:changed`).

- [ ] **Step 1: Add a snap-suppression ref** — next to the history refs (Task 6 Step 2), add:

```tsx
  // guards a feedback loop: a snap's own loadEdit re-fires edit:changed.
  const suppressSnap = useRef(false);
```

- [ ] **Step 2: Extend the `edit:changed` handler** — the existing handler at L181–188 sets dirty + debounces a live validate. Replace its body (the `edit.events.on("edit:changed", () => { … })` block L181–188) with:

```tsx
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const off = edit.events.on("edit:changed", () => {
          setDirty(true);
          if (suppressSnap.current) return; // ignore our own snap's reload
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            void (async () => {
              const merged = currentMergedEdit();
              if (!merged) return;
              const res = fikirtiveEdit.safeParse(merged);
              setLiveIssue(res.success ? null : res.error.issues[0]?.message ?? "invalid edit");
              if (!res.success) return; // don't snap an invalid edit
              const snapped = snapEdit(res.data);
              // only reload if snapping actually moved something (avoid loops)
              if (JSON.stringify(snapped.timeline.tracks) !== JSON.stringify(res.data.timeline.tracks)) {
                pushHistory();
                suppressSnap.current = true;
                try {
                  await reloadFromEdit(snapped);
                } finally {
                  suppressSnap.current = false;
                }
              }
            })();
          }, 800);
        });
```

- [ ] **Step 3: Import `snapEdit`** — extend the `@fikirtive/core` import at L5 (`import { fikirtiveEdit, type FikirtiveEdit } from "@fikirtive/core";`) to:

```tsx
import { fikirtiveEdit, snapEdit, splitClipAt, rippleDeleteClip, type FikirtiveEdit } from "@fikirtive/core";
```

(`splitClipAt`/`rippleDeleteClip` are used in Task 8 — importing them here keeps one import edit; if you split the work, add them in Task 8 instead.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck && pnpm --filter web build`
Expected: no errors.

- [ ] **Step 5: Commit** (leave for user approval)

```bash
git add apps/web/components/Editor.tsx
git commit -m "feat(editor): EP2 UI — snap-on-edit:changed (trim/move polish, contract-time, loop-guarded)"
```

---

## Task 8: UI — Split-at-playhead + Ripple-delete + history buttons + keyboard

**Files:**
- Modify: `apps/web/components/Editor.tsx`

Wire the gestures. Split uses `Edit.playbackTime` (the transport playhead) + the `selected` clip; ripple-delete removes the `selected` clip via the op; undo/redo buttons + keyboard.

- [ ] **Step 1: Add the gesture handlers** — add near the existing transition handlers (after `clearAllTransitions`, ~L331):

```tsx
  // ---- EP2 editing-feel gestures (pure contract ops + reload) ----
  // Split the selected visual clip at the transport playhead.
  async function splitAtPlayhead() {
    const h = handles.current;
    if (!h || status !== "ready" || !selected || selected.trackIndex !== 0) {
      setNotice({ tone: "warn", text: "Select a clip on the video track, move the playhead into it, then split." });
      return;
    }
    const at = h.edit.playbackTime; // seconds on the timeline
    const merged = currentMergedEdit();
    if (!merged) return;
    try {
      pushHistory();
      const next = splitClipAt(merged, selected.trackIndex, selected.clipIndex, at);
      await reloadFromEdit(next);
      setNotice({ tone: "ok", text: "Clip split at the playhead." });
    } catch (e) {
      undoStack.current.pop(); // the op failed — discard the snapshot we just pushed
      syncHistoryButtons();
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't split there." });
    }
  }

  // Ripple-delete the selected visual clip (remove + close the gap).
  async function rippleDeleteSelected() {
    const h = handles.current;
    if (!h || status !== "ready" || !selected || selected.trackIndex !== 0) {
      setNotice({ tone: "warn", text: "Select a clip on the video track to ripple-delete it." });
      return;
    }
    const merged = currentMergedEdit();
    if (!merged) return;
    try {
      pushHistory();
      const next = rippleDeleteClip(merged, selected.trackIndex, selected.clipIndex);
      await reloadFromEdit(next);
      setSelected(null);
      setBoundary(null);
      setNotice({ tone: "ok", text: "Clip removed; the gap was closed." });
    } catch (e) {
      undoStack.current.pop();
      syncHistoryButtons();
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't remove that clip." });
    }
  }
```

- [ ] **Step 2: Add the header buttons** — in the header button row, after the "Save cut" `Button` (L498–500) and before the "Close gaps" conditional (L501), add Undo / Redo / Split / Ripple:

```tsx
        <Button variant="glass" size="sm" onClick={undo} disabled={status !== "ready" || !canUndo || busy} title="Undo (⌘Z)">
          Undo
        </Button>
        <Button variant="glass" size="sm" onClick={redo} disabled={status !== "ready" || !canRedo || busy} title="Redo (⇧⌘Z)">
          Redo
        </Button>
        <Button variant="glass" size="sm" onClick={splitAtPlayhead} disabled={status !== "ready" || !selected || busy} title="Split selected clip at the playhead (S)">
          Split
        </Button>
        <Button variant="glass" size="sm" onClick={rippleDeleteSelected} disabled={status !== "ready" || !selected || busy} title="Ripple-delete selected clip (⌫)">
          Ripple delete
        </Button>
```

- [ ] **Step 3: Add keyboard shortcuts** — add an effect after the existing `beforeunload` effect (after L120). Guard against typing in inputs and against Shotstack's own `Controls` keyboard layer (it owns play/seek keys; we only claim Z / S / Backspace when a clip is selected and focus isn't an input):

```tsx
  // EP2 keyboard: undo/redo + split + ripple-delete. Skipped while typing in an
  // input/textarea (Shotstack Controls owns transport keys; we only take these).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (!meta && (e.key === "s" || e.key === "S")) {
        if (selected) { e.preventDefault(); void splitAtPlayhead(); }
      } else if (!meta && (e.key === "Backspace" || e.key === "Delete")) {
        if (selected) { e.preventDefault(); void rippleDeleteSelected(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, status]);
```

> Note on the dep array: `selected`/`status` are the values the handlers branch on; the op functions read `handles.current`/refs (stable) and `selected` via closure — re-binding on `selected` change keeps the closure fresh. This mirrors the file's existing eslint-disabled effect deps (e.g. L124, L225).

- [ ] **Step 4: Reset history on project switch** — the studio init effect (L127) reloads on `[projectId, startEdit]`. Clear the stacks there so a project switch doesn't carry another cut's history. In the init effect's async success path, after `handles.current = …` (L209), add:

```tsx
        undoStack.current = [];
        redoStack.current = [];
        syncHistoryButtons();
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck && pnpm --filter web build`
Expected: no errors. (Read `apps/web/node_modules/next/dist/docs/` only if you touch a route/page — this task edits a client component only.)

- [ ] **Step 6: Commit** (leave for user approval)

```bash
git add apps/web/components/Editor.tsx
git commit -m "feat(editor): EP2 UI — split-at-playhead, ripple-delete, undo/redo buttons + keyboard"
```

---

## Task 9: Verify — $0 ops fuzz (re-parse-valid + transitions consistent) + no-spend grep

**Files:**
- Create: `scripts/local-ep2-ops-verify.mjs`

EP2 changes no render path, so verification is contract-level: every op result must `fikirtiveEdit.parse` clean and keep transitions consistent across many random edits. No ffmpeg needed. Plus the no-spend grep on the EP2-touched files.

- [ ] **Step 1: Kill stale fal workers first (money-safety habit)**

Run: `pkill -f "apps/worker" 2>/dev/null; ps aux | grep -i "[w]orker" || echo "no stale workers"`
Expected: no stale worker process.

- [ ] **Step 2: Write the verify script** — `scripts/local-ep2-ops-verify.mjs`:

```js
#!/usr/bin/env node
// EP2 ops: $0 contract-level fuzz. Builds random gapless visual edits with random
// transitions, applies split/ripple/move/snap, and asserts every result re-parses
// clean AND each surviving transition still references a gapless-adjacent pair.
// No ffmpeg, no fal, no spend. Run: node scripts/local-ep2-ops-verify.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// import from the BUILT core (run `pnpm --filter @fikirtive/core build` first)
const core = await import(path.join(root, "packages/core/dist/index.js"));
const { fikirtiveEdit, splitClipAt, rippleDeleteClip, moveClip, snapEdit, MIN_CLIP_SECONDS } = core;

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;
const rand = (n) => Math.floor(Math.random() * n);

function randomEdit() {
  const n = 2 + rand(4); // 2..5 clips
  let start = 0;
  const clips = [];
  for (let i = 0; i < n; i++) {
    const length = 1 + rand(4); // 1..4s (≥ 2× a 0.5s transition)
    clips.push({ asset: { type: "video", src: SRC, trim: rand(3) }, start, length });
    start += length;
  }
  // optionally add a transition on a random boundary, duration ≤ half shorter clip
  const transitions = [];
  if (n >= 2 && Math.random() < 0.7) {
    const b = rand(n - 1);
    const half = Math.min(clips[b].length, clips[b + 1].length) / 2;
    const durationMs = Math.max(100, Math.min(2000, Math.floor(half * 1000)));
    transitions.push({ fromClipIndex: b, toClipIndex: b + 1, type: "cross", durationMs });
  }
  return fikirtiveEdit.parse({
    timeline: {
      tracks: [
        { clips, transitions },
        { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: start }] },
      ],
    },
    output: { format: "mp4" },
  });
}

function assertConsistent(edit, label) {
  // re-parse must not throw (covers gapless-pair + adjacency + duplicate-boundary
  // + ≤half + overlap + min-clip guards)
  fikirtiveEdit.parse(edit);
  const t0 = edit.timeline.tracks[0];
  const ordered = [...t0.clips].sort((a, b) => a.start - b.start);
  for (const tr of t0.transitions ?? []) {
    if (tr.toClipIndex !== tr.fromClipIndex + 1) throw new Error(`${label}: non-adjacent transition ${JSON.stringify(tr)}`);
    const from = ordered[tr.fromClipIndex], to = ordered[tr.toClipIndex];
    if (!from || !to) throw new Error(`${label}: dangling transition ${JSON.stringify(tr)}`);
    if (Math.abs(to.start - (from.start + from.length)) > 1e-6) throw new Error(`${label}: gap under transition`);
  }
}

const ITER = 400;
let ok = 0;
for (let i = 0; i < ITER; i++) {
  const e = randomEdit();
  const t0 = e.timeline.tracks[0];
  const n = t0.clips.length;
  // split a random clip at its midpoint (always ≥ MIN on a ≥1s clip)
  try {
    const ci = rand(n);
    const c = [...t0.clips].sort((a, b) => a.start - b.start)[ci];
    if (c.length >= 2 * MIN_CLIP_SECONDS) {
      const s = splitClipAt(e, 0, ci, c.start + c.length / 2);
      assertConsistent(s, "split");
    }
  } catch (err) { console.error("SPLIT FAIL", err.message); process.exit(1); }
  // ripple-delete a random clip (skip if only 1)
  try {
    if (n > 1) assertConsistent(rippleDeleteClip(e, 0, rand(n)), "ripple");
  } catch (err) { console.error("RIPPLE FAIL", err.message); process.exit(1); }
  // move a random clip to a random slot
  try {
    assertConsistent(moveClip(e, 0, rand(n), rand(n)), "move");
  } catch (err) { console.error("MOVE FAIL", err.message); process.exit(1); }
  // snap a slightly-perturbed copy
  try {
    const perturbed = structuredClone(e);
    perturbed.timeline.tracks[0].clips.forEach((c, idx) => { if (idx > 0) c.start += 0.05; });
    assertConsistent(snapEdit(fikirtiveEdit.parse(perturbed)), "snap");
  } catch (err) { console.error("SNAP FAIL", err.message); process.exit(1); }
  ok++;
}
console.log(`PASS ${ok}/${ITER} random edits — split/ripple/move/snap all re-parse valid with consistent transitions.`);

// no-spend grep on EP2-touched files
const files = ["packages/core/src/timeline-ops.ts", "apps/web/components/Editor.tsx", "packages/core/src/index.ts"];
const { stdout } = await run("grep", ["-nE", "startGen|GenJob|fal\\.|@fal|coworkGenerate|fal-media|falApi", ...files], { cwd: root })
  .catch((e) => (e.code === 1 ? { stdout: "" } : Promise.reject(e)));
if (stdout.trim()) { console.error("FAIL no-spend grep — EP2 files reference a spend path:\n" + stdout); process.exit(1); }
console.log("PASS no-spend  EP2 files reference no fal/generation/spend path.");
```

- [ ] **Step 3: Build core, then run the verify script**

Run: `pnpm --filter @fikirtive/core build && node scripts/local-ep2-ops-verify.mjs`
Expected:

```
PASS 400/400 random edits — split/ripple/move/snap all re-parse valid with consistent transitions.
PASS no-spend  EP2 files reference no fal/generation/spend path.
```

- [ ] **Step 4: Full local gate**

Run: `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/core typecheck && pnpm --filter web typecheck && pnpm --filter web build`
Expected: all green.

- [ ] **Step 5: Commit** (leave for user approval)

```bash
git add scripts/local-ep2-ops-verify.mjs
git commit -m "test(editor): EP2 $0 ops fuzz — split/ripple/move/snap re-parse valid + no-spend grep"
```

---

## Task 10: Manual-QA checklist + Codex gate (STOP before deploy)

**Files:** none (a QA checklist + the gate).

- [ ] **Step 1: Manual gesture QA** (local dev, `GENERATION_PROVIDER=mock`, a project with ≥3 generated clips on the cut). Walk and confirm each:
  1. **Split:** select a clip, scrub the playhead inside it, click Split (or press `S`) → clip becomes two; the playthrough is unchanged in total length; the tail continues the source seamlessly (no jump). Save → no contract error.
  2. **Split on a transition boundary:** put a transition on a boundary, split a clip that the transition touches → the transition disappears from the "cuts" strip (dropped, per the op); Save is clean.
  3. **Ripple delete:** select a middle clip, click Ripple delete (or `⌫`) → the clip is gone and the downstream clips slide left (no gap); a transition that touched it is gone; Save is clean.
  4. **Undo/redo:** after split then ripple, Undo twice returns to the original cut; Redo replays. The "cuts"/transition chips track each step. Undo is bounded (>50 ops still works, oldest dropped).
  5. **Trim + snap:** drag a clip edge in the Shotstack timeline to leave a tiny gap → on release (debounced) the gap snaps shut (re-tiled); a LARGE deliberate gap is left alone.
  6. **Save/Export:** Export the post-edit cut → the render strip shows a job and (mock) completes; the rendered duration matches the edited timeline (transitions still subtract via the EP1 worker).
  7. **No spend:** the Network tab shows no call to a generation/fal endpoint during any edit gesture; only `saveProjectEdit`/`startRender` on Save/Export.

- [ ] **Step 2: Codex gate (REQUIRED before any deploy)** — run `/codex` on the EP2 diff. Gate focus (from the brief + spec §4):
  1. **Contract-op correctness:** split sums lengths + advances trim + both halves ≥ MIN; ripple closes the gap; move re-tiles; every op returns a `parse`-valid edit (incl. EP1 gapless-pair / adjacency / duplicate-boundary / ≤-half guards).
  2. **Transition re-index correctness on EVERY index-changing op:** split drops the boundary transition + shifts later; ripple drops touching + decrements; move recomputes by identity + drops non-adjacent. (The fuzz in Task 9 is the evidence.)
  3. **Undo single-source:** ONE stack on the merged `FikirtiveEdit`; Shotstack's `undo()/redo()` is NOT wired; restore = `loadEdit` + re-seed React transitions; bounded depth; redo cleared on a new op.
  4. **No spend path introduced** (Task 9 grep) and **no worker/contract-field/migration change**.
  5. Standard build/typecheck/test gate green.

- [ ] **Step 3: STOP.** Do not deploy until the user authorizes after the Codex gate passes. **EP2 is web-only** — it changes `packages/core` (pure ops, consumed by the web bundle) + `apps/web` (the editor). The worker is unchanged (it already renders `track.transitions` from EP1), so **only the web service deploys** for EP2. (Confirm at deploy: the worker image already ships the EP1 `renderDuration`/xfade path; EP2 produces the same contract shape, just edited differently.)

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-opt4-video-editor-design.md` §0/§1/§3-EP2/§4 + the brief):

- §3 EP2 "split/ripple/snapping/boundary are CUSTOM contract ops; Shotstack only for delete/move/update + maybe undo" → Tasks 2/3/4 build split/ripple/move as PURE ops; Task 8 uses the SDK's `playbackTime`/`loadEdit` (and the SDK `deleteClip`/`updateClip` remain available for the native drag). Undo is OURS, not Shotstack's (decision). ✓
- Brief 1 `splitClipAt` (A=[start,at] same trim; B=[at,end] trim+=at−start; both ≥ min; lengths sum) → Task 2 + tests (sum, trim advance, min reject). ✓
- Brief 1 `rippleDeleteClip` (remove + shift downstream start left by removed length) → Task 3 + tests (shift, gapless, last-clip reject). ✓
- Brief 1 CRITICAL transition re-indexing on EVERY index-changing op (split drop/keep; ripple drop+decrement; move recompute) → Task 1 helpers (TDD'd in isolation) + woven into Tasks 2/3/4 + the Task 9 fuzz. Each op `parse`s valid incl. EP1 gapless+unique-boundary guards. ✓
- Brief 1 TDD list (split sums+trim+reindex; ripple closes+reindex; move reorder+reindex; re-parse valid; backward-compat no-transition) → Tasks 1–4 tests cover every bullet (no-transition edits exercised in Task 9 fuzz + the "returns []"/empty-transition paths). ✓
- Brief 2 undo ONE authoritative stack on the contract JSON (not Shotstack undo); snapshot on each op (debounced for native edits); restore = reload into Shotstack `Edit` + re-apply EP1 transition state; bounded depth; trigger + restore defined → Task 6 (stack, `pushHistory`, `reloadFromEdit`, `undo`/`redo`) + Task 7 (debounced snapshot on native `edit:changed`) + Task 8 (snapshot before each gesture op). ✓
- Brief 3 wire ops into Editor.tsx: split-at-playhead via `Edit.playbackTime` + selected clip → Task 8; ripple-delete selected → Task 8; snapping described + chosen approach (contract-time snap-on-commit, since no pixel→time map) → Task 5 (`snapEdit`) + Task 7 (snap-on-`edit:changed`); trim polish (keep Shotstack drag-trim + contract post-process) → decision 2 + Task 7. All mutate the Fikirtive edit + reload + keep transitions in sync. ✓
- Brief 4 verify: core vitest for pure ops + transition reindex (Tasks 1–5) + manual-QA checklist (Task 10 Step 1) + confirm no fal/spend path (Task 9 grep + Task 10 Step 2.4). ✓
- §0.3 "probe Shotstack then custom": the plan PROBED (full SDK read) → SDK does expose playhead/clip-ops/loadEdit/undo, so split/ripple are custom contract ops applied via `loadEdit`; snapping is custom because no pixel→time map exists (the one capability the SDK lacks). ✓
- §0.2 $0 / no spend; §1 visual-parity (structure, not pixel chrome — EP2 adds header buttons, no LTX re-skin) → honored. ✓
- House rules: $0 self-hosted (no spend path; grep proves); PURE ops returning parse-valid edits incl. EP1 guards; TDD core vitest; ONE undo stack (not split with Shotstack's); transition re-index on every index-changing op; surgical (Editor.tsx edits are additive — widened interface, new handlers/buttons/effect, factored `currentMergedEdit` out of the existing `snapshot`); match Editor.tsx/timeline.ts style; NO prisma migration (no new field); NO auto-commit/push (every commit step says "leave for user approval"); STOP for /codex before deploy (Task 10). ✓

**2. Placeholder scan:** No "TBD/TODO/handle the edge case/similar to Task N". Every code step is complete code; every run step has an exact command + expected output. The one "import here or in Task 8" note (Task 7 Step 3) is an explicit either/or, not a placeholder — both land the same import.

**3. Type consistency:** `splitClipAt(edit, trackIndex, clipIndex, atSeconds)`, `rippleDeleteClip(edit, trackIndex, clipIndex)`, `moveClip(edit, trackIndex, fromIndex, toIndex)`, `snapEdit(edit, threshold?)`, `reindexTransitionsAfter{Split,Delete,Move}`, `MIN_CLIP_SECONDS`, `SNAP_THRESHOLD_SECONDS` — names identical across core (Tasks 1–5), the barrel (Task 5 Step 5), the UI import (Task 7 Step 3), and the verify script (Task 9). The UI `UiTransition` (Editor.tsx L37) mirrors the contract `BetweenClipTransition` and is what `reloadFromEdit` re-seeds. `currentMergedEdit()` is the single merge used by `snapshot()`, `pushHistory()`, and every gesture — no divergent merge copies. `handles.current.edit` is `StudioEdit` (widened in Task 6 Step 1), so `playbackTime`/`loadEdit`/`deleteClip` are typed.

**4. The two correctness invariants the brief singled out (explicitly handled):**
- (a) **Undo single-source:** Task 6 builds ONE stack of merged `FikirtiveEdit`s; the grounding + Task 6 Step 2 comment + Task 10 gate 3 state Shotstack's `undo()/redo()` is deliberately NOT wired (it can't see custom ops applied via `loadEdit`). Restore = `loadEdit` + re-seed React transitions. Bounded (`HISTORY_MAX=50`); redo cleared on a new op; reset on project switch (Task 8 Step 4). ✓
- (b) **Transition re-index on every index-changing op:** Task 1 builds + TDDs the three helpers IN ISOLATION (the subtlest risk), then Tasks 2/3/4 call them and re-parse, and Task 9 fuzzes 400 random edits asserting each surviving transition still references a gapless-adjacent in-range pair. The "drop boundary transition on split" choice is documented + tested. ✓

---

## Notes for the executor (real-code deltas vs the brief's assumptions)

- **Shotstack 2.11.5 exposes MORE than the EP1 plan's grounding claimed — confirmed from `index.d.ts` AND the compiled bundle.** A usable playhead EXISTS: `Edit.playbackTime` (public field; 26 bundle hits) + `Edit.seek` — so split-at-playhead does NOT need a custom transport. Clip ops `deleteClip`/`updateClip`/`getClip`/`moveClipById` and **`loadEdit` (hot-reload, 2 bundle hits)** are all real. `undo()/redo()` exist too but are deliberately unused (decision). The EP1 plan's L37 grounding under-listed these; this plan corrects it.
- **`Timeline` still has NO pixel→time mapping** — re-confirmed (the class exposes only `load/dispose/zoomIn/zoomOut`; the DnD spec L25 says the same). So **snapping is snap-on-COMMIT in contract-time, not live drag-pixel snapping** (decision 1). This is the honest answer to the brief's "whether snapping is feasible without pixel→time or must be snap-on-drop": it MUST be contract-time snap-on-commit.
- **The SHIPPED EP1 contract enforces gapless LOCALLY (per transitioned pair), not a global gapless reject** — `timeline.superRefine` L235–242 only requires the two clips of an actual transition to abut; a track may otherwise have gaps (legacy edits). It ALSO has a **duplicate-boundary guard** (`seenFrom` Set, L212–221) and **adjacency** (`from+1==to`, L222) the brief didn't mention. EP2's ops + the Task 9 fuzz are written against ALL of these, not just the brief's summary. (This is why ripple/move re-tile and split re-numbers — to keep transitioned pairs abutting.)
- **The merge-on-save is REAL and already factored-friendly:** Editor.tsx `snapshot()` (L232–253) merges the React `transitions` onto track 0 before `safeParse`. EP2 factors that merge into `currentMergedEdit()` so history + ops + save share ONE merge; `reloadFromEdit` re-seeds the React `transitions` after every `loadEdit` (Shotstack strips the track-level array, so it must live in React and be re-pushed on each reload).
- **No worker change, no contract field, no migration:** EP2 is pure ops + UI. The worker already renders `track.transitions` (EP1, commit on the contract); EP2 only changes how the contract is EDITED. Deploy is web-only (Task 10 Step 3).
- **`@fikirtive/core build` before the web typecheck/verify:** the web app and the Node verify script consume the BUILT `dist` of core (the verify script imports `packages/core/dist/index.js` directly). Every typecheck/verify step that needs the new exports runs `pnpm --filter @fikirtive/core build` first.
- **Spend path is fully isolated (verified):** `startGen` is in `apps/web/lib/gen-actions.ts:28`, reached only from `coworkGenerate` (`cowork-actions.ts:563`, "the ONLY spend path"). The editor's `saveProjectEdit`/`startRender` never call it; EP2 adds nothing that does.
