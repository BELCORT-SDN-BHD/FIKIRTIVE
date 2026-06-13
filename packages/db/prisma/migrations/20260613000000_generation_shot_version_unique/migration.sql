-- Drop the old NON-partial unique index first: it constrains ALL rows incl.
-- soft-deleted ones, so a deleted version permanently blocks reuse (attachToShot
-- allocates from the LIVE max and would collide with a tombstone). The partial
-- live-only index below replaces it as the source of truth.
DROP INDEX IF EXISTS "Generation_shotId_version_key";

-- De-dup live (shotId, version) so the partial unique index below can be created
-- even if the prior non-atomic version allocation produced collisions. Renumber
-- each shot's LIVE generations to sequential versions (order preserved: version,
-- then createdAt, then id), so the "latest" (max version) generation is unchanged.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "shotId" ORDER BY "version" ASC, "createdAt" ASC, "id" ASC) AS rn
  FROM "Generation"
  WHERE "shotId" IS NOT NULL AND "deletedAt" IS NULL
)
UPDATE "Generation" g
SET "version" = r.rn
FROM ranked r
WHERE g."id" = r."id" AND g."version" <> r.rn;

-- At most one LIVE generation per (shot, version) — makes the worker's per-shot
-- version allocation race-safe (attachToShot retries on this violation). The
-- predicate is immutable (plain NULL checks), valid in an index predicate.
CREATE UNIQUE INDEX "Generation_shot_version_live" ON "Generation"("shotId", "version")
WHERE "shotId" IS NOT NULL AND "deletedAt" IS NULL;
