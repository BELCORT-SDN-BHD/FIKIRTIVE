# Home analysis detail — screen spec

> **状态：Founder approved and frozen — 2026-08-31。**  
> **上游权威：** `../../information-architecture/product-map.md`、`../../information-architecture/surface-contract.md`。  
> **研究输入：** `mobbin-home-analysis-evidence.md`。  
> **Shared understanding confirmed：** 2026-08-31。

## 1. Who and success

**For：** 没有完整 marketing team、从 Home marketing-health overview 点进一个 insight 的小生意 Founder。

**One-sentence success：** Founder 在一个 focused detail page 内先理解发生了什么，再验证证据并进入一个安全、透明的下一步，而不会面对第二个 dashboard。

## 2. Scope and ownership

- `home.analysis` 是 Home 的 application-shell detail page，不是新的 Analytics、Campaigns 或 reporting product area。
- 已验收的 Home overview 不重新设计；它只提供 driver、top performer、chart context 或 data-health entry。
- 所有入口使用同一个 adaptable analysis template，按 analysis type 组合 canonical modules。
- Desktop only，沿用 Founder Home 已批准的 viewport boundary。
- Back 必须恢复进入前的 Home business goal、date、comparison、customized composition 与 scroll / focus context。

## 3. Supported beta analysis types

1. **Performance change** — 解释 revenue、ROAS、spend 或 conversion efficiency 的变化。
2. **Top performer** — 解释某个 Product、content、channel 或 published item 为什么表现突出。
3. **Data health** — 解释 source completeness、stale data 或 connection health 对结论的影响。

不支持任意自然语言 report builder；不因 Campaign 作为 evidence dimension 而恢复 Campaigns product area。

## 4. Information hierarchy

```text
Home entry context + inherited filters
→ Plain-language conclusion
→ Headline value + period comparison
→ One primary explanatory chart
→ Top 3 evidence + evidence strength
→ What this means
→ One contextual primary action + Ask Otto
→ Optional supporting breakdown
```

第一视区必须先回答问题，不能以 KPI grid、technical table 或 Otto 长文字开场。

## 5. Filters and chart behavior

- 继承 Home 的 metric / business goal、date range 与 comparison，并持续可见。
- Analysis 内只允许调整 date range 与 comparison；改变 analysis subject 必须返回 Home 重新选择。
- 主图仅支持 hover tooltip 与 day / week granularity。
- Breakdown 默认使用最相关维度，并最多提供少量相关维度切换；不提供 drag-and-drop、arbitrary dimensions 或 chart builder。
- Analysis 内的 filter change 不改写原 Home state；Back 恢复进入前 Home。

## 6. Evidence and trust contract

- Otto / UI 只说明 observable relationship，不把 correlation 写成 causation，除非未来存在明确 experiment 或 attribution evidence contract。
- Evidence strength 使用 `Strong evidence`、`Some evidence`、`Limited evidence`，并解释 source count、time span 与 missing data；不显示 0–100% fake precision。
- 默认显示 Top 3 evidence；`View breakdown` 才显示更完整明细。
- 数据不足时不得生成推测结论。使用 `Not enough evidence yet`，说明缺什么，并提供 extend date range、manage connection 或 retry 的真实下一步。
- 页面显示 live data 与 freshness；handoff 给 Otto / Create 的 analysis context 是带生成时间、period 与 evidence IDs 的 snapshot。

## 7. Contextual actions

每个 analysis 只显示一个最相关 primary action，并保留 `Ask Otto`：

- `Create a variation` → 进入 Create，composer 显示可移除的 analysis snapshot reference；不自动 submit 或收费。
- `Manage connection` → 进入 Settings 对应 connection detail。
- `Ask Otto` → 在当前 page 打开 Otto panel，显式带入 analysis subject、period、conclusion、evidence strength 与 snapshot timestamp。

所有 generation、付费或 destructive action 继续使用其既有 confirmation；analysis 不新增旁路。

## 8. Required states

