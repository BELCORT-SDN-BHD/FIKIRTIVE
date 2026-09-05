# Beta frontend convergence - Phase 2 Home acceptance

> **状态：Implementation complete within approved frontend scope; closure blocked by two named seams and Founder visual acceptance。**（2026-09-05 回写：原三条 seams 中的 Home layout persistence + `Manage home` capability 已接通，见下表 #8 / #9 与 Named closure seams 第 1 条。）  
> **冻结规格：** `frontend-convergence-phase-2-home-spec.md`，Founder approved and frozen 2026-08-31。  
> 本文件只记录验收事实；不改写冻结规格。

## Acceptance ledger

| # | 状态 | 当前证据或剩余条件 |
|---|---|---|
| 1 | Pass | `/` 与 `/analysis` 均由 root `MerchantAppShell` 承载；Analysis 由 Home owner 点亮，不新增导航项。 |
| 2 | Pass | `lib/__tests__/home-page.test.ts` 钉住 production import graph 不读取 review fixtures / builders。 |
| 3 | Pass | Meta-only 进入 `partial`；setup、insufficient、unavailable 均不渲染 fixture-only business outcomes。 |
| 4 | Pass | 五种 read-model state 有独立 render / behavior assertions；非-ready states 有真实 recovery action。 |
| 5 | Pass | Home 只保留最多两个真实 Canvas recents；旧 Schedule、Campaign、StartSomething、onboarding 不再进入 production Home。 |
| 6 | Pass | Goal、range、comparison 共用 canonical registries，并由 URL 持有。 |
| 7 | Pass | Shared read model 持有 period、source provenance、freshness 与 evidence strength；无法取得 freshness 时明确显示 unknown。 |
| 8 | Pass（2026-09-05 回写） | Workspace-wide Home layout persistence 已接通：server action `apps/web/lib/home-layout-actions.ts`（`saveHomeLayout`）、读写单源 `apps/web/lib/home-layout-store.ts`、`OrgHomeLayout` 表（`packages/db/prisma/schema.prisma:1369`）与迁移 `packages/db/prisma/migrations/20260903120000_org_home_layout`；跨刷新与换浏览器由 `e2e/journeys/15-home-layout-persists.spec.ts:35`（FRONT-A4）守。原文「persistence action 尚不存在」是本文件冻结当时（2026-08-31）的观察，与 live code 冲突，已按现状回写。 |
| 9 | Pass（2026-09-05 回写） | `Manage home` capability 已存在：`canManageHome()` 在 `apps/web/lib/home-layout-store.ts:37` 按 org permission `workspace.manage_home` 判，founder-admin 那一支单独放行；商家侧入口是 Customize home 面板（`apps/web/components/home/CustomizeHomePanel.tsx:56`，由 `apps/web/components/home/MarketingHomeView.tsx:381` 打开）。原文「capability seam 尚不存在」是本文件冻结当时（2026-08-31）的观察，已按现状回写。 |
| 10 | Pass | Analysis 只接受 typed type / subject / filters / return target；query copy 不成为 truth。 |
| 11 | Pass | Ready 与 partial Analysis 都遵循 `conclusion → value → chart → evidence → meaning → action`。 |
| 12 | Pass | Partial / insufficient / unavailable 不作 causal claim，不显示无来源 confidence。 |
| 13 | Partial | 原 Home filters 与 typed focus target 已恢复；customized layout 需 #8，正式浏览器 scroll/focus 仍待 visual QA。 |
| 14 | Partial | Create 与 Manage connections 使用 canonical routes；Otto removable context 需真实 server context reader，当前不能假装已 attach。 |
| 15 | Partial | Controls 复用 Design System primitives，chart 有 non-visual label；正式 authenticated browser 的 keyboard pass 待 Founder 登录后执行。 |
| 16 | Pass | 高频 filters 没有装饰性 transition；Design System motion 继续遵守 reduced motion。 |
| 17 | Pending | 1440px / 1920px authenticated production visual QA。 |
| 18 | Pass | 39 项 Home tests、typecheck、scoped lint 与 production build 通过；core navigation tests 另有 38 项通过。 |
| 19 | Pending | 正式 route visual comparison 需 authenticated production `ready` aggregate；当前 live adapter 只能诚实到 Meta-only partial。 |
| 20 | Pass | `runtime-convergence.md`、Home pattern authority 与 navigation copy 已同步。 |

## Named closure seams

1. ~~**Home layout persistence + `Manage home` capability**：backend/schema/action 不在本阶段获批范围，不能以 local storage 代替。~~ **已关闭（2026-09-05 回写）**：owner-scoped persistence action、`OrgHomeLayout` 表与迁移、`workspace.manage_home` capability 都已在主干，证据见上表 #8 / #9；不是用 local storage 代替的。
2. **Otto page-context reader**：现有 panel 只会打开；server 还不会消费 Analysis context，所以不能显示会误导用户的 removable context chip。
3. **Authenticated visual acceptance**：正式 `/` 会正确经过登录；Founder 登录后需完成 1440px / 1920px、keyboard、Back / Forward、scroll / focus 与 same-viewport comparison。

## Automated evidence

- Home family tests：7 files / 39 tests passed。
- Core navigation：38 tests passed（同次 core run 共 58 files / 1,442 tests passed）。
- Web TypeScript：passed。
- Scoped ESLint：passed。
- Design-system usage audit：Home changed files only import `design-system/primitives`; repository-wide adoption report is 137 / 266 product files (51.5%) and remains a wider convergence concern, not a Home exception。
- Production build：passed；现有 local auth environment warning 不影响 compilation，但正式 browser acceptance 仍需要 authenticated session。

## Closure rule

本 Phase 现在不能标记 **closed**。只有 #8、#9、#14 的真实 seams 接通，#17、#19 完成 Founder visual acceptance 后，才可把本文件状态改为 closed。

## Founder review record

| 日期 | 验收范围 | 结果 |
|---|---|---|
| 2026-09-01 | `/product-patterns/founder-home` fixture 的 Home 视觉与现有 review interaction | Founder：“ok这个可以。” Fixture 方向通过；不升级为正式 authenticated `/`、ready aggregate、keyboard 或 same-viewport production acceptance。 |
