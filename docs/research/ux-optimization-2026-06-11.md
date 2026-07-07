# Fikirtive UX Optimization Research (2026-06-11)

Two parallel research lines: (1) ultracode workflow — LTX flow reverse-engineered from 86 screenshots + 5-persona simulation on both products; (2) codex — independent expert critique of the as-built UI. Both converged on the same core diagnosis.

======================================================================
# WORKFLOW — FINAL BRIEF
======================================================================

The critique's core technical claims are verified against the actual code:

- **No video provider exists**: grep for `veo|kling|seedance|i2v|image-to-video` returns zero hits in source (only node_modules noise). S1b is genuinely net-new.
- **15-image cap is real**: `refgen.ts` L36 `MAX_EDIT_INPUT_PLUS_OUTPUT = 15` + `MAX_CONDITIONING_IMAGES` imported from core. Multi-entity shots will collide with it.
- **Trust boundary (D19) is real and deliberate**: L20-21 — "the request never carried image URLs — the worker resolves them HERE." The proposal's S2 explicitly proposes to cross this.
- **The refgen path is image-only**: the file header says "ReferenceImages", it's a Seedream *edit* call. Stills, not video.
- **The editor pads stills to 3s and already distinguishes video from image**: `IMAGE_SECONDS = 3` (L15), `VIDEO_EXTS`/`IMAGE_EXTS` (L17-18), and `type: isVideo ? "video" : "image"` (L45). So a stills-only ship is visibly a slideshow — and the editor's own data model proves it.

The critique is correct and load-bearing. The still-vs-video conflation is the single most important correction. I have what I need to write the brief. I'll integrate the critique decisively — restructuring the One Thing around the stills-first vertical slice, splitting S1, fixing the mis-rankings (Q4 not Q1 leads; draft-discard is a P0 bug; agency scoping is a data-model change not a label), and naming audio/cost as honest gaps.

---

# Fikirtive UX Brief — For the Founder

*A discussion document. Opinionated, prioritized, honest about what we don't yet know. Read §6 first if you read nothing else.*

---

## 1. Diagnosis

Fikirtive is a reference-management tool with no reference-powered generation at its center. Users write a prompt with `@Maya @Sneaker @Logo`, look for "Generate," and find only **"Copy resolved prompt"** — which flattens their entities to a bare string, drops every reference image, and ejects them to ComfyUI to re-marshal those references by hand. The product *demonstrably can* generate-and-place pixels — but only in the **Library**, for entity refs (`GenerateRefsBlock` → fal/Seedream → auto-land). The **Workbench**, where shots are actually made, can't reach that capability — it sits 50 feet from where it's needed. The result: three siloed screens (Library, Workbench, Editor) with **no connective tissue carrying the entity through them**, and a wedge ("the same Maya in every shot, on any model") that breaks at the exact click it's supposed to win.

**The hard truth the proposal soft-pedals:** the generation path that exists produces **stills, not video** — a Seedream image-edit call (`refgen.ts`), capped at 15 images, that the editor then pads to a hard-coded 3 seconds (`IMAGE_SECONDS = 3`). Every persona wants *video* (TikTok ad, performance ad, MV, GRWM clip). So "wire up Generate and four of five personas export an ad" is not true as written — they'd export a **slideshow of 3-second stills**, which is exactly the artifact they're trying to escape. The real work is two features the proposal collapsed into one: **(a) in-app generation that carries references** — a real but bounded port, provable on stills — and **(b) image-to-video** — a net-new provider integration (no `veo`/`kling`/`seedance`/`i2v` endpoint exists anywhere in the repo). Separating these is the spine of this brief.

---

## 2. The Optimized End-to-End Flow

The fix: make **the entity travel through every screen as a first-class, generation-ready object**, and make **Generate the default verb where pixels are needed** — while being honest that "generate" means *still* on day one and *video* once a provider lands.

**Entry / Project setup (`/`)** — First decision is **format** (`9:16 / 1:1 / 16:9`) at project creation. Today the editor hard-codes `"16:9"` (`editor/page.tsx` L58) — a silent betrayal for the vertical-video creators who are 3 of 5 personas. *Caveat (per the critique, correct): this threads cleanly to **editor output**; "generation framing" is aspirational until the video path exists, since Seedream output dimensions follow the input refs, not a free aspect knob.* Empty state leads with one concrete action and an example, not a blank board and a ComfyUI sentence.

**Build the cast (`/library`, now project-aware)** — Library shows which project you're in (today: "Open a project" — `library/page.tsx` L26) and states the thesis in one line: *"Elements are shared across all your projects."* The "Generate refs" door **actually generates in the dialog** (kill today's bait-and-switch: it shows a paragraph and dumps you in a drawer). "Locked" gets a one-line definition: *"has references — ready to @mention in a shot."*

**Make the shots (`/`, the Composer — THE FIX)** — The bottom row changes from `[Copy resolved prompt] [Save]` to a real generation surface:

> **`[Generate N (~$X)]` (primary) ····· `[Save]` ····· `[Advanced ▾: copy for my ComfyUI]`**

- **Generate is primary** and calls the shipped fal path, **conditioned on the @-mentioned entities' reference images**, auto-attaching the result to the shot as a candidate. This collapses today's 8-step / 3-handoff loop into one click. *Day one this produces a still; the honest label is "Generate frame" until i2v ships.*
- **@-mention dead-end fixed**: `@xyz` matching nothing offers inline **"+ Create '@xyz'"** — without leaving the prompt. **(This sits on top of a P0 data-loss bug — see §3.)**
- **Reference health surfaces at the board level** before you render N shots: "Maya ✓ Locked · NeonAlley ⚠ no refs."
- **Model choice lives under "Advanced," not front-and-center.** The copy-out survives as the power-user escape hatch — but upgraded to a **reference manifest (image URLs + per-model schema), not just names.** (Why demoted, not promoted: §4.)

**Review & iterate (Workbench)** — Per-shot variations (1–N) and "Generate all shots" batch. "New version from this shot" clones prompt + entities. *Honest limit: on stills this re-rolls a fresh frame from the same refs — it does **not** carry forward the previous frame's lighting/wardrobe/pose. True "Maya, now wet, from this frame" continuity is a video operation we cannot deliver until i2v + a retake primitive exist. Don't oversell it.*

