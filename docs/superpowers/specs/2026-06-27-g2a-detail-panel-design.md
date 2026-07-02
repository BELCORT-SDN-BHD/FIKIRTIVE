# Design spec — G2a · Per-asset detail panel (stacked on G1)

Date: 2026-06-27
Status: ✅ SHIPPED — detail panel merged (PR #49 via the #60 stack); live on main.
Branch: `claude/otto-g2-asset-editor` (off `claude/otto-g1-canvas`). Grounded in current main + G1.

## Context
G2 (per-asset editor) is the second PR group. It is what a **canvas node opens into**. Per the
founder's HOW decisions, most of it is reuse. This PR (**G2a**) delivers the **detail panel** +
the reuse action rail + favorite + aspect picker. Split out as follow-ups: **G2b** = crop +
edit-`@composer` (item 16/24); **G2c** = video extend + upscale (items 20/22 — net-new fal
models + pricing, money-adjacent → isolated PR).

## Scope (G2a)
- **15 detail page (优化):** a `DetailPanel` modal showing one asset (image/video) + its prompt +
  an action rail. Reachable from a canvas image node via a new "Detail" action.
- **Reuse rail:** Regenerate (18) · Animate/Make-Video (19/21) · Download · Copy-link (28) ·
  Delete (27) — all reuse existing actions/components.
- **23 sound:** delivered — animate passes the model's `videoDefaults` (incl. `audio`).
- **26 favorite (重建):** add `Generation.favorite` + owner-scoped `setFavorite` + a heart in the rail.

Out of G2a (re-scoped to follow-ups after review): **variant switcher (25)** and **first-class
aspect picker (17)** → G2b; crop (16) + edit-@composer (24) → G2b; extend (20) + upscale (22) →
G2c (money-adjacent). Animate currently uses the model's default aspect via `videoDefaults`; the
user-facing aspect picker is G2b.

## Reuse seams (verified)
- `apps/web/components/Lightbox.tsx` — `Lightbox({src, kind, onClose})` (media overlay).
- `apps/web/components/otto/OttoResult.tsx` — variant chooser + `attemptCopy`/`copyLink` + `Media` (retry).
- `apps/web/lib/result-pick.ts` — `readPick`/`writePick` (variant selection persistence).
- `apps/web/lib/gen-actions.ts` — `startGen(raw)` / `getGenJob(jobId)`.
- `apps/web/lib/actions.ts` — `deleteGeneration(generationId)`.
- `packages/core/src/gen.ts` — `genRequest` (kind/sourceGenerationId/audio/aspectRatio), `GEN_VIDEO_MODEL_OPTIONS[model].aspectRatios`.
- G1: `apps/web/components/canvas/FlowCanvas.tsx` + `nodes/ImageNode.tsx` (node data callbacks).

## Architecture
- **`Generation.favorite`** (Prisma): `Boolean @default(false)` + `@@index([ownerId, favorite, deletedAt])`.
  New owner-scoped action `toggleFavorite(generationId): {favorite:boolean}|{error}` in
  `apps/web/lib/asset-actions.ts` (`requireOwner` + `ownerId`-scoped `updateMany`, fail-closed).
- **`<DetailPanel>`** (new, `apps/web/components/asset/DetailPanel.tsx`): props
  `{ generationId, projectId, onClose }`. Loads the generation (a new owner-scoped reader
  `getGeneration(generationId)` returning `{id, url, kind, prompt, urls, favorite, sourceGenerationId}`),
  renders the media (reuse `Media`/`Lightbox` style) + prompt + the action rail. Modal in normal flow
  (faux-viewport overlay), Esc/click-outside closes (reuse Lightbox pattern).
- **Action rail** (reuse): Regenerate → `startGen({kind:"image", prompt, projectId, idempotencyKey})`;
  Animate → `startGen({kind:"video", model: activeVideoModel(), sourceGenerationId, audio, durationSeconds, resolution, aspectRatio, idempotencyKey})`; Download (`<a download>`); Copy (`attemptCopy`);
  Delete (`deleteGeneration` + close); Favorite (`toggleFavorite`); variant switch (`readPick`/`writePick`).
- **Canvas → detail:** add `onOpenDetail?: (generationId) => void` to `ImageNode` data; add a "Detail"
  button on the node; in `FlowCanvas`, wire `onOpenDetail` (when `generationId` known) to open
  `<DetailPanel>` over the canvas (FlowCanvas owns the panel open-state).

## Money / safety
- **Money path untouched.** Regenerate/Animate go through the existing `startGen` (reserve→settle
  unchanged). Favorite/delete/copy do not spend. No new fal model or pricing in G2a (extend/upscale = G2c).
- **Isolation.** `toggleFavorite` + `getGeneration` are `requireOwner` + `ownerId`-scoped; a non-owner
  cannot read or favorite another tenant's generation.

## Testing
- Unit: `toggleFavorite` owner-scoping (updateMany with ownerId in where; non-owner → not found);
  `getGeneration` owner-scoping. Full `pnpm -r build` must pass (incl. `/otto`).
- Manual (deployed env, mock locally): open a canvas image node → Detail → regenerate/animate/favorite/delete.

## Out of scope (follow-up PRs)
G2b crop + edit-@composer · G2c video extend + upscale (money-adjacent) · history/discover (G5).
