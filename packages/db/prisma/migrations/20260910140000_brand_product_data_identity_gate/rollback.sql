-- 回滚 20260910140000_brand_product_data_identity_gate。
--
-- 丢掉的只有这份迁移自己加的那条 CHECK。**一行数据都不动** —— 这份迁移本来也没写过数据。
--
-- 顺序:要连 20260910120000_brand_product_identity 一起回滚时,**先跑这一份**。那一份的
-- rollback ①.5 会把 `name` / `imageAssetId` 写回价签,这条 CHECK 还在就会把它整份挡下来。
--
-- 幂等:`IF EXISTS`,可重跑。

BEGIN;

ALTER TABLE "BrandRecord" DROP CONSTRAINT IF EXISTS "BrandRecord_product_data_has_no_identity";

-- Prisma 的迁移账本也要退回去,否则下一次 migrate deploy 会认为这份迁移已经跑过。
-- 若还要用 `prisma migrate resolve --rolled-back` 销账,必须在跑这份文件**之前**做。
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910140000_brand_product_data_identity_gate';

COMMIT;
