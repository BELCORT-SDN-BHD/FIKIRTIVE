# Grok Image flow change proposal

**Status:** Founder approved and frozen for prototype implementation.  
**Date:** 2026-08-29.  
**Scope:** Fixture-only Canvas product pattern. Production generation, money, Library, Campaign, and Schedule contracts are unchanged.

**Founder approval:** Approved 2026-08-29. Founder explicitly overrode the standing one-night cooling period with “没事，继续”.

## Why this proposal exists

The frozen Canvas spec currently combines Stitch's spatial workspace with a custom `paid plan → Make/Make all → Approved → dependency queue` creation model. Founder review found that this makes image/video creation feel heavier than the intended Grok Image experience.

The proposed authority split is:

- **Grok Imagine owns creation logic:** prompt, reference inputs, generation controls, results, follow-up edits, variations, image-to-video, history, and direct output actions.
- **Stitch owns workspace mechanics:** full-screen Canvas, selectable artifacts, pan/zoom, spatial arrangement, and contextual selection.
- **Fikirtive owns trust boundaries:** exact credit quote before each paid generation, durable money status, Brand context, Library indexing, and Campaign/Schedule handoff.

## Evidence reviewed

### Mobbin — Grok Web

1. [Imagine](https://mobbin.com/flows/e8598a7f-01ba-47ee-b28e-9a82b9bf7b53)
   - Prompt-first discovery surface with Image/Video mode and aspect ratio in the composer.
   - Templates and recent/discoverable work are visible before the first prompt.
2. [Generating an image from template](https://mobbin.com/flows/bf5ac718-7a11-4839-9eed-940cccf23c9b)
   - A template collects only the inputs needed for one known job, then generates directly.
   - The finished asset opens as the main surface with edit, retry, download, share, and `Make video` actions.
3. [Creating an image](https://mobbin.com/flows/64c96a9e-1cf3-426e-abae-d73080f262bc)
   - Results remain inside a conversation; a follow-up prompt produces the next set of variations without a separate approval phase.
4. [Generating an image (drawing)](https://mobbin.com/flows/ef221af2-340c-4357-b537-397811bddd6c)
   - Drawing/reference becomes the source artifact; creative/background/subject controls and natural-language follow-up create a non-destructive result.
   - Chat stays beside the source/result instead of becoming a separate task-management product.
5. [Generating a video](https://mobbin.com/flows/4a614a21-6ef8-4bc5-a713-c18a62700a6f)
   - Upload/reference and prompt are composed in one place.
   - Generation progress is shown on the media itself; the result keeps retry, download, share, rating, extend, and upscale actions.
6. [Rating a video](https://mobbin.com/flows/dc1047e0-9573-40a2-a399-e91888773ab3)
   - Feedback and secondary actions live in the result overflow, not in a permanent inspector.
7. [Imagine history](https://mobbin.com/flows/9464567b-6eb5-497b-a3de-356e32fde3b6)
   - History is a lightweight way to revisit prior generations, not a second execution queue.

### Current Grok Imagine spot-check — Chrome, 2026-08-29

- Signed-in home currently exposes `New Generation`, `Chat`, and `New project` around one prompt composer.
- Image mode exposes `Speed / Quality (v2.0)` and `2:3 / 3:2 / 1:1 / 9:16 / 16:9`.
- Video mode exposes `480p / 720p`, `6s / 10s / 15s`, audio, and aspect ratio.
- Current templates include Photo Edit, Smart Resize, Reimagine, Background Removal & Change, E-Commerce Photos, UGC Photos, and Hero Product Reveal.
- `Photo Edit` asks for one image, one precise edit, and optional details.
- `Hero Product Reveal` asks for one product image and an optional aspect ratio, then creates a three-shot reveal video.

Mobbin and the current UI agree on the primary model: **direct generation and iterative result editing**, not an upfront multi-step plan requiring creative approval.

## Recommended Fikirtive creation state machine

```text
Prompt / template / selected artifact
  → Otto asks only a genuinely blocking question, if needed
  → exact credit quote for the next paid generation
  → Founder confirms that generation
  → Generating on the destination artifact
  → Ready result on Canvas and in Library/Generations
  → follow-up: Edit / Variations / Animate / Retry / Download / Share / Use in…
```

Every follow-up that spends credits repeats the same small `quote → confirm → generate` boundary. Free Canvas operations and free Otto guidance do not show a paid plan.

## Proposed interaction changes

### 1. Replace the paid plan card

Remove the large multi-step plan and `Make all` card from the primary path. Otto may still explain a longer strategy conversationally, but only the next executable paid action becomes a compact quote.

Example:

> Generate 4 product-photo directions  
> 4:5 · Brand and product photo attached  
> **8 credits** — `Generate`

An explicit user-requested batch can have one aggregated confirmation, but the UI must not invent a batch before the Founder asks for one.

### 2. Put status on the artifact

The image/video node owns `Queued / Generating / Ready / Failed / Cancelled` and the trustworthy credit outcome. Do not duplicate these as permanent rows in Agent log.

### 3. Make Otto conversation the iteration history

- The floating Otto surface shows the current conversation and result-producing turns.
- The lower history surface is renamed conceptually from an execution log to **History** or **Turns**.
- It lists prompts and generated results so the Founder can revisit a turn.
- It does not pretend to be a dependency scheduler.

### 4. Remove creative `Approved`

`Approved` is the wrong state for exploration. A ready image is already usable. Selection is expressed at the moment of an intentional action:

- `Use in campaign`
- `Schedule`
- `Share selected outputs`
- `Download`

Operational generation status and business handoff selection remain separate concepts.

### 5. Make the result the center of gravity

When a node is selected, the frequent actions are:

- `Edit`
- `Variations`
- `Animate` for images
- `Retry`
- `Download`
- `Share`

Secondary actions such as compare, upscale, remove from Canvas, and feedback live under `More`.

### 6. Keep templates lightweight

Templates are optional starting points, not required presets. Each template asks only for the fields that materially improve its output. A Founder can always start with a free prompt.

### 7. Keep Library automatic

Every successful generation still indexes automatically in Library → Generations. Canvas placements, Library records, and handoff destinations continue to reference the same artifact id.

## What remains from the frozen spec

- Full-screen desktop Canvas and prompt-first Create home.
- One bottom omnibox for new creation and follow-up editing.
- Selection context chips.
- Non-destructive versions and lineage.
- Automatic save, background continuation, and durable retry safeguards.
- Library/Generations as the cross-project index.
- Read-only, revocable share links.
- Campaign/Schedule as explicit handoffs, never silent publishing.
- Exact credit truth and idempotent money actions.

## What is removed or renamed

- Remove: mandatory upfront paid creation plan.
- Remove: default `Make all` path.
- Remove: `Approved` as a creative-result status.
- Remove: Agent log as a dependency/task queue.
- Rename/reframe: Agent log → conversation/generation History.
- Replace: `Approved only` sharing → `Selected outputs` sharing.

## Scrap cost and boundary

This is a direction-level change to an approved and frozen pattern, but the current route is fixture-only. Expected rework is concentrated in the Canvas pattern model, fixtures, reference component, tests, README, and QA evidence. Production generation and money paths are not yet integrated, so no backend or persisted user data needs migration.

The Founder explicitly reconfirmed this Grok-based direction and authorized implementation after the cooling reminder.

## Acceptance criteria for the next prototype

1. A Founder can start from a free prompt or a lightweight template.
2. A paid generation shows one exact quote immediately before that generation.
3. Progress is visible on the destination artifact and remains usable while other Canvas work continues.
4. A ready result can be edited, varied, animated, retried, downloaded, shared, or handed off without an `Approved` gate.
5. Conversation/history can restore prior prompts and results but does not duplicate operational status.
6. Every successful output appears automatically in Library → Generations.
7. Existing money-truth, cancellation, refund, unknown-state, and idempotency rules remain intact.
8. The prototype still uses the approved Fikirtive design system and Otto orange; Grok contributes flow logic, not copied branding.

## Non-goals

- Copying Grok's black visual theme or brand.
- Exposing provider/model names to the Founder.
- Building Grok's API console or subscription/paywall UI.
- Implementing production generation, persistence, or money movement in the review route.
- Turning Canvas into a full pixel editor or timeline editor.
