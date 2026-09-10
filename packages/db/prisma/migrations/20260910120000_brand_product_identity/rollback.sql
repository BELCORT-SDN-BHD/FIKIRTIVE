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
-- !! 判官第 1 轮 P1(PR #1337):**被商家用过的回填身份删不掉,也不去删**。这份迁移正是把存量
-- !! 产品第一次送进 Library 与 @ 菜单,所以上线之后「被用过」是常态:商家把某件产品 @ 进一个
-- !! 镜头(ShotEntityRef)、在 Library 给它补第二张照片(普通 ULID 的 ReferenceImage,下面
-- !! 那句 `prodidimg\_%` 删不到)、或给它建了变体(EntityVariant)。这三样都是**必填**外键且
-- !! 是 RESTRICT,直删会被数据库拒绝,而整份回滚包在一个事务里 —— 一条挡住就一句都不落地。
-- !! 所以下面 ③ 只删**没人用过**的回填身份,用过的原样留下(和上一段「不去猜哪一条该杀」同一
-- !! 个立场:留下一条商家看得见、可以自己删的 Library 元素,而不是替他删掉一个镜头的引用),
-- !! 并在结束时把留下的条数打成 NOTICE。回滚因此在真实生产状态下**跑得完**。
-- !! 代价也写在刀口上:留下来的那些身份与它们的价签同名,所以**直接重上这份迁移会被预检②
-- !! 挡住**(「同名旧产品自动合并」是规格 §3 的非目标)——fail closed,一个字节都不落库。
-- !! 重上之前先处理这几条:在 Library 删掉它们,或手工把 BrandRecord.entityId 接回去。
--
-- 演练记录:在 fikirtive_prodid_test 上真跑过 up → 造数据(三条活跃 product ＋ 一条软删
-- product ＋ 一条 segment ＋ 一张主图)→ rollback → up,存量 BrandRecord 行在三步之后
-- 逐字不变(id / kind / nameKey / data / deletedAt 全部原样)。第 1 轮修复补跑了「用过」
-- 那一格(brand1fix_test:一条回填身份被 @ 进镜头 ＋ 另一条补了第二张普通 ULID 照片 →
-- rollback 整份跑通,两条身份留下、其余删净;见 PR「跑过的命令与结果」)。
--
-- 每一句都带 IF EXISTS,可重跑。

BEGIN;

-- ① 先松开约束,否则下面清 entityId 的那一步会被 CHECK 拦住。
ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_needs_entity";
ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_entityId_ownerId_fkey";
DROP INDEX IF EXISTS "BrandRecord_entityId_idx";

-- ② 把指向回填身份的引用先解开(外键已经没了,这一步是为了让 ③ 删得掉)。
UPDATE "BrandRecord" SET "entityId" = NULL WHERE "entityId" LIKE 'prodid\_%';

-- ③ 删掉回填造出来的身份与主图 —— 只删**没人用过**的那些(见文件头 P1 那一段)。
--    「用过」= 还有镜头引用(ShotEntityRef)、有变体(EntityVariant)、或者除了回填自己那张
--    主图之外还挂着别的照片。这三样都是 RESTRICT 的必填外键,硬删会让整份回滚一句都不落地。
CREATE TEMP TABLE "prodid_rollback_keep" ON COMMIT DROP AS
SELECT e."id"
FROM "Entity" e
WHERE e."id" LIKE 'prodid\_%' AND e."type" = 'PRODUCT'
  AND (
    EXISTS (SELECT 1 FROM "ShotEntityRef" s WHERE s."entityId" = e."id")
    OR EXISTS (SELECT 1 FROM "EntityVariant" v WHERE v."entityId" = e."id")
    OR EXISTS (SELECT 1 FROM "ReferenceImage" ri WHERE ri."entityId" = e."id" AND ri."id" NOT LIKE 'prodidimg\_%')
  );

-- 顺序:先图后身份(ReferenceImage → Entity 是 RESTRICT)。留下来的身份连它那张主图一起留,
-- 否则商家会看到一条没有封面的孤儿元素。
DELETE FROM "ReferenceImage"
WHERE "id" LIKE 'prodidimg\_%'
  AND "entityId" NOT IN (SELECT "id" FROM "prodid_rollback_keep");
DELETE FROM "Entity"
WHERE "id" LIKE 'prodid\_%' AND "type" = 'PRODUCT'
  AND "id" NOT IN (SELECT "id" FROM "prodid_rollback_keep");

DO $$
DECLARE kept INT;
BEGIN
  SELECT count(*) INTO kept FROM "prodid_rollback_keep";
  IF kept > 0 THEN
    RAISE NOTICE
      'brand-product-identity 回滚:% 条回填身份已被商家用过(镜头引用／变体／追加照片),原样留下,成为可自行删除的 Library 元素。',
      kept;
  END IF;
END $$;

-- ④ 最后才丢列 —— 上面每一步都还要读它。
ALTER TABLE "BrandRecord" DROP COLUMN IF EXISTS "entityId";

-- Prisma 的迁移账本也要退回去,否则下一次 migrate deploy 会认为这份迁移已经跑过。
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910120000_brand_product_identity';

COMMIT;
