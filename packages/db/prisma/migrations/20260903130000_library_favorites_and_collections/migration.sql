-- 素材库:统一收藏表 + 合集两表(FRONT-A5 / FRONT-A6,
-- 规格 docs/specs/frontend-baseline.md §7.3② 与 §5 的 2026-09-03「裁决十」)。
--
-- ── 为什么收藏要单独一张表 ──────────────────────────────────────────────────────
-- 设计里的 Favorites 是一个把「生成结果」和「上传」混在一起、按时间排的**单一列表**
-- (design-system/patterns/library/model.ts 的 LIBRARY_VIEWS)。今天的收藏只有
-- "Generation".favorite 一个布尔列 —— 它天生只答得出「这一条生成有没有被收藏」,
-- 素材类型一多就得每类各存各的,于是 Favorites 视图变成「N 次查询 ＋ 应用层合并排序」,
-- 游标还要各算一套。Founder 2026-09-03 裁决十:**新建一张不分素材类型的收藏表**,
-- 备选「给 Asset 补一列」否决。
--
-- 形状:(ownerId, subjectType, subjectId) 唯一。subjectType 是**类型化 ID 的那个类型**,
-- 不是外键 —— 收藏是一条**链接**,删链接不许删原对象(backend-handoff-contract.md §4),
-- 所以这里刻意没有指向 "Generation" 的外键约束:外键的 ON DELETE 语义会把「取消收藏」
-- 和「删除素材」两件事焊在一起。目标是否仍然存在、是否属于当前租户,由动作层在**每一次**
-- 写入前重新校验(lib/library-favorites.ts),读回时 resolve 原对象。
--
-- ── 存量数据:一次性幂等回灌 ────────────────────────────────────────────────────
-- "Generation".favorite = true 的每一行,在这里落一条 ("generation", <生成 id>)。
-- INSERT … SELECT … ON CONFLICT DO NOTHING —— 整份迁移可重跑,重跑不产生第二条。
-- createdAt 取该生成自己的 createdAt(不是 now()):收藏页按时间排,拿 now() 会把
-- 全部历史收藏压成同一秒,顺序变成随机。这是**已知的近似**:我们没有「何时收藏」的
-- 历史,用「何时生成」是唯一可解释的替代,而不是编一个看起来像事实的时间戳。
-- 回灌之后,收藏的**唯一权威**就是这张表:写只写这里,读只读这里(生成结果详情面板与
-- Otto 的收藏读写都改走同一个动作 lib/library-favorites.ts,不是两套)。
-- "Generation".favorite 这一列本次**一个字节都没有写过** —— 保留它只为了让这份迁移可以
-- 干净回滚(见同目录 rollback.sql);它不再被任何读路径当作权威,后续另开一票删列。
--
-- ── 合集 ────────────────────────────────────────────────────────────────────────
-- Collection 只保存**对象链接**,一层结构,同一对象可以属于多个合集
-- (patterns/library/README.md §3.4)。删合集只删 membership,成员对象仍在 Library
-- (验收 FRONT-A6 明写)—— 所以 CollectionItem → Collection 的外键是 CASCADE
-- (合集没了,它自己的 membership 行才跟着走),而 CollectionItem → Generation
-- **没有外键**,同上一段的理由。
-- 外键带 ownerId 是仓库的租户铁律(packages/db/src/tenant-guard-coverage.test.ts 的
-- 「every direct relation between owner-scoped models carries ownerId」):跨租户的
-- collectionId 连查都拼不出来,而不是靠调用方记得加 where。
--
-- ── 回滚 ────────────────────────────────────────────────────────────────────────
-- 三张表都是**纯新增**,没有改任何既有列、没有删任何既有数据。回滚 = 反向脚本
-- (rollback.sql,与本文件同目录),DROP 这三张表即可;"Generation".favorite 从未被
-- 这份迁移改动过,所以回滚之后收藏在旧路径上原样还在。演练记录见 PR 描述。

BEGIN;

-- ── 收藏 ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Favorite" (
  "id"          TEXT NOT NULL,
  "ownerId"     TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId"   TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Favorite" DROP CONSTRAINT IF EXISTS "Favorite_ownerId_fkey";
ALTER TABLE "Favorite"
  ADD CONSTRAINT "Favorite_ownerId_fkey" FOREIGN KEY ("ownerId")
  REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 同一个租户对同一个素材只收藏一次 —— 幂等的写入压在这个约束上,而不是「先查后建」
-- (后者在两次快速点击下会双双查空、双双插入)。
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_ownerId_subjectType_subjectId_key"
  ON "Favorite" ("ownerId", "subjectType", "subjectId");

-- 收藏页:一次查询、按时间排(裁决十)。id 是并列时的 tiebreak,让 keyset 分页全走索引。
CREATE INDEX IF NOT EXISTS "Favorite_owner_recent_idx"
  ON "Favorite" ("ownerId", "createdAt", "id");

-- ── 合集 ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Collection" (
  "id"        TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_ownerId_fkey";
ALTER TABLE "Collection"
  ADD CONSTRAINT "Collection_ownerId_fkey" FOREIGN KEY ("ownerId")
  REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 复合唯一键:让子表的外键**带上 ownerId**(租户铁律),而不是只指着 id。
CREATE UNIQUE INDEX IF NOT EXISTS "Collection_id_ownerId_key"
  ON "Collection" ("id", "ownerId");

CREATE INDEX IF NOT EXISTS "Collection_ownerId_deletedAt_updatedAt_idx"
  ON "Collection" ("ownerId", "deletedAt", "updatedAt");

CREATE TABLE IF NOT EXISTS "CollectionItem" (
  "id"           TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "subjectType"  TEXT NOT NULL,
  "subjectId"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CollectionItem" DROP CONSTRAINT IF EXISTS "CollectionItem_ownerId_fkey";
ALTER TABLE "CollectionItem"
  ADD CONSTRAINT "CollectionItem_ownerId_fkey" FOREIGN KEY ("ownerId")
  REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollectionItem" DROP CONSTRAINT IF EXISTS "CollectionItem_collectionId_ownerId_fkey";
ALTER TABLE "CollectionItem"
  ADD CONSTRAINT "CollectionItem_collectionId_ownerId_fkey"
  FOREIGN KEY ("collectionId", "ownerId") REFERENCES "Collection"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 同一个合集里同一个素材只有一行(规格 §7.3②「同一 collection 内同一对象只一行」)。
CREATE UNIQUE INDEX IF NOT EXISTS "CollectionItem_collectionId_subjectType_subjectId_key"
  ON "CollectionItem" ("collectionId", "subjectType", "subjectId");

CREATE INDEX IF NOT EXISTS "CollectionItem_owner_collection_recent_idx"
  ON "CollectionItem" ("ownerId", "collectionId", "createdAt", "id");

-- ── 存量收藏一次性回灌(幂等) ───────────────────────────────────────────────────
INSERT INTO "Favorite" ("id", "ownerId", "subjectType", "subjectId", "createdAt")
SELECT
  'fav_backfill_' || g."id",
  g."ownerId",
  'generation',
  g."id",
  g."createdAt"
FROM "Generation" g
WHERE g."favorite" = TRUE AND g."deletedAt" IS NULL
ON CONFLICT ("ownerId", "subjectType", "subjectId") DO NOTHING;

COMMIT;
