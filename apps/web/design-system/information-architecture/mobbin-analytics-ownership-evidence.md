# Mobbin evidence — Analytics ownership

> 研究日期：2026-08-30。  
> 任务：决定 Founder-facing marketing analytics 应归 Home、Schedule，还是独立 product area。  
> 状态：Evidence + approved direction；Founder 于 2026-08-30 选择 A。  
> 方法：使用 Mobbin MCP `search_flows` 检查 Home dashboard、publishing calendar、post detail 与 analytics flows。

## 1. Aggregate business analytics

- [Klaviyo — Home](https://mobbin.com/flows/5c49fed3-2684-4de4-ae9f-7154557dd496)
- [Shopify — Analytics](https://mobbin.com/flows/900997d6-1ad1-4ac3-b1e4-fc7d17ff8a9c)
- [Shopify — Customizing analytics dashboard](https://mobbin.com/flows/99695c33-c6c9-4a93-98a8-e1b1b0d69bf4)
- [Shopify — Creating a custom report](https://mobbin.com/flows/5aa7d0c4-b3c0-4a01-90b2-6c291fbea162)

Klaviyo Home 显示 business performance summary、attributed conversions、top-performing flows 与 recent campaigns，
再以 `View dashboard` 进入更深报告。Shopify 则让 Analytics 成为与其他业务区并列的 area，dashboard、reports 与
live view 都在该 area 内；它不属于 Calendar / publishing。

## 2. Publishing calendar 与单项 feedback

- [Buffer — Publish](https://mobbin.com/flows/b7ad2b81-7860-49af-b8a0-86506ef22a75)
- [Buffer — Analytics](https://mobbin.com/flows/7ff85a82-a264-4191-862b-acaa60835864)
- [Semrush — Post detail](https://mobbin.com/flows/bcdaabe5-1418-4d82-b67b-e56c8ea38396)
- [Hootsuite — Post performance](https://mobbin.com/flows/79663781-4626-4759-ba9f-502d11297cf5)

Buffer 的 Publish calendar 在 post popover 内显示 reactions、comments 与 engagement rate，足以回答“这一个发布结果如何”；
完整 Analytics 仍是与 Publish 分开的入口。Semrush 的 published post detail 也只显示 impressions、engagement rate、reactions、
shares、comments 与 clicks。Hootsuite 同样将 Plan 与 Analytics 作为不同区域，并在 Analytics 的 post performance 中展开详情。

## 3. Fikirtive 已批准方向

```text
Home owns aggregate marketing health
├─ Revenue / ROAS / spend / trend
├─ What changed
├─ Top performers
└─ Deep analysis filtered by source, channel, product or date

Schedule owns publishing operations
├─ Draft / scheduled / publishing / published / failed
├─ Calendar and list views
└─ Published item popover
   ├─ lightweight result metrics
   └─ View performance → Home filtered analysis
```

裁决理由：

- Fikirtive Home 已批准回答 Founder 的 `marketing health`；再建立一个完整 Analytics area 会重复它的核心问题。
- Schedule 的主要心智模型是“何时发布、是否成功”；把跨渠道趋势与 business health 放进去会让 calendar 变成杂项区。
- item-level feedback 应留在 Schedule，因为 Founder 正在查看某一条 scheduled / published item；深入比较再交给 Home。
- v1 不新增 Analytics 主导航。现有 `/schedule/analytics` 的隐藏 / redirect 是 sitemap 冻结后的 implementation，不在 IA 研究时删除。
