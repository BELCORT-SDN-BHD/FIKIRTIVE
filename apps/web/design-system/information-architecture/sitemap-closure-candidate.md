# Founder-facing Sitemap v1 — closure candidate

> **状态：Founder approved and merged — 2026-08-30。**  
> **目标：** 补齐 detail surface、cross-surface handoff 与 Parked route destination，让现有 Product map、Surface contract 与 Core flows 可以最终冻结。  
> **依据：** 已批准的 Founder decisions，以及本目录中的 Mobbin evidence。本文不新增产品能力，也不修改 runtime route。
> **批准：** Founder：“批准冻结 closure candidate”。当前 authority 以 `product-map.md`、`surface-contract.md`、
> `core-flows.md` 与 `reference-picker-contract.md` 为准；本文保留为冻结依据。

> **Beta amendment — 2026-08-31：** Founder 决定当前 beta 暂不提供 Schedule。Schedule 的长期 ownership 保留，但从 beta 主导航、screen-design scope 与 acceptance 中延后；Campaigns 继续 Parked。

## 1. Home analysis detail

### Recommendation

新增稳定 surface key：`home.analysis`。

```text
Home summary
→ select driver / top performer / source / product / published item
→ Home analysis
→ keep selected date + comparison + source context
→ back to the same Home state
```

- `home.analysis` 仍属于 Home，不建立 Campaigns 或 Analytics product area。
- 它是 application-shell 内的 detail page，不是临时 drawer；深度比较需要稳定 back behavior 与可恢复的 filter state。
- Schedule 的 `View performance` 进入同一个 `home.analysis`，并带 published item / channel / date context。
- Home 不再使用 `Campaign drill-down` 作为通用出口；Campaign 只可作为数据维度，不是 v1 navigation object。

### Why

Klaviyo 与 Shopify 都把 aggregate analysis 放在业务 performance area；Buffer、Semrush 与 Hootsuite 只在 publishing item 附近显示轻量指标，再 handoff 到深入分析。证据见 `mobbin-analytics-ownership-evidence.md`。

## 2. Library details

### Recommendation

Library 继续是一个 product area，但使用两种 detail container：

| Object | Detail container | 理由 |
|---|---|---|
| Generation | Route-backed side panel | 保留 grid / history context，同时可恢复和 deep link |
| Upload | Route-backed side panel | 与 Generation 使用同一个 media-detail pattern |
| Official avatar | Read-only side panel | 预览、favorite、Use in Canvas，不提供 identity editing |
| Collection | Child page | 需要搜索、排序、批量选择与 membership management |
| Product | Child page | 同时显示 Otto IQ facts、constraints 与 linked media |
| Character | Child page | 管理 identity、reference assets 与 consent state |
| Clothes | Child page | 管理 reference assets 与 styling / usage notes |
| Location | Child page | 管理 reference assets 与 environment / usage notes |

Desktop 的 route-backed side panel 是“有地址的侧栏”：关闭后回到原 grid state；刷新或分享当前地址仍能恢复同一对象。

### Shared media detail actions

```text
Preview
Source + provenance
Origin Canvas / Chat
Context used
Used by Elements / Schedule
Use in Canvas
Schedule
Download
Favorite
Add to Collection
Move to Trash
```

- Favorites 与 Collections 只改变 links，不复制 object。
- 从 Canvas 删除 Canvas card，不删除 Library object。
- Move to Trash 前显示 active usage；永久删除不属于 Sitemap v1。

### Why

Runway 与 Leonardo 保留 Generation lineage 和 follow-up actions；Visual Electric 将 Canvas、Library 与 reusable references 分开。证据见 `mobbin-otto-iq-library-architecture-evidence.md`。

## 3. Brand sections

### Recommendation

Brand 是一个 application-shell experience。它使用 content-level sub-navigation；五个 section 都是 route-backed child view：

```text
Brand
├─ Brand voice
├─ Audiences
├─ Knowledge base
├─ Style guide
└─ Visual guidelines
```

- Brand landing 默认打开 `Brand voice`；不增加第二张 Brand home。
- 每个 section 使用同一套 list → detail / create flow。
- Create / Canvas 只显示当前采用的 context，并允许 remove / replace。
- Product facts 仍由 Otto IQ Product catalog 持有；Knowledge base 只链接 Product ID。
- 上传 text / URL / file 是建立 context 的入口，不会自动制造第二份 media truth。

### Why

