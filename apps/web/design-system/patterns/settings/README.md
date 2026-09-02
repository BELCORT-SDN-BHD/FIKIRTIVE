# Settings beta screen pattern

> **状态：Founder approved and frozen — 2026-08-31。**  
> **上游权威：** `../../information-architecture/` 的 beta sitemap、surface contract 与 Settings ownership。  
> **研究证据：** `../../information-architecture/mobbin-settings-ownership-evidence.md`。  
> **Beta scope：** 不包含 Schedule、Publishing defaults 或 publishing approvals。

## 1. 谁与成功标准

**主要用户：** 需要自己管理账户、workspace integrations 与 credits 的小生意 Founder。

**一句成功：** Founder 一眼分得清“只影响我”和“影响整个 workspace”，并能用最少步骤完成个人资料、连接与账单管理。

## 2. Beta information architecture

Settings 是一个 experience，不是多个外观不同的设置产品：

```text
Settings
├─ Personal
│  └─ Profile
└─ Workspace
   ├─ General
   ├─ Connections
   └─ Billing & credits

Entry points
├─ Account menu / Profile → Personal / Profile
└─ Main navigation / Settings → Workspace / General
```

- left rail 只显示上述四个 destinations；不放空的 future sections。
- Personal section 只影响当前登录用户。
- Workspace section 的页面开头明确写出 `Changes affect everyone in this workspace.`
- 页面标题跟随 active destination；`Settings` 只保留在 breadcrumb / shell context。
- route 可以继续兼容现有地址，但所有入口必须呈现同一个 Settings shell 与语言。

## 3. Shared screen architecture

Desktop 使用一个紧凑 settings rail＋单一 content pane：

1. **Scope navigation**：`Personal` 与 `Workspace` 两个清楚 group。
2. **Page header**：active page title、一句影响范围说明；不使用 dashboard KPI。
3. **Settings content**：按任务组成 section；默认使用 plain rows / forms，不堆独立 marketing cards。
4. **Action hierarchy**：多字段 form 使用一个明确 `Save changes`；单项 reversible switch 可即时保存并显示结果。
5. **State feedback**：保存中、成功、失败、需重新连接都在原位置表达；toast 只作为补充，不能代替结果状态。

普通 setting row 统一使用：

```text
Label
One-sentence effect                    Current state / control / action
```

## 4. Page contracts

### 4.1 Personal / Profile

- 编辑当前用户的 display name。
- 显示当前 email；是否可修改由真实身份系统能力决定，fixture 不伪造 email-change flow。
- 使用短表单与单一 `Save changes`；不加入 workspace name。
- 不建立第二张 standalone Profile visual language。

### 4.2 Workspace / General

- 编辑 workspace name。
- 明确说明 workspace fields 影响所有成员，而不是个人 preference。
- beta 不预造 team management、security policy、notification policy 或 destructive workspace lifecycle controls。
- Otto / Brand defaults 继续由其 canonical owner 管理；不能在 General 复制第二份 Brand context。

### 4.3 Workspace / Connections

- 默认先管理已经连接的 services，不先展示大型 marketplace。
- 每一 row 显示 service、connected identity、Personal / Workspace scope、health status 与一个 `Manage` / `Reconnect` action。
- `Add connection` 才进入 discovery，并先解释连接用途与所需 scope，再开始授权。
- 一个 provider 是否支持多个 accounts、disconnect 权限与 OAuth error recovery 必须由真实 connection contract 决定；fixture 只演示 approved states。
- disconnected、expired、permission changed 与 reconnect failed 必须有可恢复状态；不能只显示 generic toast。

### 4.4 Workspace / Billing & credits

一个页面、两个清楚 sections，不拆成两个 nav items：

1. **Plan & payment**：current plan、renewal / billing period、payment method、invoices。
2. **Credits**：included monthly credits、purchased credits、reset / expiry、usage entry 与 `Add credits`。

- monthly allowance 与 purchased balance 必须分开显示，不能合成一个像现金的钱包数字。
- 消耗顺序、rollover、expiry、low-balance warning 与 auto-refill 必须读取 pricing / billing truth；screen pattern 不自行发明。
- 付费动作必须显示准确单位、金额与结果；本 fixture 不连接真实 checkout。

