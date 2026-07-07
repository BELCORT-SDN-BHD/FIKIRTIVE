# OPT-4 EP3 — Captions + Static Text Overlays (字幕 + 文字叠加) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Fikirtive's video editor **burned-in captions** (auto-transcribed, then human-editable) and **static text overlays** — entirely on the existing $0 self-hosted render path. Captions are produced by a NEW, SEPARATE pg-boss `caption` job: extract clip audio with ffmpeg → self-hosted **whisper.cpp** (binary + model baked into the worker image alongside ffmpeg) → word/segment timestamps → cache the transcript keyed by content hash. The transcript seeds an editable caption track in the contract (`timeline.captions[]`); the RENDER job consumes the (possibly-edited) captions → builds an ASS subtitle file → ffmpeg `subtitles=` burn-in on the final composited video stream. Static text overlays are additive `timeline.textOverlays[]` → worker `drawtext`. Everything is additive to `FikirtiveEdit`, backward-compatible, bounded, and **$0** (whisper + ffmpeg, never fal).

**Architecture:**
- **Contract (additive, `packages/core/src/timeline.ts`):** two new OPTIONAL, BOUNDED top-level keys on `timeline` — `captions?: CaptionCue[]` and `textOverlays?: TextOverlay[]`. Both are **timeline-time-addressed** objects (like `betweenClipTransition`), holding integer-ms `startMs`/`lengthMs` + text/style. They live on `timeline`, NOT on a clip — the editor round-trips clips through Shotstack's `Edit` whose schema strips unknown CLIP fields (timeline.ts:99-107), and burn-in happens AFTER the visual chain is fully composited, so a timeline-level array is the correct home. New `timeline.superRefine` bounds-in-context (every cue/overlay window must fit inside `[0, editDuration]`). A `caption` pg-boss queue contract (`captionJobData`, `CAPTION_QUEUE`, `CAPTION_QUEUE_POLICY`) mirrors `renderJobData`/`RENDER_QUEUE_POLICY` exactly.
- **Caption job (`apps/worker/src/jobs/caption.ts`, NEW, $0):** copies the **render.ts money-safety skeleton** (RenderStatus, atomic claim, retry-aware FAILED-vs-requeue, tmpdir cleanup) — NOT the gen/refgen exactly-once-spend machinery, because whisper is $0. It probes the asset (`probeFile`), short-circuits audio-less clips, extracts a 16 kHz mono WAV via ffmpeg, runs `whisper-cli` (bounded: thread cap + duration cap + execa timeout), parses the JSON, and upserts a **content-hash-keyed `Transcript` cache row** (additive table, LOCAL migration only). Idempotent + cached: re-requests for the same `(contentHash, model)` return early.
- **Render (`apps/worker/src/jobs/render.ts`):** unchanged xfade/concat/amix chain. EP3 appends ONE post-`vLabel` node — `subtitles=<ass>` then `drawtext=...` — operating on the SINGLE final composited `[v]` stream BEFORE `-map vLabel`. The ASS file + drawtext windows are generated in **RENDERED time** via a new `renderedTimelineSeconds(editMs, visualPlanned, transitions)` helper (mirrors the existing `renderedStartSeconds` overlap math). Per the architecture map: this is xfade-safe because it never touches the per-clip `[v${index}]` labels, the offset/accEnd math, or `renderSeconds`.
- **UI (`apps/web/components/Editor.tsx`):** a new "Captions" `<aside>` (sibling after the Transitions aside) — a "Generate captions" button that dispatches the caption job for the visual track, polls it, then **seeds `timeline.captions[]`** from the cached transcript; an editable list (text + timing) of caption cues; and a "Text" section (add/position/style a static overlay → `timeline.textOverlays[]`). Both arrays live in Fikirtive React state OUTSIDE Shotstack (exactly like `transitions`, Editor.tsx:103-116) and are merged into the persisted `FikirtiveEdit` at `currentMergedEdit()` (Editor.tsx:404-422).
- **Dockerfile (`apps/worker/Dockerfile`):** build whisper.cpp from source in the `build` stage (no apt package exists on trixie), COPY only the `whisper-cli` binary + the `ggml-base.en.bin` model into `runtime`, set `ENV WHISPER_MODEL_PATH`.

**Tech Stack:** pnpm monorepo (`packages/core` zod + vitest; `apps/worker` Node 22 + ffmpeg 7.x apt + execa + pg-boss + Prisma 7; `apps/web` Next.js 16 + Shotstack Studio 2.11.5). `Project.editJson` is a Prisma `Json` column → **NO migration for `captions`/`textOverlays`** (they ride inside `editJson`). The ONE new table — `Transcript` cache — is an **additive, LOCAL-only** migration (nullable/standalone; never applied to prod in this plan). `apps/web/AGENTS.md` rule: read `node_modules/next/dist/docs/` before any route/page edit — EP3 touches only the `Editor.tsx` client component + a server action, no routing.

