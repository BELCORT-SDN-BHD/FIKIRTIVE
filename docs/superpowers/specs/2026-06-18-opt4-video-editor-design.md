# OPT-4 — LTX-style Video Editor (incremental cheap-wins) — Design Spec

**Goal:** Push Fikirtive's editor from an assembly-cut tool to an LTX-style editor — real transitions, editing feel (split/ripple/snapping), captions + text, music + ducking, approximate preview, and a Premiere/Resolve XML escape hatch — entirely on the existing $0 self-hosted ffmpeg render path, without building a real-time preview engine and without adding any paid-spend path.

**Architecture:** The zod edit contract (`packages/core/src/timeline.ts`) stays the single source of truth and evolves additively. The timeline UI keeps the Shotstack Studio SDK where it can carry the new gestures (probe first, custom-fallback per feature). All new effects are ffmpeg filtergraphs in the existing render worker (`apps/worker/src/jobs/render.ts`). The UI is re-laid-out to the LTX structure (Assets / Sound / Transitions tabs + a top bar). Real-time co-editing ("Collaborate") and multi-tenancy are OUT of scope (a separate platform track).

**Tech Stack:** Next.js 16 (customized — read `node_modules/next/dist/docs/` before route/page code), Shotstack Studio SDK (existing), ffmpeg in `apps/worker` (existing, apt-installed), Prisma 7 + Neon (additive migrations only), self-hosted `whisper.cpp` for captions (new, $0), `packages/core` vitest.

**Scope note:** ONE design spec covering the cheap-wins column, decomposed into 4 independently-shippable phases (EP1–EP4). Each phase → its own writing-plans implementation plan + subagent-driven build + Codex gate + (authorized) deploy. Do not build it as one change.

**Provenance:** 2026-06-18 deep-research workflow (current-editor architecture map + LTX-UX/feature tiers + ffmpeg transition mechanics) + the user's LTX Studio editor screenshots (the reference) + this brainstorm + a **Codex spec review (v2 folds its BLOCKER + STRONGs)**: transitions stored outside Shotstack state, `renderDuration()` helper, gapless-adjacency, full xfade+audio normalization, EP2 custom-not-Shotstack for split/ripple, EP3 captions as a separate cached job, EP4 audio surfacing. Prior decision doc: `docs/research/video-editor-feasibility.md` (Options A–E + validation gates) — this spec extends it; do not re-litigate.

---

## 0. Load-bearing principles (every phase preserves)

1. **The contract is ours + evolves additively.** `timeline.ts` (`FikirtiveEdit`) is the source of truth; the worker re-parses `fikirtiveEdit.parse(...)` before render. New fields are additive + bounded (unbounded values validate into impossible ffmpeg argv).
2. **$0 renders, no spend path added.** All effects are ffmpeg filtergraphs on homogeneous AI-generated H.264; renders run self-hosted in the worker (no fal, no per-render API cost). The one new dependency (captions) uses self-hosted `whisper.cpp` ($0), not a paid transcription API. Money-safety risk on this track is LOW; Codex gates focus on render correctness + "no spend path introduced" + additive contract.
3. **Probe Shotstack, then custom per-feature.** Keep the Shotstack timeline/canvas where it carries the gesture; where its public API can't (it has no documented pixel→time mapping — see `docs/superpowers/specs/2026-06-13-editor-storyboard-drag-drop-design.md`), build a custom interaction layer over our own contract for that feature.
4. **Buy-don't-build the real preview engine — and defer it.** No frame-accurate real-time scrub/compositing engine in this track (the "war-story graveyard"). Preview = an approximate sequential-`<video>` playthrough. A real engine (Remotion Player, bought) is gated behind the feasibility doc's validation trigger.
5. **LTX-light, not an NLE.** Match LTX's deliberate scope: assemble + trim + transition + sound + caption + export; single visual track; no camera-footage import; no keyframes/PiP/multi-video-track. The CapCut-feel wins (split/ripple/snapping) are the ceiling.
6. **Out of scope (separate tracks):** Collaborate / real-time co-editing + multi-tenancy → `[[platform-multi-tenancy]]`. Real preview engine, keyframed effects, multi-video-track/PiP, animated text, speed-ramp, Sound library SEARCH (upload-first; a licensed music library is later), Pitch Deck export.

