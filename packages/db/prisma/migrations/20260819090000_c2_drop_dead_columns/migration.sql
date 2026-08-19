-- DESTRUCTIVE-OK: Founder-approved dead-column deletion (PR #1027 裁决 2026-08-19:批准全部七列;R010 spec 点名的 utmBase 专项破坏性授权即此条;生产实测证据与 PITR 重验在 PR #1027 评论留档)
-- live 结果是什么」。零读者 ⇒ 这些列里的字节从来没有影响过商家看到的任何东西,数据本就 inert:
-- 删的不是「还没人用的信息」,是「谁都读不到的字节」。生产的 Neon PITR 7 天窗口照常覆盖本次执行。
--
-- 核验方法(2026-08-19,worker,分支 claude/c2-dead-columns,base = origin/main 7673ae91):
--   对每个列名在整个仓库跑一次纯 grep(rg 在本机是 shell 函数,脚本里会静默返回空集,故不用):
--     grep -rn --binary-files=without-match \
--       --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
--       --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.turbo \
--       -e <列名> <repo root>
--   然后逐条命中人工分类:读取者 / 写入者 / 仅文档或注释 / 仅「不该出现」的反向断言。
--   下面每一列记的是那次 live 命中的分类结果,不是转述历史结论。
--
-- ── 逐列证据 ────────────────────────────────────────────────────────────────────
--
-- ① ResearchJob."reservedCredits" / "actualCredits"
--    命中:schema.prisma + 建表迁移;docs/ 三处设计稿;apps/worker/src/jobs/research.ts:281 一句注释
--    (「actualCredits is omitted」);apps/web/lib/__tests__/research-actions.test.ts:158-159 两句
--    反向断言(expect("reservedCredits" in created).toBe(false))。
--    读取者 0、写入者 0。钱的唯一权威是 withLlmBudget 写的 CreditLedger。
--    注意同名不同表:RoutineRun."reservedCredits"(schema.prisma:2143,workflow-* 家族)有真读者,
--    本迁移不碰它 —— 下面的 ALTER 只点名 "ResearchJob"。
--
-- ② Entity."promptTokens"
--    命中:schema.prisma + 20260610094603_init;唯一写入者 scripts/tools/seed-local-qa-data.mjs:486,495
--    (本地 QA 种子脚本,本 PR 一并删掉那两行)。读取者 0。
--    entity-snapshot.ts 是逐字段挑选(id/name/type/refHashes),不会顺带带出这一列。
--
-- ③ Campaign."utmBase"
--    命中:schema.prisma + 20260714100000_b8_phase1_campaign_crm;docs/ 多处(R-010 D3 判它「不是长期
--    权威」并 stop-write/stop-read);apps/web/lib/__tests__/campaign-view-data.test.ts:82 与
--    campaign-actions.test.ts:194,218-220 —— 都是反向断言(不得被 select、传进来要被拒)。
--    读取者 0、写入者 0。UTM 真源是 link-time 定案的五键与事件当时快照。
--
-- ④ User."activeOrgId"
--    命中:schema.prisma + 20260619120000_org_tenant;写入者三处 —— apps/web/lib/auth-guard.ts:274、
--    e2e/support/seed.ts:88、scripts/tools/seed-local-qa-data.mjs:168,174(本 PR 一并删)。读取者 0。
--    活跃 org 一直是从 Membership 现场解出来的;真做多 org 切换器时按那时的需求另加列。
--
-- ⑤ CanvasNode."sourceNodeId"
--    命中:服务端零触碰 —— canvas-actions.ts 的 SELECT 与 CanvasNodeDTO 都不含它,
--    apps/web/lib/__tests__/canvas-batch-identity.test.ts:236 有一条机器断言钉着这件事。
--    apps/web/components/canvas/* 里的同名字段是浏览器本地的动作回执(StoredCanvasActionReceipt),
--    从不入库。库级命中只剩两处测试:packages/db/src/__tests__/canvas-settlement-backlog.test.ts:194
--    的一处残留 select(本 PR 删)、以及 canvas-batch-identity-backfill.test.ts —— 它用原生 SQL 复演
--    #603 T4 的一次性回填,本 PR 让它自带那一列的老形状(见该文件 beforeAll/afterAll),
--    11 条回填断言一条不减。读取者 0、写入者 0。
--    T4 迁移(20260805120000)原样保留在迁移史里:全新库仍按顺序先建列、跑完回填,再由本迁移删列。
--
-- ⑥ ReferenceImage."note"
--    命中:schema.prisma + 建表迁移;唯一写入者 scripts/tools/seed-local-qa-data.mjs:505,508,532,535
--    (本 PR 一并删)。读取者 0 —— 全部触碰 ReferenceImage 的源码文件里逐个跑 `grep -w note`,
--    零命中。这一列是 NOT NULL DEFAULT '',所以库里存的全是空串或 QA 种子串。
--
-- ────────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Entity" DROP COLUMN "promptTokens";

-- AlterTable
ALTER TABLE "ReferenceImage" DROP COLUMN "note";

-- AlterTable
ALTER TABLE "ResearchJob" DROP COLUMN "actualCredits",
DROP COLUMN "reservedCredits";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "activeOrgId";

-- AlterTable
ALTER TABLE "CanvasNode" DROP COLUMN "sourceNodeId";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "utmBase";
