-- ENGINE-A2(规格 docs/specs/otto-engine.md §7.2②「每轮调试档案」):
-- 新增一张 OttoTurnTrace —— Otto 一轮一行的结构事实档案。
--
-- ── 存量数据:零回填、零转换、零删除 ──────────────────────────────────────────
-- 纯新增一张表,不动任何既有列、不动任何既有行。这次迁移之前跑过的每一轮对话都不会有
-- 档案行(没有办法补:那些结构事实当时就没有被记下来过),那是一个正常状态 —— 只读脚本
-- `scripts/ops/otto-turn-trace.ts` 对一个查不到的 refId 会明说「没有这一轮的档案」,
-- 而不是假造一行。因此这次迁移不需要备份/恢复预案;回滚见同目录 rollback.sql,
-- 它丢掉的只有调试档案本身,商家的内容、钱、租户边界都不经过这张表。
--
-- (本文件不含任何数据丢失级 DDL:一句 CREATE TABLE、一个索引、一个外键。
--  所以这里**没有** DESTRUCTIVE-OK 标记 —— 那行字是给真的会删数据的迁移用的。)
--
-- ── 承重的三处约束,逐条说明为什么它们是约束而不是约定 ────────────────────────
--
-- ① 主键就是 `refId`,不另造一列 id。
--    refId 是这一轮在**账本里**的那把钥匙(`reserve:<refId>`,packages/otto/src/meter.ts),
--    三种形状全仓已经每轮唯一(`otto-stream:<userMessageId>` /`otto-turn:<userMessageId>` /
--    `otto-approve:<threadId>:<cardId>:a<n>`)。拿它当主键买到两件事:
--      · 「一轮一行」是数据库事实 —— 重复写入撞主键,不会留下两份互相矛盾的档案;
--      · 调试档案与钱账天然对得上 —— 同一个 refId,查 CreditLedger 是这一轮的钱,
--        查这张表是这一轮的动作,不需要第二把钥匙、也不会对错行。
--
-- ② `orgId` 外键指向 `Organization(id)`,ON DELETE CASCADE。
--    租户约束长在外键上:一行档案不可能挂到一个不存在的工作区上。CASCADE 与
--    CreditLedger(20260620…_credits 一族)同形 —— 工作区注销时,它自己的调试档案跟着走。
--
-- ③ 运行时守卫的归宿:这张表的租户列叫 `orgId`(不是 `ownerId`),
--    所以它必须在 `packages/db/src/tenant-guard.ts` 的 ORG_SCOPED_TENANT_GUARD_EXEMPT 里
--    出现一次并带着理由(packages/db/src/tenant-guard-coverage.test.ts 强制这个选择)。
--    守卫**注入**的是 `ownerId` 这个字面列名,把 orgId 表登记进 TENANT_MODELS 会把它
--    打坏而不是守住(那份注释里有 2026-09-02 的实测)。租户边界改由外键 + 「每一个读写口
--    都显式带 orgId」承担,双租户测试在 packages/db/src/otto-turn-trace-tenant.test.ts。
--
-- ── 为什么 toolCalls / skillFiles 是 JSONB 而不是关系表 ──────────────────────
-- 它们是**这一轮的读数**,不是可被查询的实体:形状封闭(`[{name,calls,ok,failed}]` 与
-- `string[]`),永远整份写、整份读,没有跨轮 join 的读面(ENGINE-A2 的验收是「查看任一
-- 对话轮的调试档案」,一次一个 refId)。两张子表只会换来两次写入和一次 join,买不到任何
-- 今天要用的东西。取值本身**没有** CHECK 约束:动作名单是产品层的
-- `packages/otto/src/registry.ts`,白名单在写入函数的类型上(不在册的名字被折成固定
-- 字面量 `(unregistered)`),加一个 action 不该是一次迁移。
--
-- ── 索引 ────────────────────────────────────────────────────────────────────
-- `(orgId, createdAt)` —— 「这个商家最近的几轮」是唯一的清单读面(ops 脚本的默认列表)。
-- 按 refId 的单行读走主键,不需要第二个索引。
--
-- 全部语句带 IF NOT EXISTS,整份迁移可重跑。
--
-- 上线后自查(期望两个数字都是 0):
--   -- 指向不存在工作区的行(外键已经挡住,这一句是复核)
--   SELECT count(*) FROM "OttoTurnTrace" t
--     LEFT JOIN "Organization" o ON o."id" = t."orgId" WHERE o."id" IS NULL;
--   -- surface 落在封闭集之外的行(应用层封闭集,这一句是复核)
--   SELECT count(*) FROM "OttoTurnTrace"
--     WHERE "surface" NOT IN ('stream','action','approve-resume','worker-research');

BEGIN;

CREATE TABLE IF NOT EXISTS "OttoTurnTrace" (
  "refId"           TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "threadId"        TEXT,
  "surface"         TEXT NOT NULL,
  "modelId"         TEXT NOT NULL,
  "steps"           INTEGER NOT NULL,
  "toolCalls"       JSONB NOT NULL,
  "skillFiles"      JSONB NOT NULL,
  "truncated"       BOOLEAN NOT NULL DEFAULT false,
  "settledInternal" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OttoTurnTrace_pkey" PRIMARY KEY ("refId")
);

-- 索引名逐字照 Prisma 对 `@@index([orgId, createdAt])` 的命名规则,否则下一次
-- `prisma migrate dev` 会认为 schema 与库不一致、再生成一份重复迁移。
CREATE INDEX IF NOT EXISTS "OttoTurnTrace_orgId_createdAt_idx"
  ON "OttoTurnTrace" ("orgId", "createdAt");

-- 租户约束长在外键上。
ALTER TABLE "OttoTurnTrace"
  DROP CONSTRAINT IF EXISTS "OttoTurnTrace_orgId_fkey";
ALTER TABLE "OttoTurnTrace"
  ADD CONSTRAINT "OttoTurnTrace_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
