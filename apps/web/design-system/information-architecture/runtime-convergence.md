# Founder-facing IA — runtime convergence backlog

> **状态：Active convergence record。不是 Sitemap open question。**  
> **来源：** Founder-approved and frozen IA v1，2026-08-30。  
> 本文件记录当前 runtime 与已冻结 IA 的已知差异。它不能改写 `product-map.md`、`surface-contract.md` 或
> `@fikirtive/core/navigation` 的职责。
>
> Phase 1 application shell 与 active navigation 已收敛。Home Phase 2 已完成 approved frontend scope，fixture
> 视觉已获 Founder 接受，但两项 backend 接缝与正式登录后验收仍阻止 closure。Phase 3 Create / Canvas 已完成 frozen frontend scope，
> fixture 方向获 Founder 接受；authenticated QA 与 database-backed money leg 仍是 closure seams。以下只保留尚未
> 收敛的 runtime drift；完成项必须从 backlog 移出，不能继续作为 allow-list。

## Resolved differences

| Resolved runtime difference | Current authority |
|---|---|
| Campaigns 与 Schedule 已从 beta 主导航移除，legacy routes 回到 canonical owner | `@fikirtive/core/navigation` |
| `/library/editor` 已退出 active product UI 并转向 Create | `SHELL_ROUTES.create` |
| 正式 `/analysis` 已由 Home analysis template 接管，不再渲染旧 Meta Analytics surface | `frontend-convergence-phase-2-home-spec.md` 与 `app/analysis/page.tsx` |
| 正式 Create / Canvas 已移除 Founder-facing Project language、第二套 navigation 与 prototype state | `frontend-convergence-phase-3-create-canvas-spec.md` 与其 acceptance ledger |

## Known differences

| Runtime today | Frozen IA | Required later implementation |
|---|---|---|
| `/profile` 与 `/settings` 已拆成 Personal display name / Workspace name | Personal owns display name；Workspace / General owns Workspace name | Phase 4 frontend 已实现；等待 authenticated Founder journey 与 DB-backed checks 后 closure |
| `/profile`、`/settings`、`/settings/connections`、`/billing` 已共用 production Settings shell | beta Settings 只使用 Personal / Workspace；Workspace children 为 General、Connections、Billing & credits | frontend implementation 已完成并通过 focused QA；不显示没有 backend truth 的 plan / payment / invoice controls，等待正式 routes 验收 |
| `/library` 仍组合旧 `OttoStuff`；approved Library fixture 已完成，但 Collection、cross-object Favorite、Clothes 与 Official Avatar production contracts 尚未存在 | Library uses Generation history / Uploads / Favorites / Collections / Elements | 先由 backend 落实 [`patterns/library/backend-handoff-contract.md`](../patterns/library/backend-handoff-contract.md)；再用已批准 components 完成 production convergence，不使用 fake persistence |
| `/brand` 仍组合旧 `OttoMemory`；五个 section 的 approved pattern 已完成 | Brand uses five route-backed Jasper-IQ-style child views | 等待 Founder 指定的 Otto IQ engine contract，再使用已批准 pattern 接入正式 routes；不重做设计，不伪造 ingestion / provenance / versioning |
| Otto composer 尚未接入完整 Reference picker | `@` uses Recent + type entry + universal typed search | Phase 5 review fixture 已于 2026-09-02 获 Founder 视觉与交互验收；production 接入继续等待统一 typed search / resolver / provenance contracts，不使用 fixture data |
| ~~Home customization 只有已批准 pattern，没有 workspace persistence / `Manage home` capability~~ **已接通（2026-09-05 回写）** | Home layout is workspace-wide truth | 已落地：`apps/web/lib/home-layout-actions.ts` ＋ `apps/web/lib/home-layout-store.ts`（`canManageHome()` 读 `workspace.manage_home`）＋ `OrgHomeLayout`（`packages/db/prisma/schema.prisma:1369`）＋ 迁移 `20260903120000_org_home_layout`；跨刷新由 `e2e/journeys/15-home-layout-persists.spec.ts:35` 守。本行原文是 2026-08-31 当时的观察，已不再是有效停放 |
| Home / Analysis 的 Otto handoff 会打开 panel，但 server 不消费 page context | Handoff must show truthful removable context | 先接通真实 context reader，再启用现有 context-chip UI；不能只画 chip |
| Current Home adapter 只能提供 Meta-only partial evidence | Full `ready` needs a real multi-source aggregate with freshness | 保留完整 ready frontend contract；后端 aggregate 接通前不显示完整 marketing-health claims。**2026-09-05 回写**：读模型今天仍只产出 not-configured / unavailable / insufficient / partial 四态，ready 整支不可达（`apps/web/lib/home-marketing-health.ts:133-161`）；按 Meta 单源版面接真的 PR #1192 在飞（分支 `claude/home-meta-single-source`，状态 OPEN，未合并），合入前本行照旧成立 |
| 正式 Auth routes 与未登录 journey 已获 Founder 视觉验收；本地环境仍未接可用账号数据库与邮件服务 | [`patterns/auth/access-journey-spec.md`](../patterns/auth/access-journey-spec.md) 已获 Founder 批准并冻结；Auth 是 merchant shell 外的独立 access journey | 建立 local test-auth journey，验证真实 code email、verification / reset link、provider callback 与 authenticated return；最后进行各正式 authenticated route 的视觉与键盘验收 |

