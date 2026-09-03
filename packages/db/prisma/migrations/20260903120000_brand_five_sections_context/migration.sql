-- Brand 五节 ＋ 上下文草稿流(FRONT-A8 / FRONT-A9,规格 docs/specs/frontend-baseline.md §7.3④;
-- Founder 2026-09-03 裁决三/四/十一)。
--
-- ── 这份迁移改了什么、没改什么 ────────────────────────────────────────────────
-- 改:Memory 与 BrandRecord 各加四列(contextStatus / origin / originDetail / updatedById),
--    并新建一张只追加的历史表 BrandContextRevision。
-- 没改:**一行存量数据都没动**。特别是 `Memory.category` —— 六节→五节的归属是**读的时候
--      算**的(@fikirtive/core 的 brandSectionForCategory),不是把旧字符串 UPDATE 成新字符串。
--
--      为什么不 UPDATE:`getBrandContextText` 按老六节的 key 决定段落标题与预算,而六→五是
--      多对一(products ＋ offers → knowledge-base)。真把 category 写成新 key 再解析回来,
--      原本落在 offers 桶(该函数今天根本不读)的备注会冒进「Your products」段 —— Otto 读到的
--      正文当场就变。规格要求的是「只改这条记录归哪一节、不删任何行」,纯读时映射把这句话
--      做到了字面,而且把 A9 的「与迁移前逐字相同」变成一条可断言的事实。
--
-- ── 存量语义为什么不变 ────────────────────────────────────────────────────────
-- contextStatus 默认 'Ready',origin 默认 'manual',两列都 NOT NULL 带默认 ⇒ 每一条既有
-- 记录落在「就绪 · 手写」上,与建库那天的语义完全一致。originDetail / updatedById 可空,
-- 存量行为 NULL(「我们不知道」),而不是编一个来路或一个作者。
-- 因此:零回填、零转换、零删除,不需要单独的备份/恢复预案。
--
-- ── 回滚 ──────────────────────────────────────────────────────────────────────
-- 逆操作写在同目录的 rollback.sql,并且在测试库上真跑过 up → 造数据 → rollback → up。
-- rollback 会丢掉这四列与历史表里的内容(那是这份迁移**新造**的数据,存量一个字节都不受影响)。
--
-- 每一句都带 IF NOT EXISTS / IF EXISTS,整份迁移可重跑。

BEGIN;

ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "contextStatus" TEXT NOT NULL DEFAULT 'Ready';
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "origin"        TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "originDetail"  TEXT;
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "updatedById"   TEXT;

ALTER TABLE "BrandRecord" ADD COLUMN IF NOT EXISTS "contextStatus" TEXT NOT NULL DEFAULT 'Ready';
ALTER TABLE "BrandRecord" ADD COLUMN IF NOT EXISTS "origin"        TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "BrandRecord" ADD COLUMN IF NOT EXISTS "originDetail"  TEXT;
ALTER TABLE "BrandRecord" ADD COLUMN IF NOT EXISTS "updatedById"   TEXT;

CREATE TABLE IF NOT EXISTS "BrandContextRevision" (
    "id"             TEXT NOT NULL,
    "ownerId"        TEXT NOT NULL,
    "targetKind"     TEXT NOT NULL,
    "targetId"       TEXT NOT NULL,
    "action"         TEXT NOT NULL,
    "revisionKey"    TEXT NOT NULL,
    "changedById"    TEXT,
    "changedByLabel" TEXT NOT NULL,
    "summary"        TEXT NOT NULL,
    "changedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandContextRevision_pkey" PRIMARY KEY ("id")
);

-- 幂等键。同一次保存被重放(双击/网络重试/Server Action 重发)只留一行历史。
-- 索引名逐字照 Prisma 对 @@unique([ownerId, targetKind, targetId, revisionKey]) 的命名规则。
-- 注意结尾是 `revisionKe_key` 而不是 `revisionKey_key`:全名有 64 字符,超过 PostgreSQL 的
-- 63 字符上限,而 Prisma 与 PostgreSQL 的截断方式不同 —— 照抄全名会让 `migrate diff` 当场
-- 报「索引被重命名」的漂移(实测:CI 的 prisma schema drift 闸就是这么红的)。
CREATE UNIQUE INDEX IF NOT EXISTS "BrandContextRevision_ownerId_targetKind_targetId_revisionKe_key"
    ON "BrandContextRevision" ("ownerId", "targetKind", "targetId", "revisionKey");

CREATE INDEX IF NOT EXISTS "BrandContextRevision_ownerId_targetKind_targetId_changedAt_idx"
    ON "BrandContextRevision" ("ownerId", "targetKind", "targetId", "changedAt");

-- 租户边界与 Memory / BrandRecord 同一条:历史行永远挂在某一个 org 上,org 没了就跟着没。
ALTER TABLE "BrandContextRevision"
    DROP CONSTRAINT IF EXISTS "BrandContextRevision_ownerId_fkey";
ALTER TABLE "BrandContextRevision"
    ADD CONSTRAINT "BrandContextRevision_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
