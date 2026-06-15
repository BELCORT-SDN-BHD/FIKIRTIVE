-- Race-proof backstop for refgen double-spend (mirrors GenJob_active_idempotency_key).
-- startRefGen and dispatchVariantJob each do findFirst(active)-then-create, a TOCTOU
-- window: two near-simultaneous requests (two tabs/devices, a network double-submit)
-- both pass the "already running" check and both create a PAID RefGenJob. A partial
-- UNIQUE index closes it at the DB; the app catches the P2002 and reuses the in-flight job.

-- Resolve any pre-existing active duplicates (the very race this index closes) so the
-- unique index can be built. Keep the SAFEST active row per (owner, entity, variant) and
-- mark the rest FAILED (abandoned). "Safest" = prefer GENERATING over QUEUED, then newest,
-- then id: a GENERATING row may already have spent at the provider, so it must SURVIVE,
-- and the QUEUED loser is the one failed (it hasn't spent). Failing a QUEUED row is safe —
-- the worker treats FAILED as terminal and skips it (no spend); failing a GENERATING
-- winner instead would abandon a possibly-paid job AND let the kept QUEUED duplicate spend
-- later (a double charge). No spend here either way — just frees the slot.
UPDATE "RefGenJob" r
SET "status" = 'FAILED',
    "error" = CASE WHEN r."error" = '' THEN 'abandoned: superseded duplicate (active-uniqueness migration)' ELSE r."error" END
WHERE r."status" IN ('QUEUED', 'GENERATING')
  AND EXISTS (
    SELECT 1 FROM "RefGenJob" n
    WHERE n."ownerId" = r."ownerId"
      AND n."entityId" = r."entityId"
      AND COALESCE(n."variantId", '') = COALESCE(r."variantId", '')
      AND n."status" IN ('QUEUED', 'GENERATING')
      AND n."id" <> r."id"
      AND (CASE n."status" WHEN 'GENERATING' THEN 1 ELSE 0 END, n."createdAt", n."id")
        > (CASE r."status" WHEN 'GENERATING' THEN 1 ELSE 0 END, r."createdAt", r."id")
  );

-- CreateIndex: partial UNIQUE so at most one ACTIVE (QUEUED/GENERATING) refgen job exists
-- per (owner, entity, variant). COALESCE(variantId, '') is load-bearing: base/REFSHEET jobs
-- have variantId NULL, and Postgres treats NULLs as DISTINCT, so a bare (entityId, variantId)
-- unique would NOT block two NULL-variant jobs — COALESCE collapses them to '' so base/REFSHEET
-- SERIALIZE per entity, while Phase B's per-variant VARIANT jobs keep their own variantId and
-- still run concurrently. (Safe because variantId is NULL or non-empty: refGenRequest enforces
-- z.string().min(1) and variant ids come from newId(), so a real '' can never collide with NULL.)
-- DONE/FAILED rows are excluded so regenerating later is allowed. The enum is compared to its
-- own labels (no ::text cast — that cast is not IMMUTABLE and is rejected in an index predicate);
-- COALESCE over text is IMMUTABLE and valid in an index expression.
CREATE UNIQUE INDEX IF NOT EXISTS "RefGenJob_active_entity_variant_key"
ON "RefGenJob"("ownerId", "entityId", COALESCE("variantId", ''))
WHERE "status" IN ('QUEUED', 'GENERATING');