## Recommended sequencing

1. Home fixture visual 已接受；Otto context reader 与正式 authenticated QA 保持为已命名 closure seams。**2026-09-05 回写**：Home persistence / capability 这一条已接通，不再是 seam（证据见上表 Home 行与 Phase 2 acceptance ledger #8 / #9）。
2. Phase 3 Create / Canvas frontend scope 已实现，fixture 方向获 Founder 接受；两条 closure seams 见对应 acceptance ledger。
3. Auth shared shell、正式 routes 与未登录 browser QA 已完成并获 Founder 视觉验收；local test-auth 与 authenticated cross-surface QA 保留为后端环境接缝，不在 UI fixture 中伪造。
4. Library 设计与 interaction fixture 已完成；production convergence 等待已记录的 backend handoff contract，不在 UIUX session 伪造 persistence。
5. Brand screen pattern 已完成；production convergence 等待 Founder 已指定的 Otto IQ engine，不在 UIUX session 伪造 ingestion / provenance / versioning。
6. **Settings Phase 4 frontend 已实现。** Spec 已获 Founder 批准并冻结；正式 routes 已使用现有真实 Profile、Workspace、Connections 与 Billing capabilities 完成 honest convergence。Closure 仍需 authenticated Founder journey 与 DB-backed tenant / money checks。
7. **Reference picker Phase 5 review fixture 已获 Founder 验收。** 2026-09-02 接受当前视觉与交互方向；production integration 仍受 spec 中的真实 data-contract gate 约束，不把 review acceptance 当作 backend 或 production 完成。

## 剩余前端工作边界 — 2026-09-02 核对

已批准的设计不等于正式页面已接入。以下是现有范围的收尾清单，不新增设计阶段；backend 由负责对应引擎的任务提供，本 UIUX 任务不代建。

| 尚需完成的前端工作 | 开始前的真实条件 | 当前证据 |
|---|---|---|
| Library：以已批准界面替换旧页面，并接通 views、筛选、详情与整理动作 | 上述 Library handoff contract 可用 | `app/library/page.tsx` 仍渲染 `OttoStuff`；`patterns/library/backend-handoff-contract.md` |
| Brand：把已批准的五个 section 接到正式页面 | Otto IQ engine 提供有类型的内容、状态与来源接口 | `app/brand/page.tsx` 仍渲染 `OttoMemory`；`patterns/brand/README.md` 的 engine 边界 |
| ~~Reference picker：接入两处正式 Otto composer，传递准确 reference IDs~~ —— 2026-09-04 已接入（规格 `docs/specs/frontend-baseline.md` §7.3③ 第①②刀）。剩余：把类型化引用 ID 存进消息并可回链（第③刀） | Phase 5 第 5 节 search / resolver / provenance gate 满足 | 两处 composer 与画布编辑器同走 `components/reference-picker/ReferencePickerMenu.tsx`（`components/otto/OttoFrontDoor.tsx`、`components/otto/OttoChatStream.tsx`、`components/MentionInput.tsx`）；服务端一次查询 `lib/reference-search.ts`。原先这一格点名的 `components/otto/OttoMentionPopover.tsx` 已随收口删除，不再存在 |
| Home：~~接通 Customize home 保存~~（**2026-09-05 回写：已接通**）与 Otto page context；验证完整 ready 数据 | context reader 与多来源 aggregate（workspace persistence / capability 已不再是前置条件） | `components/home/HomeEntry.tsx`、`lib/home-marketing-health.ts`；Phase 2 acceptance ledger |
| 正式页面联合验收：登录后走通 Home、Create / Canvas、Library、Brand、Settings 和返回流程 | 可用的非生产测试账号环境；需付费 / 权限证明的行为由对应 backend 测试支持 | 各 phase acceptance ledger；Auth `access-journey-spec.md` |

