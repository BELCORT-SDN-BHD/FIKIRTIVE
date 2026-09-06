# docs/ 导航

一页四节。每条只写「谁在用它」。这里不记录状态、优先级、批准或执行顺序。

## 现役权威

- `BLUEPRINT.md` —— Founder 北极星；`scripts/check-margin-floor.mjs:16` 引其毛利条款作宪法出处。
- `specs/` —— 现行规格的家；`scripts/ci/process-gates.sh`（M1/M5）与 `scripts/tools/spec-status.sh` 硬编码此路径，只收平铺的 `.md` 与两块豁免板 `.txt`。
- `adr/` —— 长期工程决定；`0001` 被 `packages/db/prisma/migrations/20260621130000_entitytype_brandmark/migration.sql` 引，`0003` 被 `packages/core/src/runtime-config.ts`、`packages/generation/src/index.ts`、`apps/web/lib/admin-actions.ts` 引。
- `references/` —— 产品与 feature 参考资料入口；`.claude/CLAUDE.md` 点名它作为任务开工时的选读来源。
- `agents/` —— gh 操作惯例（`issue-tracker.md`、`triage-labels.md`）与领域词汇（`domain.md`），agent 开工时按需读。
- `research/GRILL-VERDICTS-2026-07-03.md` —— `scripts/check-margin-floor.mjs:17` 按行号（`:105`）引作毛利宪法出处。
- `research/2026-07-03-meta-blueprint-expertise-sources.md` —— `packages/otto/src/meta-expertise/meta-expertise.data.ts:7` 指为该数据表的来源。

## 运维与交付

- `runbooks/chargeback.md` —— `apps/web/app/api/stripe/webhook/route.ts:351-352` 的运维提示指向它，`apps/web/lib/__tests__/reconcile-actions.test.ts:429` 断言这句话。
- `runbooks/db-backup.md` —— `apps/web/app/legal/data-deletion/page.tsx` 的保留窗口说明引它。
- `runbooks/local-ci.md`、`manual-refund.md`、`staging.md` —— 本地 CI、人工退款与 staging 操作的现行手册。
- `ops/dashboards.md`、`incident-visibility.md`、`worker-services.md` —— `apps/web/app/api/ops/dlq/route.ts:18` 与 `apps/web/app/api/health/route.ts:26` 指向它们作接法说明。
- `ops/manual-money-ledger.md` —— `apps/web/components/admin/TenantDetail.tsx` 的退款/释放提示要求把每笔登记在这里。
- `ops/production-shape.md`、`telegram-alerts.md`、`FINAL-REPORT-STANDARD-2026-07-12.md`、`ROUTE-B-MASTER-PLAN-2026-07-12.md` —— 生产形状、报警接线与报告体例的现行参照。
- `audits/admin-dashboard-20260704-local/README.md` —— `apps/web/lib/admin-v2.ts:74` 按行号（`:82`）引它解释 admin 投影的命名来历。
- `evidence/` —— 走查证据截图；`t5/05|06-short-viewport-*.png` 被 `apps/web/lib/__tests__/canvas-click-semantics.test.ts:392` 当几何读数引。
- `review/EXPANSION-SEAMS.md` 与 `review/REVIEWER-PLAYBOOK.md` —— `apps/web/design-system/references/legacy-v3/design-rules.md:238,253` 指为新屏建造配方与评审清单。
- `review/MARGIN-PARITY-REPORT-2026-07-04.md` —— `apps/web/lib/__tests__/gen-actions.test.ts:784` 的用例注释指它作为该断言的出处。

## 设计现役

- `design/v4/`（软链到 `apps/web/design-system/direction`）—— 现役设计方向：`design-principles.md`、`stitch-canvas-analysis.md`。
- `design/2026-07-03-harmony-04-costing-model.md` 与 `-costing-inputs.md` —— `packages/core/src/gen.ts:193` 与 `scripts/check-margin-floor.mjs:78,96` 按节引作真实账单佐证。
- `design-refs/2026-07-03-performance-card-mockup.html` —— `apps/web/components/otto/PerformanceCard.tsx:11` 引作该卡片的原型。
- `design-refs/2026-07-03-per-ad-panel-mockup.html`、`analytics-ui-kit.html` —— 同批分析面板原型，做同族界面时对照。
- `brand`（软链到 `apps/web/design-system/brand`）—— `apps/web/design-system/authority.json:31` 明文登记该映射；`apps/web/lib/__tests__/design-system-data-patterns.test.ts:9` 按 `../../docs/brand/colors.json` 读文件。
- `design-system`（软链到 `apps/web/design-system/governance`）—— `authority.json:33` 登记该映射；前端接线与设计变更先读其中的 `frontend-integration-handoff.md`。
- `ui-rework/fk-to-gb-token-map.md` —— `apps/web/design-system/references/legacy-v3/design-rules.md:283` 指为 fk→gb 令牌迁移地图，拆除仍在进行。

## 冻结区与 archive

- `superpowers/` —— 冻结历史区。`scripts/ci/process-gates.sh:390-393` 拦住任何新增与修改，`README.md` 除外。
- `archive/` —— 历史场地文档，只读参考。读法见 `archive/README.md`。
