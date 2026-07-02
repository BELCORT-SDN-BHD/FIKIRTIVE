-- Race-proof backstop for refgen double-ATTACH (codex review 2026-07-03). attachOutputs
-- (apps/worker/src/jobs/refgen.ts) does findFirst(live)-then-create on ReferenceImage, a
-- TOCTOU window: a reaper-resumed redelivery racing a live delivery's attach (or two
-- redeliveries) can both pass the "already attached" check and create duplicate visible
-- refs for the same paid output. Cosmetic (user-deletable, no money impact) — but a
-- partial UNIQUE index closes it at the DB; creators catch the P2002 and skip (the
-- concurrent winner already attached). Additive-only: no drops, no type changes.

-- Resolve any pre-existing live duplicates (races already materialized, or the same image
-- uploaded twice — assetUpsert content-dedups both files to one Asset) so the unique index
-- can be built. Per (entity, asset, COALESCE(variant,'')) keep the LOWEST-position live row
-- (ties: oldest createdAt, then lowest id — deterministic) and soft-delete the rest, exactly
-- what a user deleting the visual duplicate would do. Soft-deleted rows are already out of
-- scope (and stay untouched); the kept row carries the same assetId, so Entity.baseAssetId
-- pointers keep resolving.
UPDATE "ReferenceImage" r
SET "deletedAt" = NOW()
WHERE r."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ReferenceImage" k
    WHERE k."entityId" = r."entityId"
      AND k."assetId" = r."assetId"
      AND COALESCE(k."variantId", '') = COALESCE(r."variantId", '')
      AND k."deletedAt" IS NULL
      AND k."id" <> r."id"
      AND (k."position", k."createdAt", k."id") < (r."position", r."createdAt", r."id")
  );

-- CreateIndex: partial UNIQUE so the same asset is attached at most ONCE live per
-- (entity, variant) scope. COALESCE(variantId, '') is load-bearing (mirrors
-- RefGenJob_active_entity_variant_key, 20260615120000): base-level refs have variantId
-- NULL, and Postgres treats NULLs as DISTINCT, so a bare (entityId, assetId, variantId)
-- unique would NOT block two null-variant dups — COALESCE collapses them to ''. Safe
-- because variantId is NULL or a newId() (never a real ''). The same asset can still be
-- both a base ref and a per-variant ref (different COALESCE keys). Soft-deleted rows are
-- excluded (WHERE), so delete-then-reattach keeps working.
CREATE UNIQUE INDEX IF NOT EXISTS "ReferenceImage_live_entity_asset_variant_key"
ON "ReferenceImage"("entityId", "assetId", COALESCE("variantId", ''))
WHERE "deletedAt" IS NULL;
