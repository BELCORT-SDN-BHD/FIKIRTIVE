-- AlterTable (idempotent: a prior partial apply may have added the column before
-- the index step failed, so re-running this migration must not collide)
ALTER TABLE "GenJob" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- CreateIndex: partial UNIQUE so at most one ACTIVE (QUEUED/GENERATING) job can
-- exist per (owner, project, idempotencyKey) — concurrent same-key submits are
-- rejected at the DB (the app catches the violation and returns the live job), so
-- a reload-double-click can't double-spend. DONE/FAILED rows are excluded, so
-- regenerating later is still allowed. The enum is compared to its own labels (no
-- ::text cast — that cast is not IMMUTABLE and is rejected in an index predicate).
CREATE UNIQUE INDEX IF NOT EXISTS "GenJob_active_idempotency_key" ON "GenJob"("ownerId", "projectId", "idempotencyKey")
WHERE "idempotencyKey" IS NOT NULL AND "status" IN ('QUEUED', 'GENERATING');
