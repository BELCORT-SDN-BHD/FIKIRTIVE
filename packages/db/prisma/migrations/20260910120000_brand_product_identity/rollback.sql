-- 回滚 20260910120000_brand_product_identity。
--
-- 丢掉的只有这份迁移**自己新造**的东西:BrandRecord 上的 entityId 列、外键、索引、CHECK,
-- 以及回填生成的身份行(`Entity.id` 与 `ReferenceImage.id` 都以 `prodid_` / `prodidimg_`
-- 开头 —— 这个前缀是回填自己造的,商家自建的元素永远不长这样)。
--
-- !! 代价写在刀口上:回滚**之后**由共享动作 `createProduct` 新建的产品,它们的 Entity 用的是
-- !! 正常 ULID,不带前缀,所以下面这两句删不到它们 —— 它们会作为无人指向的 Library 元素留下来。
-- !! 这是刻意的:宁可留下一条商家看得见、可以自己删的元素,也不去猜哪一条该杀。回滚前请先
-- !! 数一下 `SELECT count(*) FROM "Entity" WHERE "type"='PRODUCT' AND "id" NOT LIKE 'prodid\_%'`,
-- !! 心里有数再执行。
--
-- !! 生产库上手跑之前先停下来问人:这份回滚删的是数据,不是代码。Founder 另行确认备份与
-- !! 恢复方案(docs/runbooks/db-backup.md)之后才执行。
--
-- 演练记录:在 fikirtive_prodid_test 上真跑过 up → 造数据(三条活跃 product ＋ 一条软删
-- product ＋ 一条 segment ＋ 一张主图)→ rollback → up,存量 BrandRecord 行在三步之后
-- 逐字不变(id / kind / nameKey / data / deletedAt 全部原样)。
--
-- 每一句都带 IF EXISTS,可重跑。

BEGIN;

-- ① 先松开约束,否则下面清 entityId 的那一步会被 CHECK 拦住。
ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_needs_entity";
ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_entityId_ownerId_fkey";
DROP INDEX IF EXISTS "BrandRecord_entityId_idx";

-- ② 把指向回填身份的引用先解开(外键已经没了,这一步是为了让 ③ 删得掉)。
UPDATE "BrandRecord" SET "entityId" = NULL WHERE "entityId" LIKE 'prodid\_%';

-- ③ 删掉回填造出来的身份与主图。顺序:先图后身份(ReferenceImage → Entity 是 RESTRICT)。
DELETE FROM "ReferenceImage" WHERE "id" LIKE 'prodidimg\_%';
DELETE FROM "Entity" WHERE "id" LIKE 'prodid\_%' AND "type" = 'PRODUCT';

-- ④ 最后才丢列 —— 上面每一步都还要读它。
ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "entityId";

-- Prisma 的迁移账本也要退回去,否则下一次 migrate deploy 会认为这份迁移已经跑过。
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910120000_brand_product_identity';

COMMIT;
