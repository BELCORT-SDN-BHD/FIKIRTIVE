-- TENANT 切片⑤(#1380,规格 docs/specs/tenant-isolation.md「已冻结·v1」TENANT-A7)——
-- ScheduledPostMedia / PublishAttempt 回填 ownerId + 升复合外键。
--
-- ── 这份迁移改了什么 ─────────────────────────────────────────────────────────
-- 这两张表都是 ScheduledPost 的子表,今天各自只靠一条裸外键
-- (scheduledPostId -> ScheduledPost.id)挂父行,自己没有 ownerId 列——租户身份完全靠
-- "去查父行"才知道,数据库看不见、也就拦不住"把 B 租户的媒体/发布尝试挂到 A 租户的帖子
-- 上"这种跨租户挂接(schema 里没有第二个值可以互相校验)。
--
-- ScheduledPost 早就有 @@unique([id, ownerId])(20260703030000_schedule_data_model),父表这半
-- 现成。这份迁移给两张子表各加一列 ownerId、从父行传递性回填、再把外键升级成复合
-- (scheduledPostId, ownerId) -> ScheduledPost(id, ownerId)——挂接一旦跨租户,Postgres 直接
-- 23503 拒绝,不再是"应用层记得查"。
--
-- PublishAttempt 正是规格 docs/specs/tenant-isolation.md §3"不做"节点名、留到这一片评估的
-- 那条("PublishAttempt 无 ownerId 列...触发条件＝随裸外键回填那一片一起评估")。
-- ScheduledPostMedia 是同一张父表下结构相同的姊妹表,同一次评估里一并处理。
--
-- ── 存量数据风险 ─────────────────────────────────────────────────────────────
-- fail-closed:先加可空列、从父行传递性回填、再收紧 NOT NULL。回填值来自
-- ScheduledPost.ownerId(该列本身 NOT NULL,见 schema),所以只要 scheduledPostId 都指向一个
-- 真实存在的 ScheduledPost,回填后不会有 NULL 残留——SET NOT NULL 那一步失败即代表存量有
-- "指向不存在的 ScheduledPost 的孤儿行"这种更早就该报错的数据损坏,不属于本迁移要吞掉的情况。
-- 迁移不做任何"悄悄改数据对齐"的操作:这里写的 UPDATE 只是把权威已经写在父行上的 ownerId
-- 值原样传递下来,不是修数。
--
-- 生产执行前预检 SQL(供 Founder 自查;本迁移不因为查到不一致行就跳过或吞错——那些行本来
-- 就是孤儿数据,SET NOT NULL 会如实报错):
--   SELECT count(*) FROM "PublishAttempt" pa
--     LEFT JOIN "ScheduledPost" sp ON sp.id = pa."scheduledPostId"
--    WHERE sp.id IS NULL;
--   SELECT count(*) FROM "ScheduledPostMedia" spm
--     LEFT JOIN "ScheduledPost" sp ON sp.id = spm."scheduledPostId"
--    WHERE sp.id IS NULL;
--
-- 幂等:每步都用 IF (NOT) EXISTS / DROP IF EXISTS 包住,可重跑。
BEGIN;

-- ── PublishAttempt ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PublishAttempt' AND column_name = 'ownerId'
  ) THEN
    ALTER TABLE "PublishAttempt" ADD COLUMN "ownerId" TEXT;
  END IF;
END $$;

DO $$
DECLARE backfilled INT;
BEGIN
  UPDATE "PublishAttempt" pa
  SET "ownerId" = sp."ownerId"
  FROM "ScheduledPost" sp
  WHERE sp.id = pa."scheduledPostId" AND pa."ownerId" IS NULL;
  GET DIAGNOSTICS backfilled = ROW_COUNT;
  IF backfilled > 0 THEN
    RAISE NOTICE 'tenant-slice5-fk-backfill: PublishAttempt.ownerId 回填 % 行(权威来自 ScheduledPost.ownerId,传递取值,不是修数)。', backfilled;
  END IF;
END $$;

ALTER TABLE "PublishAttempt" ALTER COLUMN "ownerId" SET NOT NULL;

ALTER TABLE "PublishAttempt" DROP CONSTRAINT IF EXISTS "PublishAttempt_scheduledPostId_fkey";
ALTER TABLE "PublishAttempt" DROP CONSTRAINT IF EXISTS "PublishAttempt_scheduledPostId_ownerId_fkey";
ALTER TABLE "PublishAttempt"
  ADD CONSTRAINT "PublishAttempt_scheduledPostId_ownerId_fkey"
  FOREIGN KEY ("scheduledPostId", "ownerId") REFERENCES "ScheduledPost"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ScheduledPostMedia ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ScheduledPostMedia' AND column_name = 'ownerId'
  ) THEN
    ALTER TABLE "ScheduledPostMedia" ADD COLUMN "ownerId" TEXT;
  END IF;
END $$;

DO $$
DECLARE backfilled INT;
BEGIN
  UPDATE "ScheduledPostMedia" spm
  SET "ownerId" = sp."ownerId"
  FROM "ScheduledPost" sp
  WHERE sp.id = spm."scheduledPostId" AND spm."ownerId" IS NULL;
  GET DIAGNOSTICS backfilled = ROW_COUNT;
  IF backfilled > 0 THEN
    RAISE NOTICE 'tenant-slice5-fk-backfill: ScheduledPostMedia.ownerId 回填 % 行(权威来自 ScheduledPost.ownerId,传递取值,不是修数)。', backfilled;
  END IF;
END $$;

ALTER TABLE "ScheduledPostMedia" ALTER COLUMN "ownerId" SET NOT NULL;

ALTER TABLE "ScheduledPostMedia" DROP CONSTRAINT IF EXISTS "ScheduledPostMedia_scheduledPostId_fkey";
ALTER TABLE "ScheduledPostMedia" DROP CONSTRAINT IF EXISTS "ScheduledPostMedia_scheduledPostId_ownerId_fkey";
ALTER TABLE "ScheduledPostMedia"
  ADD CONSTRAINT "ScheduledPostMedia_scheduledPostId_ownerId_fkey"
  FOREIGN KEY ("scheduledPostId", "ownerId") REFERENCES "ScheduledPost"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
