-- 演员库入库(CREATE-A10,规格 docs/specs/creation-engine.md §8.1③):
-- Entity 加一列 catalogKey,并在 (ownerId, catalogKey) 上建唯一约束。
--
-- ── 这一列是什么、不是什么 ────────────────────────────────────────────────────
-- 是:「这一行是平台演员库 v1 里的哪一位」的标记。商家自己建的元素永远是 NULL。
-- 不是:新的权限维度。租户隔离一个字节都没变 —— 读写照旧全靠 ownerId,
--      演员是**每个 org 各播各的五名**(Founder 2026-09-02 拍板「每租户播种」;
--      备选的「跨租户共享/官方实体」会改租户语义,规格里明写不做)。
--      所以这一列上没有任何跨 org 的查询,也不该长出来。
--
-- ── 为什么唯一约束是 (ownerId, catalogKey) 而不是 catalogKey ─────────────────
-- 同一位演员在**每个** org 里都有一行,catalogKey 在全表当然重复;要防的是同一个 org 里
-- 被播种两次。播种脚本的幂等就压在这个约束上(捕获 P2002 跳过),而不是「先查后建」——
-- 后者在两个请求同时给一个新 org 引导时会双双查空、双双插入,商家的库里就出现十个人。
--
-- PostgreSQL 里 NULL 之间彼此 DISTINCT,所以这个唯一约束对商家自建元素(catalogKey NULL)
-- 完全无感:一个 org 可以有任意多行 NULL,不会互相撞。这也是这一列必须可空的原因。
--
-- ── 存量数据 ──────────────────────────────────────────────────────────────────
-- 零回填、零转换、零删除:一个 ADD COLUMN(可空,无默认)＋一个 UNIQUE INDEX。
-- 现有 Entity 行全部落在 NULL,与建库那天的语义完全一致,因此不需要备份/恢复预案。
-- 两句都带 IF NOT EXISTS,整份迁移可重跑。

BEGIN;

ALTER TABLE "Entity" ADD COLUMN IF NOT EXISTS "catalogKey" TEXT;

-- 索引名逐字照 Prisma 对 @@unique([ownerId, catalogKey]) 的命名规则,
-- 否则下一次 `prisma migrate dev` 会认为 schema 与库不一致、再生成一份重复迁移。
CREATE UNIQUE INDEX IF NOT EXISTS "Entity_ownerId_catalogKey_key" ON "Entity" ("ownerId", "catalogKey");

COMMIT;