---

## 1. The LTX UI target (from the reference screenshots)

The editor surface is re-laid-out to mirror LTX Studio's editor:

- **Top bar:** aspect-ratio chip (16:9 / 9:16 / 1:1), Background color, undo/redo, **Export**. (LTX's "Collaborate" is omitted — out of scope.)
- **Left context panel, 3 tabs** (ours to build; the timeline canvas below stays Shotstack-or-custom):
  - **Assets** — the project's generated clips (from Gen/Storyboard) + Upload; drag onto the timeline. (≈ today's Editor assets panel, restyled.)
  - **Sound** — Soundtrack / Sound effects toggle + (upload-first; search-music deferred) drag/upload a sound file onto an audio track.
  - **Transitions** — a tile library: **None, Fade, Slide, Wipe, Flip, Clock Wipe, Iris** + "Clear all transitions"; applied at a selected clip boundary.
- **Center:** preview canvas + transport (play, `mm:ss / mm:ss` timecode, zoom slider, volume, fullscreen).
- **Bottom timeline:** seconds ruler, a single video track (clip blocks + per-clip audio indicator), `+` to add a clip, zoom.

The left icon rail (storyboard / gen / frames / media / timeline / @elements) is Fikirtive's existing studio nav — the editor is one surface within it.

*Visual-parity note (Codex NIT):* we match LTX's STRUCTURE, not pixel-exact chrome. Items visible in the reference but intentionally deferred/visual-only (call out in each plan so they aren't surprise scope): the Sound "Search music" box (upload-first; catalog later), the exact rail iconography, and "Collaborate" (out of scope, §0.6).

---

## 2. Contract evolution — between-clip transitions (the EP1 foundation)

Today `transition` is a per-clip in/out **fade-to-black** (`timeline.ts`), and overlapping clips are rejected. Real transitions (cross-dissolve, slide, wipe, flip, clock-wipe, iris) are a relationship BETWEEN two adjacent clips and require the renderer to overlap them by the transition duration.

**Design:** keep clips non-overlapping in the contract; add a between-clip transition as a **TRACK-LEVEL array, NOT a clip field**:
```
track.transitions?: [{ fromClipIndex, toClipIndex, type: "cross"|"slide"|"wipe"|"flip"|"clockwipe"|"iris"|"fade", durationMs, direction? }]
```
bound `durationMs ≤ TRANSITION_MAX` and `≤ min(adjacent clip lengths)/2`.

