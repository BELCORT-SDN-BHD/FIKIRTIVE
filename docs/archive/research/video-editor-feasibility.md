# Fikirtive Decision Document: The Assembly-Cut Editor

**Date:** June 10, 2026
**Question:** Is a web video editor "not that hard"? Should we build one now, and how?
**Method:** Four independent research reports (commercial SDKs, open-source landscape, browser technology, war stories & benchmarks), each adversarially fact-checked against primary sources. Corrections from verification override original claims throughout.

---

## 1. The Honest Difficulty Landscape (2026)

The short version: **"video editing isn't that hard" is half-right, and the half that's right is the half you need.** But the line between the easy half and the hard half is sharp, and every team in the war stories crossed it without noticing.

### What is genuinely commodity now (verified)

| Capability | Why it's commodity | Evidence |
|---|---|---|
| **Server-side assembly-cut export** (trim, concat, crossfade, audio mix, caption burn-in) | Maps directly to well-trodden ffmpeg filtergraphs. You already run ffmpeg 7 on a Railway worker with pg-boss. | Multiple independent builders (VidStudio thread, videotobe.com, Omniclip commenters) abandoned in-browser export and converged on exactly this architecture |
| **Browser media I/O** (read/write MP4, thumbnails, metadata, waveform display) | Mediabunny (MPL-2.0, free for closed-source commercial use, v1.46.0 June 2026) is the de-facto standard — Remotion sponsors it at $1,000/mo and deprecated its own parser in its favor (Feb 2026) | Verified against npm + GitHub + Remotion blog |
| **Raw codec access on desktop browsers** | WebCodecs: Chrome since 2021, Firefox 130+ (Sept 2024), Safari completed audio+video in Safari 26.0 (Sept 2025) | caniuse + WebKit blog, verified |
| **Timeline editor UI as a product category** | Free and cheap embeddable SDKs now exist (Shotstack Studio at $0, see Section 2) | npm/license verification, June 2026 |
| **Audio waveforms** | Precompute peaks server-side (`audiowaveform`, apt-installable on your worker), load instantly in browser | Standard documented pattern |

### What is still genuinely hard

1. **The real-time multi-clip preview engine.** Keeping decoders warm across clip boundaries, prefetching around the playhead, audio/video sync while scrubbing, and transitions (which need *two* simultaneous decode streams). This is where CapCut and Clipchamp — both with specialist teams and existing C++ engines — spent their effort. It is also exactly where OpenCut (55k stars, funded, multi-contributor) stalled for 11 months before declaring a ground-up rewrite in May 2026.

2. **Cross-browser client-side export.** Verified down to the browser source code: AAC encoding via WebCodecs is unavailable on desktop Linux (all browsers) and Firefox (all platforms); Opus is the only portable audio encoder. So "export an MP4 with AAC audio in the browser" — the format every platform wants — is **not reliable cross-browser** and never will be without WASM fallbacks. Firefox can't export H.264 video either (IMG.LY's docs say so explicitly). ffmpeg.wasm, the old workaround, has a hard 2GB input limit, needs special server headers for multithreading, and hasn't shipped a release in ~17 months.

3. **Timeline interaction polish.** Drag-reorder, trim handles, snapping, undo/redo, keyboard shortcuts — the "last 20%" that makes it feel like an editor. When fal.ai (professional devs, built on Remotion) shipped their AI-video assembly editor, a professional editor's public reaction was: "the most basic abilities of a video editor are missing… no obvious way of trimming clips." This polish is also the kind of fiddly interaction work AI coding agents are weakest at.

4. **Heterogeneous footage ingest.** Phone-recorded HEVC, 10-bit, variable frame rate files are codec whack-a-mole (the VidStudio thread documents this in painful detail). **Note: Lightricks punted on this too — LTX Studio's editor accepts no camera footage imports at all.**

One correction worth flagging from verification: the scary "67 undisposed 4K frames crashes the tab / Chrome caps tabs at 4GB" claim circulating in blog posts is **wrong** — frames are typically ~12MB (not 30MB), they do eventually get garbage-collected, and Chrome's tab limit is far higher now. The real, documented failure mode is a decoder *stall* from a handful of unclosed frames. Memory discipline matters, but it's a "follow best practices" problem, not a wall.

### Assembly cut vs. full NLE — explicitly

