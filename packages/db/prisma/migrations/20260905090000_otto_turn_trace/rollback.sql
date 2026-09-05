-- Manual rollback for 20260905090000_otto_turn_trace (NOT run by Prisma — apply by hand if needed).
--
-- 丢的是什么:只有「Otto 每一轮走了几步、调了哪些动作」这份调试档案。回滚之后可观测性
-- 退回这次改动之前的状态(零),商家的内容、credits、租户边界、对话历史一个字节都不经过
-- 这张表 —— 钱在 CreditLedger,对话在 ChatMessage,两者都不引用它。所以这是一次**可以
-- 直接执行**的回滚,不需要先备份;但如果想留一份档案以便再上线时回灌,先跑下面那句 COPY。
--
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rollback.sql
--
-- 可选:回滚前留档(再上线后可用 \copy 回灌)
--   \copy (SELECT "refId","orgId","threadId","surface","modelId","steps","toolCalls","skillFiles","truncated","settledInternal","createdAt" FROM "OttoTurnTrace") TO 'otto-turn-trace.csv' CSV HEADER

BEGIN;

-- 外键随表走;显式 DROP 一次,让这份脚本在「表被手工改过」的库上也能干净收尾。
ALTER TABLE IF EXISTS "OttoTurnTrace" DROP CONSTRAINT IF EXISTS "OttoTurnTrace_orgId_fkey";

DROP TABLE IF EXISTS "OttoTurnTrace";

COMMIT;

-- 然后把迁移记录删掉,这份 migration.sql 才能被干净地重跑:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260905090000_otto_turn_trace';