**MONEY-SAFETY (rule #1, invariant across EVERY task):** EP3 adds NO spend path. The caption job runs ffmpeg + whisper.cpp ONLY — it MUST NOT import or call `startGen` / `createGenJob` / `coworkGenerate` / any fal transport. The spend path is `startGen` (`apps/web/lib/gen-actions.ts`), reached only from `coworkGenerate` (`apps/web/lib/cowork-actions.ts`); the render + caption + save paths never touch it. Every task's gate greps `apps/worker/src/jobs/caption.ts` + the new action to prove no spend token (`startGen`, `createGenJob`, `fal`, `GENERATION_PROVIDER`, `spentUsd`) is introduced, and that the caption job uses NO `spent`/`committed` resume markers (it's $0, so the gen/refgen exactly-once-spend skeleton is deliberately NOT copied).

**WORKER-SAFETY (rule #2, invariant):** every new ffmpeg/whisper invocation is bounded so it cannot hang or OOM the worker: (a) `whisper-cli -t ${WHISPER_THREADS:-4}` thread cap (the worker also runs ffmpeg renders; an unbounded thread count starves the box); (b) input duration double-capped — `ffmpeg -t ${WHISPER_MAX_SECONDS}` on the extract AND `whisper-cli -d ${WHISPER_MAX_SECONDS*1000}` (ms); (c) `execa(..., { timeout })` on BOTH the extract and the transcribe; (d) `CAPTION_QUEUE_POLICY.expireInSeconds` STRICTLY GREATER than the whisper timeout (same ordering invariant render uses: STALE_MS between runtime and expire) so a job never expires mid-transcribe and a crash is both redelivered AND re-claimable. The caption job is a SEPARATE queue from render (render has a 10-min ffmpeg / 15-min queue window) so a slow transcription never blocks or stalls a render. The transcript is CACHED by content hash so a re-render reuses it for $0 + 0 CPU.

**CONTRACT-SAFETY (rule #3, invariant):** `captions`/`textOverlays` are additive `.optional()` keys with absence = "feature not used" (exactly like `transitions?`). Old stored edits keep parsing (default zod object strips unknown top-level keys; adding a new optional key is purely additive — timeline.ts doc 6-11). Every number is finite + bounded (the codex rule, timeline.ts:26-28) — an unbounded `startMs`/`lengthMs`/`fontSize` validates into impossible ffmpeg/ASS argv. Bounds-in-context validation lands in `timeline.superRefine` where `editDuration` is in scope. "None" = the absence of an entry, never a stored sentinel.

**HOUSE RULES (every task):** TDD for `packages/core` (vitest, write the failing test first). Render/whisper correctness verified by a LOCAL `$0` ffmpeg/whisper run of a small fixture (`GENERATION_PROVIDER=mock`; **kill stale fal workers FIRST**). Surgical — match existing `render.ts`/`Editor.tsx`/job style; touch only what each task needs; do not refactor adjacent code. **NO auto-commit/push** — every git step is written for the USER to run; the agent leaves changes staged. After the phase executes, **STOP for the `/codex` render-correctness + no-spend gate** before any deploy. Use codegraph to ground every file:symbol before editing.

---

## Grounding (verified against the real code, 2026-06-18)

Every task references these by exact symbol/line. All read via codegraph + Read before writing this plan.

### Contract — `packages/core/src/timeline.ts` (314 lines, EP1/EP2-shipped)
- `MAX_CLIPS_PER_TRACK=100` (L30), `MAX_CLIP_SECONDS=60*10` (L31), `MAX_TIMELINE_SECONDS=60*30` (L32), `TRANSITION_MAX_SECONDS=2` (L34) — the codex "every number finite + bounded" precedent.
- `EXT_BY_TYPE` (L38-42), `mediaSrc` regex (L46-51) — unchanged by EP3.
- `betweenClipTransition` (L108-115): the EP1 precedent EP3 mirrors — `durationMs: z.number().int().gt(0).max(TRANSITION_MAX_SECONDS*1000)`. **Integer ms; the worker divides by 1000** (comment L102-107). New caption/overlay schemas use the SAME integer-ms convention and the SAME "live on timeline, never on a stripped clip" rule.
- `track` (L142-150): `{ clips, transitions? }` — transitions live on the TRACK precisely because Shotstack strips unknown CLIP fields (L99-107). EP3 puts captions/overlays on `timeline` (one level up) for the same reason.
- `timeline` (L165-261): object `{ background, tracks }` + a big `.superRefine` (L173-261) — visual/audio track caps, overlap reject, mixed-track reject, the between-clip transition rules, and the global `end > MAX_TIMELINE_SECONDS` cap (L255-260). **EP3 adds caption/overlay bounds-in-context here** (where clip lengths/positions + the `end` accumulator are in scope).
- `fikirtiveEdit = z.object({ timeline, output })` (L273-277): **two top-level keys, plain zod object → unknown top-level keys are STRIPPED**. Doc L6-11: parsing is CANONICALIZING; callers persist the PARSED value; the worker re-parses (`fikirtiveEdit.parse` in render.ts:193). Adding an optional key to `timeline` is additive; old edits keep parsing.
- `renderJobData`/`RENDER_QUEUE`/`RENDER_DLQ`/`RENDER_RETRY_LIMIT=2`/`RENDER_QUEUE_POLICY` (L282-300) — the EXACT template for the new `caption` queue constants. `RENDER_QUEUE_POLICY.expireInSeconds = 60*15` "> ffmpeg timeout so jobs never expire mid-render" (L298). `RENDER_STATUSES` (L303-304).
- `editDuration(edit)` (L316-321) = `max(start+length)` across tracks. `renderDuration(edit)` (L328-333) = `editDuration − Σ transitions.durationMs/1000`. **EP3 caption/overlay windows are bounded against `editDuration` at parse, and converted to RENDERED time at render via `renderedTimelineSeconds`.**

### `packages/core/src/index.ts` barrel (L4-64)
- Re-exports the timeline contract block (L10-35) + the timeline-ops block (L36-48) + `export *` of `gen.js`/`refgen.js`/etc (L49-64). EP3 adds the new caption-cue/text-overlay/caption-queue symbols + types to the timeline re-export block.

### `packages/core/src/gen.ts` (the spending-job constant pattern, for shape reference only)
- `genJobData = z.object({ genJobId: z.string().min(1).max(64) }).strict()` (L239), `GEN_QUEUE`/`GEN_DLQ`/`GEN_RETRY_LIMIT=2`/`GEN_QUEUE_POLICY` (L242-254). The caption queue constants mirror THIS shape (and the render shape), but the caption JOB skeleton copies render.ts, NOT gen.ts (no spend).

### Render — `apps/worker/src/jobs/render.ts` (381 lines)
- Imports from `@fikirtive/core` (L22-34): `fikirtiveEdit`, `editDuration`, `renderDuration`, `newId`, `srcToStorageKey`, `RENDER_RETRY_LIMIT`, types. EP3 adds `renderedTimelineSeconds` here (or co-locate in render.ts as a private helper).
- `inputArgs` (L50-55), `videoChain` (L62-73), `transitionToXfade` (L75-99 region), `renderedStartSeconds` (L101-125 — THE overlap-math helper EP3's `renderedTimelineSeconds` mirrors), `audioChain` (L127-169).
- `handleRender` (L171-380): findUnique (L172) → `if status==="DONE" return` (L177) → atomic claim `updateMany` with `STALE_MS = 1000*60*13` "> ffmpeg timeout (10m), < queue expire (15m)" (L183-188) → work in `tmpdir()` (L190) → `fikirtiveEdit.parse(job.editJson)` (L193) → build `planned`/`visualPlanned`/`sounded` (L203-228) → `transitions` (L231) + belt guards (L237-247) → `renderSeconds` (L249) → `graph` build: videoChain loop (L253), xfade/concat chain → `vLabel` (L255-285), audio amix → `[a]` (L287-295) → assemble argv (L297-302) → execa ffmpeg `{ timeout: 1000*60*10, buffer:false }` (L309) → progress parse guarded `WHERE status:"RENDERING"` (L314-333) → store output `storage.put` + `asset.upsert` (L337-355) → terminal `status:"DONE"` (L357-360) → catch: `final = retryCount >= RENDER_RETRY_LIMIT` (L368), FAILED-or-requeue (L370-375), `throw err` (L376) → `finally` rm tmpdir (L377-379).
- **THE EP3 SEAM (architecture map, verbatim):** burn-in/overlay nodes append to the SINGLE final `vLabel` AFTER the xfade/concat chain (after L284) and BEFORE `-map vLabel` (L299): `${vLabel}subtitles=${escapedAssPath}[vsub]` then `[vsub]drawtext=...:enable='between(t,${startR},${endR})'[vtxt]`; set `vLabel="[vtxt]"`. The ASS/drawtext files are written into `work` (L190; cleaned L377-379). Timing in RENDERED time. Subtitles paths + drawtext text need filter-graph escaping (commas/colons/backslashes/quotes).
- `probeFile` imported from `./ingest.js` (L35) — detects `hasAudio`; the caption job reuses it.

### Job wiring (the 6 places a new pg-boss job touches)
1. **Core constants** — `packages/core/src/timeline.ts` next to `RENDER_*` (L282-304); re-export in `index.ts`.
2. **DB row** — `packages/db/prisma/schema.prisma`: `enum RenderStatus` (L279-284), `model RenderJob` (L286-307: `id`, `ownerId @default("founder")`, `projectId`, `editJson Json`, `status RenderStatus @default(QUEUED)`, `progress Int @default(0)`, `outputAssetId String?`, `error String @default("")`, `queueJobId String @default("")`, `attempts Int @default(0)`, `startedAt/finishedAt DateTime?`, `createdAt/updatedAt`, `@@index([status, updatedAt])`). The caption job reuses `RenderStatus` (it's $0 — no `spentUsd`).
3. **Worker registry** — `apps/worker/src/queues.ts:4-15` (`QUEUES` object; import from `@fikirtive/core` L1).
4. **Worker boot** — `apps/worker/src/index.ts`: imports (L12-29), `createQueue` DLQ-first then queue (L58-63), `boss.work<...>(QUEUES.x, { batchSize:1, includeMetadata:true }, ...)` (the render block L73-82 is the template; `includeMetadata:true` drives `retryCount`).
5. **Web producer** — `apps/web/lib/queue.ts`: import (L3) + `createQueue` DLQ-first then queue in `buildBoss()` (L30-35).
6. **Web dispatch action** — `apps/web/lib/actions.ts`: `startRender` (L660-703) is the canonical template — gate (L661) / OWNED project (L662-663) / parse-or-reject (L664-669) / in-flight guard (L672-677) / persist row FIRST in `$transaction` (L678-683) / dispatch `boss.send` + write back `queueJobId` (L684-690) / catch keeps row, mark FAILED (L691-699) / `logAction` + `revalidatePath` + `return {id}` (L700-702). `getRenderJobs` (L706-727) is the polling template.

### Editor UI — `apps/web/components/Editor.tsx`
- Action imports (L6): `getRenderJobs, saveProjectEdit, startRender, getEditorMedia`. EP3 adds the new caption-dispatch + caption-poll + seed-transcript actions.
- `transitions` state OUTSIDE Shotstack (L99-117): `useState` seeded from `initialEdit.timeline.tracks[0].transitions` (L103-104), mirrored in `transitionsRef` (L111), single `setTransitions` keeps both in sync (L112-116). **EP3 mirrors this EXACT pattern** for `captions`/`textOverlays` state.
- `currentMergedEdit()` (L404-422): reconciles transitions (L407), reads id-free `getEdit()` (L408), merges the React `transitions` onto track 0 (L412-419). **EP3 extends the merge** to also fold `timeline.captions`/`timeline.textOverlays` from React state into the merged timeline (one level up — they're timeline-level, not track-level).
- `snapshot()` (L424-435): `currentMergedEdit()` → `fikirtiveEdit.safeParse` → first-issue error. Unchanged in shape; it now carries captions/overlays because the merge does.
- `getEditorMedia` (actions.ts:745-769) — EP3 does NOT touch the audio filter (that's EP4); captions read the VISUAL track's clip srcs to know what to transcribe.

### Dockerfile — `apps/worker/Dockerfile` (full file read)
- `FROM node:22-trixie-slim AS base` apt-installs `ffmpeg ca-certificates` (shared by build + runtime); `FROM base AS build` does pnpm install + builds; `FROM base AS runtime` → `COPY --from=build /repo ./` → `USER node` → `CMD ["node", "apps/worker/dist/index.js"]`. EP3 adds the whisper build block to `build` and two COPY lines + one ENV to `runtime` (before `USER node`).

### whisper.cpp recipe (verified in the architecture map — RULED OUT apt + prebuilt; CHOSE build-from-source)
- No `whisper.cpp`/`whisper-cpp` apt package on Debian trixie (only the unrelated `python3-whisper` Graphite engine). Build from source in the throwaway `build` stage; copy the `whisper-cli` (~1 MB) + `ggml-base.en.bin` (~142 MB) into runtime. base.en = the English-first CPU sweet spot (tiny.en too weak, small too big/slow). `WHISPER_MODEL`/`WHISPER_REF` build ARGs + `WHISPER_MODEL_PATH` env make swapping a one-line change. whisper-cli needs a 16 kHz mono PCM WAV — ffmpeg extracts it; whisper does NOT decode arbitrary media.

---

## DECISIONS THIS PLAN LOCKS (the brief asked the plan to pick)

1. **Caption + textOverlay data placement = TOP-LEVEL on `timeline` (`timeline.captions[]`, `timeline.textOverlays[]`).** Rationale: a caption/overlay is a timeline-time-addressed object (like a transition), and burn-in happens on the FULLY-COMPOSITED final stream (after the xfade/concat chain), so it belongs at the timeline level, not on a clip and not on a track. CRITICAL CONFIRMATION (Task 5): Shotstack strips unknown CLIP fields (timeline.ts:99-107), but EP3 NEVER puts captions on the Shotstack `Edit` — they live in Fikirtive React state and are merged into the persisted `FikirtiveEdit.timeline` at `currentMergedEdit()`, exactly like `transitions` (which already round-trips this way at the track level). The Shotstack `Edit` never carries them, so it can't strip them. (Same proven mechanism as EP1.)
2. **Burn-in mechanism = ASS file via `subtitles=` for CAPTIONS + `drawtext` per overlay for STATIC TEXT.** Captions are multi-cue, time-windowed, styled text → an ASS sidecar (`subtitles=<file>`) is the clean file-based path with real styling and gives proper multi-line caption rendering; one filter node for ALL caption cues. Static text overlays are few, positioned, styled → `drawtext` nodes (`enable='between(t,start,end)'`) avoid a second sidecar grammar and map 1:1 to the contract's `{text,position,style}`. Both insert at the SAME post-`vLabel` seam.
3. **Timing units + timebase = absolute TIMELINE time in integer ms in the contract; converted to RENDERED time at render.** The contract stores `startMs`/`lengthMs` as integer ms (mirrors `betweenClipTransition.durationMs`). Captions/overlays are addressed by **absolute timeline time** (not relative to a clip) — they can span clip boundaries. The worker converts each window to rendered time with `renderedTimelineSeconds(editMs, visualPlanned, transitions)` (subtracts the cumulative transition overlap strictly before that timeline position — the SAME overlap math as `renderedStartSeconds`), because transitions shrink the timeline. Without this, captions desync whenever a visual xfade exists.
4. **EP3 captions = a NEW separate pg-boss `caption` job (transcribe → cache), NOT folded into render.** The brief + spec require it (render's 10-min ffmpeg / 15-min queue window would be blown by CPU transcribe + render in one job; and a re-render must reuse a cached transcript for $0). The job ONLY transcribes + caches; the RENDER job consumes the cached/edited captions from the contract. Static text overlays need NO job (pure contract + drawtext).
5. **`outputAssetId` semantics:** the `caption` job produces NO video asset — it produces a cached `Transcript` row (the transcript JSON). So the `CaptionJob` row has NO `outputAssetId` for an MP4; its "output" is the `Transcript` cache it writes (linked by `assetId`/`contentHash`). The captioned MP4 is produced by the EXISTING render job (a distinct content hash → a new RENDER asset, as today render.ts:337-360). This keeps the caption job a pure $0 transcribe-and-cache step.
6. **STALE/timeout/expire triple for the caption queue:** whisper timeout `1000*60*10` (10 min, same magnitude as render's ffmpeg); ffmpeg-extract timeout `60_000` (like `probeFile`); `CAPTION_QUEUE_POLICY.expireInSeconds = 60*15` (> whisper timeout); `STALE_MS = 1000*60*13` (> whisper timeout, < expire) — identical ordering invariant to render.

---

## Task list

### Phase A — Contract (TDD, `packages/core`, $0, NO migration)

#### Task 1 — Failing tests: `captions[]` + `textOverlays[]` additive schema + bounds-in-context
- [ ] Create `packages/core/src/captions.test.ts` (new file; do NOT bloat `timeline.test.ts`). Pattern after `timeline.test.ts`: `import { describe, expect, it } from "vitest"`; `import { fikirtiveEdit } from "./timeline.js"`; `const HASH = "a".repeat(64)`; `const SRC = ` + "`/files/u/founder/${HASH}.mp4`" + `;`. Build a base valid edit with one visual track `[{ asset:{type:"video",src:SRC}, start:0, length:6 }]` + `output:{format:"mp4"}`.
- [ ] Write these failing assertions (the schema does not exist yet):
  - **additive/backward-compat:** an edit with NO `captions`/`textOverlays` parses (already true — assert it stays true after the schema change).
  - **captions happy path:** `timeline.captions = [{ startMs:0, lengthMs:1500, text:"hello" }, { startMs:1500, lengthMs:1500, text:"world" }]` parses; `fikirtiveEdit.parse(x).timeline.captions` round-trips.
  - **textOverlays happy path:** `timeline.textOverlays = [{ startMs:500, lengthMs:2000, text:"TITLE", position:"top", style:{ fontSize:48, color:"#ffffff" } }]` parses and round-trips.
  - **bounds reject (codex rule):** `lengthMs:0` rejects (`gt(0)`); `startMs` negative rejects (`min(0)`); `lengthMs` above `MAX_CLIP_SECONDS*1000` rejects; `text` over `MAX_CAPTION_CHARS` rejects; `style.fontSize` above `MAX_FONT_PX` rejects; a non-hex `style.color` rejects.
  - **bounds-in-context reject:** a caption whose `startMs + lengthMs` runs past `editDuration*1000 + EPS` rejects with a message naming the overflow (validated in `timeline.superRefine`).
  - **count cap:** more than `MAX_CAPTIONS` cues / `MAX_OVERLAYS` overlays rejects.
  - **canonicalizing:** an unknown extra field on a cue (`{ ...cue, bogus:1 }`) is STRIPPED by parse (plain zod object).
- [ ] Run `pnpm --filter @fikirtive/core test -- captions` → expect FAIL (schema missing). Verify the failures are "unrecognized/has no effect" / parse-succeeds-when-it-should-fail, NOT import errors.

#### Task 2 — Implement the `captionCue` + `textOverlay` schemas + bounds-in-context
- [ ] In `packages/core/src/timeline.ts`, add bounds next to the existing caps (after L35): `export const MAX_CAPTIONS = 500;`, `export const MAX_OVERLAYS = 50;`, `export const MAX_CAPTION_CHARS = 500;`, `export const MAX_OVERLAY_CHARS = 200;`, `export const MAX_FONT_PX = 200;`, `export const OVERLAY_POSITIONS = ["top","center","bottom"] as const;` (+ `export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];`).
- [ ] Define `captionCue` (after `betweenClipTransition`, ~L115), mirroring the integer-ms convention + the comment style:
  ```ts
  /** A caption cue is a TIMELINE-time-addressed text window (absolute, integer ms),
   *  NOT clip-relative — it can span clip boundaries. Lives on timeline.captions[]
   *  (NOT on a clip: Shotstack strips unknown clip fields; burn-in is on the final
   *  composited stream). The worker converts startMs→RENDERED time (transitions
   *  shrink the timeline) and builds an ASS file for ffmpeg subtitles=. */
  export const captionCue = z.object({
    startMs: z.number().int().min(0).max(MAX_TIMELINE_SECONDS * 1000),
    lengthMs: z.number().int().gt(0).max(MAX_CLIP_SECONDS * 1000),
    text: z.string().min(1).max(MAX_CAPTION_CHARS),
  });
  export type CaptionCue = z.infer<typeof captionCue>;
  ```
- [ ] Define `textOverlay` (immediately after `captionCue`):
  ```ts
  /** A static text overlay (timeline-time-addressed, integer ms). Static only —
   *  animated text is deferred. Worker → drawtext with enable='between(t,...)'
   *  in RENDERED time. Lives on timeline.textOverlays[] (same reason as captions). */
  export const overlayStyle = z.object({
    fontSize: z.number().int().min(8).max(MAX_FONT_PX).default(48),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  });
  export const textOverlay = z.object({
    startMs: z.number().int().min(0).max(MAX_TIMELINE_SECONDS * 1000),
    lengthMs: z.number().int().gt(0).max(MAX_CLIP_SECONDS * 1000),
    text: z.string().min(1).max(MAX_OVERLAY_CHARS),
    position: z.enum(OVERLAY_POSITIONS).default("bottom"),
    style: overlayStyle.default({}),
  });
  export type TextOverlay = z.infer<typeof textOverlay>;
  ```
- [ ] Add the two optional keys to the `timeline` object (L165-172): inside `z.object({ background, tracks, ... })` add `captions: z.array(captionCue).max(MAX_CAPTIONS).optional(),` and `textOverlays: z.array(textOverlay).max(MAX_OVERLAYS).optional(),`.
- [ ] Add bounds-in-context to `timeline.superRefine` (L173-261), AFTER the `end` accumulator is computed (after L254, where `end` = max clip end is known) — reject any cue/overlay whose `startMs/1000 + lengthMs/1000 > end + EPS`:
  ```ts
  const limit = end; // editDuration is in scope as `end`
  for (const c of tl.captions ?? []) {
    if (c.startMs / 1000 + c.lengthMs / 1000 > limit + EPS)
      ctx.addIssue({ code: "custom", message: `caption window ends past the timeline (${(c.startMs+c.lengthMs)/1000}s > ${limit}s)` });
  }
  for (const o of tl.textOverlays ?? []) {
    if (o.startMs / 1000 + o.lengthMs / 1000 > limit + EPS)
      ctx.addIssue({ code: "custom", message: `text overlay window ends past the timeline (${(o.startMs+o.lengthMs)/1000}s > ${limit}s)` });
  }
  ```
- [ ] Re-export the new symbols + types in `packages/core/src/index.ts` (in the timeline block L10-35): `captionCue`, `textOverlay`, `overlayStyle`, `MAX_CAPTIONS`, `MAX_OVERLAYS`, `MAX_CAPTION_CHARS`, `MAX_OVERLAY_CHARS`, `MAX_FONT_PX`, `OVERLAY_POSITIONS`, and `type CaptionCue`, `type TextOverlay`, `type OverlayPosition`.
- [ ] Run `pnpm --filter @fikirtive/core test -- captions` → expect PASS. Run `pnpm --filter @fikirtive/core test` (full suite) → expect ALL green (no regression in `timeline.test.ts`/`timeline-ops.test.ts`). Run `pnpm --filter @fikirtive/core typecheck` → expect 0 errors.

> **COMMIT (user runs):** `git add packages/core && git commit -m "feat(opt4): EP3 contract — additive captions[] + textOverlays[] on timeline (bounded, backward-compat)"` — review the diff first; this is a clean stop point (contract-only, no behavior change).

---

### Phase B — Caption queue contract + DB cache row (LOCAL migration)

#### Task 3 — Caption queue constants (mirror `RENDER_*`)
- [ ] In `packages/core/src/timeline.ts`, after `RENDER_QUEUE_POLICY` (L300), add (mirroring the render block + the gen.ts shape):
  ```ts
  /** $0 caption job: extract audio → whisper.cpp → cached transcript. SEPARATE
   *  queue from render so a slow transcribe never blocks a render. The payload
   *  holds ONLY the row id; the row holds the real data. */
  export const captionJobData = z.object({ captionJobId: z.string().min(1).max(64) });
  export type CaptionJobData = z.infer<typeof captionJobData>;
  export const CAPTION_QUEUE = "caption";
  export const CAPTION_DLQ = `${CAPTION_QUEUE}.dlq`;
  export const CAPTION_RETRY_LIMIT = 2;
  export const CAPTION_QUEUE_POLICY = {
    retryLimit: CAPTION_RETRY_LIMIT,
    retryDelay: 20,
    retryBackoff: true,
    expireInSeconds: 60 * 15, // > whisper timeout (10m) so a job never expires mid-transcribe
    deadLetter: CAPTION_DLQ,
  } as const;
  ```
- [ ] Re-export in `index.ts` (timeline block): `captionJobData`, `CAPTION_QUEUE`, `CAPTION_DLQ`, `CAPTION_RETRY_LIMIT`, `CAPTION_QUEUE_POLICY`, `type CaptionJobData`.
- [ ] Run `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/core typecheck` → expect green.

#### Task 4 — `Transcript` cache table + `CaptionJob` row (additive, LOCAL migration ONLY)
- [ ] In `packages/db/prisma/schema.prisma`, add an additive `CaptionJob` model (reuse `RenderStatus` — it's $0, NO `spentUsd`) right after `RenderJob` (after L307):
  ```prisma
  model CaptionJob {
    id            String       @id
    ownerId       String       @default("founder")
    projectId     String
    /// the visual-track asset being transcribed (content-addressed) + its hash
    assetId       String
    contentHash   String
    status        RenderStatus @default(QUEUED)
    progress      Int          @default(0)
    error         String       @default("")
    queueJobId    String       @default("")
    attempts      Int          @default(0)
    startedAt     DateTime?
    finishedAt    DateTime?
    createdAt     DateTime     @default(now())
    updatedAt     DateTime     @updatedAt
    @@index([projectId, createdAt])
    @@index([status, updatedAt])
  }
  ```
- [ ] Add the `Transcript` cache model (content-hash + model keyed, the $0 reuse cache):
  ```prisma
  /// Cached whisper.cpp transcript, keyed by (contentHash, model). Deterministic
  /// for fixed (audio bytes, model, flags) → cache is always valid; a re-render or
  /// re-request reuses it for $0 + 0 CPU. cuesJson = CaptionCue[] (the editable seed).
  model Transcript {
    id          String   @id
    ownerId     String   @default("founder")
    contentHash String
    model       String
    cuesJson    Json
    createdAt   DateTime @default(now())
    @@unique([contentHash, model])
  }
  ```
- [ ] Author the migration via the diff-script ritual (the P1a/P2/P3a convention — avoids LOCAL checksum drift). Timestamp AFTER the latest existing migration (`20260617150000_user_role`):
  ```bash
  mkdir -p packages/db/prisma/migrations/20260618120000_caption_transcript
  pnpm --filter @fikirtive/db exec prisma migrate diff \
    --from-schema-datasource packages/db/prisma/schema.prisma \
    --to-schema-datamodel packages/db/prisma/schema.prisma \
    --script > /tmp/caption-diff.sql
  ```
  > NOTE: that first command compares CURRENT-DB vs DESIRED-schema only AFTER you have edited the schema model above; `--from-schema-datasource` reads live DB state, `--to-schema-datamodel` reads the edited model. Inspect `/tmp/caption-diff.sql`: it MUST contain ONLY `CREATE TABLE "CaptionJob"`, `CREATE TABLE "Transcript"`, their indexes, and the `Transcript` unique index — NO `DROP`, NO `ALTER` of any existing table/column. Copy the verified SQL into `packages/db/prisma/migrations/20260618120000_caption_transcript/migration.sql`.
- [ ] Apply LOCAL ONLY (never prod in this plan): `DATABASE_URL=postgresql://fikirtive:fikirtive@localhost:5432/fikirtive pnpm --filter @fikirtive/db exec prisma migrate deploy` then `pnpm --filter @fikirtive/db exec prisma generate`.
- [ ] Run `pnpm --filter @fikirtive/db build` → expect green. Verify the client has `prisma.captionJob` + `prisma.transcript`.

> **COMMIT (user runs):** `git add packages/core packages/db && git commit -m "feat(opt4): EP3 caption queue contract + Transcript cache + CaptionJob row (additive, LOCAL migration)"` — review the migration.sql is purely additive before committing.

---

### Phase C — Worker: whisper Dockerfile + caption job + render burn-in

#### Task 5 — Dockerfile: build whisper.cpp, bake binary + model
- [ ] **FONT (resolves open-Q1):** in the `base` stage `apt-get install` line, add `fonts-dejavu-core fontconfig` to the existing `ffmpeg ca-certificates` list — drawtext (Task 7) needs a concrete TTF at `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`, and ASS `subtitles=` resolves fonts via fontconfig. (DejaVu core is tiny; this is the smallest reliable path.)
- [ ] In `apps/worker/Dockerfile`, in the `build` stage (right after `FROM base AS build`, before the pnpm work — stable layer caching), add the whisper build block (pinned tag, NOT master). **`-DGGML_NATIVE=OFF` is REQUIRED (resolves open-Q5):** without it, ggml bakes the build host's `-march=native` SIMD into the binary, which SIGILLs at runtime if Railway's build host has wider SIMD (AVX-512/AVX2) than the runtime host. OFF builds a portable baseline binary (slightly slower, but base.en on CPU stays well within the bounds). Do NOT omit this flag.
  ```dockerfile
  # --- whisper.cpp: self-hosted $0 transcription (no apt package on trixie) ---
  ARG WHISPER_REF=v1.7.4
  ARG WHISPER_MODEL=base.en
  RUN apt-get update \
    && apt-get install -y --no-install-recommends git build-essential cmake curl \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 --branch "${WHISPER_REF}" https://github.com/ggml-org/whisper.cpp /tmp/whisper.cpp \
    && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build /tmp/whisper.cpp/build -j --config Release --target whisper-cli \
    && install -Dm755 /tmp/whisper.cpp/build/bin/whisper-cli /opt/whisper/bin/whisper-cli \
    && mkdir -p /opt/whisper/models \
    && bash /tmp/whisper.cpp/models/download-ggml-model.sh "${WHISPER_MODEL}" /opt/whisper/models \
    && rm -rf /tmp/whisper.cpp
  ```
  > BUILD FIXES (validated by `docker build`, fold into the block above — DO NOT omit): (a) `curl` in the apt list — the slim base ships no curl/wget, and `download-ggml-model.sh` needs one. (b) `-DBUILD_SHARED_LIBS=OFF` — whisper.cpp defaults to SHARED libs; the binary then needs `libwhisper.so.1`/`libggml*.so` at runtime, which the runtime stage doesn't have. Static-link so only the single binary ships. (c) `mkdir -p /opt/whisper/models` before the download — the script `cd`s into the target dir. (d) `libgomp1` in the BASE apt line (runtime) — the static binary still dynamically links OpenMP's libgomp.
- [ ] In the `runtime` stage (`FROM base AS runtime`), add BEFORE `USER node` (so they land root-owned/world-readable, like apt's ffmpeg):
  ```dockerfile
  COPY --from=build /opt/whisper/bin/whisper-cli /usr/local/bin/whisper-cli
  COPY --from=build /opt/whisper/models /opt/whisper/models
  ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-base.en.bin
  ```
  Leave `COPY --from=build /repo ./`, `USER node`, and `CMD` exactly as they are.
- [ ] Local verify (Docker available): `docker build -f apps/worker/Dockerfile -t fikirtive-worker-ep3 .` (or build only the runtime target). Then `docker run --rm fikirtive-worker-ep3 sh -c "whisper-cli --help | head -5 && ls -la /opt/whisper/models/"` → expect the CLI help + `ggml-base.en.bin` present. If Docker is not available locally, note that explicitly and defer this verify to the codex/CI gate (the build block is grounded; do not skip the assertion silently).

#### Task 6 — Caption handler (copy the render.ts $0 skeleton; bounded whisper)
- [ ] Create `apps/worker/src/jobs/caption.ts`. Imports: `mkdir, readFile, rm` from `node:fs/promises`, `tmpdir` from `node:os`, `path`, `execa`, `prisma` from `@fikirtive/db`, `storage` from `../storage.js`, `probeFile` from `./ingest.js`, and from `@fikirtive/core`: `captionCue`, `CAPTION_RETRY_LIMIT`, `srcToStorageKey`, `newId`, `type CaptionJobData`, `type CaptionCue`.
- [ ] Define bounded knobs at module top:
  ```ts
  const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH ?? "/opt/whisper/models/ggml-base.en.bin";
  const WHISPER_MODEL_NAME = "base.en"; // cache key dimension
  const WHISPER_THREADS = Math.max(1, Math.min(8, Number(process.env.WHISPER_THREADS ?? 4)));
  const WHISPER_MAX_SECONDS = Math.max(1, Number(process.env.WHISPER_MAX_SECONDS ?? 600));
  const WHISPER_TIMEOUT_MS = 1000 * 60 * 10;   // = render's ffmpeg magnitude; < expire (15m)
  const EXTRACT_TIMEOUT_MS = 60_000;            // like probeFile
  const STALE_MS = 1000 * 60 * 13;              // > whisper timeout, < expire (same invariant as render)
  ```
- [ ] `export async function handleCaption(data: CaptionJobData, retryCount = 0): Promise<void>` — copy the render.ts control flow EXACTLY (L171-188 claim, L362-379 catch/finally):
  - findUnique `captionJob` row; missing → log + return.
  - `if (job.status === "DONE") return;` (idempotent re-delivery).
  - **CACHE SHORT-CIRCUIT (before claiming or transcribing):** `const cached = await prisma.transcript.findUnique({ where: { contentHash_model: { contentHash: job.contentHash, model: WHISPER_MODEL_NAME } } }); if (cached) { await prisma.captionJob.update({ where:{id:job.id}, data:{ status:"DONE", progress:100, finishedAt:new Date(), error:"" } }); return; }` — a re-request for the same audio reuses the cache for $0 + 0 CPU.
  - atomic claim `updateMany` `WHERE { id, OR:[{status:"QUEUED"},{status:"RENDERING", startedAt:{ lt: new Date(Date.now()-STALE_MS) }}] } data:{ status:"RENDERING", progress:5, startedAt:new Date(), attempts:{increment:1} }`; `if (claim.count===0) return;`.
  - work dir `path.join(tmpdir(), `fikirtive-caption-${job.id}`)`; `try { await mkdir(work,{recursive:true});`
    - resolve the source: `const file = await storage.ffmpegInput(srcToStorageKey(SRC))` where `SRC` is reconstructed from the asset (look up the asset by `job.assetId`, build the `/files/...` src via `storageKeyToSrc(storageKey(asset.ownerId, asset.contentHash, asset.ext))` — import these from core).
    - **audio gate:** `const probe = await probeFile(file); if (!probe.hasAudio) { await prisma.transcript.upsert({ ... cuesJson: [] }); /* cache empty so a silent clip isn't retried */ await prisma.captionJob.update({ status:"DONE", progress:100, ... }); return; }` (wrap upsert in the `contentHash_model` unique).
    - **bounded duration:** `const maxS = Math.min(WHISPER_MAX_SECONDS, probe.durationS ?? WHISPER_MAX_SECONDS);`
    - **STEP 1 extract WAV (bounded):** `await execa("ffmpeg", ["-nostdin","-y","-i",file,"-t",String(maxS),"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le","-f","wav", path.join(work,"audio.wav")], { timeout: EXTRACT_TIMEOUT_MS });`
    - **STEP 2 transcribe (bounded thread + duration + timeout):** `await execa("whisper-cli", ["-m", WHISPER_MODEL_PATH, "-f", path.join(work,"audio.wav"), "-l","en", "-t", String(WHISPER_THREADS), "-d", String(Math.round(maxS*1000)), "-ml","1","-sow","-oj","-of", path.join(work,"transcript"), "--no-prints"], { timeout: WHISPER_TIMEOUT_MS, cwd: work });`
    - **parse JSON → CaptionCue[]:** read `path.join(work,"transcript.json")`; each `transcription[]` entry → `{ startMs: Math.round(entry.offsets.from), lengthMs: Math.max(1, Math.round(entry.offsets.to - entry.offsets.from)), text: entry.text.trim() }`; drop empty-text entries; clamp to bounds; **validate each through `captionCue.parse`** (police whisper output into the contract). Bound the array to `MAX_CAPTIONS` (slice).
    - **upsert the cache:** `await prisma.transcript.upsert({ where:{ contentHash_model:{ contentHash: job.contentHash, model: WHISPER_MODEL_NAME } }, update:{ cuesJson: cues }, create:{ id:newId(), ownerId: job.ownerId, contentHash: job.contentHash, model: WHISPER_MODEL_NAME, cuesJson: cues } });`
    - terminal update: `await prisma.captionJob.updateMany({ where:{ id:job.id, status:"RENDERING" }, data:{ status:"DONE", progress:100, finishedAt:new Date(), error:"" } });`
  - `} catch (err) {` — copy render.ts L362-376 EXACTLY (no spend flags): `const message = ...slice(0,500); const final = retryCount >= CAPTION_RETRY_LIMIT;` update FAILED-or-QUEUED; `throw err;`
  - `} finally { await rm(work, { recursive:true, force:true }); }`
- [ ] **NO spend tokens:** the file MUST NOT import `startGen`/`createGenJob`/fal/`@fikirtive/generation` provider, and MUST NOT have `spent`/`committed`/`spentUsd`. Confirm by grep at the end of the task.
- [ ] Wire the job (the 4 remaining wiring places):
  - `apps/worker/src/queues.ts`: import `CAPTION_QUEUE`, add `caption: CAPTION_QUEUE,` to `QUEUES`.
  - `apps/worker/src/index.ts`: import `handleCaption` + `CAPTION_DLQ`, `CAPTION_QUEUE_POLICY`, `type CaptionJobData`; `await boss.createQueue(CAPTION_DLQ); await boss.createQueue(QUEUES.caption, { ...CAPTION_QUEUE_POLICY });` (DLQ first, after L63); add the `boss.work<CaptionJobData>(QUEUES.caption, { batchSize:1, includeMetadata:true }, async ([job]) => { if(!job) return; console.log(...try...); await handleCaption(job.data, job.retryCount); ... })` block (mirror render L73-82).
  - `apps/web/lib/queue.ts`: import `CAPTION_DLQ`, `CAPTION_QUEUE`, `CAPTION_QUEUE_POLICY`; add `await boss.createQueue(CAPTION_DLQ); await boss.createQueue(CAPTION_QUEUE, { ...CAPTION_QUEUE_POLICY });` in `buildBoss()` (after L35).
- [ ] Run `pnpm --filter @fikirtive/worker build && pnpm --filter @fikirtive/worker typecheck` → expect green.

#### Task 7 — Render: `renderedTimelineSeconds` + ASS/drawtext burn-in at the post-`vLabel` seam
- [ ] In `apps/worker/src/jobs/render.ts`, add a private helper `renderedTimelineSeconds(editSeconds, visualPlanned, transitions)` next to `renderedStartSeconds` (after L125), reusing the SAME overlap math: cumulative transition overlap that occurs strictly BEFORE `editSeconds` on the visual track → `return Math.max(0, editSeconds - overlapBefore)`. (Refactor `renderedStartSeconds` to call it with `clip.start`, OR copy the loop — keep it surgical; prefer extracting the shared core if it stays small.)
- [ ] Add `buildAssFile(captions, w, h)`: write an ASS subtitle file into `work` from `timeline.captions` (each cue: convert `startMs`/`startMs+lengthMs` → RENDERED time via `renderedTimelineSeconds(ms/1000, ...)` → ASS `H:MM:SS.cs` timestamps; escape `\n`/braces; one default bottom style scaled to `h`). Return the path or `null` if no captions.
- [ ] Add `drawtextNode(overlay, prevLabel, nextLabel, w, h)`: for each `timeline.textOverlays` entry, compute rendered `startR`/`endR` via `renderedTimelineSeconds`, choose `x`/`y` from `position` (top/center/bottom), escape the text (colons, commas, backslashes, single quotes, `%`), and emit `${prevLabel}drawtext=fontfile=<font>:text='<escaped>':fontsize=${style.fontSize}:fontcolor=${style.color}:x=${x}:y=${y}:box=1:boxcolor=black@0.4:enable='between(t,${startR},${endR})'${nextLabel}`. **Font path = `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`** (baked by Task 5's `fonts-dejavu-core`); make it a module const `DRAWTEXT_FONT` so it's swappable. ASS captions inherit the same font via fontconfig.
- [ ] Insert the burn-in chain in `handleRender` AFTER the xfade/concat chain sets `vLabel` (after L284) and BEFORE the audio block / `-map` (before L287). Read `edit.timeline.captions ?? []` and `edit.timeline.textOverlays ?? []`. If captions: write the ASS file, push `${vLabel}subtitles=${escapeForFilter(assPath)}[vsub]`, set `vLabel="[vsub]"`. Then for each overlay push a `drawtextNode(...)` chaining `vLabel`→`[vtxtN]`, advancing `vLabel`. The existing `-map vLabel` (L299) picks up the final label unchanged. DO NOT touch the xfade offset/accEnd math, the per-clip `[v${index}]` labels, `renderSeconds`, or the audio amix.
- [ ] Run `pnpm --filter @fikirtive/worker build && pnpm --filter @fikirtive/worker typecheck` → expect green.

#### Task 8 — LOCAL $0 render fixture: captions + text burned in (no spend)
- [ ] **Kill stale fal workers FIRST:** `pgrep -fl "apps/worker" || true` then kill any stray worker that could grab a job + burn real money; confirm `GENERATION_PROVIDER` is unset/`mock` in the shell. (Memory: stale fal workers steal jobs and spend real money — this is mandatory before any local run.)
- [ ] Write a small tracer (or extend `scripts/render-tracer.mjs` into `scripts/caption-render-tracer.mjs`) that, against the LOCAL DB + MinIO, builds an edit with one short video clip that HAS audio, dispatches the `caption` job, polls it to DONE, reads the cached `Transcript.cuesJson` into `timeline.captions`, adds one `timeline.textOverlays` entry, dispatches a RENDER job, polls to DONE, downloads the MP4.
- [ ] Assert the effect is present: `ffprobe` the output is a valid mp4 (ftyp box) at the expected dims/duration; AND a scene/scrub check that the burn-in landed — e.g. extract a frame inside the overlay window (`ffmpeg -ss <mid> -i out.mp4 -frames:v 1 frame.png`) and assert it is non-trivially different from a frame OUTSIDE the window (pixel diff), proving drawtext/subtitles rendered. (Lightweight: a SSIM/blockhash diff > threshold between in-window and out-of-window frames.)
- [ ] Assert **$0 / no spend:** after the run, query the DB — NO new `GenJob`/`RefGenJob` rows were created, no `spentUsd` movement; the only new rows are `CaptionJob` (DONE), `Transcript` (cached), and the RENDER asset. Grep the worker logs for any fal/provider call → none.

> **COMMIT (user runs):** `git add apps/worker apps/web/lib/queue.ts scripts && git commit -m "feat(opt4): EP3 worker — whisper.cpp caption job (\$0, bounded) + ASS/drawtext burn-in at post-vLabel seam"` — review the Dockerfile + caption.ts diff (confirm no spend import) before committing.

---

### Phase D — UI: Captions panel + Text overlays (Editor.tsx)

#### Task 9 — Web actions: dispatch caption job + poll + read transcript
- [ ] In `apps/web/lib/actions.ts`, add `startCaption(projectId, assetId)` modeled on `startRender` (L660-703): `requireSession`; OWNED project; verify the asset belongs to the project's media; in-flight guard (reject if a QUEUED/RENDERING `captionJob` exists for this `assetId`); persist the `captionJob` row FIRST (`id`, `ownerId: FOUNDER_OWNER_ID`, `projectId`, `assetId`, `contentHash` from the asset); dispatch `boss.send(CAPTION_QUEUE, { captionJobId: job.id } satisfies CaptionJobData)`; write back `queueJobId`; catch keeps the row + marks FAILED; `logAction("caption.start", ...)`; `return { id }`.
- [ ] Add `getCaptionJob(jobId)` (poll, modeled on `getRenderJobs` L706-727): return `{ id, status, progress, error }`.
- [ ] Add `getTranscript(projectId, assetId)`: OWNED project; look up the asset's `contentHash`; `prisma.transcript.findUnique({ where:{ contentHash_model:{ contentHash, model:"base.en" } } })`; return `cuesJson` parsed as `CaptionCue[]` (or `[]`). This is what the UI uses to SEED `timeline.captions` after the job completes.
- [ ] Read `node_modules/next/dist/docs/` ONLY if touching routing — these are server actions in an existing file, so no routing change. Run `pnpm --filter @fikirtive/web typecheck` (or the repo's web typecheck) → expect green.

#### Task 10 — Editor state + merge: `captions`/`textOverlays` outside Shotstack
- [ ] In `apps/web/components/Editor.tsx`, mirror the EXACT `transitions` pattern (L99-117) for both arrays: `useState` seeded from `initialEdit?.timeline.captions ?? []` and `initialEdit?.timeline.textOverlays ?? []`; a `captionsRef`/`overlaysRef` mirror; `setCaptions`/`setOverlays` wrappers that keep ref + state in sync. Add `type UiCaption`/`UiOverlay` aliases of the contract types if needed (loose `string` where the editor edits text/timing live).
- [ ] Extend `currentMergedEdit()` (L404-422): after merging `transitions` onto track 0, also fold the React captions/overlays into the merged TIMELINE (one level up, NOT on a track):
  ```ts
  const merged = {
    ...raw,
    timeline: {
      ...raw.timeline,
      tracks: raw.timeline.tracks.map((t, i) => i === 0 && live.length > 0 ? { ...t, transitions: live } : t),
      ...(captionsRef.current.length > 0 ? { captions: captionsRef.current } : {}),
      ...(overlaysRef.current.length > 0 ? { textOverlays: overlaysRef.current } : {}),
    },
  };
  ```
  This keeps `snapshot()` (L424-435) and the debounced live-validate (L286-292) carrying captions/overlays through `fikirtiveEdit.safeParse` unchanged. (Absence stays absent — no empty arrays written, matching the "None = absence" rule.)
- [ ] Run the web typecheck → expect green.

#### Task 11 — Captions panel (`<aside>`) + Text section
- [ ] Add a new `<aside>` sibling in the panel flex row AFTER the Transitions aside (the architecture map's insertion point) — match the Transitions aside header/width styling (`<MonoLabel>Captions</MonoLabel>`, ~200px).
  - **Generate captions:** a button that picks the visual track's first/selected clip asset id, calls `startCaption(projectId, assetId)`, then polls `getCaptionJob` until DONE, then `getTranscript` → `setCaptions(cues)`. Show progress + a disabled state while running (in-flight guard already server-side). On audio-less clip → DONE with empty cues → show "no speech detected".
  - **Edit cues:** render `captions` as an editable list — each row a text `<input>` (→ `setCaptions` patch) + start/length number inputs (ms or s; convert). Keep it minimal (text + timing edit, per spec); no styling UI for captions in v1.
  - **Text overlays:** a small "Text" section — an "Add text" button appends a default `{ startMs:0, lengthMs:2000, text:"Text", position:"bottom", style:{fontSize:48,color:"#ffffff"} }` to `overlays`; each overlay row edits text + position (`<select>` top/center/bottom) + start/length + fontSize + color.
- [ ] Edits flow into the persisted edit automatically via the extended `currentMergedEdit()` (Task 10) — Save cut / Export MP4 pick them up with NO further wiring. Verify the existing `saveCut`/`exportCut` (which call `snapshot()`) carry captions/overlays.
- [ ] Manual smoke (LOCAL, no spend): open the editor, generate captions on a clip with audio, edit a cue, add a text overlay, Save cut, Export MP4, confirm the rendered MP4 shows both (reuse Task 8's frame-diff check or eyeball).

> **COMMIT (user runs):** `git add apps/web && git commit -m "feat(opt4): EP3 UI — Captions panel (generate + edit) + static text overlays, merged into FikirtiveEdit"` — review the Editor.tsx diff (confirm captions/overlays live in React state, never on a Shotstack clip) before committing.

---

### Phase E — Gate

#### Task 12 — Full verify + STOP for the codex gate
- [ ] `pnpm --filter @fikirtive/core test` (full) → all green; `pnpm -r typecheck` (or each package's typecheck) → 0 errors; `pnpm -r build` → green.
- [ ] **No-spend grep (rule #1):** `grep -RnE "startGen|createGenJob|coworkGenerate|@fikirtive/generation|spentUsd|GENERATION_PROVIDER" apps/worker/src/jobs/caption.ts apps/web/lib/actions.ts` (the new symbols only) → expect NO hits in `caption.ts`/`startCaption`/`getTranscript`. The caption job + caption action introduce NO spend path.
- [ ] **Worker-safety check (rule #2):** confirm in `caption.ts` — `whisper-cli -t` capped, `ffmpeg -t`/`whisper-cli -d` duration capped, both `execa` calls have a `timeout`, `CAPTION_QUEUE_POLICY.expireInSeconds (15m) > WHISPER_TIMEOUT_MS (10m) > nothing`, `STALE_MS (13m)` between them. Audio-less clips short-circuit + cache empty.
- [ ] **Contract-safety check (rule #3):** an OLD stored edit with no `captions`/`textOverlays` still parses (covered by Task 1's backward-compat test — re-run it). The new keys are `.optional()`; no migration touches `editJson`; the only migration (Task 4) is additive + LOCAL.
- [ ] **STOP. Do not deploy.** Hand off to the user to run the `/codex` render-correctness + no-spend gate on the full EP3 diff. Address codex findings, then (only with explicit user authorization) deploy: worker image rebuild (whisper baked in) FIRST, then web; apply the `20260618120000_caption_transcript` migration to prod via `migrate deploy` as part of the authorized deploy (NOT in this plan).

---

## Open questions (flag to the user before/at the gate)

1. **Font for `drawtext` + ASS.** The trixie-slim base may not ship a TTF. Task 7 needs a concrete `fontfile`. Options: add `fonts-dejavu-core` (tiny) to the base `apt-get` line, or rely on `fontconfig`'s default. Confirm which — this is a Dockerfile decision that affects Task 5. (Recommendation: add `fonts-dejavu-core` to the base apt line — smallest reliable path; ASS `subtitles=` also resolves fonts via fontconfig.)
2. **Caption scope: per-clip vs whole-timeline transcription.** This plan transcribes ONE asset per caption job and seeds `timeline.captions` from it (absolute timeline time = the clip's `start` offset applied when seeding). If the visual track has MULTIPLE clips with speech, the UI must dispatch one caption job per clip and offset each cue by that clip's timeline `start` when merging into `captions`. Confirm whether v1 captions only the selected/first clip (simpler) or auto-transcribes every speech clip (more wiring in Task 11). The contract + worker support either; it's a UI-scope call.
3. **`base.en` model size in the runtime image (+142 MB).** Acceptable per the architecture map, but it does grow the worker image + cold build. Confirm OK, or downgrade default to `tiny.en` (~75 MB, weaker) via the `WHISPER_MODEL` build ARG. (Recommendation: ship `base.en`; the ARG makes it a one-line change.)
4. **Build-time network for whisper.** The build now git-clones whisper.cpp + downloads the model from Hugging Face. Railway/CI build already allows outbound network (apt + pnpm), but an HF outage breaks the image build. Confirm acceptable, or vendor the model in R2 and curl from there (mitigation only if HF flakiness appears).
5. **ABI/CPU portability of the compiled binary.** whisper.cpp may bake in build-host SIMD (AVX2/FMA). If Railway build hosts have wider SIMD than runtime hosts, the binary could SIGILL. Build + run on the same Railway arch (they do). If a portable binary is ever needed, pass `-DGGML_NATIVE=OFF`. Flag for the deploy step, not a code change now.
6. **Word-level granularity (`-ml 1 -sow`) is a heuristic split, not forced alignment.** Fine for caption display; if frame-accurate word highlighting is later wanted, that's a separate (larger) effort. Confirm v1 only needs readable time-windowed captions.
7. **Caption cache invalidation.** The `Transcript` cache is keyed `(contentHash, model)` and is always valid for fixed bytes+model. If the user EDITS captions in the UI, those edits live in `timeline.captions` (the contract), NOT back into the cache — the cache stays the original whisper output (the seed). A "re-generate captions" overwrites the UI cues from the cache again. Confirm this is the desired behavior (edits are per-project, transcript cache is per-asset-bytes).