**Assemble & export (`/editor`)** — Cut auto-assembles from attached renders (works today). Empty editor should **diagnose the gate** ("5 shots, 2 have no attached render") instead of "Nothing to cut yet." Per-shot duration selectable at assembly, not silently 3s. **Known hole, named not hidden: there is no audio path** beyond raw Shotstack — for a short-video-ad tool, shipping silent clips is a real gap (two personas raised it). Deferred, not solved.

**The connective tissue that was missing:** the entity's reference images now flow Library → Composer (into generation) → shot candidate → Editor clip, and cross-links appear where the data already supports them (the drawer knows `usageCount` but won't link to "the shots using Maya").

---

## 3. Ranked Roadmap

### QUICK WINS (days)

| # | Problem | Change | Personas | Effort |
|---|---------|--------|----------|--------|
| **Q1** ⚠️ **P0 BUG** | Leaving the Composer to create an element fires `confirm("Discard unsaved prompt changes")` and **destroys the draft** (Workbench L67-68). A rage-quit defect, not a nicety. | **Preserve the draft** across element-create. *This is the prerequisite for inline-create below.* | UGC, brand owner | **S** |
| **Q2** | Generate-door bait-and-switch (Library L344-348) shows text, generates nothing. Every persona hits it in the first 60s; trust-killer. | Render `GenerateRefsBlock` **inside the create dialog**. *The single highest-leverage quick win.* | UGC, brand owner, solo ad | **S** |
| **Q3** | `@xyz` matches nothing → "create one in the Library" dead-end. | **Inline "+ Create '@xyz'"** in the mention dropdown. (Depends on Q1.) | UGC, brand owner | **S/M** |
| **Q4** | Aspect ratio hard-coded `"16:9"` (editor L58); 3 of 5 personas make vertical and discover landscape at the end. | **9:16/1:1/16:9 picker** → **editor output** (the locatable, trivial half). | Solo ad, UGC, brand owner | **S** |
| **Q5** | Library shows "Open a project"; vocabulary noise ("Locked" undefined, Elements/Library double-name, "Unattached"). | Pass project (library L26); add the "shared across projects" line; define "Locked"; pick one name. | Director, all | **S** |
| **Q6** | Empty Editor dead-ends with "Nothing to cut yet." | Diagnostic copy: "5 shots, 2 missing renders." | Director, all | **S** |

> **De-ranked from the proposal:** the **Target/model picker** was the proposal's #1 quick win. It is now **deferred to ship *with* generation**, not led with — it's pointless before a generate path exists to target, and it's *cognitive load* for 4 of 5 personas who explicitly don't want to see the model (§4).

### STRUCTURAL (weeks)

