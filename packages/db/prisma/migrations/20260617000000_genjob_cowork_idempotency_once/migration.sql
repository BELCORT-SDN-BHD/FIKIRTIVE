-- CreateIndex: a Cowork gen-card must generate EXACTLY ONCE EVER — not just once
-- while active. The general "GenJob_active_idempotency_key" is partial on ACTIVE
-- status (QUEUED/GENERATING) so a shot frame can legitimately be regenerated later
-- with the same key; that is correct for the general path. But a "cowork:<cardId>"
-- key is single-shot: the app guards it (coworkGenerate's any-status read), yet that
-- read is not atomic with the insert, so a TOCTOU race (two submits both pass the
-- read, the first finishes DONE before the second inserts) could create — and pay
-- for — a second job, because the active-only index no longer covers the finished
-- first job. This all-status partial-unique index closes that window for cowork keys
-- ONLY (LIKE 'cowork:%'), so a second insert is rejected at the DB regardless of the
-- first job's status. The general path is untouched. LIKE against a constant pattern
-- is IMMUTABLE, so it is valid in an index predicate.
CREATE UNIQUE INDEX IF NOT EXISTS "GenJob_cowork_idempotency_once" ON "GenJob"("ownerId", "projectId", "idempotencyKey")
WHERE "idempotencyKey" LIKE 'cowork:%';
