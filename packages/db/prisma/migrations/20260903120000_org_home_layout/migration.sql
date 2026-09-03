-- FRONT-A4(规格 docs/specs/frontend-baseline.md §7.3⑤「Customize home 落库」):
-- 新增一张 OrgHomeLayout —— 一个工作区一行的 Home 版面。
--
-- ── 存量数据:零回填、零转换、零删除 ──────────────────────────────────────────
-- 纯新增一张表,不动任何既有列、不动任何既有行。没有这一行的工作区照旧看推荐版面
-- (解析在 apps/web/lib/home-layout.ts,缺行 = 走 patterns/founder-home/model.ts 的推荐模板),
-- 所以「迁移已跑但还没有人保存过版面」是一个完全正常、商家无感的状态。
-- 因此这次迁移不需要备份/恢复预案;回滚见同目录 rollback.sql(DROP TABLE 只丢版面偏好,
-- 丢了就退回推荐版面,商家的任何内容、钱、租户边界都不经过这张表)。
--
-- ── 承重的三处约束,逐条说明为什么它们是约束而不是约定 ────────────────────────
--
-- ① `ownerId` UNIQUE —— **就是「org 级一行」这句话本身**。
--    版面是工作区共有的(设计权威 patterns/founder-home/README.md:「Customization is
--    workspace-wide」),不是每个成员各存一份。少了这条唯一约束,两个管理员同时按 Save
--    会插出两行,读的时候按什么顺序取都是掷骰子 —— 「刷新之后版面还在」(A4)就不再是
--    一句真话。写入方压在这条约束上做 upsert(apps/web/lib/home-layout-store.ts),
--    而不是「先查后建」:后者在两个请求同时保存时会双双查空、双双插入。
--
-- ② `ownerId` 外键指向 `Organization(id)`,ON DELETE CASCADE。
--    租户约束长在外键上:一行版面不可能挂到一个不存在的工作区上。CASCADE 与
--    MetaConnection 同族(20260628140000_meta_connection):工作区注销时,它自己的
--    界面偏好跟着走是对的,没有任何东西需要保留它。
--
-- ③ 运行时守卫:这张表带 `ownerId`,所以它必须在
--    `packages/db/src/tenant-guard.ts` 的 TENANT_MODELS 或 TENANT_GUARD_EXEMPT 里出现一次
--    (packages/db/src/tenant-guard-coverage.test.ts 强制这个选择)。本次选 TENANT_MODELS
--    —— 它装的是「这个商家的 Home 长什么样」,越租户读一行就是把 A 家的工作区偏好讲给 B 家听。
--
-- 取值本身**没有** CHECK 约束:组件名单是产品层的
-- `apps/web/design-system/patterns/founder-home/model.ts`,读的时候按名单过滤(未知 id 丢弃)。
-- 加一个 Home 组件不该是一次迁移。
--
-- 全部语句带 IF NOT EXISTS,整份迁移可重跑。
--
-- 上线后自查(期望两个数字都是 0):
--   -- 指向不存在工作区的行(外键已经挡住,这一句是复核)
--   SELECT count(*) FROM "OrgHomeLayout" l
--     LEFT JOIN "Organization" o ON o."id" = l."ownerId" WHERE o."id" IS NULL;
--   -- 一个工作区两行(唯一约束已经挡住,这一句是复核)
--   SELECT count(*) FROM (SELECT "ownerId" FROM "OrgHomeLayout" GROUP BY 1 HAVING count(*) > 1) d;

BEGIN;

CREATE TABLE IF NOT EXISTS "OrgHomeLayout" (
  "id"           TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "componentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "hiddenIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrgHomeLayout_pkey" PRIMARY KEY ("id")
);

-- ① 索引名逐字照 Prisma 对 `ownerId String @unique` 的命名规则,否则下一次
--    `prisma migrate dev` 会认为 schema 与库不一致、再生成一份重复迁移。
CREATE UNIQUE INDEX IF NOT EXISTS "OrgHomeLayout_ownerId_key"
  ON "OrgHomeLayout" ("ownerId");

-- ② 租户约束长在外键上。
ALTER TABLE "OrgHomeLayout"
  DROP CONSTRAINT IF EXISTS "OrgHomeLayout_ownerId_fkey";
ALTER TABLE "OrgHomeLayout"
  ADD CONSTRAINT "OrgHomeLayout_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Organization" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
