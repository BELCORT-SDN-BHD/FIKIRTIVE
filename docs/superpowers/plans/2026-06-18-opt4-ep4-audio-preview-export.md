# OPT-4 EP4 — Audio + approximate preview + NLE XML export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Artlio video editor's audio story and add two zero-render exits. (1) **Sound tab** — surface audio assets (today `getEditorMedia` filters audio out), upload audio (the upload contract already allows it), place audio onto its own audio track (the contract already allows ≤2 audio tracks + per-clip volume + amix), expose per-audio-clip volume, and add **auto-ducking** (music under voiceover) as a per-audio-track toggle rendered with ffmpeg `sidechaincompress`. (2) **NLE XML export** — a PURE `ArtlioEdit → FCP7 XML` transform (no render, $0), downloaded client-side, alongside first-class **aspect/resolution presets** (the contract already has them; the editor never exposed them) and a revisit of the 1080 cap. (3) **Approximate preview** — a sequential `<video>` playthrough fallback (NO real-time compositing engine; Remotion deferred). All of it stays on the existing $0 self-hosted ffmpeg path with **no new spend path**.

**Architecture:** EP4 builds on the EP1/EP2/EP3 contract. Audio placement reuses the already-capable worker: `apps/worker/src/jobs/render.ts` already renders audio-track clips (volume + per-transition crossfade + `adelay` in RENDERED time + `amix`). EP4's only worker change is **ducking**: thread an audio-track identity into `PlannedInput` so the single flat `amix` can be partitioned into a music sub-mix and a voice sub-mix, then `[bed][voice]sidechaincompress` → re-`amix`, preserving the load-bearing `atrim=0:${renderSeconds}[a]` + `-map [a]` tail untouched. The contract (`packages/core/src/timeline.ts`) gains ONE additive optional field — `track.audioRole?` ("voice" | "music") — validated in `timeline.superRefine` where track composition is in scope; absence = today's flat mix (backward-compat). The UI (`apps/web/components/Editor.tsx`) gets a **Sound aside** (surface + upload + place + per-clip volume + ducking toggle), an **Output control** (aspect/resolution/fps, merged into the persisted edit like EP1 transitions), an **Export XML button** + an **Approx preview toggle**. The XML serializer is a pure function in `packages/core` next to `timeline.ts`. The audio un-filter is a surgical widen of `getEditorMedia` (`apps/web/lib/actions.ts`).

