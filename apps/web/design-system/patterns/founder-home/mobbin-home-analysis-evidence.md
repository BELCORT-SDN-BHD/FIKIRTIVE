# Mobbin evidence — Home analysis detail

> **状态：** Screen-design research input — 2026-08-31。  
> **范围：** Founder 从 Home marketing health overview 进入一个 focused explanation。  
> 本文件不改写冻结 IA；它只为 `home.analysis` 的 screen spec 提供可核查 reference。

## 1. Reviewed flows

### Shopify

- [Analytics](https://mobbin.com/flows/900997d6-1ad1-4ac3-b1e4-fc7d17ff8a9c) — 6 screens。Overview 使用 headline metric、trend 与小图；后续进入 focused report 与 benchmarking。可复用的是 `overview → focused metric → contextual comparison`。
- [Customizing analytics dashboard](https://mobbin.com/flows/99695c33-c6c9-4a93-98a8-e1b1b0d69bf4) — 4 screens。Date、comparison、refresh 与 customize 在 overview 层；metric library 和 drag-and-drop 属于可选 customization，不应进入 Fikirtive Founder 的核心分析路径。

### Stripe

- [Billing overview](https://mobbin.com/flows/c96f68a8-c962-45d1-9ce3-64b81dcacca6) — 6 screens。稳定 shell、topic tabs 与重复 metric modules 让 Founder 保持位置感；benchmarking 是第二层，而不是第一解释。
- [Filtering Revenue](https://mobbin.com/flows/0239ef67-d3e5-4a2b-89fb-5ace2d83631e) — 5 screens。证明 revenue detail 可拥有专属 filtering sequence；本研究没有根据未见 preview 推断更细行为。

### Google Analytics

- [User acquisition](https://mobbin.com/flows/c1ea43d7-137a-4a60-bb5c-408fba800bee) — 4 screens。以一个明确 report question 开场，保留 date / comparison；chart 在前，dimension table 在后，hover tooltip 与 granularity toggle 是辅助解释而非必经步骤。

### HubSpot

- [Creating a dashboard](https://mobbin.com/flows/f2e6db94-d707-4e2c-b25f-e1a73063569a) — 10 screens。Report template 先以 plain-language purpose 解释用途，之后才暴露 grouped cards 与 table。对 Fikirtive 的价值是先说明 Founder 正在回答什么问题。

### Klaviyo

- [Campaign detail](https://mobbin.com/flows/de35bd06-5edd-4cac-a097-a9b1d59f7d65) — 14 screens。Detail 通过少量意图明确的 tabs 管理 scope；metric status 使用 `Healthy / Needs attention`，旁边提供 explanation 与 troubleshooting action。Fikirtive 可采用 status → meaning → next action，但不复制完整 tab 数量。

## 2. Evidence-backed pattern

```text
Home selected insight + current filters
→ Focused analysis question
→ Headline status / value + period comparison
→ One primary explanatory chart
→ Plain-language “What this means”
→ One recommended next action
→ Optional breakdown / evidence
→ Back restores exact Home state
```

## 3. What Fikirtive should reuse

1. 保留 application shell 与可识别的 Home return path。
2. Page title 写出一个明确问题，不使用 generic `Analytics`。
3. Date range 与 comparison 从 Home 带入并持续可见。
4. 第一视区只放一个主要解释；supporting breakdown 在后。
5. Status 使用 Founder language，并立即解释意义与下一步。
6. Hover tooltip、granularity、filters 与 benchmarking 都是 progressive disclosure。

## 4. What Fikirtive should avoid

- 不以 Google Analytics 式多列技术 table 开场。
- 不让 Stripe benchmarking percentile 抢走主要解释。
- 不把 Shopify dashboard customization 放进分析主路径。
- 不复制 Klaviyo 的完整 campaign tabs；只有 Founder 能理解且需要的 intent 才成为 view。
- 不显示没有解释或行动建议的 dense metric grid。

## 5. Working recommendation

`home.analysis` 是一个 explanation-first detail page，不是第二个 dashboard，也不是 Campaigns / Analytics product area。它应回答 Founder 从 Home 点进来的一个问题，并使用 `summary → evidence → action` 的信息层级。最终范围以 Founder grilling 与随后冻结的 screen spec 为准。
