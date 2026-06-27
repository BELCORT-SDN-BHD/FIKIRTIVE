# Design spec — G2b · Detail-panel editor tools (stacked on G2a)

Date: 2026-06-27 · Branch: claude/otto-g2b-editor-tools (off claude/otto-g2-asset-editor).
Finishes the per-asset editor items re-scoped out of G2a.

## Scope (4 items, all DetailPanel enhancements; reuse-heavy)
- **25 variant switcher:** `getGeneration` also returns sibling urls from the producing GenJob
  (`genJob.generationIds` → their assets, owner-scoped). DetailPanel shows a thumbnail strip to
  switch the displayed media; selection persisted via `readPick`/`writePick` (`lib/result-pick.ts`).
- **17 aspect picker:** a segmented control for the Animate flow from
  `GEN_VIDEO_MODEL_OPTIONS[activeVideoModel()].aspectRatios` (only when non-empty); passed to the
  animate `startGen({ aspectRatio })`.
- **24 edit @composer:** a `MentionInput` "describe your edit, @ to reference" field in the panel →
  `startGen({ kind:"image", prompt, entityIds, projectId, idempotencyKey })` as a derived edit (reuse).
- **16 crop:** a crop modal (`react-easy-crop`) over the image → cropped blob → owner-scoped
  `saveCroppedGeneration(sourceGenerationId, dataUrl)` that ingests the bytes (`ingestFile`+`assetUpsert`,
  the existing ref-upload path) and creates a new owner-scoped `Generation` row; panel reloads to it.

## Reuse seams (verified)
- `apps/web/components/MentionInput.tsx` (used by GenSpace/Storyboard).
- `apps/web/lib/actions.ts` — `ingestFile`/`assetUpsert` (ingest bytes → Asset).
- `apps/web/lib/result-pick.ts` — `readPick`/`writePick`.
- `packages/core/src/gen.ts` — `GEN_VIDEO_MODEL_OPTIONS[model].aspectRatios`, `videoDefaults`.
- `apps/web/lib/asset-actions.ts` (G2a) — `getGeneration` (extend with `urls`).
- `apps/web/components/asset/DetailPanel.tsx` (G2a) — the panel to enhance.

## Money / safety
- Money path untouched: all generation via the existing `startGen`; crop-save creates a Generation
  row from ingested bytes but does NOT call a paid model (no fal spend) — it's a derived asset.
  No new pricing/credit code.
- Owner isolation: `getGeneration` sibling lookup, `saveCroppedGeneration` are `requireOwner` +
  `ownerId`-scoped; cropped Generation is stamped with the caller's `ownerId`.

## Testing
- Unit: `saveCroppedGeneration` owner-scoping (rejects non-owned source; stamps ownerId);
  `getGeneration` sibling-url lookup owner-scoped. Full `pnpm -r build` passes.

## Out of scope: extend (20) + upscale (22) → G2c (money-adjacent).
