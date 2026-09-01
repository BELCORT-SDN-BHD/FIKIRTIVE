# Frontend convergence Phase 4 — Settings

> **状态：Frontend implementation complete — awaiting authenticated Founder acceptance and DB-backed checks。**  
> **上游权威：** `product-map.md`、`surface-contract.md`、`../patterns/settings/README.md`、`@fikirtive/core/navigation` 与现有 authenticated server actions。  
> **视觉权威：** `../patterns/settings/selected-direction.png`；Founder 已选择第二款，fixture journey audit 已通过。

## 1. Who and success

**For：** 需要自己管理个人资料、Workspace、Connections 与 credits 的小生意 Founder。

**One-sentence success：** Founder 从任何 Settings 入口都进入同一个清楚的 Settings experience，准确知道一项修改只影响自己还是影响整个 Workspace，并且所有可见动作连接现有真实能力。

## 2. Foundation finding

- Settings screen pattern、第二款视觉方向与完整 fixture journey 已获 Founder 验收。
- Frozen IA 只有四个 destinations：Personal / Profile；Workspace / General、Connections、Billing & credits。
- Production 目前是四个外观不同的 surfaces：`/profile` 同时修改 personal 与 Workspace name；`/settings` 仍渲染 legacy `OttoAccount`；`/settings/connections` 渲染独立 `OttoConnections`；`/billing` 使用另一套 standalone billing layout。
- 现有 backend 已能真实读取和修改 display name、Workspace name；读取及管理现有 Connections；读取 credit balance、held credits、credit packs 与 usage history；发起真实 checkout。
- 现有 backend 没有完整 subscription plan、payment-method management 或 invoice list contract。本阶段不得复制 fixture records 或发明这些 claims；没有真实能力的 section / action 不显示。

## 3. Scope

### S1 — One shared Settings experience

- 建立一个 production shared Settings shell：左侧 scope rail，右侧 active content；不为四条 routes 复制壳。
- 保留现有 route authority：`/profile`、`/settings`、`/settings/connections`、`/billing`；不使用 query-only fake navigation。
- Account menu 的 Profile 进入 Personal / Profile；主导航 Settings 进入 Workspace / General。
- active item、H1、content、URL 与 browser Back / Forward 永远同步。

### S2 — Personal / Profile

- 只显示和修改当前 User 的 display name；email 只读。
- Workspace name 从 Profile 移到 Workspace / General。
- 使用现有 `getMyProfileNames` 与 `updateDisplayName`；不建立第二份 identity action。

### S3 — Workspace / General

- 只显示和修改当前 Org 的 Workspace name，并明确 `Changes affect everyone in this workspace.`
- 使用现有 `getMyProfileNames` read 与 `updateWorkspaceName` action。
- 不显示 Schedule、publishing、generic Automation、Brand / Otto IQ defaults 或 future placeholders。

### S4 — Workspace / Connections

- 把现有 connection truth 和 actions 放进 approved list → detail anatomy；不复制 OAuth 或 Meta business logic。
- 每个真实 provider row 显示 identity、Workspace scope、health 与当前可执行的 `Connect / Manage / Reconnect / Disconnect`。
- Add connection 只列出 server 当前真实支持或可解释为 unavailable 的 providers；fixture Google Ads / Shopify state 不进入 production。
- OAuth callback error、unreadable、needs reconnect 与 disconnect confirmation 保留原位 recovery。

### S5 — Workspace / Billing & credits

- 使用一个 `Billing & credits` destination；页内只显示 server 能证明的内容：available / held credits、credit packs、checkout result 与 usage history。
- 没有真实 subscription plan、payment method 或 invoices contract 时，不显示 sample plan、sample card 或 sample invoices，也不显示无作用按钮。
- 所有 credits wording、formatting、pack price 与 ledger rows继续读取现有 pricing / billing truth。

## 4. Single source of truth and DRY

1. Route / Settings ownership：`@fikirtive/core/navigation`。
2. Personal display name：existing User identity reads / actions。
3. Workspace name：existing Org reads / actions。
4. Connection status、OAuth 与 disconnect：existing account / Meta connection actions。
5. Credits、packs、checkout 与 usage：existing account、billing、pricing 与 ledger authorities。
6. Settings shell、scope rail、row、detail inspector 与 feedback：shared production Settings components using current Design System primitives。
7. Review fixtures only prove design；production import graph 不得读取 fixture account、connection、billing 或 invoice data。

