-- 回滚 20260918120000_genjob_lineage_generation。
--
-- 丢的只有本列自己的值(纯谱系记录,零钱路、零引擎输入、零读者以外的依赖),既有列一格不碰。
-- 回滚之后的行为 = 本 PR 之前的行为:派生图的 `entitySnapshot` 回到空数组(R3-F30 原状)。
-- DESTRUCTIVE-OK: 本列由这份迁移自己新增,回滚就是把它撤掉;列里没有任何其它来源的数据。

BEGIN;

ALTER TABLE "GenJob" DROP COLUMN IF EXISTS "lineageGenerationId";

COMMIT;
