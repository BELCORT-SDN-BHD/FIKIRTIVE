-- L1 publish recovery anchor (spec docs/superpowers/specs/
-- 2026-07-10-l1-meta-organic-publish-lighting.md §四D lock 3 + §四F). Additive ONLY: one new
-- nullable column on PublishAttempt. The publish worker stores the IG media container id here
-- BEFORE calling media_publish, so a crash/redelivery reconcile re-checks that exact container
-- (Meta-idempotent) instead of rebuilding + re-posting → never double-publishes. Null for FB.
-- No DROP / no ALTER-that-drops / no changes to any existing column. $0 path (organic is free).

-- AddColumn
ALTER TABLE "PublishAttempt" ADD COLUMN "creationId" TEXT;
