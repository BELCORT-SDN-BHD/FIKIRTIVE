-- 回滚 20260903120000_brand_five_sections_context。
--
-- 丢掉的只有这份迁移**自己新造**的东西:Memory / BrandRecord 上的四列,以及历史表
-- BrandContextRevision 整张。存量数据一个字节都不受影响 —— 这份迁移没有回填、没有转换、
-- 没有删除,`Memory.category` 从头到尾没被碰过(六→五是读时映射,不是写库)。
--
-- 代价说清楚:回滚之后,草稿(contextStatus='Draft')的行会失去「它是草稿」这件事,
-- 变回一条普通记录 —— 也就是会被 Otto 读到。所以回滚前若库里已有草稿,先把它们删掉
-- 或确认(下面第一句就是删草稿;要保留就把它注释掉,并自行决定这些行的去留)。
--
-- 演练记录:在 fikirtive_bb3_test 上真跑过 up → 造数据(五节各一条 ＋ 一条草稿 ＋ 历史行)
-- → rollback → up,存量行在三步之后逐字不变。
--
-- 每一句都带 IF EXISTS,可重跑。

BEGIN;

-- 草稿在回滚之后没有地方安放(见上)。删掉它们,而不是让它们悄悄变成 Otto 会读的正式记录。
DELETE FROM "Memory"      WHERE "contextStatus" <> 'Ready';
DELETE FROM "BrandRecord" WHERE "contextStatus" <> 'Ready';

DROP TABLE IF EXISTS "BrandContextRevision";

ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "updatedById";
ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "originDetail";
ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "origin";
ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "contextStatus";

ALTER TABLE "Memory" DROP COLUMN IF EXISTS "updatedById";
ALTER TABLE "Memory" DROP COLUMN IF EXISTS "originDetail";
ALTER TABLE "Memory" DROP COLUMN IF EXISTS "origin";
ALTER TABLE "Memory" DROP COLUMN IF EXISTS "contextStatus";

-- Prisma 的迁移账本也要退回去,否则下一次 migrate deploy 会认为这份迁移已经跑过。
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260903120000_brand_five_sections_context';

COMMIT;
