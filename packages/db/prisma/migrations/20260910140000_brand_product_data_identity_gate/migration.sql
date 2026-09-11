-- 价签不承载身份 —— 机器闸(规格 docs/specs/brand-product-identity.md §1.4;票 #1322,
-- 判官 P2 b「核心不变量加机器闸」)。
--
-- ── 这份迁移改了什么 ─────────────────────────────────────────────────────────
-- 一条 CHECK:`BrandRecord_product_data_has_no_identity`。非草稿的 product 价签,`data` 里
-- 不许出现 `name` 或 `imageAssetId` 这两个键。
--
-- ── 为什么要有它 ─────────────────────────────────────────────────────────────
-- 前一份迁移(20260910120000_brand_product_identity)把这两格从价签搬进身份,写路一律
-- `stripProductIdentity` 剥掉、读路一律 `withProductIdentity` 从身份取。可是「六条写路都记得
-- 剥」是一句**靠人记住**的话:再多一条写路(下一个功能、下一个 agent、一次顺手的
-- `brandRecord.updateMany`),同一个事实就又有了第二处存放点,而那正是这份规格前五轮每一条
-- P1 的共同根。判据落在数据库上,新写路想绕都绕不开:写进去就 23514,不是「审查时希望有人看见」。
--
-- 判官给了两个选项(数据库 CHECK / packages/db 写路统一剥离＋源码围栏),这里选 CHECK:
-- 源码围栏只能证明「今天这几句是这么写的」,而 `BrandRecord` 的写路遍布 apps/web、
-- apps/worker、packages/otto、packages/db 四个包 —— 静态判据分不清「这一句写的是产品还是
-- 受众」(brand-record-actions 里 product 与 segment/offer 的分支就并排住着),要么误报、
-- 要么漏报。约束不需要分辨调用者,它只看落库的那一行。
--
-- ── 草稿是唯一的口子(与前一份迁移同一条边界)─────────────────────────────────
-- `contextStatus = 'Draft'` 的产品此刻**没有身份**(规格 §1.9、验收 PRODID-A7:理解 worker
-- 提取的产品先落草稿,商家确认后才建身份)。它的名字与主图只有 `data` 这一处记法 —— 一处不是
-- 两处,所以草稿放行。确认(`confirmProductDraft`)建出身份的同一个事务里这两格才搬走。
-- 边界与 `BrandRecord_product_needs_entity` 逐字相同,两条 CHECK 说的是同一件事的两半。
--
-- ── 回滚顺序(重要)──────────────────────────────────────────────────────────
-- 20260910120000 的 `rollback.sql` ①.5 会把 `name` / `imageAssetId` **写回**价签(那是它的
-- 职责:把 up 搬走的两格精确还原)。这条 CHECK 还在的话,那一句会被数据库拒绝、整份回滚一句
-- 都不落地。所以回滚按**时间倒序**跑:先跑本目录的 rollback.sql(它只丢这条约束),再跑
-- 20260910120000 的 rollback.sql。
--
-- ── 装闸之前先把库扫平 ───────────────────────────────────────────────────────
-- 前一份迁移的 ② d 已经把存量行的这两个键删干净了,所以正常情况下下面那一句是零行。它存在是
-- 为了「前一份跑过之后、这一份跑到之前」那段时间里,旧版代码可能又写进去的行 —— 那种行按定义
-- 就是这条不变量要关掉的洞,而名字与主图的权威**已经**在 `Entity` 上(读路一律从身份取),
-- 所以删掉这两个键不丢任何事实。删了几行打成 NOTICE,不静默。
-- 草稿不动(它此刻没有身份,这两格是它唯一的记法)。
--
-- 幂等:先扫平、再 DROP IF EXISTS / ADD,可重跑。

BEGIN;

DO $$
DECLARE stripped INT;
BEGIN
  UPDATE "BrandRecord" r
  SET "data" = (r."data" - 'name') - 'imageAssetId'
  WHERE r."kind" = 'product' AND r."contextStatus" <> 'Draft'
    AND (r."data" ? 'name' OR r."data" ? 'imageAssetId');
  GET DIAGNOSTICS stripped = ROW_COUNT;
  IF stripped > 0 THEN
    RAISE NOTICE
      'brand-product-data-identity-gate:% 条 product 价签仍带着 name / imageAssetId,已剥掉(权威在 Entity 上,不丢事实)。',
      stripped;
  END IF;
END $$;

ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_data_has_no_identity";
ALTER TABLE "BrandRecord" ADD CONSTRAINT "BrandRecord_product_data_has_no_identity"
  CHECK (
    "kind" <> 'product'
    OR "contextStatus" = 'Draft'
    OR NOT ("data" ? 'name' OR "data" ? 'imageAssetId')
  );

COMMIT;
