-- #784 素材理解三件套:AssetUnderstanding。
--
-- 纯新增一张表 —— 不改任何既有列、不动任何既有数据、没有回填。已有的素材由 worker 的
-- 扫描器按正常节奏补上理解行(每一轮有条数上限),所以这次迁移在生产上是零风险的一句
-- CREATE TABLE 加三个索引。
--
-- ── 承重的两处约束,逐条说明为什么它们是约束而不是约定 ──────────────────────
--
-- ① `(ownerId, assetId, kind)` 唯一 —— **幂等键**。
--    理解由后台自动跑,生产者是 worker 自己的扫描器,而扫描器可能在两个副本上同时看到
--    同一件素材;pg-boss 也允许重投。少了这条唯一约束,同一张菜单会被读第二次,而第二次
--    读出来的产品行会再落一遍 BrandRecord —— 商家看到的是自己的产品目录里凭空多了一份。
--    「不重复计费」在这张票里的具体形状就是它:钱不进商家账本,但重复的**产物**一样是缺陷。
--    刻意**不带** `WHERE deletedAt IS NULL`:这张表没有软删,一件素材的一种理解全状态只
--    允许一行,FAILED/SKIPPED 也占位 —— 否则一次失败之后每一轮扫描都会再建一行重试到天荒地老。
--
-- ② `(assetId, ownerId)` 复合外键指向 `Asset(id, ownerId)`。
--    租户约束长在外键上:一行理解不可能挂到别家的素材上,即使写入方漏了 where。
--    Asset 上已有 `@@unique([id, ownerId])`(schema.prisma),所以这个引用是合法的。
--    ON DELETE 走默认 RESTRICT:Asset 行本身是永存墓碑(D21 清扫只删 blob),所以这条
--    外键在实际运行中永远不会挡住任何删除。
--
-- 上线后自查(期望两个数字都是 0):
--   -- 越租户的行(外键已经挡住,这一句是复核)
--   SELECT count(*) FROM "AssetUnderstanding" u
--     JOIN "Asset" a ON a."id" = u."assetId" WHERE a."ownerId" <> u."ownerId";
--   -- 越集的 kind / status
--   SELECT count(*) FROM "AssetUnderstanding"
--    WHERE "kind" NOT IN ('image-caption','doc-extract','video-qa')
--       OR "status" NOT IN ('QUEUED','RUNNING','DONE','FAILED','SKIPPED');

BEGIN;

CREATE TABLE "AssetUnderstanding" (
  "id"           TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "assetId"      TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'QUEUED',
  "summary"      TEXT NOT NULL DEFAULT '',
  "data"         JSONB,
  "inputTokens"  INTEGER,
  "outputTokens" INTEGER,
  "error"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssetUnderstanding_pkey" PRIMARY KEY ("id")
);

-- 封闭取值:代码里没有的词写不进来(house style 用 CHECK 而不是 PG enum ——
-- 加一个新 kind 是一次迁移,不是一次 ALTER TYPE)。
ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_kind_check" CHECK (
    "kind" IN ('image-caption', 'doc-extract', 'video-qa')
  );

ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_status_check" CHECK (
    "status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED')
  );

-- ① 幂等键。
CREATE UNIQUE INDEX "AssetUnderstanding_ownerId_assetId_kind_key"
  ON "AssetUnderstanding" ("ownerId", "assetId", "kind");

-- Otto 取回:某租户最近读懂了什么。
CREATE INDEX "AssetUnderstanding_ownerId_status_createdAt_idx"
  ON "AssetUnderstanding" ("ownerId", "status", "createdAt");

-- 清道夫:滞留 RUNNING 的行(跨租户扫描)。
CREATE INDEX "AssetUnderstanding_status_updatedAt_idx"
  ON "AssetUnderstanding" ("status", "updatedAt");

-- 租户约束长在外键上(② 见上)。
ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_assetId_ownerId_fkey"
  FOREIGN KEY ("assetId", "ownerId") REFERENCES "Asset" ("id", "ownerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Organization" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
