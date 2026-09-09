-- Brand 产品身份(规格 docs/specs/brand-product-identity.md §1.4,验收 PRODID-A8;票 #1321)。
--
-- ── 这份迁移改了什么 ─────────────────────────────────────────────────────────
-- ① `BrandRecord` 加一列 `entityId`,以**复合外键** (entityId, ownerId) → Entity(id, ownerId)
--    指向身份(ADR 0002 第五条:两端都带 ownerId,PostgreSQL 直接拒绝跨租户连线)。
-- ② 一次性回填:每条 `BrandRecord(kind='product')` 建一条 `Entity(type='PRODUCT')`,把
--    `data.imageAssetId` 挂成主图(baseAssetId ＋ 一条 ReferenceImage),再把 entityId 写回去。
-- ③ CHECK `BrandRecord_product_needs_entity`:product 行没有 entityId 就进不了库 ——
--    「一处建、处处可用」从此由数据库保证,不靠调用处记得写。
--
-- ── 为什么连软删的 product 行也回填 ──────────────────────────────────────────
-- 规格 §1.4 说的是「每条**活跃** BrandRecord(product) 建 Entity」,而验收 PRODID-A8 要的是
-- 「**每条** BrandRecord(product).entityId 非空」。两句话都要满足,只有一种做法:软删的行
-- 也配一条身份,而那条身份带**同一个 deletedAt** —— 于是它在 Library、@ 菜单、任何读路
-- (全都过滤 deletedAt IS NULL)里都不存在,「活跃 Entity(PRODUCT) 数 ≥ 迁移前活跃
-- BrandRecord(product) 数」照样成立。反过来只回填活跃行的话,CHECK 就必须给软删行开一个
-- 口子,而那个口子会在**恢复**一条旧的已删产品时当场炸掉(恢复出来的行没有身份)。
--
-- ── 预检:失败就整条迁移不落库 ───────────────────────────────────────────────
-- 整份文件包在一个事务里,两条预检任何一条报错,ADD COLUMN 与回填一起回滚,库里一个字节
-- 都没变(规格 §4 的第一风险对策)。
--   预检①跨租户:已有的 entityId 必须指向**同一 ownerId** 的 Entity。
--   预检②同名冲突:一条待回填的活跃 product 行,若本租户已经有一条同名的活跃
--                  Entity(PRODUCT),就不猜「是不是同一件」——规格 §3 明写「同名旧产品
--                  自动合并」是非目标,回填只负责报出来,人工处理。
-- 名字归一化与 @fikirtive/core 的 normalizeNameKey 逐字一致(trim → lower → 空白折叠);
-- 记录那一侧直接用它自己算好的 `nameKey`,不重算。
--
-- ── 回滚 ─────────────────────────────────────────────────────────────────────
-- 同目录 rollback.sql。生产执行前 Founder 另行确认备份与恢复方案。
--
-- 每一句都带 IF NOT EXISTS / ON CONFLICT DO NOTHING,整份迁移可重跑。

BEGIN;

-- ① 列先落地。外键与 CHECK 留到回填之后 —— 否则预检还没跑,库就已经拒绝存量数据了。
ALTER TABLE "BrandRecord" ADD COLUMN IF NOT EXISTS "entityId" TEXT;

-- 预检①:跨租户或指向不存在的身份。
DO $$
DECLARE bad_count INT;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "BrandRecord" r
  WHERE r."entityId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Entity" e
      WHERE e."id" = r."entityId" AND e."ownerId" = r."ownerId"
    );
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'brand-product-identity 预检①失败:% 条 BrandRecord.entityId 指向别的租户或不存在的 Entity。整条迁移不落库,请先查数据。',
      bad_count;
  END IF;
END $$;

-- 预检②:同租户同名冲突(规格 §3「同名旧产品自动合并」是非目标)。
DO $$
DECLARE bad_count INT;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "BrandRecord" r
  WHERE r."kind" = 'product'
    AND r."entityId" IS NULL
    AND r."deletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "Entity" e
      WHERE e."ownerId" = r."ownerId"
        AND e."type" = 'PRODUCT'
        AND e."deletedAt" IS NULL
        AND lower(btrim(regexp_replace(e."name", '\s+', ' ', 'g'))) = r."nameKey"
    );
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'brand-product-identity 预检②失败:% 条活跃 BrandRecord(product) 与本租户既有的活跃 Entity(PRODUCT) 同名。整条迁移不落库,请人工确认是不是同一件产品。',
      bad_count;
  END IF;
END $$;

-- ② 回填 a:身份行。id 由记录 id 推导 —— 重跑得到同一个 id,回滚也就删得干净。
--    时间戳与 deletedAt 照抄记录:身份和它的价签同生同灭。
INSERT INTO "Entity" ("id", "ownerId", "type", "name", "brandId", "createdAt", "updatedAt", "deletedAt", "baseAssetId")
SELECT
  'prodid_' || r."id",
  r."ownerId",
  'PRODUCT'::"EntityType",
  left(coalesce(nullif(btrim(r."data"->>'name'), ''), r."nameKey"), 120),
  r."brandId",
  r."createdAt",
  r."updatedAt",
  r."deletedAt",
  a."id"
FROM "BrandRecord" r
LEFT JOIN "Asset" a
  ON a."id" = (r."data"->>'imageAssetId') AND a."ownerId" = r."ownerId"
WHERE r."kind" = 'product' AND r."entityId" IS NULL
ON CONFLICT ("id") DO NOTHING;

-- ② 回填 b:主图。只有资产**真的存在且属于同一租户**时才挂 —— 挂不上就诚实留空,
--    不编一张图(上一句的 LEFT JOIN 已经让 baseAssetId 在这种情况下是 NULL)。
INSERT INTO "ReferenceImage" ("id", "ownerId", "entityId", "assetId", "position", "brandId", "createdAt", "deletedAt")
SELECT
  'prodidimg_' || r."id",
  r."ownerId",
  'prodid_' || r."id",
  a."id",
  0,
  r."brandId",
  r."createdAt",
  r."deletedAt"
FROM "BrandRecord" r
JOIN "Asset" a
  ON a."id" = (r."data"->>'imageAssetId') AND a."ownerId" = r."ownerId"
WHERE r."kind" = 'product' AND r."entityId" IS NULL
ON CONFLICT ("id") DO NOTHING;

-- ② 回填 c:把身份写回价签。
UPDATE "BrandRecord" r
SET "entityId" = 'prodid_' || r."id"
WHERE r."kind" = 'product' AND r."entityId" IS NULL;

-- ③ 外键、索引、CHECK。名字逐字照 Prisma 对 schema.prisma 的命名规则,否则 schema drift 闸会红。
CREATE INDEX IF NOT EXISTS "BrandRecord_entityId_idx" ON "BrandRecord"("entityId");

ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_entityId_ownerId_fkey";
ALTER TABLE "BrandRecord" ADD CONSTRAINT "BrandRecord_entityId_ownerId_fkey"
  FOREIGN KEY ("entityId", "ownerId") REFERENCES "Entity"("id", "ownerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- entityId 为 NULL 时(segment / offer)复合外键按 MATCH SIMPLE 不检查 —— 这正是要的:
-- 只有 product 有身份那一半,而「product 必须有」由下面这条 CHECK 说死。
ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_needs_entity";
ALTER TABLE "BrandRecord" ADD CONSTRAINT "BrandRecord_product_needs_entity"
  CHECK ("kind" <> 'product' OR "entityId" IS NOT NULL);

COMMIT;