Create / Canvas、Settings、Auth 在本次定向核查中未发现额外的界面施工缺口；这不等于正式登录流程、全部浏览器尺寸或完整 web suite 已验收。

Reference picker 的 review 回归修复另记于 Phase 5 spec 第 9 节。它不代替 production 接入，也不解除任何 backend gate。

CodeGraph: not used — 当前是非持图 worktree；以上以当前 routes、components 与 approved artifacts 的定向读取核对。

## 有边界的前端回归检查 — 2026-09-02

Founder 继续前端收尾任务；本轮没有新增页面、改动已验收界面或接入 backend。以下是工程检查，不改变上方的接线与 Founder 验收状态。

- **现有前端测试：** 32 files / 187 tests 全部通过，范围为 Design System、已批准 product patterns、shell、Reference picker 与 mocked / DOM feedback controls。使用现有 serial Vitest 配置，未提供 `DATABASE_URL`，未运行真实数据库、生成、扣费或邮件 provider 测试。完整运行清单与结果：`/tmp/fikirtive-frontend-regression-rerun.ngcOFZ/vitest.log`（临时日志；测试源位于 `apps/web/lib/__tests__/`）。
- **测试维护：** 首轮 186/187，唯一失败是 `design-system-data-patterns.test.ts` 禁止任何 UI primitive import 的旧断言。当前 foundations 样张仅用正式 Button 展示键盘焦点；依据设计来源地图的复用规则，改为只允许 Button，并保留禁止业务 galleries、禁止 raw button 的检查。没有修改样张。定向 6/6 与该测试 scoped ESLint 通过。
- **类型与构建：** `pnpm run typecheck` 通过；`pnpm run build` 退出 0，完成编译、类型检查及 48 个静态页面生成。但构建仍打印缺少／默认 `BETTER_AUTH_SECRET` 的 `BetterAuthError` 和 base URL 未设置警告；不能据退出码推断登录可用或可发布。本轮未修改认证配置。
- **本地预览：** 构建后 `http://127.0.0.1:3008/product-patterns/create` 返回 HTTP 200，只证明该入口可响应，不代表浏览器交互验收。
- **未覆盖：** 完整 web suite、required CI、真实 authenticated journey、数据库／权限／钱路、屏幕阅读器、跨浏览器与双 viewport 的最终验收；现有接线交接档与各 phase closure 条件继续有效。

CodeGraph: not used — 非持图 worktree，使用定向源文件核对与测试运行。本轮不提交、不 push、不修改其他分支。

### PR 交接复核 — 2026-09-02

Founder 随后明确授权打包当前基线、提交 feature branch 并创建 PR；上述“不提交、不 push”仅描述前一轮回归检查。接手入口为 [前端基线交付快照](../governance/frontend-baseline-handoff.md)，不改变任何尚未关闭的接线条件。

- 新交接入口已登记到 authority map，并由已有 SSOT guard 检查可发现性；这只证明链接／owner 存在，不证明未来 agent 自动合规。
- 更新 guard 后再次重跑同一组 32 files / 187 tests，全部通过；准确文件名与可重复命令收录于交付快照（包括 `profile-design-system.test.ts`）。
- SSOT／data-pattern 定向 15/15 与修改后的 SSOT test scoped ESLint 通过。此次文档打包没有重新跑 build；沿用上方同日 build 记录及其 Auth 配置限制，不把它提升为 production acceptance。

## Guard rule

`navigation-contract.json` 记录 active main navigation 与已知 runtime extra keys。自动测试必须满足：

1. runtime active keys 移除已登记 drift 后，严格等于 frozen active keys；
2. 新增未登记的 main-navigation key 会失败；
3. known runtime extra 必须同时属于 Parked keys；
4. `informationArchitecture` 必须登记在 `design-system/authority.json`。

当 production navigation 收敛时，implementation change 必须同时删除对应 `knownRuntimeExtraMainNavigationKeys`；不得把已修复 drift
继续留在 allow-list。

## Boundary

本次 Sitemap freeze 不修改 runtime navigation、routes、database、permissions、money flow 或 production UI。每个 convergence item
需要按 observable behavior 的风险建立独立 implementation spec 与验收。