- Loading / recalculating。
- Ready with strong / some / limited evidence。
- Partial data / stale source。
- Not enough evidence。
- Source unavailable / recoverable error。
- Handoff prepared；handoff destination unavailable 时留在当前 page 并给 recoverable feedback。

## 9. Checkable acceptance criteria

1. 所有 Home analysis entries 打开同一个 `home.analysis` surface，并携带可识别 subject 与 Home filter context。
2. Page title 是具体 founder question / conclusion，不使用 generic `Analytics`。
3. 第一视区严格遵循 `conclusion → value/comparison → primary chart → meaning → action`。
4. Beta fixture 覆盖 Performance change、Top performer 与 Data health 三种 analysis type。
5. Date / comparison 可交互并同步更新 conclusion、value、chart、evidence 与 URL-backed state。
6. Subject 在 detail 内不可被 filters 悄悄替换；改变 subject 返回 Home。
7. Back / Forward、refresh 与 deep link 后，URL、title、filters、content 与 selected analysis 保持一致。
8. Back 返回原 Home business goal、date、comparison、component order 与 scroll / focus context。
9. Top 3 evidence 默认可见；完整 breakdown 通过 progressive disclosure 打开并可关闭。
10. Evidence strength 永远有解释；UI 不显示无来源的 confidence percentage 或 causal claim。
11. Not-enough-evidence state 不显示 fabricated conclusion / zero，并至少提供一个真实 recovery action。
12. Chart tooltip、granularity 与 breakdown dimension controls 均可键盘操作并有可读名称。
13. Contextual primary action 依 analysis type 唯一且可预测；Ask Otto 始终可用。
14. Create / Otto handoff 显示可移除 snapshot context；不会自动生成、收费或修改 persistent Brand truth。
15. Manage connection 进入 canonical Settings connection route；不建立第二套 connection UI。
16. Loading、partial、stale、error 与 handoff failure 都在原位置表达；toast 不代替持久结果状态。
17. Campaigns、Schedule、Saved reports、PDF、CSV、public share 与 mobile layout 不出现在 beta UI。
18. Screen 使用现有 design tokens、primitives、shared application shell 与 Otto interaction language，不建立页面私有副本。

## 10. Non-goals

- 重做 Home overview 或 Home customization。
- 任意 query builder、dashboard builder、custom report 或 benchmarking suite。
- Saved reports、favorites、collections、export、public share 或 scheduled email。
- Campaign management、publishing calendar、CRM 或 manual attribution modeling。
- Backend analytics calculation、provider mapping、causal inference、production permissions 或 persistence。
- Mobile / responsive dashboard design。

## 11. Visual and implementation gates

1. Founder 批准并冻结本 spec candidate。
2. 使用已归档 Mobbin screenshots 与当前 Fikirtive design system 制作三款真正不同但同一 contract 的 visual directions。
3. Founder 选择 visual target 后才开始 fixture implementation。
4. QA 必须逐条验证本文件 acceptance criteria，并比较 reference 与 prototype 的同 viewport screenshots；不能只检查截图或按钮 click。

## 12. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-31 | Mobbin research | 检查 Shopify、Stripe、Google Analytics、HubSpot 与 Klaviyo 的 analytics drill-down flows；证据归档在 `mobbin-home-analysis-evidence.md`。 |
| 2026-08-31 | Shared understanding confirmed | Founder 选择全部推荐项：explanation-first、shared template、evidence-based language、Top 3 evidence、limited filters、contextual handoff、三个 beta types、founder-friendly evidence strength、live page + snapshot handoff、honest insufficient-data state、no saved/export/share beta。 |
| 2026-08-31 | Founder approved and frozen | Founder：“批准并冻结 Home analysis spec”。本文件成为 `home.analysis` screen design、visual direction、fixture implementation 与 QA 的当前 authority。 |
| 2026-08-31 | Visual target selected | Founder 选择视觉方向 3；`home-analysis-selected-direction.png` 成为 implementation 与同 viewport visual QA 的目标。 |
