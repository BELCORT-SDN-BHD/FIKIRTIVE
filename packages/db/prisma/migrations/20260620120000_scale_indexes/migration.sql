-- Scale-readiness covering indexes (scale audit 2026-06-20).
-- Additive only: pure CREATE INDEX for the per-render tenant hot paths. No table rewrite;
-- a brief lock per index, negligible on current (small) tables. The column order is
-- equality-columns-first then the ORDER BY column so WHERE+ORDER BY is fully index-served.
--   Generation_media_idx       → getProjectMedia (Assets library)
--   Generation_candidates_idx  → getCandidates (Storyboard strip + editor clip pool)
--   Shot_order_idx             → getShots ([scene asc, number asc] storyboard order)

-- CreateIndex
-- id is the tie-breaker for getMediaPage's keyset pagination (ORDER BY createdAt DESC, id DESC)
CREATE INDEX "Generation_media_idx" ON "Generation"("ownerId", "projectId", "threadId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Generation_candidates_idx" ON "Generation"("ownerId", "projectId", "shotId", "threadId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Shot_order_idx" ON "Shot"("ownerId", "projectId", "deletedAt", "scene", "number");
