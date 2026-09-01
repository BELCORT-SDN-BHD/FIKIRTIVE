# Beta frontend convergence - Phase 2 Home and Home analysis

> **状态：Founder approved and frozen - 2026-08-31。授权 implementation。**  
> **上游权威：** `product-map.md`、`surface-contract.md`、`core-flows.md`、`navigation-contract.json`、`../patterns/founder-home/README.md`、`../patterns/founder-home/home-analysis-spec.md`。  
> **正式 route authority：** `@fikirtive/core/navigation`。  
> **设计 authority：** `../patterns/founder-home/selected-direction.png` 与 `../patterns/founder-home/home-analysis-selected-direction.png`。

## 1. Who and success

**For：** 没有完整 marketing team，需要快速理解 marketing health 并决定下一步的小生意 Founder。

**One-sentence success：** Founder 在正式 Home 看见由真实、可追溯数据支持的 marketing-health overview，能进入 focused analysis、Create、Settings 或 Otto；缺数据时页面明确说明缺什么，绝不显示 fixture 数字或把 unknown 写成 zero。

## 2. Intent

本阶段将 Founder 已批准的 `Home` 与 `home.analysis` pattern 收敛到正式 `/` 与 `/analysis`。它保留 Phase 1 已完成的 application shell、五项主导航和 Otto panel，不重新设计 screen，也不建立第二套 dashboard 或 Analytics product area。

现有正式 Home 的真实 `Continue creating` 数据继续使用，但改为批准版 Home 中的紧凑 handoff。Campaigns 与 Schedule 已从 beta 停用，不得重新进入 Home。

## 3. Truth boundary

批准版 fixture 同时假设 Shopify、Meta ads 与 website analytics 等多来源数据。当前正式代码只能稳定读取部分 Meta performance；它不能诚实地产生 Revenue、ROAS、online-sales attribution、跨渠道 top performers 或 causal explanation。

因此 production Home 使用一个单一 `MarketingHealthReadModel` 边界，并明确区分：

1. `ready`：当前 goal 所需指标均来自真实来源，带 source、period 与 freshness。
2. `partial`：只有部分组件拥有足够事实；只渲染可证明的内容，并说明缺失来源。
3. `not-configured`：没有适合当前 goal 的连接；显示连接入口，不显示样板数字。
4. `insufficient`：连接存在但资料量不足；显示 `Not enough evidence yet` 与真实 recovery action。
5. `unavailable`：读取失败或来源暂时不可用；与真正空数据分开表达，可重试。

`getAnalytics()` 可以作为其中一个 source adapter，但不能被当作完整 Home aggregate。Fixture builder 永远不能进入 production route 的 import graph。

## 4. Production behavior

### 4.1 Home overview

- 正式 `/` 使用批准版 narrative hierarchy：marketing-health conclusion、primary trend、efficiency/source context、What changed、Top performers、Otto recommendation、channel contribution。
- `Business goal`、`Date range` 与 `Comparison` 使用 Home 的 canonical registries，不建立第二份 option list。
- 每个 component 只在 read model 明确允许时渲染 ready content；缺资料时使用对应的 partial / setup state，不用 `0`、`-` 或 fixture copy 冒充结果。
- `Continue creating` 从现有 tenant-scoped Canvas reads 取得最多两个最近 Canvas，并把新工作送到 canonical Create route。
- `What changed`、Top performer、chart context 与 data health 进入同一个 `/analysis` template，并携带 typed subject、goal、range、comparison 与返回 context。
- `Recommended next action` 打开 Otto panel 或 Create handoff，不自动发送、生成或收费。
- Dashboard 保持 desktop only；小 viewport 使用已批准的 desktop-required boundary。

### 4.2 Home customization

- Component registry、recommended templates 与排序规则继续只由 `patterns/founder-home/model.ts` 持有。
- Customization draft 可以在 UI 中 reorder、show、hide、reset 与 cancel。
- `Save` 必须通过 owner-scoped、workspace-wide persistence action，并检查 `Manage home` capability。
- 如果这个 persistence action 尚不存在，production 不得用 browser storage 冒充 workspace save，也不得显示会静默丢失结果的成功反馈。该 seam 未接通前，本阶段不能被标记 complete。

### 4.3 Home analysis

- 正式 `/analysis` 替换旧 Meta Analytics surface，使用 Founder 已批准的 explanation-first template。
- Beta 支持 `performance-change`、`top-performer`、`data-health` 三种 typed analysis。
- 页面只接受 server-validated identifiers 与 filter values；query string 的 title、value 或 conclusion 不能直接成为 merchant truth。
- Ready content 来自同一个 `MarketingHealthReadModel` snapshot；snapshot 带 source IDs、period、freshness 与 evidence strength。
- Back、refresh、deep link 与 browser history 恢复 Home goal、range、comparison、customized order、scroll 与 focus context。
- Create、Settings 与 Otto handoff 使用 canonical routes/actions；不会自动生成、收费或写 Brand truth。