## 5. Essential states

- **Profile ready / saving / save failed**。
- **Workspace General ready / saving / save failed**。
- **Connections empty**：解释为什么连接，并提供一个 `Add connection`。
- **Connection healthy**：显示 identity、scope 与 `Manage`。
- **Connection needs attention**：说明原因并提供 `Reconnect`。
- **Connection authorization failed**：保留 service context，可 retry 或 cancel。
- **Billing ready**：plan、credits、reset / expiry、payment 与 invoices 都可辨认。
- **Billing unavailable**：保留页面结构，明确暂时无法读取；不显示 `0 credits` 假状态。
- **No permission**：解释需要何种 workspace capability；不展示看似可成功的付费或连接按钮。

## 6. Checkable acceptance criteria

1. Settings 只有一个 shared shell，并清楚分成 Personal / Workspace。
2. Account menu Profile 进入 Personal / Profile；主导航 Settings 进入 Workspace / General。
3. beta rail 只有 Profile、General、Connections、Billing & credits。
4. 不出现 Schedule、Publishing defaults、publishing approval、generic Automation 或 future placeholder pages。
5. active page title 与 URL / navigation state 同步；browser Back / Forward 能恢复 active page。
6. Profile 不编辑 workspace name；General 不复制 Brand / Otto IQ facts。
7. Workspace pages清楚说明修改会影响整个 workspace。
8. Connections 默认是 management list；Add connection 才进入 discovery / authorization。
9. Connection rows 显示 identity、scope、health 与真实下一步；expired / error 可恢复。
10. Billing & credits 是一个 nav item，但 monthly / purchased credits 在页内清楚分开。
11. 多字段保存、重连、Add connection、Add credits 与 invoice entry 都是可操作或诚实 disabled；不用 toast 假装完成。
12. 全部 UI 消费现有 Fikirtive Design System owners；coral 只属于 Fikirtive / Otto moments。
13. fixture 不声称 persistence、OAuth、payment、permission 或 backend engine 已连接。

## 7. Non-goals

- Schedule、publishing defaults、posting slots 或 publishing approval inbox；
- team / member administration；
- notification、security、2FA 或 session management；
- generic automation builder、approver chains 或 rule canvas；
- workspace deletion / ownership transfer；
- multi-workspace / agency switching；
- 在 screen-pattern 阶段修改 auth、billing、connection backend、schema、permissions 或 production routes。

## 8. Founder approval gate

**Spec status：** Founder approved and frozen — 2026-08-31。  
**Selected visual：** `selected-direction.png` 的第二款方向——紧凑 Settings scope rail、连接列表与右侧 detail inspector。  
**Implementation gate：** Founder 于 2026-08-31 回复“2那种我很喜欢”，批准此方向进入 frontend implementation。

## 9. Change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-31 | Scope approved | Founder 同意 beta Settings 精简为 Personal / Profile、Workspace / General、Connections、Billing & credits；Schedule 不属于 beta。 |
| 2026-08-31 | Drafted | 按冻结 Sitemap 与第二轮 Mobbin evidence 建立 screen spec candidate，等待 Founder 浏览后冻结。 |
| 2026-08-31 | Approved and frozen | Founder 回复“确认”；冻结 Settings beta screen spec，进入 visual direction gate。 |
| 2026-08-31 | Visual selected | Founder 选择第二款；冻结 `selected-direction.png` 为 Settings implementation target。 |
| 2026-08-31 | Ready for Founder review | 第二款已实现并完成同 viewport visual comparison、主要交互、typecheck、lint、tests 与 production build 检查。 |
| 2026-08-31 | Previous audit invalidated | 录屏证明 Settings 内部 URL 会改变但画面不会跟随，且其他 review surfaces 泄漏 parked Campaigns / Schedule；撤回原 `Interaction audit passed` 结论，完整 journey 重新验收。 |
| 2026-08-31 | Corrected journey audit passed | 五个 review surfaces 改用 shared frozen shell；Settings 改用 router-aware links；重走跨页、Back / Forward、forms、connections、billing、account menu 与 Otto，并修复 audit 新发现的 credits 总数不同步。证据与边界记录于 `interaction-audit.md`。 |