| | Assembly cut (Fikirtive's scope) | Full NLE |
|---|---|---|
| Order shots, trim in/out | Days–weeks (data model + UI) | Same |
| 1 video track + 1–2 audio tracks | Tractable | Multi-track compositing: months |
| Hard cuts + a few crossfades | ffmpeg `xfade`/`acrossfade`: days | Keyframed effects/color/multicam: months-to-years, **correctly out of scope** |
| Captions (burned in) | Whisper job + ASS burn-in: 1–2 weeks | Animated motion graphics: months |
| Preview | "Approximate preview" or double-buffered `<video>`: days. **Frame-accurate synced preview: the hard part** | Effect-parity preview: the open-ended tail that killed OpenCut v1 |
| Export MP4 | **Already ~solved by your existing worker** | Client-side everywhere: months of codec tail |

**Fikirtive has two structural advantages that the war-story victims did not:** (1) inputs are homogeneous AI-generated H.264 MP4s at known resolutions — the ingest nightmare doesn't apply; (2) the server-side ffmpeg worker already exists — the export nightmare doesn't apply. The hard parts that remain are preview sync and timeline feel, and both can be bought or deferred.

---

## 2. Option Matrix

All pricing and licenses verified against primary sources June 10–11, 2026.

### Option A — Embed a commercial SDK

**A1. Shotstack Studio SDK — the standout (verified: $0)**

- **What it is:** `@shotstack/shotstack-studio` on npm. A real timeline editor UI: canvas preview (PixiJS), drag/resize/snap timeline, playback controls, keyboard shortcuts. Works in Next.js.
- **License (verified):** PolyForm Shield 1.0.0 — free for commercial embedding; the only restriction is you can't build a product that *competes with Shotstack* (a render API). Fikirtive doesn't.
- **Export:** dual path — client-side (via Mediabunny/WebCodecs) **or** emit their documented Edit JSON. Critically, that JSON format (tracks/clips/trim/transitions) is simple enough that **your existing ffmpeg worker can render it yourself**, paying Shotstack nothing. Their cloud render is an optional convenience ($0.20/min on a $39/mo plan, 1080p cap).
- **Maintenance (verified):** very active — v2.11.5 published *today* (June 10, 2026), 8 releases in the last 3 weeks.
- **Capability fit:** ~95% of the assembly-cut spec out of the box.
- **Effort:** ~1–2 weeks to integrate, persist Edit JSON per project (fits your version-history model), wire export to your worker.
- **Cost:** $0. Optionally $39/mo if you want their cloud render while validating.
- **Lock-in/risk:** Your edit state lives in their JSON schema (simple, documented — migration is feasible). Vendor could change the license for *future* versions (pinned versions keep their grant). Worth one polite email to Shotstack confirming self-rendering their JSON is fine; legally the license doesn't prohibit it.
- **Failure mode:** the SDK's UI conventions don't match what Fikirtive's shot-board users expect, and customization hits the limits of someone else's component.

**A2. Rendley Video SDK — credible runner-up ($150/mo, verified)**

- Purpose-built embeddable editor (web components, works in Next.js), client-side rendering. Pricing changed from ~$5k/yr (2024) to self-serve: Free tier is local-network-only with watermark; **Pro $150/mo** removes watermark, grants commercial license, 1 domain + 3 subdomains. Active (npm publish May 2026).
- **Risk:** small company whose consumer site has pivoted to an AI-editor app — SDK longevity is a real question. Client-side rendering inherits all the browser export caveats in Section 1.
- **Failure mode:** $1,800/yr pre-revenue for an SDK whose vendor deprioritizes it.

**Not viable:** IMG.LY CE.SDK is the most polished product but sales-led at ~$13k/yr average (Vendr data, verified) — disqualifying pre-revenue. Creatomate's embeddable piece is template-parameter editing only, not a timeline. VEED/Descript/Plainly/json2video/Banuba/Cloudinary have no embeddable web timeline at all (verified).

### Option B — Adopt or fork open source

**Verdict up front: there is no permissively-licensed, maintained, embeddable editor to *adopt*. There are good codebases to *study or strip-mine*.**

| Project | License (verified) | Status | Verdict |
|---|---|---|---|
| **OpenCut-classic** | MIT, Next.js 16 + Mediabunny | **Archived 2026-05-17**, frozen, no fixes coming | Best strip-mine source — same stack as Fikirtive; fork patterns, don't depend |
| OpenCut (rewrite) | MIT | Rust-core rewrite, **not functional**, contributions paused | Watch, don't bet |
| **Mediabunny** | MPL-2.0 (safe for proprietary SaaS) | Very active, industry standard | **Adopt as a building block** (thumbnails, metadata, client media I/O) |
| Twick | "Sustainable Use License" — **SaaS use requires a commercial agreement** (verified, Section 3 of license) | Active, best feature fit on paper | Only viable after negotiating unpublished pricing with Kiffer AI — not a free option |
| DesignCombo react-video-editor | **No license at all** (all rights reserved); export hardwired to their hosted paid API | Active-ish | **Legally unsafe to copy even snippets.** Look, don't touch |
| Omniclip | MIT | Solo maintainer, mid-rewrite, stale npm package | Inspiration only |
| Etro | GPL-3.0 — incompatible with a closed-source SaaS frontend | Recently revived | Avoid |
| Motion Canvas / Revideo | — | Both dead (verified: ~16 and ~13 months idle, site returns 410) | Avoid |
| FreeCut | MIT | Solo dev, closed-contribution, Chromium-only | Fork-and-own reference for preview-engine code |

- **Capability fit:** raw materials only; you assemble the editor.
- **Effort:** 4–8+ weeks to a credible editor even with OpenCut-classic as a crib sheet.
- **Cost:** $0 in licenses; high in time.
- **Failure mode:** you inherit the hardest problem (preview engine) from a frozen codebase with no upstream, and become the sole maintainer of a video editor — exactly what the validation gate says not to do.

### Option C — Build minimal on Remotion

- **License (verified, with an important correction):** Remotion is **free including commercial use while the company is ≤3 people** — that's you, today, at $0. But the pricing model changed in Feb 2026: once you're 4+ people, a SaaS video tool falls under the **"Automators" tier: $0.01/render with a $100/mo minimum** (the $25/seat "Creators" tier is only for low-volume manual creation). And the pending Remotion 5.0 license **counts contractors toward the 3-person threshold** — relevant the moment you hire contract help.
- **Shortcuts:** official Editor Starter ($600 one-time, source code: timeline + canvas + uploads; built on React Router 7, needs adaptation to Next.js) or the $300 Timeline component. ReactVideoEditor.com kit: $149 one-time, explicit SaaS-permitted license.
- **Export:** Remotion renders via headless Chromium — works in your Railway worker but is dramatically heavier than ffmpeg concat for a plain assembly cut. You'd likely use Remotion only for preview and still export with ffmpeg.
- **Capability fit:** good for *preview* (the fal.ai starter proved the Player makes synced preview tractable in 1–2 weeks); you still build the timeline UI or buy the starter.
- **Effort:** 3–6 weeks. **Cost:** $0–$600 now; $100/mo minimum later as the team grows. **Lock-in:** a license that gets more expensive precisely when you succeed, plus React-render-everything architecture.
- **Failure mode:** you adopt a whole rendering paradigm to get a preview player, then discover the license meter starts the day you stop being solo.

### Option D — Server-side-only assembly render on the EXISTING worker + simple ordering UI (no timeline)

- **What it is:** No timeline component at all. The shot board you already have *is* the UI: drag to reorder shots (you have this), add per-shot in/out trim fields (two number inputs or a simple range scrubber on a `<video>`), pick one music track, choose 16:9/9:16 + 720/1080 preset, press Export. A pg-boss job compiles the sequence to ffmpeg args (trim → normalize → concat → `amix` → optional `xfade`), reports `-progress` into job status, uploads MP4 to R2. Preview = double-buffered stacked `<video>` elements playing shots in sequence ("good enough to judge the cut," not frame-accurate).
- **Capability fit:** covers order + trim + music + export — the actual assembly-cut *outcome* — without the timeline *form factor*. No captions/transitions in v1 (add `xfade` and Whisper-caption burn-in later as worker features, ~1–2 weeks each).
- **Effort (verified consensus of the decomposition report):** **~1–2 weeks** for a solo founder with AI agents, because the data model, queue, worker, ffmpeg, and R2 all exist. ffmpeg filtergraphs on homogeneous inputs are precisely the kind of code AI agents generate reliably.
- **Cost:** $0.
- **Lock-in/risk:** none — every line is yours, and the edit state (ordered shots + trims in Postgres) migrates losslessly into any future timeline editor, including Shotstack's Edit JSON.
- **Failure mode:** users who expect a CapCut-style timeline find the trim UX clunky. Mitigation: this is detectable in user feedback within weeks, and the upgrade path (Option A1) costs $0.
- **Bonus escape hatch (the LTX precedent):** generate a Premiere-compatible FCP7 XML / OTIO file from the same data model — days of work — so power users finish in Premiere/Resolve. LTX Studio ships exactly this, and its 1.5/5 Trustpilot score is about *billing and credits*, never about the editor being light (verified review-text analysis). A modest editor with a clean handoff is commercially defensible.

### Option E — Defer entirely

- **Cost:** $0. **Risk:** the shot board produces clips with no path to a watchable cut; users export shots and assemble elsewhere, and you never see whether assembly inside Fikirtive matters. Given Option D costs ~1–2 weeks on existing infra, full deferral saves little and blinds you to a key validation signal.

---

## 3. What the War Stories Teach

Five independent teams, one pattern:

1. **The export button is what solo devs cut first, and in-browser export is why.** OpenCut's export shipped as a placeholder that only logged to console (issue #167). Reelleer launched real-time-only, WebM-only, Chrome-only. VidStudio got publicly flagged for LGPL violations shipping ffmpeg.wasm. Multiple builders independently retreated to server-side ffmpeg. **You start where they all ended up.**

2. **The timeline "feel" is the consistently underestimated piece.** fal.ai's professional team shipped an AI-clip assembly editor and got panned for missing trim handles and transport controls. Rendley: two experienced devs, one full year, just for the SDK. Omniclip: one dev, ~6 months, "hard as shit." This is interaction polish, it resists AI-agent acceleration, and it's invisible in the spec.

3. **Scope creep toward NLE is how funded teams die.** OpenCut: 11 months → wrong architecture → rewrite. burningion: a year, two pivots. The open-ended tail is preview-parity across a growing effect set — the thing the assembly-cut scope line explicitly fences off.

4. **The market accepts a light editor; it revolts over billing.** LTX Studio — the closest commercial benchmark, ~2 years before Lightricks shipped any timeline — does 2 video + 5 audio tracks, no camera-footage import, MP4 + Premiere XML out. Reviewers call it limited; the 1-star avalanche is entirely credits/refunds. The competitive minimum for an AI-video tool is the assembly cut **plus an escape hatch**, not an NLE.

5. **Homogeneous inputs are a superpower.** Nearly every codec war story (HEVC, 10-bit, VFR, "phones record exactly the files Firefox can't decode") comes from camera-footage ingest. AI-generated clips sidestep it — and even Lightricks chose to keep it that way.

---

## 4. Recommendation

### The verdict on "it isn't that hard"

**The founder is right — for exactly one version of the feature, which happens to be the right version.** A cuts-only assembly export (order + trim + music + server ffmpeg render + approximate preview) is realistically **1–2 focused weeks** on Fikirtive's existing infrastructure, because the genuinely hard parts of "web video editor" (in-browser encoding, heterogeneous ingest, frame-accurate preview engines) are either already solved by your worker or excluded by your input format.

**The advisor is also right.** A *credible timeline editor* — polished interactions, synced preview, captions, transitions, undo/redo — is 2–4 months even buying components, and history shows it expands without mercy (OpenCut: 11 months → rewrite; Rendley: 2 dev-years; Lightricks: ~2 years to a 2-track timeline). Building that before the validation gate would be exactly the mistake the war stories document.

These don't conflict, because **the cheap version and the expensive version are different features**. The sequencing below gives both of them their due.

### Sequenced path

**Phase 0 — now, pre-gate (~1–2 weeks): ship Option D.**
Per-shot trim in/out on the existing shot board, drag-to-order (exists), one music track, aspect/resolution presets, "Export MP4" as a pg-boss → ffmpeg → R2 job with progress, plus a Premiere XML/OTIO export from the same data model. Sequential `<video>` playthrough as preview. Define the timeline data model (tracks, clips, in/out, order, gain) in Prisma now — it is the durable asset every later option consumes.
*Verify by:* a real user turns a shot board into a watchable MP4 without leaving Fikirtive.

**Phase 1 — at the validation gate: measure, don't build.**
Instrument: % of projects that use Export, % that re-export after re-trimming, and explicit asks for transitions/captions/multi-track audio.

**Upgrade trigger (named):** adopt a real timeline editor when **users are demonstrably assembling in Fikirtive and hitting the wall** — concretely, when a meaningful share of active projects use export AND the top recurring requests are timeline-shaped (transitions, captions, audio layering, precise trimming) rather than generation-shaped. If exports go unused, the advisor's caution is vindicated and you've spent two weeks, not four months.

**Phase 2 — when triggered (~2–4 weeks): embed Shotstack Studio SDK (Option A1).**
$0, npm-installable, actively maintained, real timeline UI. Persist its Edit JSON per project (slots into your version-history model); migrate Phase-0 edit state into it (trivial mapping); render on your own ffmpeg worker — or via Shotstack's API at $0.20/min as a stopgap. Before committing, run the planned one-week head-to-head against Rendley behind the same route — both install in an afternoon — and send Shotstack the one-line email confirming self-rendering their Edit JSON is welcomed. Captions (Whisper job + ASS burn-in) and a fixed transition set (`xfade`/`acrossfade`, "preview is approximate") are 1–2 worker-weeks each, added on demand.

**Standing decisions (any phase):** final MP4 export stays server-side permanently — the browser-export codec matrix (no AAC on Linux/Firefox, no H.264 export on Firefox) makes client export a feature, never the foundation. Use Mediabunny freely for client-side media chores. Do not adopt GPL (Etro) or unlicensed (DesignCombo) code in any form; treat Remotion as a fallback whose meter starts when the team grows past three (contractors included, come v5.0).

### Why this is the lowest-regret path

Every dollar and week spent before the gate produces assets that survive every branch: the data model, the ffmpeg job compiler, the XML escape hatch, and a validation signal about whether assembly matters. The expensive, lock-in-prone decisions (which timeline SDK, how much preview fidelity) are deferred to the moment real usage data exists — and the best-available answer at that moment currently costs $0.