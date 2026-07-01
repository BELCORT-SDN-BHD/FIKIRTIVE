# Canvas image→video flow — Grok-aligned enhancements (design)

Date: 2026-07-01 · Status: approved (founder: all four, phased, keep it simple)

## Context

Founder feedback on the canvas after the toolbar / confirm-dialog work (#82). Four
Grok-aligned enhancements to the image→video creation flow, built in phases: the
cheap front-end wins first, the money-path changes last. Grounded in a read of the
current code (`useCanvasGen.ts`, `byteplus.ts`, `refgen.ts`).

**Money path stays sacred.** Every paid action is gated by an explicit OK the owner
clicks (the founder's rule: user prompts → clicks OK → it generates). No change to
`startGen` / idempotency / dedup / the provider charge logic. Phases 2 and 3 pass
money-safety-review before merge.

## Phase 1 — canvas-only, no cost (ship first) — BUILT

### 1a. Motion presets
The "Make a video?" confirm dialog offers three motion choices instead of a bare OK:
**Gentle** (default — the current "gentle, natural motion" prompt), **Dynamic**, and
**Custom…** (reveals a text field). Each maps to a motion prompt string passed to the
existing `animate()`. Custom falls back to the gentle default when empty, so the paid
prompt is never empty. Still one OK → spend; no spend-logic change.

### 1b. Make video on hover
Node action buttons (Detail / Make video / ✕) are hidden until the node is hovered
**or selected** (select-reveal keeps them reachable without a hover, e.g. touch).
CSS-only (`.cv-node-actions` on each node's button container).

## Phase 2 — variant grid (image), 4× cost

- Image generation returns 4 variants instead of 1 (`generateImage` `count: 1→4`; the
  BytePlus image provider already loops `count` requests).
- The image node shows a 2×2 grid; the owner clicks one to **pick** it → the node
  adopts that image. All 4 remain in the library (already paid for).
- Because each image gen is now 4× cost, image generation gains a **cost-hint confirm**
  (OK before spend), parallel to the video confirm.
- **Money-safety-review required** (touches `genRequest.count` and the charge amount).
  No change to dedup / exactly-once.

## Phase 3 — text-to-video fallback, backend + money-path

- The video tool with **nothing selected** opens a video prompt composer → OK →
  generates from text (no source image).
- Feasibility: the BytePlus provider already supports no-image
  (`byteplus.ts` — `const i2v = req.imageUrl.length > 0`, image only added when
  present). So this is plumbing, not a new model integration:
  - make `VideoRequest.imageUrl` optional through interface → gate → worker;
  - allow `genRequest` video without `sourceGenerationId`.
- Confirm at build: prod's active video model actually does t2v (`activeVideoModel()`
  defaults to `veo3.1-lite`, but the BytePlus map only has `seedance-2-fast` — verify
  which runs in prod and that it supports text-to-video).
- **Money-safety-review required** (new spend entry). No change to per-clip charge or
  dedup.

## Order

1 (a + b) → 2 → 3. Phase 1 ships on its own.