| # | Problem | Change | Personas | Effort |
|---|---------|--------|----------|--------|
| **S1a** | **No generate on the Workbench.** The core loop. | **In-app *still* generation on the Composer**, reusing the refgen path, **shot-scoped** (new wiring: the job must carry a `shotId` and land in `shot.generations` — refgen today keys to `entityId`, so this is a real port, *not* the freebie the proposal's "auto-attach rides S1" implied). | All 5 | **M** |
| **S1b** | **The refgen path makes stills. Every persona wants video.** | **Image-to-video provider integration** (Veo / Kling / Seedance, TBD). Net-new: new endpoint, new cost surface, new failure modes. **This — not S1a — is what turns stills into the ad.** | All 5 | **L** |
| **S2** ⭐ | References collapse to plain text at the handoff (Composer L357). **The wedge breaks here.** | **Resolve @mentions to actual reference image URLs into generation.** *This is the differentiated half — the moat.* **But not "the broken line of code":** it **crosses the D19 trust boundary** (`refgen.ts` L20: "the request never carried image URLs — the worker resolves them HERE"), and a multi-entity shot (Maya + Sneaker + Logo) can blow the **15-image cap** (L36). S2 is a **new conditioning model** (client-passed multi-entity refs, shot-side resolution, cap arbitration) — the riskiest item in the plan, not a one-liner. | All 5 | **M→L** |
| **S3** | Model choice is a decorative chip (`interactive={false}`, Composer L393). | **Target picker** (fal / hosted ComfyUI / copy-out), **behind "Advanced."** Ships *with* S1, not before. | Founder mainly | **S** |
| **S4** | Library is **globally shared** → competing clients' brand kits in one pile. **NDA/legal blocker** for agencies. *The proposal mis-sized this as a one-line "S" copy fix.* | **Scope Elements to project/client** — a **data-model change**, the same work as project lifecycle. The *label* is trivial; the *fix* is M/L. | Agency, brand owner, director | **M/L** |
| **S5** | No second seat, no roles — the agency CD **can't delegate** (hardcoded `FOUNDER_OWNER_ID`). | **Multi-user auth + Creator/Reviewer roles + review/approval** state. | Agency CD | **L** |
| **S6** | 8 one-at-a-time select→type→save cycles; no batch. | **"Generate all shots" + per-shot variations (1–N)**; show prompt on the ShotCard pre-render. | UGC, director, solo ad | **M** |

**Sequencing (corrected from the proposal):**
1. **Q1+Q2** immediately — the data-loss bug and the bait-and-switch are cheap and bleed trust in the first minute.
2. **S1a + S2** as one thin vertical slice, **proven on stills** — in-app generation that *carries the references*. This is the moat made real. **Then stop and validate (§6) before S1b.**
3. **S1b (i2v)** only after stills validate demand — it's the expensive L, and the thing that actually produces an ad.
4. **S6** (batch) for volume, after the single-shot loop works.
5. **S4 + S5** as a **parallel "go-to-market to agencies" track** — equally urgent *for that buyer*, but invisible to the solo/creator fix. The agency persona bounces at Step 3, *before generating* — so every Generate investment is invisible to her. Don't let it block the solo fix; don't let "don't block it" read as "deprioritize it."

---

## 4. Borrow from LTX (adapt, don't clone) + Keep the Wedge

**Borrow:**
1. **In-app generation as the default verb** → our S1, but with model choice *surfaced behind Advanced* (LTX hides it; we expose it as a *capability*, not a *required decision*).
2. **Reference-health gating + greyed-Generate-until-valid** → surface our existing integrity gates at the **board level**, before batch.
3. **Anti-perfectionist empty states that teach the next action** → replace every dead-end ("create one in the Library," "Nothing to cut yet") with a concrete action + example.
4. **`@`-mention driving generation and propagation** → we already have the mention graph; the adaptation is making it **condition generation** (S2) and offer to re-roll shots when an entity's refs change.
5. **In-context cost badges** → price on the Generate button.

**Do NOT borrow:** auto-cast script-to-storyboard *as the headline* (it's exactly where LTX's identity consistency breaks — "a cousin, not the same person"); a deep NLE; aggressive paywalling / per-retake credit-burn (LTX's #1 user complaint).

**Keep the wedge — with two corrections to the proposal's framing:**
- **The wedge is S2 (references conditioning generation), NOT the Generate button or the Target picker.** The button is the delivery mechanism; the picker is a power-user nicety. The proposal said this in its §5 then foregrounded the button/picker in its recommendation — the emphasis was inverted. *If you build the button and the picker but fake S2 with text, you've shipped an LTX clone.* The whole point is that your @Maya is the **same** Maya — which is only true if real reference pixels condition every generation.
- **The Target picker is the wedge for *one* persona (the ComfyUI founder) and cognitive load for the other four.** Three personas explicitly *don't want to see the model*. So: **default to in-app, hide the picker under "Advanced," and express neutrality as the copy-out manifest** (a capability), not a required decision. The proposal's "non-negotiable for every persona" was an overreach.
- **Subtle but important:** the founder — the *only* persona who wants model choice — wants their *own tuned LoRA* of Maya, which in-app fal/Seedream **cannot run**. For that persona the valuable deliverable is the **reference-manifest copy-out (S2)**, not the in-app button. So S2 serves *both* the non-technical four (real conditioning) *and* the power user (manifest). The button is the only part that doesn't serve everyone.

---

## 5. New Features (only those closing a multi-persona gap)

1. **In-app generation conditioned on entity refs, auto-attached (S1a + S2)** — the gap *all five* personas hit. *The product.* Ship on stills first.
2. **Image-to-video (S1b)** — without it, every persona exports a slideshow. *The thing that makes it an ad.* Validate demand on stills before building.
3. **Batch generate + per-shot variations (S6)** — UGC volume, director's 8 shots, solo ad's 5 shots all die on the one-at-a-time loop.
4. **Reference-manifest copy-out (part of S2)** — serves the power user who'll always go to their own graph.

**Held back, deliberately:**
- **"Draft shots from a brief" seeder** — the proposal both warned against auto-cast (§4) and shipped a brief-seeder (§6.4). That's an internal contradiction; the line between "seed titled shots" and "auto-cast" is blurry and unvalidated. **Don't build it until users ask** — test whether they want it or find it the same off-brand magic we're avoiding.
- **Roles / review-approval (S5)** — real, but one segment; gate behind the multi-seat track.

---

## 6. The ONE Highest-Leverage Move

> **Make the @-mentioned references actually condition an in-app generation that lands on the shot — and prove it on *stills* first (S1a + S2), as a thin vertical slice, before committing to the video provider (S1b).**

This corrects the proposal on three counts:
- **Scope:** the proposal fused still-gen and video-gen into one "M." They are **M + L**, and the L is the part that produces the ad. Conflating them risks shipping a 3-second-slideshow exporter, demoing it against video goals, and concluding the redesign failed.
- **Emphasis:** lead with **S2 (conditioning), not the button or the picker.** The references *are* the moat; the button just delivers them.
- **Promise:** not "four of five export an ad" — on day one, "four of five generate a *referenced still on the right shot, in one click*, without losing their references." That's the provable, honest win. The ad comes with S1b.

**Validate with real users before building the expensive parts:**
1. **Does a stills-only loop retain anyone?** Put S1a + S2 (single referenced still → shot, padded to 3s) in front of the personas. If they all still bounce at "this is a slideshow," S1a is a stepping stone, not a shippable release — and "ship one thing" must wait for S1b. *This single test gates the largest spend in the plan.*
2. **Will the ComfyUI founder use in-app fal at all** — or always copy out to run his own LoRA? If the latter, his deliverable is the **manifest**, and we shouldn't over-invest in the in-app button for him.
3. **What does batch + variations actually cost a volume user?** The UGC creator's core anxiety is cost-per-attempt at 5–8 videos/day. "Forgiving iteration" (free refs, pay per gen) and "Generate N variations" are in direct tension — more variations, more fal bill. Get a real per-roll number in front of that persona before promising "cheap re-rolls."

---

## Decisions I need from you

1. **Stills-first, or hold for video?** Do we ship the S1a+S2 stills slice to validate the conditioning loop (faster, honest, but visibly not-an-ad), or hold the whole release until i2v (S1b) lands so the first thing anyone sees is real video? This is the single biggest fork in the roadmap.

2. **Which i2v provider, and is model-neutrality a launch requirement or a v2 capability?** Picking one (Kling/Veo/Seedance) is fastest; the multi-model "Switzerland" wedge is the long-term moat but multiplies integration and cost surface. Do we launch neutral, or launch on one model and make neutrality the copy-out manifest until later?

3. **Solo/creator first, or fund the agency track in parallel?** The agency is the only *paying-team* buyer in the set, but it's blocked by seats + client-scoping (S4/S5, an L) that no amount of Generate work touches — and the agency persona bounces *before* she'd ever see a Generate button. One bet converts 4 of 5 solo/creator personas; the other opens a different, higher-ACV customer. Which do we resource now?

---

*Anchor files for the build:* `apps/web/components/Composer.tsx` (copy-only handoff → Generate; dead Target chip L393), `apps/web/lib/refgen-actions.ts` + `apps/web/lib/actions.ts` (the shipped gen+attach path to reuse), `apps/web/components/Library.tsx` (L375-484 `GenerateRefsBlock` to reuse; L344-348 bait-and-switch), `apps/web/app/editor/page.tsx` (L15 `IMAGE_SECONDS=3`, L17-18 `VIDEO_EXTS`/`IMAGE_EXTS` — the editor already distinguishes the two, which is *why* a stills-only ship will look wrong; L58 hard-coded `"16:9"`), `apps/web/components/Workbench` (L67-68 draft-discard P0 bug), `apps/worker/src/jobs/refgen.ts` (L20 D19 trust boundary; L36 15-image cap — the constraints S2 must solve). **No `veo`/`kling`/`seedance`/`i2v` endpoint exists in `apps/worker/` or `apps/web/lib/` — confirming S1b is net-new, not a port.**

======================================================================
# WORKFLOW — RAW PROPOSAL (pre-critique)
======================================================================

I have everything I need. The brief is exhaustive: a verified current-state map, the LTX flow map, and 5 grounded persona simulations. My job is synthesis into a decisive founder-facing proposal, not more code archaeology. I'll write it directly.

# Fikirtive UX Redesign — Decisive Proposal

## 1. THE CORE DIAGNOSIS

**Fikirtive is a reference-management tool with no reference-powered generation at its center — the product's entire value proposition leaks out at the one click that matters.** Every persona, from the ComfyUI-fluent founder archetype to the zero-jargon brand owner, hit the identical wall: they write a prompt with `@Maya @Sneaker @Logo`, look for "Generate," and find only **"Copy resolved prompt"** — which flattens their entities to a bare text string (`"Maya holding Sneaker"`), drops every reference image, and ejects them into ComfyUI to marshal those references by hand. This is the inverse of the pitch: a "Switzerland of references" that abandons the references at the border crossing.

The single biggest **structural** problem is not the missing button — it's that **Fikirtive has three siloed screens (Library, Workbench, Editor) and no connective tissue carrying the entity through them.** Generation already works in-app — but only in the Library, for entity refs (`GenerateRefsBlock` → fal/Seedream → poll → auto-land). The Workbench, where shots are made, can't reach it. So the product *demonstrably can* generate-and-place pixels and *refuses to* for the one job users came for. The capability exists 50 feet away from where it's needed. Everything else (no aspect ratio, no batch, dead "Target" chip, project-context blackout in the Library, "Unattached" bookkeeping) is downstream friction on top of that one missing spine.

**One line: Fikirtive built the reference layer and the export layer, then left a ComfyUI-shaped hole where the filmmaking goes — and threw away the references on the way out.**

---

## 2. THE OPTIMIZED END-TO-END FLOW

The fix is to make **the entity travel through every screen as a first-class, generation-ready object**, and to make **Generate the default verb everywhere pixels are needed.** Here is the ideal journey.

### Entry → Project setup (`/`)
- New user lands on the Workbench. **First decision is format**: a small `9:16 / 1:1 / 16:9` control at project creation (today `editor/page.tsx` hard-codes `"16:9"` — a silent betrayal for the vertical-video creators who are 3 of 5 personas). This threads into both generation framing and editor output.
- Empty state leads with **one concrete next action and an example**, not a blank board + a ComfyUI sentence. "Describe your ad in a line, we'll seed the shots" (lightweight; see §6).

### Build the cast (`/library`, now project-aware)
- Library shows **which project you're in** (today the pill reads "Open a project" — fix `library/page.tsx` L26 to pass project) and states the rule in one line: *"Elements are shared across all your projects."* This is the **core thesis**, currently invisible.
- Create entity → the **"Generate refs" door actually generates in the dialog** (kill the bait-and-switch where it shows a paragraph and dumps you in a drawer). Same `GenerateRefsBlock` machine, rendered in the create flow.
- "Locked" gets a one-line definition: *"has references — ready to @mention in a shot."*

### Make the shots (`/`, the Composer — THE FIX)
This is where the redesign lives. The Composer bottom row changes from `[Copy resolved prompt] [Save prompt]` to:

**`[Target ▾: Fikirtive in-app] ····· [Generate N (~$X)] [Save]`**

- **Generate is the primary button.** It calls the *exact* fal/Seedream path the Library already ships (`startRefGen`-style → poll → auto-land), **conditioned on the @-mentioned entities' actual reference image URLs** (the R2 assets are right there; the Library already does "using N images as reference"). The result **auto-attaches to the selected shot as V1** — no "Unattached," no separate attach act. This collapses today's 8-step / 3-handoff loop (copy → leave → load refs by hand → render → re-import → attach) into **one click**.
- **The "Target" chip becomes a real picker** (`fal/Seedream · hosted ComfyUI · "copy for my own ComfyUI"`), each with a cost badge. This is where the model-neutral wedge becomes visible and clickable instead of a decorative sticker.
- **"Copy resolved prompt" survives as the power-user escape hatch** under the ComfyUI target — but upgraded to copy a **reference manifest (image URLs + per-model schema), not just names.** Even the manual path stops dropping the references.
- **@-mention dead-end is fixed**: when `@xyz` matches nothing, the dropdown offers **"+ Create '@xyz'"** inline, without leaving the prompt or triggering the discard dialog.
- **Reference health surfaces at the board level** before you render 8 shots: "Maya ✓ Locked · NeonAlley ⚠ no refs" — fix continuity gaps once, up front.

### Review & iterate (Workbench)
- **Per-shot variations (1–N)** and a **"Generate all shots" batch** for the volume creators. Pick the on-brand candidate per shot.
- **"New version from this shot"** (clone prompt + entities) so "Maya, now wet" starts from "Maya steps out," not a blank prompt — the narrative-continuity primitive.

### Assemble & export (`/editor`)
- Cut auto-assembles from attached renders (good today), but **per-shot version + duration are selectable at assembly**, not silently "latest attached, 3s."
- Empty editor **diagnoses the gate**: "You have 5 shots but 2 have no attached render" instead of dead-end "Nothing to cut yet."
- Export MP4 in the chosen aspect ratio. **This step already works end-to-end — leave it alone.**

**The connective tissue that was missing:** the entity's reference images now flow Library → Composer (into generation) → shot candidate → Editor clip, and cross-links appear where the data already supports them (the drawer knows `usageCount` but won't link to "the shots using Maya"; add "@mention in a shot" and "send to editor").

---

## 3. PRIORITIZED CHANGES

### QUICK WINS (days — high leverage, low effort)

| # | Problem | Change | Personas | Effort |
|---|---------|--------|----------|--------|
| **Q1** | Most important decision (where shots render) is a decorative chip (`interactive={false}`, Composer L393) | Make the **Target chip a real `PopMenu`** (fal / ComfyUI / copy-out) with cost badges | All 5 | **S** |
| **Q2** | Aspect ratio hard-coded `"16:9"` (`editor/page.tsx` L58); 3 of 5 personas make vertical video and discover landscape at the end | **9:16/1:1/16:9 picker** at project creation, threaded to editor output | Solo ad, UGC, brand owner | **S** |
| **Q3** | Library shows "Open a project"; global-vs-project model never explained — an **NDA blocker** for the agency | Pass project to `library/page.tsx` (L26); add one line: *"Elements shared across all projects"* | Agency, brand owner, director | **S** |
| **Q4** | Generate-door bait-and-switch (Library L344–348) shows text, generates nothing | Render `GenerateRefsBlock` **inside the create dialog**, or remove the door and jump to the drawer focused on it | UGC, brand owner, solo ad | **S** |
| **Q5** | `@xyz` matches nothing → "create one in the Library" dead-end; leaving discards the draft (Workbench L67–68) | **Inline "+ Create '@xyz'"** in the mention dropdown | UGC, brand owner | **S/M** |
| **Q6** | Empty Editor says "Nothing to cut yet" with no diagnosis; "Locked" undefined; Elements/Library double-name | Diagnostic copy on empty Editor; define "Locked" in a tooltip; **pick one name** (Elements *or* Library) everywhere | Director, all | **S** |

### STRUCTURAL (weeks — re-architecture, but where the product is won)

| # | Problem | Change | Personas | Effort |
|---|---------|--------|----------|--------|
| **S1** | **No generate on the Workbench. The core loop.** | Add **"Generate" to the Composer**, reusing the shipped ref-gen path, conditioned on entity refs, **auto-attaching to the shot.** *This is the whole ballgame.* | **All 5** | **M** |
| **S2** | References collapse to plain text at the copy handoff (Composer L357) — the wedge breaks at the one moment it matters | **Resolve @mentions to actual reference image URLs** into generation; upgrade copy-out to carry a **reference manifest**, not names | All 5 (esp. founder, director) | **M** |
| **S3** | Attach is a separate manual act even when the upload already carries shot provenance (Workbench L428–457) | **Auto-attach** shot-scoped uploads/generations; keep detach/reassign | UGC, solo ad, brand owner | **S** (rides S1) |
| **S4** | No second seat, no roles — the agency CD **can't delegate**, structurally impossible (hardcoded "founder", `FOUNDER_OWNER_ID`) | **Multi-user auth + Creator/Reviewer roles + shot assignment**; a real **review/approval** state (submit → approve/needs-changes) with comments, replacing the self-set status sticker | Agency CD | **L** |
| **S5** | Project is just a bare shot board; `createProject(name)` is the only verb — graveyard of "Untitled" boards | **Project lifecycle** (rename/archive/duplicate) + **client scoping of Elements** (or explicit shared brand kit) | Agency, director | **M/L** |
| **S6** | 8 separate select→type→save cycles, then 8 prompt-less grey boxes; no batch | **Batch: "Generate all shots" + per-shot variations (1–N)**; show prompt on the ShotCard pre-render | UGC, director, solo ad | **M** |

**Recommended sequencing:** Ship **S1 + S2 + S3 together** (they're one coherent change and the backend port already supports fal — this is the difference between "I'd never finish" and "I'd finish"). Land the **quick wins Q1–Q6 in the same release** (most are labels and a scoping arg). Then **S6** (batch) for volume. Treat **S4/S5** (seats, client scoping) as the dedicated "go-to-market to agencies" track — large, but it's a *different customer*; don't let it block the solo/creator fix that unblocks 4 of 5 personas.

---

## 4. BORROW FROM LTX (adapt, don't clone)

1. **In-app generation as the default verb, model auto-selected** → Fikirtive's S1, but with the **Target picker exposing the choice** (LTX hides the model; Fikirtive's wedge is *surfacing* it). Adopt LTX's *frictionlessness*, keep Fikirtive's *neutrality*.
2. **Reference health gating ("Please pick a source image") + greyed-Generate-until-valid** → Fikirtive's integrity gates already exist; surface them **at the board level before batch-rendering**, and grey the Generate button until mentions resolve.
3. **Anti-perfectionist empty states that teach the next action with examples** (§3.3) → replace every Fikirtive dead-end ("create one in the Library," "Nothing to cut yet," the ComfyUI sentence) with a concrete next action.
4. **`@`-mention with live propagation** → Fikirtive already has the mention graph; the adaptation is to make it **drive generation** (S2) and **propagate edits** (edit Maya's refs → offer to re-roll shots using her). This is the single most-validated LTX pattern and Fikirtive is one wire from parity.
5. **In-context cost badges** → put the price on the Generate button and Target options (the Library already shows "~$X"; extend it to shots).
6. **Cost/credit transparency without the punishment** → show cost in-context like LTX, but keep Fikirtive's "free references, pay per generation" model. Do **not** adopt per-retake credit-burn.

**Explicitly do NOT borrow:** auto-cast script-to-storyboard as the *headline* (it's exactly where LTX's identity consistency breaks — "a cousin, not the same person"); a deep NLE (LTX keeps it shallow and exports to Premiere — Fikirtive's editor is already at the right altitude); aggressive paywalling / credit-burn economics (LTX's #1 user pain and 1.5/5 billing reputation).

---

## 5. KEEP THE WEDGE

Fikirtive's differentiation is **being the model-neutral entity/reference layer that delivers rock-solid identity persistence across any model** — precisely the two things LTX is weakest at (consistency that's "a cousin, not the same person," and iteration that punishes you). The redesign must **amplify**, not dilute, this:

- **The Target picker is the wedge made visible.** Generating in-app via fal must coexist with "hand a fully-resolved reference bundle to my own ComfyUI / Veo / Kling." Fikirtive wins by carrying references *to any model*, not by becoming another walled generator. The founder's ComfyUI users will pay for exactly this — don't abstract the *choice* away, only the *operation*.
- **S2 is the wedge delivered.** Passing real reference images into generation is what makes "your @Maya is the **same** Maya in every shot" true — the claim LTX structurally can't make. This is the moat; it's also currently the broken line of code.
- **Identity persistence > generation breadth.** Don't out-feature LTX on keyframes and motion sliders. Double down on locked entities, real ref sets, negative constraints, and reference fidelity conditioning every generation.
- **Forgiving iteration is a weapon.** "Free references, charge for generation" is *right*. Make re-rolling a shot feel cheap and predictable — the opposite of LTX's meter-anxiety. This is a deliberate competitive attack, not just pricing.

**The trap to avoid:** the fastest way to ship a Generate button is to wire one fal model and call it done. That would quietly become an LTX clone. The *differentiated* version of S1 is S2 — the button that carries the references. Ship them as one thing.

---

## 6. NEW FEATURES (only those closing multi-persona gaps)

1. **Real model Target picker** (Q1) — every persona wanted to choose or didn't want to see ComfyUI; it's also the wedge surface. *Non-negotiable.*
2. **In-app shot generation conditioned on entity refs, auto-attached** (S1+S2+S3) — the gap *all five* personas hit. *The product.*
3. **Batch generate + per-shot variations** (S6) — UGC volume, director's 8 shots, solo ad's 5 shots all die on the one-at-a-time loop.
4. **"Draft shots from a brief" seeder** — a *lightweight* borrow of LTX's magic moment: paste a shot list / one-line brief → seed N titled ShotCards with suggested prompts pre-wired to existing Elements. **Not** full auto-cast (that's where LTX breaks). Serves director, UGC, brand owner, agency. **M.**
5. **Roles + review/approval surface** (S4) — only the agency persona, but it's a whole customer segment and the status badge is already 80% of the UI scaffolding. Gate behind the multi-seat track.
6. **"New version from this shot"** continuity clone (part of S6) — narrative director's evolving-continuity need ("Maya, now wet"), cheap to build (clone `promptDoc` + `entityIds`).

**The decisive recommendation:** if the founder ships one thing, it is **S1+S2+S3 as a single release with Q1 (the Target picker) and Q2 (aspect ratio)** — in-app shot generation that carries the references and auto-attaches, with a real model target and correct aspect. That one release converts "I bounce in 4 minutes" into "I export an ad," for four of the five personas, **while making the model-neutral wedge real for the first time** instead of a decorative chip and a broken clipboard call. Everything else is sequencing.

---

**Anchor files for the build:** `apps/web/components/Composer.tsx` (L332–362 copy-only handoff → Generate; L393 dead Target chip → picker), `apps/web/lib/refgen-actions.ts` + `apps/web/lib/actions.ts` (the shipped generation+attach path to reuse; `attachGeneration` L381), `apps/web/components/Library.tsx` (L375–484 `GenerateRefsBlock` to reuse; L344–348 bait-and-switch), `apps/web/app/editor/page.tsx` (L58 hard-coded `"16:9"`; L15/L40 hard-coded 3s), `apps/web/app/library/page.tsx` (L26 no project context), `apps/web/components/AppShell.tsx` (L123/L146 Elements-vs-Library label, hardcoded "founder").

======================================================================
# WORKFLOW — CRITIQUE
======================================================================

I have what I need. The architecture confirms three things the proposal materially understates or gets wrong, and they sharpen the critique decisively. I have enough grounding. Writing the critique now.

# Skeptical Critique: Fikirtive UX Redesign Proposal

The proposal is well-argued and the diagnosis (§1) is correct and load-bearing: no generate-on-Workbench, references collapse to text at the handoff. But it is **synthesized at too high an altitude** — it treats "reuse the shipped ref-gen path for shots" (S1+S2) as a clean port when the code says otherwise, and in doing so it buries the single hardest, most important risk under a confident "this is the whole ballgame." Below, the gaps.

---

## 1. COVERAGE GAPS

**A. The biggest gap is one NO persona is allowed to state plainly: the path the proposal says to reuse produces stills, but every persona wants video.** The proposal's spine — S1+S2+S3, "reuse the exact fal/Seedream path the Library already ships" — rests on `GenerateRefsBlock` → `refgen-actions` → the refgen worker. That worker is a **Seedream image-edit call capped at 15 images** (`apps/worker/src/jobs/refgen.ts` L35: "fal Seedream edit caps total (inputs + outputs) at 15 images"). It is an image generator. Yet all five personas state a **video** goal: "20-second vertical TikTok ad," "15-second performance ad," "45-second narrative MV," "GRWM clip," "Instagram ad… get clips." The proposal's §2 even says the result "auto-attaches to the selected shot **as V1**" and flows "Library → Composer → shot candidate → **Editor clip**." But reusing the refgen path gives you a **still image on the shot**, which the Editor then pads to a hard-coded 3 seconds (`editor/page.tsx` L15, `IMAGE_SECONDS = 3`). So "ship S1+S2+S3 and four of five personas export an ad" is **not true as written** — they'd export a slideshow of 3-second stills, which is exactly the artifact the personas are trying to escape. The honest version of S1 is *two* features: (a) in-app **still** generation (a real port, ~M), and (b) in-app **image-to-video** generation (a **new** provider integration — no Veo/Kling/Seedance/`i2v` endpoint exists anywhere in the repo; `grep` for them returns nothing). The proposal collapses these into one "M" and calls it "the difference between 'I'd never finish' and 'I'd finish.'" That sequencing claim is the proposal's central promise and it is the least verified thing in it.

**B. The director's continuity primitive is named but the proposal's own #1 fix can't deliver it.** §2 and §6.6 promote "New version from this shot" / "Maya, now wet" as the narrative wedge. But true continuity (LTX's Retake: "regenerate a 2-16s sub-segment, blended with surrounding frames") is a *video* operation. Cloning `promptDoc` + `entityIds` (what the proposal scopes it as) only re-rolls a fresh still from the same references — it does **not** carry forward the previous frame's lighting/wardrobe/pose. The proposal quietly downgrades the director's actual need ("same look, now soaked, from *this* frame") to "start from a non-blank prompt." That's a real gap it papers over.

**C. Audio is dropped entirely.** Two personas raise it: the UGC creator ("trend audio slapped on") and the MV director ("cuts ride the music," "rain, footsteps"). The UGC persona explicitly flags "Fikirtive has *no visible audio import path* on its Editor beyond raw Shotstack." The proposal's §2 editor step says "Export MP4 in the chosen aspect ratio… **leave it alone**." For a *short-video ad* tool, shipping silent clips is a real hole, and the proposal doesn't even list it as a known non-goal. At minimum it should be named and deferred, not omitted.

**D. The "auto-attach" win is overstated.** §2/S3 sell auto-attach as nearly free ("rides S1," "the upload already carries shot provenance"). But `attachGeneration`/upload provenance (`actions.ts` L243–266, L315 "Lands in the candidate zone, shotId = null") is the **manual upload** path. In-app generation from a shot is a *different* code path that doesn't exist yet — there's no shot-scoped refgen job (refgen jobs key to `entityId`, not `shotId`). So "auto-attach" isn't reusing existing provenance plumbing; it's new wiring (generation job needs to carry a `shotId` and land in `shot.generations`). Not hard, but not the freebie the table implies.

**E. Cost/throughput friction the personas felt, dropped from the economics.** The UGC creator's core anxiety is **cost-per-attempt at volume** (5–8 videos/day × variations). The proposal mentions cost *badges* (§4.5) but never models what batch generation *costs* a volume user, or that "forgiving iteration" (§5) and "Generate N variations" (S6) are in direct tension — more variations = more spend on a pay-per-gen model. It asserts "make re-rolling feel cheap and predictable" without saying how, given there's a real fal bill per roll. That's the one place the wedge claim ("forgiving iteration is a weapon") is hand-waved.

---

## 2. RISKY ASSUMPTIONS

**A. "The backend port already supports fal — this is one wire away."** This phrase recurs across the proposal and personas and is doing enormous load-bearing work. What the backend supports is **fal Seedream image edit, conditioned on an entity's own references**. The comment at `refgen.ts` L20 is a warning the proposal ignores: *"the request never carried image URLs — the worker resolves them HERE from the entity's own references… [otherwise it] silently degrade[s] to unconditioned text-to-image."* This is a deliberate **trust boundary (D19)**: the client is *not trusted* to pass reference URLs. The proposal's S2 ("resolve @mentions to actual reference image URLs **into generation**, pass them as conditioning") proposes to pass *multiple entities'* refs *from the composer* — which crosses exactly the boundary the worker was built to refuse, and for a *multi-entity* shot (Maya + Sneaker + Logo = easily >15 images against the 15-image cap). S2 is not "the broken line of code" (§5) — it's a new conditioning model (multi-entity, shot-side resolution, cap arbitration) the current single-entity, server-resolved design explicitly avoided. **This is the riskiest assumption in the document and it's presented as trivial.**

**B. Over-indexing on the solo/UGC persona's "one button" frame.** Four of five personas converge on "add Generate," so the proposal treats that convergence as proof. But convergence across personas who were *given the same code map and the same LTX comparison* is weak evidence — they were primed to find the same wall. The agency CD's actual blocker (no seats, NDA-blocking global library) is **architecturally orthogonal** to the Generate button and the proposal correctly walls it into S4/S5 — but then still lists S4 as serving "the agency CD" as if Generate helps her. It doesn't. Her bounce point (per her own sim) is **Step 3, before a single shot** ("there is no junior… I'd bounce right here"). The proposal's headline ("converts 'I bounce in 4 minutes' into 'I export an ad' for four of five personas") silently excludes her — which is honest in the sequencing note but dishonest in the framing.

**C. The Target picker as "the wedge made visible" may be backwards for 4 of 5 personas.** §5 leans hard on the model-neutral Target picker as the moat. But the three non-technical personas (brand owner, UGC, agency CD) **explicitly do not want to see the model** — "I don't want to learn ComfyUI," "the model is abstracted away," "presets, never a graph." Only the founder/ComfyUI persona wants model choice. So the picker is the wedge for **one** persona and *cognitive load* for the other four. The proposal calls it "non-negotiable" for "every persona" (§6.1) — that's an overreach. The defensible version: default to in-app, hide the picker behind "advanced," surface neutrality as a *capability* (copy-out manifest) not a *required decision*. The proposal half-says this ("demote ComfyUI to advanced") but then ranks the picker as Q1, the top quick win, which over-weights the one power user.

**D. Aspect ratio "threaded into generation framing" assumes generation framing exists.** Q2 says thread 9:16 "into both generation framing and editor output." The editor output is a real, locatable change (`editor/page.tsx` L58, hard-coded `aspectRatio: "16:9"`). But "generation framing" presupposes the generate path (which doesn't exist yet) accepts an aspect param — and Seedream image-edit output dimensions are driven by the input refs, not a free aspect knob. So Q2 is **two changes of very different size** filed as one "S": the editor fix is trivial; making generation honor 9:16 depends on the unbuilt video path. Mislabeled.

---

## 3. SEQUENCING

**The headline sequencing is wrong because it's built on the still/video conflation (Gap A).** "Ship S1+S2+S3 together and four personas export an ad" cannot be true if S1 reuses the still path. Corrected sequencing:

- **S1 splits into S1a (in-app still gen, real port of refgen to shot scope) and S1b (i2v video gen, new provider).** S1a is M; S1b is L (new integration, new cost surface, new failure modes). The proposal's "M" is really "M + L." **S1b, not S1a, is the actual ballgame** — it's what turns stills into the ad the personas want.

- **Q1 (Target picker) is mis-ranked as the #1 quick win.** It's a quick win *technically*, but it's the **lowest-value** of the six for four of five personas (§2.C above), and it's pointless until there's a generate path to target. It should ship *with* S1, not lead the quick-win batch. The true highest-leverage quick win is **Q4 (kill the generate-door bait-and-switch)** — every persona hit it in the first 60 seconds, and the UGC/brand-owner personas rank it as an early trust-killer.

- **Q5 (inline "+ Create @xyz") is under-ranked at S/M and listed as a "quick win," but it's coupled to a data-loss bug the proposal doesn't escalate.** The UGC persona: leaving the composer to create an element fires `confirm("Discard unsaved prompt changes")` (Workbench L67–68) and **destroys the draft**. That's not a "quick win," that's a **rage-quit / data-loss defect**. Draft-preservation should be P0-bug priority, separate from the nicety of inline-create.

- **S4 (seats/roles) correctly walled off, but P0-for-its-persona.** The proposal says "don't let it block the solo fix" — right. But it should state the converse equally loudly: **for the agency, nothing else matters until seats exist**, and the agency is the only *paying-team* segment in the set. Burying it as "a different customer, don't let it block" risks reading as "deprioritize," when it's "parallel track, equally urgent for that buyer." The proposal's own agency sim says she bounces before generating — so every Generate-button investment is invisible to her.

- **The global-vs-project Elements scoping (Q3) is mis-sized as an "S" label fix.** The proposal frames Q3 as "pass project + add one line of copy." But the agency persona's finding is that the library being **globally shared is an NDA/legal blocker** — competing clients' brand kits in one pile. The *label* is S; the *actual fix* (scoping Elements to a project/client, which the agency P0 demands) is a **data-model change (M/L)**, the same thing as S5. Filing the label under Q3-quick-win and the real scoping under S5 splits one problem across two priority tiers and lets the quick-win table imply the NDA problem is "handled." It isn't.

---

## 4. WHAT'S UNVERIFIED (validate with users before building)

1. **That a single in-app **still** generator (S1a alone) is enough to retain anyone.** The personas want video. Before building S1b (the expensive L), validate: does an in-app *still*-to-shot loop + 3s-padding actually convert *any* persona, or do they all still bounce at "this is a slideshow, not an ad"? If still-only retains no one, S1a is a stepping stone, not a shippable release — which changes the whole "ship one thing" calculus.

2. **That power users want in-app fal at all, vs. a better copy-out.** The founder persona is a *ComfyUI* user who wants their *own* tuned LoRA of Maya — which in-app fal/Seedream **cannot run**. So for the one persona who wants model choice, the valuable deliverable may be S2's **reference manifest copy-out**, not the in-app Generate button. Validate whether the founder would even *use* in-app fal or would always copy out to their graph. If the latter, the "one release" is mis-targeted: the founder needs the manifest, the non-technical four need video, and *neither* is the fal-still button the proposal leads with.

3. **That auto-cast-from-brief ("Draft shots from a brief," §6.4) is wanted, given the proposal simultaneously says NOT to borrow auto-cast (§4).** This is an internal contradiction: §4 says auto-cast is "exactly where LTX breaks" and a "do NOT borrow," but §6.4 ships a "draft shots from a brief" seeder serving 4 personas. The line between "seed titled shots with suggested prompts" and "auto-cast" is blurry and unvalidated. Test whether users want the seeder or find it the same off-brand magic the proposal warns against.

4. **Cost tolerance at volume.** Unverified that the UGC creator's "5 videos before lunch" survives contact with the per-roll fal bill across batch + variations. Get a real number in front of that persona.

5. **That "Locked" / Elements-vs-Library / "Unattached" are *the* vocabulary blockers** vs. surface noise. Cheap to fix, but the proposal asserts impact ("each unfamiliar term costs trust") without evidence any of them is a *bounce* cause rather than a shrug. Validate before spending a coordinated rename pass.

---

## 5. THE ONE THING

**The proposal says the one thing is "S1+S2+S3 as a single release, with Q1 and Q2." That is wrong as stated — and more importantly, it's wrong about *which half* is the moat.**

The one thing should be: **make the @-mentioned references actually condition an in-app generation that lands on the shot — and prove it on stills first (S1a + S2), as a thin vertical slice, before committing to the video provider (S1b).**

Two corrections to the proposal's framing:

1. **The differentiated half is S2 (references conditioning generation), not S1 (a Generate button).** The proposal actually says this in §5 ("the differentiated version of S1 is S2") — but then its §3/§6 "ship one thing" recommendation foregrounds the *button* and the *Target picker* (Q1) and folds S2 in as a sub-bullet. The emphasis is inverted. S2 is the wedge; S1 is the delivery mechanism; the Target picker is a power-user nicety. If the founder reads §6's "decisive recommendation," they'll build the button and the picker and risk shipping the LTX-clone trap the proposal itself warns about three sections later.

2. **The proposal does NOT make clear that "reuse the shipped path" gets you stills, not video** — so a founder following it literally will ship a 3-second-slideshow exporter, demo it against the personas' video goals, and conclude the redesign failed. The single most important correction this critique offers: **separate "generation works in-app and carries references" (provable on stills, a real port, do this first) from "generation produces video" (new provider, the expensive part, validate demand before building).** The proposal's confidence that these are one "M"-sized thing is the document's central unverified leap.

So: the One Thing is right in spirit (in-app generation that carries references) but the proposal **mis-scopes it** (still vs video conflated into one M), **mis-emphasizes it** (button/picker over conditioning), and **over-promises it** ("four of five export an ad" — they export a slideshow). Fix the scoping and the emphasis and it's the right call.

**Anchor for the correction:** `apps/worker/src/jobs/refgen.ts` (L20 trust-boundary comment; L35 15-image cap) and `apps/web/app/editor/page.tsx` (L15 `IMAGE_SECONDS = 3`; L38 `VIDEO_EXTS` — the editor already distinguishes video from image, which is exactly why shipping only stills will be visibly wrong). No video provider endpoint (`veo`/`kling`/`seedance`/`i2v`) exists anywhere in `apps/worker/` or `apps/web/lib/` — confirming S1b is net-new, not a port.