**BLOCKER fix — transitions live OUTSIDE Shotstack state (Codex).** The editor round-trips through the Shotstack `Edit` object (`Editor.tsx` `new Edit(startEdit)` → save `edit.getEdit()`), and Shotstack's clip schema is **strict — it strips unknown fields**. So transition data must NOT ride on a Shotstack clip. EP1 keeps transitions in Fikirtive-owned state (React + the FikirtiveEdit `track.transitions` array), and `saveProjectEdit` MERGES: take the clip list from Shotstack's `getEdit()` + the Fikirtive transition array → the persisted `FikirtiveEdit`. The Shotstack `Edit` never carries transitions (so it can't strip them). Consequence: the Shotstack timeline won't natively render the between-clip transition marker — EP1 draws it with our own overlay/indicator (and this is one reason EP2 may move the timeline track custom).

**`renderDuration()` is a first-class helper (Codex).** Today `editDuration()` = max(`start+length`) and the worker uses it for audio trim, progress, and the stored asset duration (`render.ts`). With transitions overlapping, the OUTPUT is shorter: add `renderDuration(edit)` = `editDuration − Σ transition durations` and use it everywhere render-output duration matters (audio `atrim`, `-progress` total, the stored `durationS`). `editDuration` stays for the timeline-layout length.

**Gapless adjacency (Codex).** The contract rejects overlaps but ALLOWS visual gaps, and the renderer currently ignores `start` (sorts clips + concats — there's already a backlog item "export ignores timeline gaps"). A transition is only meaningful between two **gapless-adjacent** clips. EP1 defines "adjacent" = consecutive with no gap, and ENFORCES a gapless visual track for LTX-light (validation: visual clips tile with no gap; or normalize gaps to 0 on save). This also closes the pre-existing gap-ignore bug as part of EP1.

The legacy per-clip fade-to-black stays valid (backward-compat). Validation: a transition references two real gapless-adjacent clips; duration guards prevent `offset` ≥ clip length.

**Transition → ffmpeg `xfade` mapping** (the LTX 7 tiles):
| LTX tile | xfade `transition=` |
|---|---|
| None | (hard cut, no xfade) |
| Fade | `fade` |
| Slide | `slideleft`/`slideright`/`slideup`/`slidedown` (by direction) |
| Wipe | `wipeleft`/`wiperight`/`wipeup`/`wipedown` |
| Clock Wipe | `radial` |
| Iris | `circleopen` / `circleclose` |
| Flip | no native xfade equivalent → **approximate** (e.g. `slidedown` + a flip-ish curve, or a custom filter); ship as best-effort + note the approximation, or defer Flip if it doesn't read well. |
Audio under a video transition uses `acrossfade` over the same overlap.

---

## 3. Phase decomposition (each = its own plan + Codex gate + deploy)

### EP1 — Real transitions (真·转场)
- Contract: the between-clip transition (§2), additive + bounded, with guards. Core zod tests.
- Worker: rewrite `render.ts`'s filtergraph from `concat` to a CHAINED `xfade` per transition (cut clips still concat). FULL per-clip normalization BEFORE each xfade (Codex): scale/pad + `setsar` + fps + **`format=yuv420p` + `settb` + `setpts=PTS-STARTPTS`** (the final `-pix_fmt` is encoder-only and not enough). Compute each `xfade offset` from the preceding (rendered) timeline position. Use `renderDuration()` for the `-progress` total + the stored duration.
- Worker AUDIO timing (Codex — more than "add acrossfade"): once video transitions shrink time, BOTH native clip audio and external audio-track clips must be re-mapped to the RENDERED timeline (their delays shift by the cumulative transition overlap), with `acrossfade` over each video-transition overlap, **silence-fill (`anullsrc`) for clips with no audio**, and sample-rate/format normalization (`aresample`) before `amix` — else audio drifts at every transition. Spell out the rendered-time mapping.
- Guards: transition `durationMs` ≥ either adjacent clip length, non-gapless-adjacent pair, mismatched dims → reject/clamp.
- UI: the **Transitions** tab (the 7-tile library) + apply-at-boundary + "Clear all"; show the transition on the timeline between clips.
- Test: a local render of a 2-clip edit with each transition type produces a valid mp4 with the visible effect (small fixtures; $0; assert ffprobe duration = Σ clip − Σ transition).

### EP2 — Editing feel (编辑手感) — Shotstack probe (narrowed per Codex)
- Reality (Codex, from the installed SDK types): Shotstack DOES expose clip delete/move/update + **undo/redo** — use those. But its public `Timeline` API is only load/dispose/zoom with **no pixel→time mapping** (confirmed in the DnD spec), so **split / ripple / boundary-transition placement / snapping must be CUSTOM contract ops** — assume custom for those, don't budget on the SDK doing them. (If matching the LTX timeline look also forces it, the timeline track goes fully custom — consistent with "probe then custom".)
- Build over the contract:
  - **Split** = two clips with adjusted `trim`/`start`/`length` (pure contract op).
  - **Ripple-delete** = remove a clip + shift downstream `start`s (pure contract math).
  - **Snapping** = snap clip edges to neighbors/playhead/markers.
  - **Undo/redo** = snapshot the (small JSON) contract on each `edit:changed`.
- Report the probe result in the plan; the UI may go partly custom if Shotstack blocks the gestures (and, if matching the LTX timeline look forces it, a custom timeline track — consistent with "probe then custom").
- Test: contract-level unit tests for split/ripple math; manual gesture QA.

### EP3 — Captions + text (字幕 + 文字叠加)
- Captions: a **SEPARATE transcription job + cache (Codex)** — NOT inline in the render job (render has a 10-min ffmpeg / 15-min queue limit; CPU transcribe + render would blow it). A new pg-boss `caption` job: extract audio → **self-hosted `whisper.cpp`** (static binary + a small model baked into the worker image alongside ffmpeg, runs as `node`; $0) → word/segment timestamps → persist (cache on the asset/clip, keyed by content hash so a re-render reuses it). The RENDER job only consumes the cached transcript → ASS → ffmpeg `subtitles=` burn-in. Bound the model size + transcription time; the worker Dockerfile adds the binary+model. A caption-edit panel (edit text/timing) in the UI; the (possibly-edited) captions live in the contract (additive) so they persist + re-render.
- Static text overlays: contract additive `textOverlays?: [{ text, start, length, position, style }]`; worker `drawtext` (or rendered PNG overlay). Static only (animated text = deferred).
- Test: a render with captions + a text overlay burns them in correctly (fixture + ffprobe/scene check); whisper step is $0 + bounded.

### EP4 — Audio + preview + export (音频 + 预览 + 导出)
- Audio: the **Sound** tab — and it's more than a tab (Codex): today the editor media query FILTERS AUDIO OUT (`actions.ts` getEditorMedia) and `appendAsset` only appends to visual track 0. EP4 must: surface audio assets (un-filter / add an audio source), add audio UPLOAD (the upload contract already allows audio), and add audio-track creation + placement logic (the contract already allows ≤2 audio tracks + per-clip volume + `amix`). Then **auto-ducking** via ffmpeg `sidechaincompress` (music under voiceover) as a toggle. (Audio must respect the EP1 rendered-time mapping.)
- Preview: an **approximate** sequential-`<video>` playthrough (double-buffered) so the user can judge the cut — NOT a real engine.
- Export: keep the existing RenderJob path; ADD a **Premiere/Resolve XML (FCP7 XML / OTIO) export** = a pure `FikirtiveEdit` → XML transform (no render). Surface aspect/resolution presets first-class; revisit the 1080 cap (currently downscales to 720 for OOM — ffmpeg memory tuning, not new code).
- Test: ducking render fixture; XML export validates against an FCP7/OTIO schema + round-trips the clip list; preview plays the cut in order.

---

## 4. Testing strategy + gates

- **Contract:** zod tests for the between-clip transition, captions, textOverlays — additive, bounded, backward-compat with existing edits; `fikirtiveEdit.parse` round-trips.
- **Render correctness ($0):** per phase, a LOCAL ffmpeg render of a small fixture edit asserting the effect (xfade duration math, caption/text burn-in present, ducking applied, export mp4 valid). No fal, no paid path — `GENERATION_PROVIDER=mock` for any adjacent gen; kill stale fal workers first.
- **No-spend invariant:** a check that the editor/render path adds NO call into the fal/generation spend path (renders stay self-hosted ffmpeg; whisper is self-hosted).
- **Codex gate per phase:** focus = render-pipeline correctness + the contract change is additive/bounded + NO spend path introduced + the worker change can't hang/OOM (duration/dimension guards). Plus the standard build/typecheck/test gate.
- House rules: additive migrations LOCAL-first (prod via migrate:deploy + authz); surgical; NO auto-commit/push; Chinese comms / English UI.

---

## 5. Explicitly deferred / out of scope (record, don't build)

- **Collaborate / real-time co-editing + multi-tenancy** → `[[platform-multi-tenancy]]` (a platform-level track: tenancy foundation → async sharing → CRDT/Liveblocks/Cloudflare-DO real-time).
- **Real-time frame-accurate preview/compositing engine** → buy Remotion Player when the feasibility-doc validation trigger fires; never hand-build.
- **Keyframed effects, multi-video-track/PiP, animated text, speed-ramp** → expensive (need the preview engine); LTX itself skips them.
- **Sound library SEARCH** (licensed music catalog) → upload-first now; catalog later.
- **Pitch Deck export, in-context AI re-edit, transcript/script-based editing** → off the critical path.
- **Camera-footage import** → out (homogeneous AI-H.264 is the deliberate superpower, same as LTX).
- **Flip transition** may ship approximate or be deferred if it doesn't read well (EP1).