## 5. Single source of truth and DRY

1. Home goal、range、comparison、component registry 与 recommended templates：`patterns/founder-home/model.ts`。
2. Active routes、navigation labels 与 redirects：`@fikirtive/core/navigation`。
3. Marketing-health state and evidence：一个 server-owned `MarketingHealthReadModel`；Home 与 Analysis 只消费，不各自重新计算。
4. Existing Canvas recents：复用当前 tenant-scoped project / generation reads，不建立 Home 专用副本。
5. Design tokens、controls、chart、feedback、empty state 与 Otto panel：复用 Design System primitives。
6. Production copy：集中到 Home domain copy authority；fixture copy 不进入 production。

## 6. Checkable acceptance criteria

1. `/` 与 `/analysis` 都使用 shared application shell；Home 在导航中保持 active，Analysis 不新增导航项。
2. 正式 `/` 不 import `fixtures.ts`、`buildHomeDashboardFixture()` 或任何 review-only route helper。
3. 未连接、部分连接、资料不足与读取失败时，页面不显示批准 fixture 的 Revenue、ROAS、top performer、channel share 或 conclusion。
4. `ready`、`partial`、`not-configured`、`insufficient` 与 `unavailable` 均有独立行为测试和可见 recovery action。
5. Current production Canvas recents 被压缩进 `Continue creating`；旧 Home 的 Schedule、Campaign、generic StartSomething 与 onboarding sections 不残留。
6. Goal、range 与 comparison 改变会更新 URL-backed view state；Back / Forward 与 refresh 后状态一致。
7. 可用 component 的数据、comparison、freshness 与 source provenance 一致；一个 source failure 不会把其他 source 伪装成空。
8. `Customize home` 支持 reorder、show、hide、reset、cancel；Save 通过 owner-scoped persistence，失败留在 draft 并显示 inline feedback。
9. 没有 `Manage home` capability 时仍可看 Home，但不能保存 workspace layout；UI 解释权限而不是静默失败。
10. 每个 Home analysis entry 携带 typed subject ID；不信任客户端传入的 title、metric 或 conclusion。
11. `/analysis` 遵循已冻结的 `conclusion -> value/comparison -> chart -> evidence -> meaning -> action` hierarchy。
12. Analysis 的 insufficient / stale / partial / unavailable states 不作 causal claim，也不显示无来源 confidence percentage。
13. Analysis Back 恢复原 Home filters、layout、scroll 与 focus；direct deep link 有安全、诚实的 default return behavior。
14. Ask Otto、Create 与 Manage connections handoff 均显示可移除 context，且不自动触发付费或 persistent write。
15. 所有 visible controls 可用键盘操作，拥有可读名称、visible focus 与合理 tab order；chart 有非视觉摘要。
16. 高频 filter 切换不加装饰性动效；必要 state transition 在 300ms 内、可中断，并遵守 reduced motion。
17. 1440px 与 1920px desktop viewport 无遮挡、横向溢出或断裂；较小 viewport 显示 desktop-required boundary。
18. Navigation authority、Home pattern tests、production Home / Analysis behavior tests、typecheck、scoped lint 与 production build 通过。
19. 同 viewport visual comparison 证明正式 ready fixture state 与两张 Founder-selected reference 的 hierarchy、spacing、component language 一致。
20. 本阶段完成时同步 `runtime-convergence.md`、Home pattern authority 与 navigation copy，不留下“已修复但 backlog 仍写 open”的 drift。

## 7. Non-goals

- 新建或修改 Shopify、website analytics、attribution 或 causal-inference backend。
- 用 Meta-only 数据推算 Revenue、ROAS、orders 或 cross-channel attribution。
- 使用 local storage 代替 workspace-wide Home layout persistence。
- Campaigns、Schedule、saved reports、export、public share、mobile dashboard 或 arbitrary report builder。
- 修改 money movement、generation pricing、tenant identity 或 connection credentials。
- 重新设计已批准的 Home、Analysis、application shell、Otto panel 或 Design System。

## 8. Implementation gates

1. Founder 批准并冻结本 spec。
2. 先建立行为测试，钉住 production route 不读取 fixture、五种 data states、typed analysis context 与 Home state restoration。
3. 建立一个 server-owned read-model adapter；不在 Home 与 Analysis 组件内复制计算。
4. 只有真实 Home layout persistence action 接通后，`Customize home` acceptance 才能完成。
5. 逐项执行 automated tests、typecheck、scoped lint、production build 与同 viewport visual QA。
6. Founder 在正式 `/` 与 `/analysis` 完成 visual / interaction acceptance 后，本阶段才关闭。

## 9. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-31 | Review candidate | 基于已冻结 IA、Home / Analysis design authority 与当前 production data capability 建立；未授权 implementation。 |
| 2026-08-31 | Founder approved and frozen | Founder：“批准并冻结 Home Phase 2 spec。” 本文件成为正式 Home 与 Home analysis convergence 的 implementation authority。 |