**Tech Stack:** pnpm monorepo (`packages/core` zod + vitest, `apps/worker` ffmpeg via execa, `apps/web` Next.js 16 + Shotstack Studio SDK 2.11.5). ffmpeg `sidechaincompress`/`amix`/`adelay`/`atrim` (sidechaincompress confirmed in the worker's Debian-trixie ffmpeg 7.x build; verified locally in Task 0). FCP7 XML (Premiere + DaVinci Resolve both import it — the chosen interchange target, see Decision 3). `Project.editJson` is a Prisma `Json` column — the `audioRole` + `output` changes are backward-compat additive, **NO prisma migration**. `apps/web/AGENTS.md` rule: read the relevant guide in `node_modules/next/dist/docs/` before any route/page edit — EP4 touches only the client component `Editor.tsx`, no routing; the XML download is client-side (Blob), no new route.

**MONEY-SAFETY (rule #1, invariant across every task):** EP4 adds NO call into the fal / generation spend path. Audio upload lands as an `UPLOAD`-source Generation + an INGEST probe job (the existing $0 path); placing/ducking/exporting audio is pure contract + ffmpeg, rendered self-hosted in the worker. The XML export and the approximate preview never touch the server's render or generation paths at all. The render change (ducking) is bounded by the same duration/dimension guards + 10-min execa timeout + 720p cap that EP1 shipped — `sidechaincompress` adds no input and cannot inflate the mix length (the `atrim=0:${renderSeconds}` tail clamps it). The verify task greps every EP4-touched file to prove no spend token is added.

> **Sequencing note:** EP4 assumes EP3 (captions/text overlays) ships first. EP3 adds `timeline.captions?` / `timeline.textOverlays?` (top-level-on-timeline) + a post-`vLabel` burn-in seam in `render.ts`. EP4 is **additive on top** and touches a disjoint surface: the AUDIO graph (288–295 region of the EP1-shipped render.ts) + the `output` block + a new Sound aside. If EP3 has not landed when EP4 is executed, every EP4 task still applies unchanged (no EP4 task depends on a caption/overlay symbol); only the merged-file line numbers shift. Re-ground line numbers with codegraph before editing.

---

## Grounding (verified against the real code, 2026-06-18)

Every task references these by exact symbol/line. All read (codegraph + Read) before writing.

### The EP1/EP2-shipped contract (`packages/core/src/timeline.ts`, 333 lines) — what EP4 keeps valid

- `EXT_BY_TYPE` L38–42: `video`, `image`, **`audio: ["mp3","wav","m4a","aac","ogg","flac"]`** (L41) — the exact audio ext set EP4's `getEditorMedia` un-filter reuses.
- `assetSchema` L59–78: audio assets carry `{ type:"audio", src, trim?, volume? (0..1) }` (L62–67). `visualAsset` L80 (video|image union); `audioAsset` L81.
- `clip` zod L117–140: `{ asset: union(visualAsset, audioAsset), start, length>0, transition?, fit? }`.
- `track` zod L142–150: `{ clips: array(clip).min(1).max(100), transitions?: array(betweenClipTransition).max(100) }`. **This is where `audioRole?` is added.**
- `isVisualTrack(t)` L162–163 = `t.clips.some(c => c.asset.type !== "audio")`. A track is "audio" iff every clip is audio.
- `timeline.superRefine` L173–261: ≤1 visual track (L176–181), **≤2 audio tracks (L182–187)**, per-track overlap reject (L190–193), mixed-track reject (L194–197), between-clip transition rules (L203–252), 30-min cap (L255–260). **`audioRole` validation slots in here** (track composition in scope).
- `output` zod L263–269: `{ format: literal("mp4"), resolution: enum("sd","hd","1080").default("hd") (L266, "720p cap, 1080 OOM'd ffmpeg; kept for legacy, render caps to hd"), aspectRatio: enum("16:9","9:16","1:1").default("16:9") (L267), fps: union(25,30).default(25) (L268) }`. EP4's Output control reads/writes this; the 1080-cap revisit is Decision 4.
- `artlioEdit` L273–277 = `{ timeline, output }`. Default zod object **strips unknown top-level keys** → adding `track.audioRole?` (optional) is additive; old stored edits keep parsing.
- `editDuration(edit)` L316–321 = `max(start+length)`; `renderDuration(edit)` L328–333 = `editDuration − Σ transitions.durationMs/1000`. **`renderSeconds` (render.ts:249) is the load-bearing audio-placement timebase EP4 ducking must preserve.**
- `packages/core/src/index.ts` barrel L11–32 re-exports `artlioEdit`, `ArtlioEdit`, `ArtlioClip`, `editDuration`, `renderDuration`, the transition types, etc. EP4 adds `editToFcpXml` + `AudioRole` here.

### The EP1-shipped worker (`apps/worker/src/jobs/render.ts`, 381 lines) — the audio graph EP4 partitions

- `PlannedInput` interface L43–48: `{ clip: ArtlioClip; file: string; index: number; hasAudio: boolean }`. **EP4 adds `audioRole?: AudioRole` and `trackKind: "visual"|"audio"`** so the mix can partition by track.
- `handleRender` L171; `visualTrack` L195, `audioTracks = tracks.filter(t => t !== visualTrack)` L197. Planning loop L203–212: visual clips first (sorted by start L210), then each audio track's clips L212 — `planned.push({ clip, file, index, hasAudio })` L208. **This is where `audioRole`/`trackKind` get threaded onto the planned input.**
- `sounded = planned.filter(p => p.hasAudio && (p.clip.asset.volume ?? 1) > 0)` L226–228.
- `audioChain(p, visualPlanned, transitions)` L136–169: `aresample=async=1:first_pts=0` → `volume` → legacy afade → per-transition crossfade afades (L152–164) → `adelay=${renderedStartSeconds*1000}:all=1` (L166–167). Output `[a${index}]`. **Reused unchanged by ducking** — only the MIX changes.
- The mix L288–295: for each `sounded` push `audioChain`, then `${mixIn}amix=inputs=${n}:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]` (L291–293), `mapAudio=true`. Mapped L300 `-map [a] -c:a aac -b:a 192k`. **EP4 replaces the single `amix` with a partitioned ducking mix when an audioRole pair exists, KEEPING the `,aresample…,atrim=0:${renderSeconds}[a]` tail + `-map [a]`.**
- `renderSeconds = renderDuration(edit)` L249; used in the amix atrim L292, the `-progress` denominator L324, the stored `durationS` L353. **Untouched by EP4.**
- execa timeout `1000*60*10` L309; 720p cap `res = resolution==="1080" ? "hd" : resolution` L220, `SIZES[aspectRatio][res]` L221, SIZES table L37–41.
- `transitionToXfade` L81–99, `videoChain` L62–73, chained-xfade build L255–285 — **all untouched by EP4** (EP4 is audio + output + UI only on the render side).

### `apps/web/lib/actions.ts` (771 lines) — the audio-filter EP4 un-filters

- `EDITOR_VIDEO_EXTS` L745, `EDITOR_IMAGE_EXTS` L746. `getEditorMedia` L750: return type `kind: "image" | "video"` (L750). flatMap L759–769: `if (!isVideo && !EDITOR_IMAGE_EXTS.has(ext)) return []; // skip audio/unknown` (L762). `seconds` L767 = `isVideo ? (durationS ?? 5) : 3`. **EP4 adds an audio ext set, widens `kind` to include `"audio"`, and stops dropping audio.**
- `startRender(projectId, editJsonString)` L660–703: parse → in-flight guard → `$transaction([project.update editJson, renderJob.create])` → `boss.send(RENDER_QUEUE, { renderJobId })`. **Untouched** — EP4 audio renders through the same path (the edit just carries audio tracks + `audioRole` + `output`).

### Upload flow (already wired at contract+action level; EP4 builds the FIRST editor consumer)

- `packages/core/src/upload.ts`: `UPLOAD_EXTS` includes audio; `mimeOf` maps audio MIME; zod validates audio. **No change.**
- `apps/web/lib/direct-upload.ts`: `uploadFilesDirect(files, onProgress)` — hash → authorize → presigned PUT/multipart (Uppy) → `FinalizedUpload[]`. Ext-agnostic. **No change.**
- `apps/web/lib/upload-actions.ts`: `finalizeCandidateUploads(projectId, promptText, entityIds, raw)` L83–208 — HEAD-verify size, upsert Asset (L143–167), create a `source:"UPLOAD"` Generation (L169–180), dispatch one INGEST job per asset (L200–205) which probes `durationS`/`hasAudio` (ingest `probeFile` L28–45, `hasAudio` L24/L45). **No change** — EP4 calls these from the Sound aside. NOTE: no `.tsx` calls `uploadFilesDirect`/`finalizeCandidateUploads` today — EP4 is the first consumer (Open Q resolved in Decision 5).

### `apps/web/components/Editor.tsx` (1160 lines) — the EP1/EP2 UI EP4 extends

- Imports L5–8 (`artlioEdit`, ops, `getEditorMedia`, `setDnd/getDnd/hasDnd`, ds). `EditorClip` type L38 = `{ id; src; kind: "image"|"video"; seconds }` — **EP4 widens `kind` to include `"audio"`**.
- `EMPTY_EDIT` L57–60 (`output: hd/16:9/25`). `media` state L164, loaded L166–172 (`getEditorMedia(projectId)`).
- `currentMergedEdit()` L404–422 — merges React `transitions` onto track 0 before parse. **EP4 also merges `output` here** (Output control state lives in React like transitions).
- `snapshot()` L424–435; `commitState` L442–452; `flushNative` L463–481; `reloadFromEdit(next)` L517–526 (the `loadEdit` + re-seed pattern EP4's `appendAudioAsset` uses to create an audio track); `appendAsset(clip)` L570–585 (`addClip(0, …)` — visual track 0 hard-coded).
- `applyVolume(v)` L614–634 — patches `asset.volume` via `updateClip`; gated by Inspector `hasAudio = type === "video"` L1124. **EP4 widens `hasAudio` to include `"audio"`** so a selected audio-track clip exposes the volume slider.
- Toolbar L911–971 (Save cut L948, Undo L951, Redo L954, Split L957, Ripple delete L960, Close gaps L963–967, **Export MP4 L968** — EP4 adds Export XML + Approx-preview toggle + Output control here).
- Asides flex row L980: Assets L982–1000, Transitions L1001–1042, studio+timeline center, Inspector ("Clip") L1121–1154. **EP4 inserts a Sound aside after the Transitions aside (after L1042).**
- DnD: Assets thumbnail `onDragStart setDnd(… { kind:"editor-clip", src, clipKind, seconds })` L988; timeline drop handler L1067–1073 routes ALL `editor-clip` → `appendAsset` (track 0). **EP4 branches on `clipKind==="audio"` → `appendAudioAsset`.**

### Job-wiring (not needed for EP4 — recorded so the executor doesn't add a queue)

EP4 introduces **NO new pg-boss job/queue/DB row**. Ducking is a filter inside the EXISTING render job; audio upload reuses the EXISTING ingest job; XML export is client-side. The 6-place job recipe (queues.ts, worker index.ts boot, web queue.ts, actions dispatch, handler) is therefore **not exercised** by EP4. (The whisper.cpp transcription job is an EP3 concern, not EP4.)

### Local toolchain (confirmed)

- `ffmpeg`/`ffprobe` on PATH (`/opt/homebrew/bin`). `sidechaincompress` present (Task 0 verifies on this machine + documents the worker's trixie 7.x has it too). `amix`, `adelay`, `atrim`, `aresample` all present (EP1 already uses them).

### Three design decisions this plan LOCKS (the spec asked the plan to pick)

1. **Ducking model = a per-audio-track `audioRole` ("voice" | "music"), ducking happens iff EXACTLY ONE track is "music" AND ≥1 source is "voice".** Rationale: the contract has no track "role" today, and ducking needs to know which signal triggers (voice) and which is ducked (music). `audioRole` is the minimum addition — one optional enum on `track`. The trigger ("voice" sidechain) is built from the **voice-role audio track's clips + all native visual-clip audio** (a video clip's own dialogue is the natural sidechain trigger); the ducked bed is the **music-role audio track's clips**. If `audioRole` is absent on every track (every legacy edit, and any edit where the user didn't opt in), the mix stays the EP1 flat `amix` — zero behavior change. If 0 or 2 music tracks, or 0 voice sources, ducking is a no-op flat mix (validated/guarded, never an error). This keeps the contract surface tiny and the feature opt-in.
2. **Approximate preview = a sequential HTML5 `<video>` playthrough of the VISUAL track only, transitions/overlays/ducking NOT simulated, behind an explicit toggle labeled "Approx preview (no effects)".** Rationale: the Shotstack studio canvas already gives WYSIWYG transport (`Edit.playbackTime`), so a parallel player is NOT a replacement — it's a cheap, dependency-free "does my cut roughly play back-to-back" check (the spec explicitly defers a real compositing engine = buy Remotion later). It plays each visual clip's `src` in `start` order, advancing on `ended`, honoring `trim`(as `currentTime`) and `length`. It does NOT render transitions, captions, overlays, or audio ducking — the label says so. This is honest, $0, and ~40 lines. (A real-time preview of effects is explicitly out of scope.)
3. **XML export target = FCP7 XML (`xmeml` version 5), one visual track + audio tracks + hard cuts + per-clip fades, transitions/ducking dropped-with-a-comment.** Rationale: FCP7 XML is the broadest NLE interchange — **Premiere Pro AND DaVinci Resolve both import it** (FCPXML 1.x is Apple-only; EDL loses audio/fades; OTIO needs a runtime lib). EP4 maps `ArtlioEdit` → `xmeml`: sequence rate from `output.fps`, frame size from `output.aspectRatio`×`output.resolution` (SIZES), one video track of clipitems (in/out from `trim`×fps, start/end from timeline `start`×fps), audio tracks likewise, per-clip `transition.in/out` → a `<filter>` Cross Dissolve-to-black is **omitted** (FCP7's fade-to-black is a generator, lossy) — instead the mapping is honest: hard cuts + clip in/out/start/end + a top-of-file `<!-- ... -->` comment listing what was dropped (between-clip transitions, ducking, captions). The export is **lossy by nature** (any NLE interchange is) and says so. This is a pure `ArtlioEdit → string` function, fully unit-testable (the output parses as XML and round-trips key fields). Resolve/Premiere re-link media by filename; the `<pathurl>` is the app-relative `/files/...` src (the user re-links on import — documented in the download toast).

> **Decision 4 (the 1080 revisit):** KEEP the 720p render cap for now, but make it HONEST in the UI. The cap exists because a 1080 ffmpeg render OOM'd the worker (render.ts:218–220 comment). EP4 does NOT lift it (no infra change in scope; raising it risks the worker OOM the money-safety rule guards against). Instead the Output control's resolution selector shows `1080` as **"1080 (renders at 720 — beta)"** and the XML export uses the TRUE selected resolution (NLE re-renders at full res anyway). This closes the "revisit" honestly without a risky worker change. (If a future infra task gives the worker more memory, lifting the cap is a one-line change at render.ts:220 — flagged, not done here.)

---

## File Structure

| File | Create/Modify | Responsibility in EP4 |
|---|---|---|
| `packages/core/src/timeline.ts` | Modify | Add `AUDIO_ROLES`/`AudioRole` enum + `audioRole?` to the `track` zod; validate in `timeline.superRefine` (audioRole only on an audio track; ≤1 music track). Additive + backward-compat. |
| `packages/core/src/timeline.test.ts` | Modify | New describe block: `audioRole` accept (voice/music), reject on a visual track, reject 2 music tracks, legacy edit (no audioRole) still parses, `output` presets parse. |
| `packages/core/src/nle-export.ts` | **Create** | Pure `editToFcpXml(edit, opts?): string` — `ArtlioEdit → xmeml v5`. No I/O, no spend. |
| `packages/core/src/nle-export.test.ts` | **Create** | vitest: output is well-formed XML, has the right `<rate>`/frame size, one clipitem per visual+audio clip with correct in/out/start/end frames, the dropped-features comment is present, an empty/transition edit doesn't throw. |
| `packages/core/src/index.ts` | Modify | Re-export `editToFcpXml`, `AUDIO_ROLES`, `AudioRole`. |
| `apps/worker/src/jobs/render.ts` | Modify | Thread `audioRole`/`trackKind` onto `PlannedInput`; when a music+voice pair exists, partition `sounded` into a voice sub-mix + a music sub-mix, `sidechaincompress` the music under the voice, re-`amix` — KEEP the `,aresample…,atrim=0:${renderSeconds}[a]` tail + `-map [a]`. New helper `buildAudioMix(...)`. Bounded; no new input. |
| `apps/web/lib/actions.ts` | Modify | `getEditorMedia`: add `EDITOR_AUDIO_EXTS`, widen `kind` union to include `"audio"`, stop dropping audio, `seconds = durationS ?? 5` for audio. |
| `apps/web/components/Editor.tsx` | Modify | Widen `EditorClip.kind`; Sound aside (surface audio + Upload audio + place via `appendAudioAsset` + per-clip volume + ducking toggle); `appendAudioAsset` (build/extend an audio track via `reloadFromEdit`); widen Inspector `hasAudio` to include audio clips; Output control (aspect/resolution/fps in React, merged in `currentMergedEdit`); Export XML button (client Blob download); Approx-preview toggle + `<video>` player. |
| `scripts/local-ep4-audio-export-verify.mjs` | **Create** | $0 local ffmpeg render of a music+voice ducking fixture asserting a valid mp4 whose ffprobe duration == `renderDuration` and that the music dips under the voice (RMS check on a music-only window vs an overlap window); `editToFcpXml` round-trip XML-validates; grep the diff for any fal/spend token. |

No new package, **no prisma migration, no new pg-boss queue/job, no new env var.**

---

## Task 0: Probe — confirm `sidechaincompress` in the local + worker ffmpeg (no code)

The whole ducking feature rests on `sidechaincompress` existing in the worker's ffmpeg. Confirm before building.

- [ ] **Step 1: Confirm the local build has it**

Run: `ffmpeg -hide_banner -filters | grep -E "sidechaincompress|amix|adelay|atrim"`
Expected: a line for each — in particular `... sidechaincompress    A->A       Sidechain compressor.` (or `AA->A`). If `sidechaincompress` is ABSENT locally, STOP and tell the user (the local verify in Task 9 can't run; the worker still has it on trixie, but you lose the local gate).

- [ ] **Step 2: Confirm the worker image base has it** — the worker is `node:22-trixie-slim` + `apt-get install ffmpeg` (`apps/worker/Dockerfile` L4–5). Debian trixie ships ffmpeg 7.x with `sidechaincompress` compiled in (same family as the EP1 `xfade`/`acrossfade` already used). Record this in a code comment in Task 5 so the dependency is auditable. No Dockerfile change is needed (no new binary, unlike EP3's whisper.cpp).

- [ ] **Step 3: No commit** (probe only).

---

## Task 1: Contract — `audioRole` on `track` + validation (TDD)

**Files:**
- Modify: `packages/core/src/timeline.ts` (the `track` zod L142–150; `timeline.superRefine` per-track loop L190–254)
- Test: `packages/core/src/timeline.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/timeline.test.ts` (reuse the existing `cloneEdit`/`validEdit`/`SRC` harness; `validEdit` has a visual track[0] + an audio track[1]):

```ts
import { AUDIO_ROLES } from "./timeline.js";

describe("track.audioRole (ducking opt-in)", () => {
  it("AUDIO_ROLES is exactly voice + music", () => {
    expect([...AUDIO_ROLES].sort()).toEqual(["music", "voice"]);
  });

  it("accepts audioRole on an audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].audioRole = "music"; // track[1] is the audio track
    const parsed = artlioEdit.parse(e);
    expect((parsed.timeline.tracks[1] as any).audioRole).toBe("music");
  });

  it("rejects audioRole on a visual track", () => {
    const e = cloneEdit();
    e.timeline.tracks[0].audioRole = "voice"; // track[0] is visual
    expect(() => artlioEdit.parse(e)).toThrow(/audio track|visual/i);
  });

  it("rejects more than one music track", () => {
    const e = cloneEdit();
    // add a 2nd audio track and mark both music (timeline allows ≤2 audio tracks)
    e.timeline.tracks[1].audioRole = "music";
    e.timeline.tracks.push({ clips: [{ asset: { type: "audio", src: SRC.replace(".mp4", ".mp3") }, start: 0, length: 4 }], audioRole: "music" });
    expect(() => artlioEdit.parse(e)).toThrow(/one music|single music/i);
  });

  it("accepts one music + one voice audio track", () => {
    const e = cloneEdit();
    e.timeline.tracks[1].audioRole = "voice";
    e.timeline.tracks.push({ clips: [{ asset: { type: "audio", src: SRC.replace(".mp4", ".mp3") }, start: 0, length: 4 }], audioRole: "music" });
    expect(() => artlioEdit.parse(e)).not.toThrow();
  });

  it("still parses a legacy edit with NO audioRole (backward-compat)", () => {
    expect(() => artlioEdit.parse(validEdit)).not.toThrow();
    expect((artlioEdit.parse(validEdit).timeline.tracks[1] as any).audioRole).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: FAIL — `AUDIO_ROLES` not exported; `audioRole` stripped (unknown field) so the accept case is `undefined`; the guards don't exist.

- [ ] **Step 3: Add the enum + the `track` field** — in `packages/core/src/timeline.ts`, add after `TRANSITION_DIRECTIONS` (after L97):

```ts
/** Audio-track role for auto-ducking (EP4). "music" = a bed ducked UNDER any
 *  "voice" signal (the voice audio track + native visual-clip dialogue) via
 *  ffmpeg sidechaincompress. Absent on every legacy edit and any edit that
 *  doesn't opt in → the worker uses a flat amix (no ducking). Roles are
 *  visual-track-illegal (a role describes an audio bed/voice, not picture). */
export const AUDIO_ROLES = ["voice", "music"] as const;
export type AudioRole = (typeof AUDIO_ROLES)[number];
```

Then add the field to the `track` zod (L142–150), after `transitions`:

```ts
export const track = z.object({
  clips: z.array(clip).min(1).max(MAX_CLIPS_PER_TRACK),
  transitions: z.array(betweenClipTransition).max(MAX_CLIPS_PER_TRACK).optional(),
  /** audio-track role for ducking (EP4); audio tracks only. None = the absence
   *  of an entry → flat mix. Validated in timeline.superRefine (track
   *  composition + the ≤1-music-track rule are in scope there). */
  audioRole: z.enum(AUDIO_ROLES).optional(),
});
```

- [ ] **Step 4: Validate in `timeline.superRefine`** — inside the existing `tl.tracks.forEach((t, i) => { … })` (L190–254), add after the mixed-track check (after L197):

```ts
      // audioRole is audio-track only; the count guard (≤1 music) is below the loop
      if (t.audioRole && isVisualTrack(t)) {
        ctx.addIssue({ code: "custom", message: `track ${i}: audioRole is for audio tracks only (a visual track has no bed/voice role)` });
      }
```

Then after the `forEach` closes (after L254, before the 30-min `if (end > MAX_TIMELINE_SECONDS)` check at L255), add the count guard:

```ts
    const musicTracks = tl.tracks.filter((t) => !isVisualTrack(t) && t.audioRole === "music").length;
    if (musicTracks > 1) {
      ctx.addIssue({ code: "custom", message: `at most one music track may duck (got ${musicTracks}) — mark only the bed as "music"` });
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @artlio/core test -- timeline`
Expected: PASS (all `track.audioRole` cases green; every pre-existing test still passes — `validEdit` has no `audioRole` so nothing fires on it).

- [ ] **Step 6: Re-export + typecheck + full core suite**

In `packages/core/src/index.ts`, add `AUDIO_ROLES` to the value exports and `type AudioRole` to the type exports from `./timeline.js` (the block at L11–32).

Run: `pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/core test`
Expected: green.

- [ ] **Step 7: Commit** (leave for user approval — do NOT push)

```bash
git add packages/core/src/timeline.ts packages/core/src/timeline.test.ts packages/core/src/index.ts
git commit -m "feat(editor): EP4 contract — track.audioRole (voice/music) for ducking, additive + validated"
```

---

## Task 2: Worker — thread audio identity onto `PlannedInput`

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — `PlannedInput` L43–48; the planning loop L203–212; imports L22–34.

Ducking partitions the mix by track, but `PlannedInput` (L43–48) doesn't record which track a clip came from. Thread it on first (this task is structural only — the mix still flattens until Task 5, so behavior is unchanged).

- [ ] **Step 1: Widen `PlannedInput`** — replace L43–48 with:

```ts
interface PlannedInput {
  clip: ArtlioClip;
  file: string;
  index: number;
  hasAudio: boolean;
  /** which kind of track this clip came from (EP4 ducking partitions by this) */
  trackKind: "visual" | "audio";
  /** the owning audio track's role, if any (EP4); undefined on visual clips */
  audioRole?: AudioRole;
}
```

- [ ] **Step 2: Set the new fields when planning** — in `handleRender`, the `addInput` closure + the two planning loops (L204–212). Replace `addInput` (L204–209) and the audio-track loop (L212) so the role/kind are recorded:

```ts
    const planned: PlannedInput[] = [];
    const addInput = async (clip: ArtlioClip, trackKind: "visual" | "audio", audioRole?: AudioRole) => {
      const file = await storage.ffmpegInput(srcToStorageKey(clip.asset.src));
      const probe = clip.asset.type === "image" ? { hasAudio: false } : await probeFile(file);
      planned.push({ clip, file, index: planned.length, hasAudio: probe.hasAudio, trackKind, audioRole });
    };
    const visualClips = [...visualTrack.clips].sort((a, b) => a.start - b.start);
    for (const c of visualClips) await addInput(c, "visual");
    for (const t of audioTracks) for (const c of t.clips) await addInput(c, "audio", t.audioRole);
```

- [ ] **Step 3: Import `AudioRole`** — add `type AudioRole` to the `@artlio/core` import (L22–34).

- [ ] **Step 4: Typecheck (build core first so the worker sees the new export)**

Run: `pnpm --filter @artlio/core build && pnpm --filter @artlio/worker typecheck`
Expected: no errors. (The new fields are unused until Task 5 — `trackKind`/`audioRole` are read by `buildAudioMix`; if `noUnusedLocals` complains, Task 5 lands in the same commit, so commit Tasks 2+5 together as noted in Task 5 Step 6.)

> Do NOT commit Task 2 alone — fold into Task 5's commit (the fields are consumed there).

---

## Task 3: Worker — `buildAudioMix()` helper (pure, exercised by Task 9 render)

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — add a helper after `audioChain` (after L169).

> The worker has no vitest suite (no `vitest.config.*`, no `*.test.ts` under `apps/worker`). EP4 does NOT add one (out of scope; matches EP1's decision). `buildAudioMix` is exercised end-to-end by the `scripts/local-ep4-audio-export-verify.mjs` render in Task 9. This task is implementation-only (no failing-test step).

The helper takes the already-built per-clip `[a${index}]` labels (from `audioChain`) plus the `sounded` plan and returns the mix filtergraph lines + the final label. It encapsulates the ducking branch so `handleRender` stays readable.

- [ ] **Step 1: Add the helper** — after `audioChain` (after L169):

```ts
/** Build the audio mix filtergraph from the per-clip [a${index}] labels.
 *  Default path: a flat amix of all sounded clips (the EP1 behavior).
 *  Ducking path (EP4): if exactly ONE music-role audio track has sounded clips
 *  AND there is ≥1 voice source (a voice-role audio track's clips OR any native
 *  visual-clip audio), the music bed is compressed UNDER the voice via
 *  sidechaincompress, then re-mixed with the voice. sidechaincompress is in the
 *  worker's Debian-trixie ffmpeg 7.x (Task 0). The final node ALWAYS ends with
 *  ,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a] so the downstream
 *  -map [a] is unchanged (the load-bearing EP1 invariant). normalize=0 is kept
 *  on every amix (avoids a volume bump). Returns the lines to append + true if
 *  audio should be mapped. */
function buildAudioMix(sounded: PlannedInput[], renderSeconds: number): { lines: string[]; mapAudio: boolean } {
  if (sounded.length === 0) return { lines: [], mapAudio: false };
  const lab = (p: PlannedInput) => `[a${p.index}]`;
  const tail = `aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`;

  // partition: the ducked bed = sounded clips on a music-role audio track;
  // the voice trigger = voice-role audio clips + ALL native visual-clip audio.
  const bed = sounded.filter((p) => p.trackKind === "audio" && p.audioRole === "music");
  const voice = sounded.filter((p) => !(p.trackKind === "audio" && p.audioRole === "music"));
  const duckable = bed.length > 0 && voice.length > 0;

  if (!duckable) {
    // flat mix (EP1 behavior) — covers every legacy edit and any non-ducked edit
    const mixIn = sounded.map(lab).join("");
    return {
      lines: [`${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,${tail}`],
      mapAudio: true,
    };
  }

  const lines: string[] = [];
  // 1) sub-mix the voice sources → [voice]
  const voiceIn = voice.map(lab).join("");
  lines.push(`${voiceIn}amix=inputs=${voice.length}:duration=longest:normalize=0[vmix]`);
  // 2) sub-mix the bed sources → [bed]
  const bedIn = bed.map(lab).join("");
  lines.push(`${bedIn}amix=inputs=${bed.length}:duration=longest:normalize=0[bmix]`);
  // 3) duck the bed under the voice. The voice is the SIDECHAIN trigger; it must
  //    be split because we also need it dry in the final mix. asplit duplicates it.
  lines.push(`[vmix]asplit=2[vkey][vout]`);
  lines.push(`[bmix][vkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck]`);
  // 4) final mix: dry voice + ducked bed → [a] (with the load-bearing tail)
  lines.push(`[vout][duck]amix=inputs=2:duration=longest:normalize=0,${tail}`);
  return { lines, mapAudio: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @artlio/core build && pnpm --filter @artlio/worker typecheck`
Expected: no errors. (`buildAudioMix` is unused until Task 5; fold its commit into Task 5.)

> Do NOT commit Task 3 alone — fold into Task 5's commit.

---

## Task 4: Worker — guard the ducking inputs before ffmpeg

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — in `handleRender`, near the existing transition guard L237–247.

Belt-and-braces: the contract already enforces ≤1 music track (Task 1), but guard against schema drift so a malformed role can't produce an `amix=inputs=0` (an ffmpeg argv error) or an unbounded chain.

- [ ] **Step 1: Add the guard** — after the existing transition guard block (after L247), before `const renderSeconds = …` (L249):

```ts
    // belt-and-braces (contract enforces ≤1 music track; guard against drift).
    // Ducking needs at least one bed clip AND one voice source, else it falls
    // back to the flat mix — buildAudioMix handles that, but assert the partition
    // can never produce an empty amix input list.
    const musicSounded = sounded.filter((p) => p.trackKind === "audio" && p.audioRole === "music");
    const musicTrackCount = new Set(
      planned.filter((p) => p.trackKind === "audio" && p.audioRole === "music").map((p) => p.audioRole),
    ).size;
    if (musicTrackCount > 1) {
      throw new Error("more than one music-role audio track — ducking is ambiguous");
    }
    void musicSounded; // partition recomputed inside buildAudioMix; this only asserts the cap
```

> Note: this throws cleanly into the existing try/catch (L362) → `FAILED` with a message, never a malformed ffmpeg argv. `buildAudioMix` itself is total (returns the flat mix when not duckable), so the only hard error is the >1 music-track drift case the contract already rejects.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @artlio/worker typecheck`
Expected: no errors. (Fold into Task 5's commit.)

---

## Task 5: Worker — wire `buildAudioMix` into `handleRender`

**Files:**
- Modify: `apps/worker/src/jobs/render.ts` — replace the inline mix block L287–295 with the helper; update the console.log L304–306.

- [ ] **Step 1: Replace the inline mix** — replace L287–295 (`let mapAudio = false; … mapAudio = true; }`) with:

```ts
    if (sounded.length > 0) {
      for (const p of sounded) graph.push(audioChain(p, visualPlanned, transitions));
    }
    const { lines: mixLines, mapAudio } = buildAudioMix(sounded, renderSeconds);
    for (const line of mixLines) graph.push(line);
```

- [ ] **Step 2: Update the log line** — replace the `console.log` at L304–306 with one that reports ducking:

```ts
    const ducked = sounded.some((p) => p.trackKind === "audio" && p.audioRole === "music") &&
      sounded.some((p) => !(p.trackKind === "audio" && p.audioRole === "music"));
    console.log(
      `[render] ${job.id}: ffmpeg ${visualPlanned.length} visual (${transitions.length} transitions) + ${sounded.length} audio${ducked ? " (ducking)" : ""} → ${w}x${h}@${fps}, ${renderSeconds}s`,
    );
```

- [ ] **Step 3: Confirm the argv tail is untouched** — the block at L297–302 (`const args = ["-y"]; … "-map", vLabel; if (mapAudio) args.push("-map", "[a]", …); … "-progress", "pipe:1", "-nostats", out;`) is UNCHANGED. `buildAudioMix` always ends its final node with `[a]`, so `-map [a]` still resolves. Verify by reading L297–302 after the edit — no change there.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @artlio/core build && pnpm --filter @artlio/worker typecheck && pnpm --filter @artlio/worker build`
Expected: no errors.

- [ ] **Step 5: Sanity — render an existing non-ducked fixture still works** — if a local fixture render exists from EP1 (`scripts/local-ep1-transitions-verify.mjs`), run it to confirm the flat-mix path is byte-for-byte unchanged:

Run: `pnpm --filter @artlio/core build && node scripts/local-ep1-transitions-verify.mjs` (if present; else skip to Task 9)
Expected: the EP1 verify still PASSes (the default mix path is identical — `buildAudioMix` returns the same single `amix … atrim[a]` line when not duckable).

- [ ] **Step 6: Commit Tasks 2+3+4+5 together** (leave for user approval)

```bash
git add apps/worker/src/jobs/render.ts
git commit -m "feat(editor): EP4 worker — audioRole ducking (sidechaincompress music under voice), flat-mix default unchanged"
```

---

## Task 6: Core — `editToFcpXml()` NLE export (TDD)

**Files:**
- Create: `packages/core/src/nle-export.ts`
- Create: `packages/core/src/nle-export.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test** — create `packages/core/src/nle-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { editToFcpXml } from "./nle-export.js";
import type { ArtlioEdit } from "./timeline.js";

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;
const ASRC = `/files/u/founder/${HASH}.mp3`;

const edit: ArtlioEdit = {
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
    // clip 0: trim 1.5s → in = 1.5*25 = 37 (round) ; length 4s → out = in + 100 = 137
    // start = 0*25 = 0 ; end = 4*25 = 100
    expect((xml.match(/<clipitem/g) ?? []).length).toBe(3); // 2 video + 1 audio
    expect(xml).toContain("<in>37</in>");
    expect(xml).toContain("<out>137</out>");
    expect(xml).toContain("<start>0</start>");
    expect(xml).toContain("<end>100</end>");
  });

  it("includes the lossy-export comment listing dropped features", () => {
    const xml = editToFcpXml(edit);
    expect(xml).toMatch(/<!--[\s\S]*lossy[\s\S]*-->/i);
  });

  it("does not throw on an edit with between-clip transitions (they're dropped)", () => {
    const e: ArtlioEdit = structuredClone(edit);
    (e.timeline.tracks[0] as any).transitions = [{ fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 }];
    expect(() => editToFcpXml(e)).not.toThrow();
  });

  it("escapes XML-special chars in the pathurl", () => {
    const xml = editToFcpXml(edit);
    expect(xml).not.toMatch(/<pathurl>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/); // no raw & in pathurl
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @artlio/core test -- nle-export`
Expected: FAIL — `editToFcpXml` not found.

- [ ] **Step 3: Implement** — create `packages/core/src/nle-export.ts`:

```ts
import type { ArtlioEdit, ArtlioClip } from "./timeline.js";

/** Frame size per aspect×resolution — mirrors the worker SIZES table
 *  (render.ts:37–41). The XML export uses the TRUE selected resolution (an NLE
 *  re-renders at full res; the 720p worker cap is render-only, EP4 Decision 4). */
const SIZES: Record<string, Record<string, [number, number]>> = {
  "16:9": { sd: [854, 480], hd: [1280, 720], "1080": [1920, 1080] },
  "9:16": { sd: [480, 854], hd: [720, 1280], "1080": [1080, 1920] },
  "1:1": { sd: [480, 480], hd: [720, 720], "1080": [1080, 1080] },
};

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const isAudioTrack = (clips: ArtlioClip[]) => clips.every((c) => c.asset.type === "audio");

/** Serialize an ArtlioEdit to FCP7 XML (xmeml v5) — imports into Premiere Pro and
 *  DaVinci Resolve. LOSSY by design (any NLE interchange is): between-clip
 *  transitions, audio ducking, and captions/overlays are DROPPED and listed in a
 *  top-of-file comment. Hard cuts + clip in/out/start/end (frame-accurate from
 *  trim/length/start × fps) + per-clip media references are preserved. Media is
 *  referenced by app-relative src in <pathurl>; the user re-links on import.
 *  Pure: no I/O, no spend. */
export function editToFcpXml(edit: ArtlioEdit, opts?: { sequenceName?: string }): string {
  const fps = edit.output.fps;
  const res = edit.output.resolution;
  const [width, height] = SIZES[edit.output.aspectRatio]?.[res] ?? [1280, 720];
  const name = xmlEscape(opts?.sequenceName ?? "Artlio cut");
  const sec = (s: number) => Math.round(s * fps); // seconds → frames

  const dropped: string[] = [];
  for (const t of edit.timeline.tracks) if ((t.transitions?.length ?? 0) > 0) { dropped.push("between-clip transitions"); break; }
  if (edit.timeline.tracks.some((t) => t.audioRole === "music")) dropped.push("audio ducking");
  // EP3 captions/overlays are top-level-on-timeline; drop them too if present
  const tl = edit.timeline as unknown as { captions?: unknown[]; textOverlays?: unknown[] };
  if ((tl.captions?.length ?? 0) > 0) dropped.push("captions");
  if ((tl.textOverlays?.length ?? 0) > 0) dropped.push("text overlays");

  let fileSeq = 0;
  const clipItem = (c: ArtlioClip, trackKind: "video" | "audio"): string => {
    const inF = sec(c.asset.trim ?? 0);
    const startF = sec(c.start);
    const lenF = sec(c.length);
    const fileId = `file-${fileSeq++}`;
    const path = xmlEscape(c.asset.src);
    const media =
      trackKind === "video"
        ? `<media><video><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></video></media>`
        : `<media><audio/></media>`;
    return [
      `<clipitem id="${fileId}-clip">`,
      `<name>${path.slice(path.lastIndexOf("/") + 1)}</name>`,
      `<rate><timebase>${fps}</timebase></rate>`,
      `<in>${inF}</in>`,
      `<out>${inF + lenF}</out>`,
      `<start>${startF}</start>`,
      `<end>${startF + lenF}</end>`,
      `<file id="${fileId}"><name>${path.slice(path.lastIndexOf("/") + 1)}</name><pathurl>${path}</pathurl><rate><timebase>${fps}</timebase></rate>${media}</file>`,
      `</clipitem>`,
    ].join("");
  };

  const visualTracks = edit.timeline.tracks.filter((t) => !isAudioTrack(t.clips));
  const audioTracks = edit.timeline.tracks.filter((t) => isAudioTrack(t.clips));
  const totalFrames = sec(
    Math.max(0, ...edit.timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length))),
  );

  const videoTrackXml = visualTracks
    .map((t) => `<track>${[...t.clips].sort((a, b) => a.start - b.start).map((c) => clipItem(c, "video")).join("")}</track>`)
    .join("");
  const audioTrackXml = audioTracks
    .map((t) => `<track>${[...t.clips].sort((a, b) => a.start - b.start).map((c) => clipItem(c, "audio")).join("")}</track>`)
    .join("");

  const comment =
    dropped.length > 0
      ? `<!-- Artlio FCP7 export (lossy): the following were DROPPED and must be re-created in the NLE: ${dropped.join(", ")}. Re-link media by filename on import. -->`
      : `<!-- Artlio FCP7 export (lossy interchange). Re-link media by filename on import. -->`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    comment,
    `<xmeml version="5">`,
    `<sequence>`,
    `<name>${name}</name>`,
    `<duration>${totalFrames}</duration>`,
    `<rate><timebase>${fps}</timebase></rate>`,
    `<media>`,
    `<video><format><samplecharacteristics><width>${width}</width><height>${height}</height><rate><timebase>${fps}</timebase></rate></samplecharacteristics></format>${videoTrackXml}</video>`,
    `<audio>${audioTrackXml}</audio>`,
    `</media>`,
    `</sequence>`,
    `</xmeml>`,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @artlio/core test -- nle-export`
Expected: PASS.

- [ ] **Step 5: Re-export + typecheck**

In `packages/core/src/index.ts`, add `export { editToFcpXml } from "./nle-export.js";`.

Run: `pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/core test`
Expected: green.

- [ ] **Step 6: Commit** (leave for user approval)

```bash
git add packages/core/src/nle-export.ts packages/core/src/nle-export.test.ts packages/core/src/index.ts
git commit -m "feat(editor): EP4 core — editToFcpXml() pure ArtlioEdit→FCP7 XML export ($0, lossy interchange)"
```

---

## Task 7: Web — un-filter audio in `getEditorMedia`

**Files:**
- Modify: `apps/web/lib/actions.ts` — `EDITOR_*_EXTS` L745–746; `getEditorMedia` return type L750; flatMap L759–769.

- [ ] **Step 1: Add the audio ext set** — after L746:

```ts
const EDITOR_AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]); // EXT_BY_TYPE.audio
```

- [ ] **Step 2: Widen the return type + un-drop audio** — change the `getEditorMedia` signature (L750) `kind: "image" | "video"` → `kind: "image" | "video" | "audio"`, and replace the flatMap body (L759–769) with:

```ts
  return gens.flatMap((g) => {
    const ext = g.asset.ext.toLowerCase();
    const isVideo = EDITOR_VIDEO_EXTS.has(ext);
    const isImage = EDITOR_IMAGE_EXTS.has(ext);
    const isAudio = EDITOR_AUDIO_EXTS.has(ext);
    if (!isVideo && !isImage && !isAudio) return []; // skip unknown
    const kind = isVideo ? ("video" as const) : isImage ? ("image" as const) : ("audio" as const);
    return [{
      id: g.id,
      src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      kind,
      // audio + video carry durationS; images get a 3s still default
      seconds: kind === "image" ? 3 : (g.asset.durationS ?? 5),
    }];
  });
```

- [ ] **Step 3: Typecheck (web)** — the caller (`Editor.tsx`) widens its `EditorClip.kind` in Task 8; this server file typechecks independently.

Run: `pnpm --filter web typecheck`
Expected: an error ONLY at the `Editor.tsx` `setMedia`/`appendAsset` call sites (the `kind` union widened) — those are fixed in Task 8. If you run Task 8 in the same session before this typecheck, expect green. (Sequence Tasks 7→8 then typecheck once after Task 8.)

- [ ] **Step 4: Commit** (leave for user approval — or fold into Task 8 since the types are coupled)

```bash
git add apps/web/lib/actions.ts
git commit -m "feat(editor): EP4 web — getEditorMedia surfaces audio assets (un-filter, kind widened)"
```

---

## Task 8: Web — Sound aside (surface + upload + place + volume + ducking) + Output control + Export XML + Approx preview

**Files:**
- Modify: `apps/web/components/Editor.tsx` — `EditorClip` L38; imports L5–6; `appendAudioAsset` (new, near `appendAsset` L570); the Sound aside (new, after the Transitions aside L1042); Inspector `hasAudio` L1124; Output state + `currentMergedEdit` merge L404–422; Output control + Export XML + Approx-preview toggle in the toolbar L911–971; the Approx `<video>` player near the studio canvas; the timeline drop branch L1067–1073.

This is the largest task. It is additive — every existing handler stays. Break it into clear sub-steps.

- [ ] **Step 1: Widen `EditorClip.kind`** — L38:

```ts
type EditorClip = { id: string; src: string; kind: "image" | "video" | "audio"; seconds: number };
```

- [ ] **Step 2: Import the export + upload helpers** — extend the imports (L5–6):

```ts
import { artlioEdit, snapEdit, splitClipAt, rippleDeleteClip, reconcileTransitions, editToFcpXml, type ArtlioEdit, type ArtlioClip } from "@artlio/core";
import { getRenderJobs, saveProjectEdit, startRender, getEditorMedia } from "@/lib/actions";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
```

- [ ] **Step 3: Output state + merge** — add Output React state near the `transitions` state (after L164's `media`), and merge it in `currentMergedEdit`:

```tsx
  // EP4 output presets live in React (like transitions, outside Shotstack) and are
  // merged into the persisted ArtlioEdit. Seeded from the loaded edit's output.
  const [output, setOutput] = useState<ArtlioEdit["output"]>(
    () => initialEdit?.output ?? EMPTY_EDIT.output,
  );
```

In `currentMergedEdit()` (L404–422), change the returned object's `output` to the React state — replace `...raw,` usage so the merged edit carries our `output`:

```tsx
    const merged = {
      ...raw,
      output, // EP4: the Output control is the source of truth, not Shotstack's
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) =>
          i === 0 && live.length > 0 ? { ...t, transitions: live } : t,
        ),
      },
    };
```

> The Output control changing should mark the edit dirty: each `setOutput` is paired with `setDirty(true)` in its handler (Step 8).

- [ ] **Step 4: `appendAudioAsset`** — add after `appendAsset` (after L585). It builds the next ArtlioEdit in JS (find/create an audio track) and pushes it via `reloadFromEdit` (the EP2 op pattern — the SDK's `addClip` targets an existing track index and can't reliably create an audio track; Decision in the EP4 grounding):

```tsx
  // EP4: place an audio asset on its OWN audio track (the contract forbids audio
  // on the visual track). Build the next edit in JS — find the first audio track
  // (all-audio clips) and append at its end, or CREATE one if there's room
  // (≤3 tracks total, ≤2 audio). Push via reloadFromEdit (the EP2 op pattern):
  // the SDK's addClip targets an existing index and can't create an audio track.
  async function appendAudioAsset(clip: EditorClip) {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return;
    if (!flushNative()) return; // settle pending native edits + reconcile first
    opLock.current = true;
    try {
      const base = currentMergedEdit();
      if (!base) return;
      const tracks = base.timeline.tracks.map((t) => ({ ...t, clips: [...t.clips] }));
      const isAudio = (t: { clips: { asset: { type: string } }[] }) => t.clips.length > 0 && t.clips.every((c) => c.asset.type === "audio");
      let idx = tracks.findIndex(isAudio);
      const newClip = { asset: { type: "audio" as const, src: clip.src }, start: 0, length: clip.seconds };
      if (idx >= 0) {
        const end = tracks[idx]!.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
        tracks[idx]!.clips.push({ ...newClip, start: end });
      } else {
        const audioCount = tracks.filter(isAudio).length;
        if (tracks.length >= 3 || audioCount >= 2) {
          setNotice({ tone: "warn", text: "No room for another audio track (max 2)." });
          return;
        }
        tracks.push({ clips: [newClip] });
      }
      const next = { ...base, timeline: { ...base.timeline, tracks } };
      const parsed = artlioEdit.safeParse(next);
      if (!parsed.success) {
        setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "Could not place audio." });
        return;
      }
      commitState(parsed.data);
      selfReload.current = true;
      try { await reloadFromEdit(parsed.data); } finally { selfReload.current = false; }
    } catch (e) {
      console.error("[editor] appendAudioAsset failed", e);
    } finally {
      opLock.current = false;
    }
  }
```

- [ ] **Step 5: Audio upload handler** — add near `appendAudioAsset`:

```tsx
  const [uploadingAudio, setUploadingAudio] = useState(false);
  async function uploadAudio(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingAudio(true);
    try {
      const outcome = await uploadFilesDirect(Array.from(files), () => {});
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res) { setNotice({ tone: "warn", text: res.error }); return; }
      const fresh = await getEditorMedia(projectId);
      setMedia(fresh);
      setNotice({ tone: "ok", text: `Uploaded ${res.count} audio file${res.count === 1 ? "" : "s"} — find it in Sound.` });
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setUploadingAudio(false);
    }
  }
```

> NOTE for the executor: confirm `uploadFilesDirect`'s return shape exposes `.files` (a `FinalizedUpload[]`) — read `apps/web/lib/direct-upload.ts` for the exact field name and adjust `outcome.files` if it differs. The `finalizeCandidateUploads` signature is `(projectId, promptText, entityIds, raw)` (upload-actions.ts:83).

- [ ] **Step 6: Ducking toggle handler** — set `audioRole` on the music track in the merged edit. Add near `appendAudioAsset`:

```tsx
  // EP4 ducking: toggle whether an audio track is the "music" bed ducked under
  // voice. Sets track.audioRole; reloads the edit. Only one music track allowed.
  async function setAudioTrackRole(trackIndex: number, role: "voice" | "music" | undefined) {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return;
    if (!flushNative()) return;
    opLock.current = true;
    try {
      const base = currentMergedEdit();
      if (!base) return;
      const tracks = base.timeline.tracks.map((t, i) => (i === trackIndex ? { ...t, audioRole: role } : t));
      const next = { ...base, timeline: { ...base.timeline, tracks } };
      const parsed = artlioEdit.safeParse(next);
      if (!parsed.success) { setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "Invalid role." }); return; }
      commitState(parsed.data);
      selfReload.current = true;
      try { await reloadFromEdit(parsed.data); } finally { selfReload.current = false; }
    } finally {
      opLock.current = false;
    }
  }
```

> NOTE: `reloadFromEdit` (L517–526) re-seeds `transitions` from track 0 but does NOT track `audioRole` in React (it lives only in the contract, re-read each time via `currentMergedEdit` → `getEdit()`). HOWEVER, Shotstack's `getEdit()` STRIPS `audioRole` (it's an unknown track field, same as `transitions`). So `audioRole` must ALSO live in React state and be re-merged. Add an `audioRoles` React state keyed by track index (mirroring the `transitions` pattern), seed it in `reloadFromEdit`, and merge it in `currentMergedEdit` alongside `transitions`. The executor MUST wire this exactly like `transitions` — verify against the EP1 transition-state plumbing (currentMergedEdit L416–417, reloadFromEdit L521–522, commitTransitions L489–510) and add a parallel `audioRoles` set. This is the single subtlest part of Task 8.

- [ ] **Step 7: Export XML handler** — client-side Blob download (same pattern as the render Download link). Add near `exportCut`:

```tsx
  function exportXml() {
    const snap = snapshot();
    if (snap.error || !snap.edit) { setNotice({ tone: "warn", text: snap.error ?? "Fix the cut first." }); return; }
    const xml = editToFcpXml(snap.edit, { sequenceName: "Artlio cut" });
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "artlio-cut.xml";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setNotice({ tone: "ok", text: "Exported FCP7 XML — import into Premiere/Resolve, re-link media by filename." });
  }
```

- [ ] **Step 8: Output control in the toolbar** — add before the Export MP4 button (before L968) three small selects bound to `output`:

```tsx
        <select value={output.aspectRatio} onChange={(e) => { setOutput({ ...output, aspectRatio: e.target.value as ArtlioEdit["output"]["aspectRatio"] }); setDirty(true); }} aria-label="Aspect ratio" style={{ font: "var(--text-caption)" }}>
          <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
        </select>
        <select value={output.resolution} onChange={(e) => { setOutput({ ...output, resolution: e.target.value as ArtlioEdit["output"]["resolution"] }); setDirty(true); }} aria-label="Resolution" style={{ font: "var(--text-caption)" }}>
          <option value="sd">SD</option><option value="hd">HD 720</option><option value="1080">1080 (renders at 720 — beta)</option>
        </select>
        <select value={output.fps} onChange={(e) => { setOutput({ ...output, fps: Number(e.target.value) as ArtlioEdit["output"]["fps"] }); setDirty(true); }} aria-label="FPS" style={{ font: "var(--text-caption)" }}>
          <option value={25}>25fps</option><option value={30}>30fps</option>
        </select>
        <Button variant="glass" size="sm" onClick={exportXml} disabled={status !== "ready" || busy} title="Export FCP7 XML for Premiere/Resolve">Export XML</Button>
```

- [ ] **Step 9: The Sound aside** — add after the Transitions aside (after L1042), a sibling `<aside>` matching the Transitions styling. It (a) surfaces `media.filter(m => m.kind === "audio")` with an audio glyph + an "add" button → `appendAudioAsset`, (b) an "Upload audio" file input → `uploadAudio`, (c) per-audio-track ducking toggle → `setAudioTrackRole`. Build the audio-track list from the live edit (`currentMergedEdit()?.timeline.tracks` filtered to audio tracks). Concretely:

```tsx
          {/* Sound tab — audio assets, upload, place on an audio track, ducking */}
          <aside style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", flex: "none" }}>
              <MonoLabel>Sound</MonoLabel>
              <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
                {uploadingAudio ? "Uploading…" : "Upload"}
                <input type="file" accept="audio/*" multiple hidden disabled={uploadingAudio} onChange={(e) => uploadAudio(e.target.files)} />
              </label>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {media.filter((m) => m.kind === "audio").length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No audio yet — upload a track, or generate audio in Gen space.</p>
              ) : media.filter((m) => m.kind === "audio").map((m) => (
                <button key={m.id} onClick={() => appendAudioAsset(m)} disabled={status !== "ready"}
                  draggable onDragStart={(e) => setDnd(e.dataTransfer, { kind: "editor-clip", src: m.src, clipKind: "audio", seconds: m.seconds })}
                  style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", font: "var(--text-caption)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "7px 10px", cursor: "pointer" }}>
                  <span aria-hidden>♪</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{Math.round(m.seconds)}s clip</span>
                  <span aria-hidden style={{ color: "var(--fg-3)" }}>+</span>
                </button>
              ))}
              {/* Ducking: list audio tracks with a music/voice toggle */}
              {(() => {
                const tracks = currentMergedEdit()?.timeline.tracks ?? [];
                const audioTracks = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.clips.length > 0 && t.clips.every((c) => c.asset.type === "audio"));
                if (audioTracks.length === 0) return null;
                return (
                  <section style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <MonoLabel>Ducking</MonoLabel>
                    {audioTracks.map(({ t, i }) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)" }}>
                        <span style={{ flex: 1 }}>Track {i + 1}</span>
                        <select value={(t as { audioRole?: string }).audioRole ?? ""} onChange={(e) => setAudioTrackRole(i, (e.target.value || undefined) as "voice" | "music" | undefined)} aria-label={`Track ${i + 1} role`} style={{ font: "var(--text-caption)" }}>
                          <option value="">none</option><option value="voice">voice</option><option value="music">music (duck)</option>
                        </select>
                      </div>
                    ))}
                    <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Mark the bed “music” to dip it under voice.</p>
                  </section>
                );
              })()}
            </div>
          </aside>
```

- [ ] **Step 10: Inspector — expose volume on audio clips** — widen `hasAudio` (L1124):

```tsx
            const hasAudio = type === "video" || type === "audio"; // EP4: audio-track clips expose volume too
```

(The `applyVolume` handler L614–634 already patches `asset.volume` on the selected clip regardless of type — no change needed there.)

- [ ] **Step 11: Timeline drop branch** — in the drop handler (L1067–1073), route audio payloads to `appendAudioAsset`:

```tsx
              if (payload?.kind === "editor-clip" && handles.current && status === "ready") {
                if (payload.clipKind === "audio") void appendAudioAsset({ id: "", src: payload.src, kind: "audio", seconds: payload.seconds });
                else void appendAsset({ id: "", src: payload.src, kind: payload.clipKind, seconds: payload.seconds });
              }
```

- [ ] **Step 12: Approx preview toggle + `<video>` player** — add a toggle state near `output`:

```tsx
  const [approxPreview, setApproxPreview] = useState(false);
```

a toolbar toggle (near the Output selects, Step 8):

```tsx
        <label style={{ font: "var(--text-caption)", color: "var(--fg-2)", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={approxPreview} onChange={(e) => setApproxPreview(e.target.checked)} /> Approx preview (no effects)
        </label>
```

and a sequential `<video>` player rendered ABOVE the studio canvas when `approxPreview` is on. It plays the visual track's clips back-to-back honoring `trim` + `length` (no transitions/overlays/ducking — the label says so):

```tsx
          {approxPreview && (() => {
            const vts = currentMergedEdit()?.timeline.tracks.find((t) => t.clips.some((c) => c.asset.type !== "audio"));
            const clips = vts ? [...vts.clips].sort((a, b) => a.start - b.start) : [];
            return <ApproxPreview clips={clips} />; // small local component, defined below
          })()}
```

Define a small local `ApproxPreview` component (above `Editor` or as a top-level component in the file) that holds an index, renders one `<video>` with `src = clips[idx].src` muted=false, sets `currentTime = trim ?? 0` on `loadedmetadata`, and on `timeupdate` advances when `currentTime >= (trim ?? 0) + length`, looping back to 0 at the end. ~40 lines. (It is read-only; it does not touch the contract or Shotstack.)

```tsx
function ApproxPreview({ clips }: { clips: ArtlioClip[] }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { setIdx(0); }, [clips]);
  const cur = clips[idx];
  useEffect(() => {
    const v = ref.current; if (!v || !cur) return;
    const trim = cur.asset.trim ?? 0;
    const onMeta = () => { v.currentTime = trim; void v.play().catch(() => {}); };
    const onTime = () => { if (v.currentTime >= trim + cur.length) setIdx((i) => (i + 1) % Math.max(1, clips.length)); };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    return () => { v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("timeupdate", onTime); };
  }, [cur, clips.length]);
  if (!cur) return <p style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>No visual clips to preview.</p>;
  return (
    <div style={{ marginBottom: 8 }}>
      <video ref={ref} src={cur.asset.src} playsInline controls style={{ width: "100%", borderRadius: "var(--radius-md)", background: "#000" }} />
      <p style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)", margin: "4px 0 0" }}>Approx clip {idx + 1}/{clips.length} — transitions, captions & ducking not shown.</p>
    </div>
  );
}
```

- [ ] **Step 13: Typecheck the whole web app + core**

Run: `pnpm --filter @artlio/core build && pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 14: Commit** (leave for user approval)

```bash
git add apps/web/components/Editor.tsx apps/web/lib/actions.ts
git commit -m "feat(editor): EP4 web — Sound tab (audio surface/upload/place/volume/ducking) + Output presets + Export XML + approx preview"
```

---

## Task 9: $0 local verify — ducking render + XML round-trip + no-spend grep

**Files:**
- Create: `scripts/local-ep4-audio-export-verify.mjs`

> **Stale-worker safety (memory lesson):** BEFORE running, kill any leftover fal/worker process so nothing burns real money. `pgrep -fl "tsx.*worker|node.*worker/dist" || echo "no worker running"` — kill any hit. This script never starts a worker; it shells `ffmpeg` directly with LOCAL fixtures (no fal, no provider, `GENERATION_PROVIDER` irrelevant — no generation call is made).

- [ ] **Step 1: Write the verify script** — create `scripts/local-ep4-audio-export-verify.mjs`. It (a) synthesizes a short silent-ish video + a music tone + a voice tone with ffmpeg `lavfi`, (b) builds the SAME audio mix filtergraph the worker builds for a music+voice ducking edit, runs ffmpeg, asserts the output duration == `renderDuration` (within tolerance) AND the music track's RMS during the voice window is LOWER than during a voice-free window (ducking proof), (c) calls `editToFcpXml` on a fixture and asserts the string XML-parses + contains the expected frames, (d) greps EP4 files for any spend token. Skeleton:

```js
import { execa } from "execa";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editToFcpXml, renderDuration, artlioEdit } from "../packages/core/dist/index.js";

const root = path.resolve(import.meta.dirname, "..");
const work = await mkdtemp(path.join(tmpdir(), "ep4-verify-"));
const fail = (m) => { console.error("FAIL " + m); process.exit(1); };

try {
  // --- 1) synth fixtures: 6s color video (silent), 6s music tone, a 2-4s voice tone
  const vid = path.join(work, "vid.mp4");
  const music = path.join(work, "music.wav");
  const voice = path.join(work, "voice.wav");
  await execa("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=6:r=25", "-pix_fmt", "yuv420p", vid]);
  await execa("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", music]);
  // voice only between t=2 and t=4 (silence-padded) so we can compare ducked vs un-ducked windows
  await execa("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-af", "adelay=2000:all=1,apad=whole_dur=6", voice]);

  // --- 2) build the ducking mix EXACTLY as buildAudioMix does and render
  const out = path.join(work, "out.mp4");
  const renderSeconds = 6;
  const graph = [
    "[1:a]aresample=async=1:first_pts=0,volume=1[am]",   // music bed
    "[2:a]aresample=async=1:first_pts=0,volume=1[av]",   // voice
    "[av]asplit=2[vkey][vout]",
    "[am][vkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck]",
    `[vout][duck]amix=inputs=2:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`,
  ].join(";");
  await execa("ffmpeg", ["-y", "-i", vid, "-i", music, "-i", voice, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);

  // --- 3) assert duration ≈ renderSeconds
  const { stdout: dur } = await execa("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out]);
  if (Math.abs(Number(dur) - renderSeconds) > 0.5) fail(`output duration ${dur}s != ~${renderSeconds}s`);

  // --- 4) ducking proof: RMS over the voice window (2-4s) < RMS over a voice-free window (4.5-5.5s)
  const rms = async (ss, t) => {
    const { stderr } = await execa("ffmpeg", ["-ss", String(ss), "-t", String(t), "-i", out, "-af", "astats=metadata=1:reset=1", "-f", "null", "-"], { reject: false });
    const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr);
    return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : NaN;
  };
  const duckedWin = await rms(2, 1.5);   // music ducked here (voice present)
  const freeWin = await rms(4.5, 1.0);   // music not ducked here (voice gone)
  if (!(duckedWin < freeWin - 0.5)) fail(`ducking not detected: voice-window RMS ${duckedWin}dB not below free-window RMS ${freeWin}dB`);
  console.log(`PASS ducking — music ${duckedWin.toFixed(1)}dB under voice vs ${freeWin.toFixed(1)}dB free.`);

  // --- 5) XML round-trip: editToFcpXml output XML-parses + has expected frames
  const HASH = "a".repeat(64);
  const fixture = artlioEdit.parse({
    timeline: { background: "#000000", tracks: [
      { clips: [{ asset: { type: "video", src: `/files/u/founder/${HASH}.mp4`, trim: 1.5 }, start: 0, length: 4 }] },
      { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 4 }], audioRole: "music" },
    ] },
    output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
  });
  const xml = editToFcpXml(fixture);
  if (!xml.includes("<xmeml version=\"5\">")) fail("xml missing xmeml v5 root");
  if (!xml.includes("<in>37</in>")) fail("xml missing frame-accurate in (1.5s*25=37)");
  if (!/lossy[\s\S]*ducking/i.test(xml)) fail("xml comment must note dropped ducking");
  console.log(`PASS editToFcpXml — XML well-formed, frame-accurate, lossy-comment present (renderDuration=${renderDuration(fixture)}s).`);
} finally {
  await rm(work, { recursive: true, force: true });
}

// --- 6) no-spend grep on EP4-touched files
const files = [
  "packages/core/src/timeline.ts", "packages/core/src/nle-export.ts",
  "apps/worker/src/jobs/render.ts", "apps/web/lib/actions.ts", "apps/web/components/Editor.tsx",
];
const { stdout } = await execa("grep", ["-nE", "startGen|GenJob|createGenJob|fal\\.|@fal|coworkGenerate|fal-media|falApi", ...files], { cwd: root, reject: false });
if (stdout.trim()) fail("no-spend grep — EP4 files reference a spend path:\n" + stdout);
console.log("PASS no-spend — EP4 files reference no fal/generation/spend path.");
```

- [ ] **Step 2: Kill stale workers, build core, run the verify**

Run: `pgrep -fl "tsx.*worker|node.*worker/dist" || echo "no worker running"`
Then: `pnpm --filter @artlio/core build && node scripts/local-ep4-audio-export-verify.mjs`
Expected:

```
PASS ducking — music -XX.XdB under voice vs -YY.YdB free.
PASS editToFcpXml — XML well-formed, frame-accurate, lossy-comment present (renderDuration=4s).
PASS no-spend — EP4 files reference no fal/generation/spend path.
```

(If `sidechaincompress` was absent in Task 0, this script's ducking section can't run — report that and rely on the worker-image guarantee + the Task 1/6 unit tests; do NOT skip the XML + no-spend checks.)

- [ ] **Step 3: Full local gate**

Run: `pnpm --filter @artlio/core test && pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/worker typecheck && pnpm --filter @artlio/worker build && pnpm --filter web typecheck && pnpm --filter web build`
Expected: all green.

- [ ] **Step 4: Commit** (leave for user approval)

```bash
git add scripts/local-ep4-audio-export-verify.mjs
git commit -m "test(editor): EP4 $0 verify — ducking RMS proof + editToFcpXml round-trip + no-spend grep"
```

---

## Task 10: Manual-QA checklist + Codex gate (STOP before deploy)

**Files:** none (a QA checklist + the gate).

- [ ] **Step 1: Manual QA** (local dev, `GENERATION_PROVIDER=mock`, a project with ≥2 generated video clips + at least one generated/uploaded audio file). Walk and confirm:
  1. **Surface audio:** the Sound aside lists audio assets (mp3/wav/etc.) with a ♪ glyph; they do NOT appear in the Assets (image/video) panel.
  2. **Upload audio:** "Upload" in Sound → pick an mp3 → finalize → the Sound list refreshes with the new clip (and its duration is non-zero after ingest probes it; may take a moment).
  3. **Place audio:** click (or drag) an audio clip → it lands on its OWN audio track (a 2nd track row in the timeline), NOT track 0; placing a 2nd different audio creates the 2nd audio track; a 3rd is refused with a notice (≤2 audio tracks).
  4. **Per-clip volume:** select an audio-track clip → the Inspector "Audio" section shows the volume slider + Mute; changing it persists (Save → no contract error).
  5. **Ducking:** mark the music track "music (duck)" and (if present) the other "voice"; Export MP4 → the rendered mp4's music audibly dips when the voice plays. With NO role set, the mix is unchanged (flat).
  6. **Output presets:** change aspect to 9:16 → Export MP4 → the render is portrait; resolution "1080 (renders at 720 — beta)" still renders (at 720); fps 30 applies. The edit is marked dirty when a preset changes.
  7. **Export XML:** click "Export XML" → an `artlio-cut.xml` downloads; open it → it's `xmeml version="5"` with one clipitem per visual+audio clip and the lossy comment. (Optionally import into Resolve/Premiere and re-link to confirm.)
  8. **Approx preview:** toggle "Approx preview (no effects)" → a `<video>` plays the visual clips back-to-back honoring trim; the label says effects aren't shown. Toggling off returns to the studio canvas.
  9. **No spend:** the Network tab shows NO generation/fal endpoint call during any Sound/Output/Export action — only `getEditorMedia`, `uploadFilesDirect`/`finalizeCandidateUploads` (upload), `saveProjectEdit`/`startRender` (save/export MP4). XML export and approx preview make NO server call at all.

- [ ] **Step 2: Codex gate (REQUIRED before any deploy)** — run `/codex` on the EP4 diff. Gate focus:
  1. **No spend path introduced** (Task 9 grep) — audio upload reuses the UPLOAD/ingest $0 path; ducking is render-only; XML/preview are client-only. No `startGen`/`createGenJob`/fal token anywhere in the diff.
  2. **Worker safety:** ducking adds NO ffmpeg input, the `atrim=0:${renderSeconds}[a]` + `-map [a]` tail is preserved, the flat-mix default is byte-identical for non-ducked edits, the 10-min execa timeout + 720p cap + transition guards are untouched. `sidechaincompress` availability is documented (Task 0 + the render.ts comment). The >1-music-track drift guard throws cleanly into the existing catch.
  3. **Contract additive + backward-compat:** `track.audioRole?` is optional; absence = flat mix; every legacy stored edit still `artlioEdit.parse`s; `output` presets unchanged. No prisma migration, no new queue/job.
  4. **Audio placement correctness:** `appendAudioAsset` never puts audio on the visual track; respects ≤2 audio tracks / ≤3 tracks; the new edit re-parses valid; `audioRole` is plumbed in React (like `transitions`) because Shotstack strips it.
  5. **XML correctness:** frame math (trim/length/start × fps) is right; XML-special chars escaped; the export is honestly labeled lossy with the dropped-features comment.
  6. Standard build/typecheck/test gate green.

- [ ] **Step 3: STOP.** Do not deploy until the user authorizes after the Codex gate passes. **EP4 deploys BOTH services:** the worker (the `render.ts` ducking change must ship) AND web (the Sound aside / Output / Export XML / un-filtered media). Deploy-order rule: worker first (it owns queue creation + must understand the new mix path before web sends edits carrying `audioRole`), then web — same ordering EP1 used. The contract change is additive, so an old worker would simply ignore `audioRole` and flat-mix (safe), but ship the worker first to get real ducking.

---

## Self-Review

**1. Spec coverage** (against the approved EP4 scope):

- §EP4(1) Sound tab — un-filter audio (`getEditorMedia`) → Task 7; audio upload (existing contract) → Task 8 Steps 5+9; audio-track creation + placement (≤2 audio tracks, per-clip volume, amix) → Task 8 Steps 4+10+11; respect EP1 rendered-time mapping → audio flows through the UNCHANGED `audioChain`/`renderedStartSeconds`/`renderSeconds` (Tasks 2–5 only re-partition the MIX, never the per-clip placement). Auto-ducking via `sidechaincompress` as a toggle → Task 1 (contract) + Tasks 2–5 (worker) + Task 8 Step 6+9 (toggle). ✓
- §EP4(2) Export — keep RenderJob path (`startRender` untouched) → confirmed (Task grounding); ADD Premiere/Resolve XML = pure `ArtlioEdit → XML` no render → Task 6 (`editToFcpXml`) + Task 8 Step 7 (client download); aspect/resolution presets first-class → Task 8 Steps 3+8; revisit the 1080 cap → Decision 4 (kept honestly, labeled "renders at 720 — beta", XML uses true res). ✓
- §EP4(3) Preview — approximate sequential `<video>` playthrough, NO real-time compositing (Remotion deferred) → Decision 2 + Task 8 Step 12 (`ApproxPreview`, visual track back-to-back, explicitly "no effects"). ✓

**2. House-rule coverage:**
- Money-safety #1 (no spend path; renders+captions stay $0; never call fal/startGen/createGenJob) → Tasks 2–8 add ffmpeg/contract/UI only; Task 9 greps to prove it; Task 10 gate 1. ✓
- Worker safety (bounded ffmpeg; ducking is a filter inside the EXISTING render job, no new queue; no new input; tail preserved) → Tasks 3–5 + Task 0 (sidechaincompress confirmed) + Task 4 guard. No transcript cache needed (EP4 adds no transcription — that's EP3/whisper). ✓
- Contract additive + backward-compat (`audioRole?` optional, absence=flat mix; `output` unchanged; no migration for editJson) → Task 1 + its backward-compat test. ✓
- TDD for core (vitest) → Task 1 (audioRole) + Task 6 (editToFcpXml). Render/ducking correctness by a LOCAL $0 ffmpeg run asserting the effect (RMS ducking proof) + no-spend → Task 9. Kill stale fal workers first → Task 9 Step 2. ✓
- Surgical (match render.ts/Editor.tsx style; no auto-commit/push — every git step is the USER's) → every commit step says "leave for user approval". ✓
- STOP for /codex render-correctness + no-spend gate before deploy → Task 10. ✓
- Codegraph-grounded file:symbol → the Grounding section cites exact lines from timeline.ts, render.ts, actions.ts, Editor.tsx, upload-actions.ts, ingest.ts, the queue wiring, the Dockerfile.

**3. Placeholder scan:** No "TBD/similar to Task N". Every code step is complete code with exact commands + expected output. The two explicit executor NOTES (Task 8 Step 5 `outcome.files` field name; Task 8 Step 6 the `audioRoles` React-state plumbing) are flagged as "verify against X" with the exact reference — they are real verification steps, not placeholders, because the precise field name (`uploadFilesDirect` return) and the exact mirror of the `transitions` plumbing must be read from the live code, not guessed.

**4. The subtle correctness risks called out:**
- (a) **`audioRole` must live in React like `transitions`** — Shotstack `getEdit()` strips unknown track fields (the same reason `transitions` lives outside Shotstack). Task 8 Step 6 NOTE makes this the single most important wiring detail and points to the exact `transitions` plumbing to mirror. Without it, ducking would silently reset on every reload.
- (b) **The flat-mix default must be byte-identical** for non-ducked (every legacy) edit — `buildAudioMix` returns the SAME single `amix … atrim=0:${renderSeconds}[a]` line when not duckable; Task 5 Step 5 re-runs the EP1 verify to confirm no regression.
- (c) **The `-map [a]` tail is load-bearing** — every `buildAudioMix` branch ends its final node `[a]`; Task 5 Step 3 explicitly re-reads L297–302 to confirm the argv is untouched.

---

## Notes for the executor (real-code deltas vs the brief's assumptions)

- **The worker is ALREADY audio-capable** — `render.ts` renders audio-track clips with volume, per-transition crossfade, and rendered-time `adelay` + `amix` (EP1). EP4's ONLY worker change is partitioning the single `amix` into a ducked sub-mix. Per-clip audio placement, `renderedStartSeconds`, and `renderSeconds` are reused verbatim — do NOT touch them.
- **`getEditorMedia` is the ONLY place audio is dropped** — `apps/web/lib/actions.ts:762` `return []; // skip audio/unknown`. Un-filtering there (Task 7) surfaces every already-stored audio Generation (uploads land as `source:"UPLOAD"` Generations with `durationS` from the ingest probe).
- **Audio CANNOT use the SDK's `addClip`** — `addClip(trackIdx, …)` targets an existing track index and audio is forbidden on track 0 (the visual track). `appendAudioAsset` builds the next `ArtlioEdit` in JS and pushes it via `reloadFromEdit` (the EP2 op pattern) — the robust, SDK-bypassing path.
- **`audioRole` (and `output`) live in React state and merge in `currentMergedEdit`** exactly like `transitions` — Shotstack strips both. `reloadFromEdit` already re-seeds `transitions` from track 0; the executor adds a parallel re-seed for `audioRoles` and merges `output` (Task 8 Steps 3+6).
- **No new pg-boss job/queue, no migration, no env var** — ducking is a filter in the existing render job; audio upload is the existing ingest path; XML export + approx preview are client-only. (The whisper.cpp transcription job in the architecture map is an EP3 concern; EP4 does not add it.)
- **EP3-on-top:** if EP3 has shipped, `editToFcpXml` already lists `captions`/`textOverlays` in its dropped-features comment (Task 6 reads `timeline.captions`/`timeline.textOverlays` defensively via a cast, so it works whether or not EP3 is present). The render-side burn-in seam EP3 added (post-`vLabel`) is on the VIDEO graph; EP4 ducking is on the AUDIO graph — disjoint, no conflict.
- **`@artlio/core build` before any web/worker typecheck or the verify script** — both consume the BUILT `dist` of core; the verify script imports `packages/core/dist/index.js` directly.
- **Spend path stays isolated** — `startGen` (`gen-actions.ts`) is reached only from `coworkGenerate`; the editor's save/render/upload/export paths never call it and EP4 adds nothing that does (Task 9 grep proves it).