## 5. Checkable acceptance criteria

1. `/profile`、`/settings`、`/settings/connections` 与 `/billing` 使用同一个 production Settings shell。
2. Rail 只显示 Profile、General、Connections、Billing & credits；没有 Schedule、Publishing、Automation 或 future placeholders。
3. URL、active rail item、H1 与 content 同步；direct load、Back、Forward 与 refresh 保持正确 destination。
4. Profile 只修改 display name，并只读显示 authenticated email；不出现 Workspace name。
5. General 只修改 Workspace name，并清楚说明 Workspace scope；不复制 Brand / Otto IQ facts。
6. Profile 与 General 保存使用现有 owner-scoped actions；busy、success 与 failure 原位可读，不以 toast 代替结果。
7. Connections 只显示真实读取到的 provider states；Connect、Manage、Reconnect 与 Disconnect 使用现有 action layer。
8. Connection unavailable、OAuth failure、needs reconnect、unreadable 与 disconnect cancel / confirm 都有可恢复结果。
9. Billing & credits 只显示可证明的 balances、held credits、packs、checkout status 与 usage history；不可读时不回落成 `0`。
10. 不显示 fixture plan、payment method、invoice 或购买结果；付费动作继续使用现有 checkout 与 pricing truth。
11. Production routes 不 import `design-system/patterns/settings` fixtures、review account 或 session-only save state。
12. 所有 controls 使用当前 Design System owners；没有 duplicate Button、Dialog、Alert、Field、Input、Badge、Spinner 或 tokens。
13. Keyboard、visible focus、dialog naming、form labels、disabled email、destructive confirmation 与 reduced-motion behavior 可完成核心 journey。
14. Settings route / interaction tests、tenant / money contract tests、typecheck、scoped lint、Design System audit 与 production build 通过。
15. Founder 在正式 routes 验收 shared shell、四个 destinations 与 desktop journey 后，本 frontend phase 才完成。

## 6. Non-goals

- 新增或修改 database schema、Org / permission model、OAuth provider 或 connection backend。
- 新建 subscription、payment-method update、invoice backend 或 pricing product。
- email change、password / session security、2FA、team management 或 Workspace lifecycle。
- Schedule、publishing defaults、publishing approval、notification 或 Automation settings。
- 把 fixture data、session-only mutation 或 review screenshots 接进 production。

## 7. Delivery order

1. Founder 批准并冻结本 spec。
2. 先写 behavior tests，钉住 shared shell、route ownership、no-fixture import 与 honest capability visibility。
3. 建立 shared production Settings shell 和四个 route adapters。
4. 将现有 Profile、General、Connections 与 Billing reads / actions 接入 approved anatomy；删除由本次替换产生的 legacy presentation imports。
5. 逐条执行 route、keyboard、failure、tenant、money、typecheck、lint、Design System audit 与 production build checks。
6. 打开正式 routes 给 Founder 验收；不 push。

## 8. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-09-01 | Review candidate | Library 与 Brand production 分别等待 backend contract / Otto IQ engine 后，核对 Settings approved pattern 与现有 runtime abilities；确认四个 Settings destinations 可在不新增 backend、不使用 fake data 的前提下收敛。等待 Founder 批准与冻结。 |
| 2026-09-01 | Founder approved and frozen | Founder 在呈批后明确回复“继续”；冻结 S1–S5、acceptance criteria 与 non-goals，授权修改正式 Settings routes。 |
| 2026-09-01 | Frontend implemented; acceptance pending | 四条正式 routes 已共用 `components/settings/SettingsShell.tsx`；Profile / General ownership 已拆分；Connections 已接回真实 connection actions 的 list → detail inspector；Billing 只显示真实 balances、packs、checkout status 与 usage。Core navigation tests 1443/1443、Settings scoped tests 112/112、TypeScript、scoped ESLint、Design System audit 与 production build 已通过。Production build 在当前无 secrets 环境仍打印既有 `BETTER_AUTH_SECRET` 警告；authenticated Founder journey 与 DB-backed tenant / money checks 尚未完成，因此不宣告 Phase closure。 |