Jasper IQ 使用稳定 sections 管理 persistent AI context，并在 creation 中显式应用。证据见 `mobbin-jasper-iq-evidence.md`。

## 4. Schedule details

### Recommendation

Schedule 只有一个 Calendar surface，并在同一 surface 上使用两个 contextual containers：

```text
Calendar
├─ Create / edit scheduled item → composer overlay
└─ Open published item → lightweight detail panel
   ├─ status
   ├─ preview
   ├─ channel + publish time
   ├─ lightweight result metrics
   └─ View performance → Home analysis
```

- Composer overlay 可以从 Canvas selected Generation、Library object 或 Calendar empty slot 打开。
- Composer 包含 channel、time、caption、media preview 与 Library picker。
- 完成后回到 Calendar，并提供 `Keep creating` 或 `View in calendar`。
- Schedule 不拥有跨渠道 business-health dashboard。

### Why

Adobe Express、Later、Hootsuite 与 Semrush 都让 composer 靠近 Calendar / current creation，同时让 Library 保持独立 truth。证据见 `mobbin-create-to-schedule-evidence.md`。

## 5. Settings structure

### Recommendation

Settings 是一个 shared experience。它使用 scope-separated sub-navigation：

```text
Settings
├─ Personal
│  └─ Profile
└─ Workspace
   ├─ General
   ├─ Automation & approvals
   ├─ Publishing defaults
   ├─ Connections
   └─ Billing & credits
```

- Main navigation `Settings` 默认打开 `Workspace / General`。
- Account menu `Profile` 打开同一个 Settings experience，并选中 `Personal / Profile`。
- Display name 与 email 属于 Personal。
- Workspace name 与 workspace lifecycle 属于 Workspace / General。
- v1 不预造 Security、Notifications 或 Team 空页面。
- 现有 route 可以暂时保留，但所有入口必须显示同一 Settings shell 与 language。

### Why

Linear、Jasper 与 Canva 都使用同一个 settings experience，再按 personal / workspace owner 分组。证据见 `mobbin-settings-ownership-evidence.md`。

## 6. Missing core flows to add at freeze

### Upload and promote

```text
Canvas or Library
→ Upload
→ Processing
→ Ready in Library / Uploads
→ Use in Canvas
or
→ Promote into Product / Character / Clothes / Location
```

### Resume work

```text
Create or Library / Generation history
→ choose Canvas
→ restore Canvas layout + Chat history + selection
→ continue with Otto
```

### Organize without copies

```text
Library object
→ Favorite or Add to Collection
→ create organization link
→ open from Favorite / Collection
→ resolve the same canonical object ID
```

### Official avatar

```text
Library / Elements / Official avatars
→ preview read-only identity
→ Use in Canvas or @mention
→ generate
→ Founder-owned Generation enters Generation history
```

### Remove and Trash

```text
Remove Canvas card → remove placement only
Remove Favorite / Collection membership → remove organization link only
Move Library object to Trash → show active usage, then hide from normal Library views
```

## 7. Parked surface destinations

| Existing surface | v1 state | Destination rule |
|---|---|---|
| Campaigns | Parked | Remove from navigation; legacy entry returns to Home |
| Manual Video editor | Parked | Remove from navigation; legacy entry returns to Create |
| Schedule Analytics | Re-owned by Home | Redirect / handoff to `home.analysis` |
| CRM | Disabled | Keep outside Founder sitemap; legacy entry returns to Home |
| Old Otto page | Compatibility only | Redirect to owning surface and open Otto when context exists |

Exact URL strings remain owned by `@fikirtive/core/navigation` and a later implementation spec.

## 8. Closure acceptance

Founder 已批准以上五组决定；本 candidate 已合并进三份 IA authority documents。

Closure actions:

1. `product-map.md`、`surface-contract.md` 与 `core-flows.md` 已合并；
2. stale `Campaign drill-down` 与 Founder-facing Project language 已从 current IA 移除；
3. Founder approval、authority registration 与 navigation drift guard 已登记；
4. redirects 与 production-page convergence 留给独立 implementation spec。

## 9. Non-goals

- 不在 Sitemap 阶段画高保真 screen；
- 不改变 database schema、money flow、permissions 或 provider calls；
- 不恢复 Campaigns、Manual Video editor 或 CRM；
- 不为每个 Library object 建立独立主导航；
- 不在 Founder approval 前修改 runtime navigation 或 production routes。
