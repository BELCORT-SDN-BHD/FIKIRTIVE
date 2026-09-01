# Mobbin evidence — Settings ownership

> 研究日期：2026-08-30。  
> 任务：决定 Profile、Preferences、Connections 与 Billing 应按 route、功能，还是 owner scope 分组。  
> 状态：Evidence + approved direction；Founder 于 2026-08-30 选择 A。  
> 方法：使用 Mobbin MCP `search_flows` 检查 Linear、Jasper 与 Canva 的完整 Settings flows，并对照 Fikirtive 当前页面字段。
>
> **Beta follow-up — 2026-08-31：** Founder 决定 beta 暂不提供 Schedule。第二轮 Mobbin MCP 研究补查了连接管理、审批与 credits；以下结论是 Settings screen spec 的输入，不会自行改写已冻结 IA。

## 1. Mobbin patterns

### Linear

- [Settings](https://mobbin.com/flows/d25c7666-f06d-4b4f-9d9b-ec3f9663c87e)
- [Account settings](https://mobbin.com/flows/8ff79d73-2aa9-4175-a039-3c38031e6e72)
- [Workspace settings](https://mobbin.com/flows/820abf56-0781-456e-b6ed-98609be8edc9)

Linear 使用一个 Settings experience，但明确分成个人范围（Profile、Preferences、Notifications、Security & access）和
Workspace / Administration 范围（Workspace、Members、Applications、Billing、Integrations）。

### Jasper

- [Settings](https://mobbin.com/flows/07ca70cf-48ef-4fa0-bfe2-a24344ea430b)
- [Workspace settings](https://mobbin.com/flows/c8c29782-c27a-4f19-916b-5da11a7c813d)
- [Editing integration settings](https://mobbin.com/flows/ac2baaf8-5965-408c-80fe-96c582404c50)

Jasper 在同一 settings sidebar 中使用 `Personal / Workspace / Admin controls` headings。My profile 属于 Personal；About、Plans、
Team、Usage 与 AI settings 属于 Workspace；Integrations 属于 Admin controls。Billing / plan 因影响整个 workspace，不放在个人账号下。

### Canva

- [Settings](https://mobbin.com/flows/24a726fc-b14c-4266-ba49-fe138a764793)
- [Updating profile](https://mobbin.com/flows/6293d12e-a9c3-4092-b152-8ac368e4f363)
- [Update payment method](https://mobbin.com/flows/62167242-2a21-4f46-af14-0376997be98c)

Canva 同样把 `Personal account`、team / people management 与 `Payments and plans` 分区。个人 profile 管姓名、email、language 等；
team profile 与 billing 属于 team owner scope。

## 2. Fikirtive current-state conflict

当前 `/settings` 的页面标题是 Preferences，但实际 sections 是：

- Otto behavior 与 spend cap；
- Schedule defaults；
- Connections summary；
- Billing / credits summary；
- Danger zone。

这不是 personal preferences，而是 workspace controls。当前 `/profile` 同时编辑 `displayName` 与 `workspaceName`；前者是个人，后者是
workspace。若继续放在同一 Profile card，会让“修改我是谁”和“修改 workspace 是什么”共享一个 owner，和现有页面的
`Personal profile` 承诺冲突。

## 3. 已批准 A — one settings experience, scope-separated

```text
Settings experience
├─ Personal
│  └─ Profile
│     ├─ Display name
│     └─ Email
└─ Workspace
   ├─ General
   │  ├─ Workspace name
   │  └─ Delete workspace
   ├─ Automation & approvals
   │  ├─ Otto behavior
   │  ├─ Spend cap
   │  └─ Auto-publish
   ├─ Publishing defaults
   ├─ Connections
   └─ Billing & credits

Entry points
├─ Main navigation Settings → Workspace scope
└─ Account menu Profile → same Settings experience, Personal / Profile active
```

约束：

- Brand business identity 不复制进 Workspace General；这里的 workspace name 只是应用内组织名称。
- Connections 属于 workspace，因为它同时供 Home、Create、Library 与 Schedule 使用，不属于某个人。
- Billing / credits 属于 workspace，因为余额、reserve 与 spend history 是共享业务状态。
- `Security / Notifications / Team` 只有在产品存在真实能力时才加入；v1 不画空设置。
- route 是否嵌套不是 IA owner。现有 `/profile`、`/billing` 与 `/settings/connections` 可先保留地址，但呈现同一 settings language。

## 4. 备选 B — Profile standalone

Profile 继续作为 account-menu-only 的独立页面；Settings 只管理 Workspace。Connections 与 Billing 仍是 Workspace children。
这个方案 implementation 较轻，但 Founder 在 Profile 与 Settings 之间会看到两套 settings presentation。

## 5. Beta follow-up：直接采用与暂缓

第二轮直接检查的高价值 evidence：

- [Linear · Connected accounts](https://mobbin.com/screens/3b7417c7-551f-4935-890f-4788e4d8d334)：连接管理使用紧凑 row，显示价值、身份与 `Connect / Manage`，不先展示 marketplace。
- [Linear · Integration detail](https://mobbin.com/screens/e64c901c-4ada-4f0a-b3a0-89a6ccf490da)：连接后显示 enabled by、scope、health 与 integration-specific settings。
- [Jasper · My profile](https://mobbin.com/screens/cb390e48-e4cc-494e-b432-5adf355d1d34)：短表单＋单一 Save action，适合 Personal / Profile。
- [Jasper · AI settings](https://mobbin.com/screens/aff86e76-cc52-4677-b8d9-843800fb4c2e)：明确说明 workspace defaults 会影响所有成员；适合作为 shared-default copy precedent。
- [Canva · Billing](https://mobbin.com/screens/5f3d62d3-4235-4f0f-afb1-b83ec90f0ac2)：plan、payment method、credits 与 billing details 在一个页面呈现。
- [Buffer · member approval access](https://mobbin.com/screens/7479340b-b7c5-47fc-8ebd-49b865b5fece)：`Can publish / Requires approval / No access` 是简单 access choice，不是 rule builder。
- [Buffer · Approvals inbox](https://mobbin.com/screens/992508f9-1d1a-43d6-8ecd-574b2e6bf1a3)：approval queue 属于 publishing operations，而不是 Settings。
- [v0 · Billing and Usage](https://mobbin.com/screens/109c6bf3-1d25-49f3-98d0-a167f76deaf8)：清楚分开 monthly credits 与 purchased credits，并显示 reset timing、payment 与 invoices。

适用于 Fikirtive beta 的结论：

- 继续采用一个 Settings shell，以 `Personal / Workspace` 明确分 scope。
- Connections 默认显示已连接项目的管理 list；`Add connection` 后才进入 discovery。
- Billing & credits 保持一个 nav item，在页内分 plan、included credits、purchased credits、reset / expiry、payment 与 invoices。
- Workspace 改动必须明确写出“affects everyone in this workspace”；default 与 enforced rule 不可混称。
- Schedule 已 deferred，因此 `Publishing defaults` 不应在 beta 出现空页面。
- 不建立含糊的 generic `Automation` 页面。只有确认 beta 存在真实的 Otto default、spend control 或 collaborator approval 时，才把对应 controls 组成一个可命名 section。
- 若 beta 没有 direct publishing / collaborators，publishing approval 也一起 deferred；Canvas 的逐次 generation confirmation 继续留在创作 flow，不搬成 Settings rule builder。
