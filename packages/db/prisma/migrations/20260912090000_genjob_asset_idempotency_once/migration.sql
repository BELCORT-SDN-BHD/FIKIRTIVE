-- #1375 / docs/specs/asset-action-idempotency.md §1.4 改动三 (ASSET-A6, ASSET-A10)
--
-- An `asset:<op>:<digest>` key must generate EXACTLY ONCE EVER — not just once while
-- active. The general "GenJob_active_idempotency_key" is partial on ACTIVE status
-- (QUEUED/GENERATING), which is right for shot-frame keys (the same slot may legitimately
-- be regenerated later) but wrong for this family: since #1375 the digest already carries
-- the browser's per-click intent id, so the SAME key can only ever mean "a replay of that
-- one click" — deliberately buying another image mints a new intent id and therefore a new
-- key. startAssetGen's app-level reuse read is all-status too, but that read is not atomic
-- with the insert: a TOCTOU race (both submits pass the read; the first reaches DONE before
-- the second inserts) would otherwise create — and pay for — a second job, because the
-- active-only index no longer covers the finished first one. This all-status partial-unique
-- index closes that window for `asset:` keys ONLY. The general and cowork paths are
-- untouched. LIKE against a constant pattern is IMMUTABLE, so it is valid in an index
-- predicate.

-- Spec §1.4: 未公测、零商家数据,所以历史里预期一行重复都没有。如果真有,这条迁移必须
-- **停下报错**,绝不静默丢行,也不让 CREATE UNIQUE INDEX 自己抛一句读不懂的话 —— 重复行
-- 意味着有人已经为同一件东西付过两次钱,那是要人来裁的账,不是迁移能替商家决定的。
DO $$
DECLARE
  dupes bigint;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1
    FROM "GenJob"
    WHERE "idempotencyKey" LIKE 'asset:%'
    GROUP BY "ownerId", "projectId", "idempotencyKey"
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'Refusing to add GenJob_asset_idempotency_once: % (ownerId, projectId, idempotencyKey) group(s) already hold more than one asset: job. Each duplicate is a double charge that must be reconciled by hand before this index can exist.',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "GenJob_asset_idempotency_once" ON "GenJob"("ownerId", "projectId", "idempotencyKey")
WHERE "idempotencyKey" LIKE 'asset:%';
