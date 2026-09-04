-- Manual rollback for 20260903120000_org_home_layout (NOT run by Prisma — apply by hand if needed).
--
-- 丢的是什么:只有「这个工作区把 Home 排成什么样」这一条界面偏好。回滚之后每个工作区
-- 退回推荐版面(apps/web/design-system/patterns/founder-home/model.ts 的模板),商家的内容、
-- credits、租户边界、连接状态一个字节都不经过这张表。所以这是一次**可以直接执行**的回滚,
-- 不需要先备份 —— 但如果想留一份偏好以便再上线时回灌,先跑下面那句 COPY。
--
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rollback.sql
--
-- 可选:回滚前留档(再上线后可用 \copy 回灌)
--   \copy (SELECT "id","ownerId","componentIds","hiddenIds","updatedById","createdAt","updatedAt" FROM "OrgHomeLayout") TO 'org-home-layout.csv' CSV HEADER

BEGIN;

-- 外键随表走;显式 DROP 一次,让这份脚本在「表被手工改过」的库上也能干净收尾。
ALTER TABLE IF EXISTS "OrgHomeLayout" DROP CONSTRAINT IF EXISTS "OrgHomeLayout_ownerId_fkey";

DROP TABLE IF EXISTS "OrgHomeLayout";

COMMIT;

-- 然后把迁移记录删掉,这份 migration.sql 才能被干净地重跑:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260903120000_org_home_layout';
