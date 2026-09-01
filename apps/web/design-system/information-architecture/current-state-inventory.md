# Founder-facing IA v1 — current-state inventory

> **状态：Evidence inventory，不是最终 sitemap。**  
> 盘点日期：2026-08-30。所有 “current” 都必须能回到 Blueprint、已批准 spec、runtime navigation 或当前 route file。
>
> **Beta scope amendment — 2026-08-31：** Founder 决定当前 beta 暂不提供 Schedule。Schedule 的长期 publishing / calendar ownership 继续保留，但不进入 beta 主导航、screen design 或 acceptance；现有 route 与 runtime nav 只作为待收敛现状。

## 1. 已存在的权威层

| 层 | 当前证据 | 能回答 | 不能回答 |
|---|---|---|---|
| 产品蓝图 | `docs/BLUEPRINT.md` | Fikirtive 为谁服务、长期能力范围、一个产品一个 Otto | 具体页面层级与导航 |
| Shell IA | `docs/specs/wave2-shell.md` §2 | 七格主导航、一个日历、Otto 不是模块 | 各板块完整 children 与跨板块 flow |
| Runtime navigation | `packages/core/src/navigation.ts` | 当前 route、label、主导航顺序、redirect | 页面为何存在、详情页归谁 |
| Product patterns | `../patterns/` | Home、Application shell、Otto panel、Create / Canvas 已批准 interaction | Library、Brand、Campaigns、Schedule 的完整产品架构 |

**结论：** 当前已有“主导航 IA”，但没有覆盖整个 Founder-facing product 的 sitemap / surface contract。

## 2. 已确认、不可在本轮悄悄改写的关系

| Surface key | 已确认关系 | 证据 |
|---|---|---|
| `home` | 全产品唯一 Home；主要回答 Founder 的 marketing health | `../patterns/founder-home/README.md`；`../patterns/canvas/stitch-image-video-parity-spec.md` §16 |
| `create` | beta 的 first-class product area；不是 Home 的展开状态 | `../patterns/canvas/stitch-image-video-parity-spec.md` §16 |
| `canvas` | Create 下面的 full-screen creation workspace | `packages/core/src/navigation.ts` 的 `CANVAS_HREF`；Canvas approved pattern |
| `library` | 跨 Canvas 的 content surface；管理 Generation history、Uploads、Favorites、Collections 与 reusable Elements | `apps/web/app/library/page.tsx`；Canvas approved pattern；Founder Library lifecycle 裁决 |
| `library taxonomy` | 所有 Generation 可按 Canvas / Chat history 找回；Favorites 与 Collections 只保存组织链接；Elements 包含 Products、Characters、Official avatars、Clothes 与 Locations | Founder Library simplification / Official avatar / Reference expansion 裁决；`mobbin-otto-iq-library-architecture-evidence.md` |
| `product reference` | Product facts 的 canonical owner 是 Otto IQ Product catalog；Library Products 是同一 ID 的 browse / linked-media view，Brand Knowledge base 也只链接同一 object | Founder Product ownership 裁决 |
| `character reference` | Character 是多素材 reference object，统一覆盖 real person、AI avatar 与 mascot；真人需要 consent 状态 | Founder Library 裁决；`mobbin-library-reference-objects-evidence.md` |
| `official avatar` | Fikirtive-owned read-only Element；可 browse / search / preview / favorite / use，不能修改 identity；其生成结果归 Founder Library | Founder Official avatar 裁决 |
| `clothes reference` | Clothes 是可复用服装或造型 context object，链接 Library asset 与必要的 styling / usage notes | Founder Reference expansion 裁决 |
| `location reference` | Location 是可复用场景、店铺或拍摄环境 context object，链接 Library asset 与必要的 environment / usage notes | Founder Reference expansion 裁决 |
| `brand` | Jasper IQ 式 marketing context hub：Brand voice、Audiences、Knowledge base、Style guide、Visual guidelines；从文字 / URL / 文件建立并可预览应用差异 | Founder Brand 裁决；`mobbin-jasper-iq-evidence.md` |
| `analytics` | beta 由 Home 管 aggregate marketing health 与深入分析；未来 Schedule 恢复时只显示单条 published item 的轻量结果，并 handoff 到已筛选 Home；无独立 Analytics 主导航 | Founder Analytics Q5-A 裁决；`mobbin-analytics-ownership-evidence.md` |
| `schedule` | 长期唯一发布日历；当前 beta deferred，不进入主导航或 screen design | `docs/specs/wave2-shell.md` §2；Founder beta scope amendment 2026-08-31 |
| `library → schedule` | 未来 Schedule 恢复时，所有 Creation 成果仍自动进入 Library；Canvas 可带选中 asset 进入 Schedule，Schedule 也能从 Library 选择。当前不属于 beta acceptance | Founder Q2-A 裁决；`mobbin-create-to-schedule-evidence.md` |
| `otto` | 跨 product area 的 assistant；不是主导航板块或第二个 app | `docs/BLUEPRINT.md` §3；`OTTO_ASSISTANT` |
| `otto @reference` | 裸 `@` 显示 Recent＋类型入口，继续输入后跨全部 approved targets 统一搜索；Canvas / Chat / Collection 只用于 browse | Founder Reference picker 裁决；`reference-picker-contract.md`；`mobbin-reference-picker-evidence.md` |
| `settings` | 主导航中的分组，不是一张同时拥有所有设置的重复页面 | `MERCHANT_NAV` |
| `settings ownership` | 一个 Settings experience，以 Personal / Workspace 分 scope；Profile 从 account menu 深链 Personal，Billing 与 Connections 属于 Workspace | Founder Settings Q6-A 裁决；`mobbin-settings-ownership-evidence.md` |
| `video editor` | v1 不承诺手动 timeline editing；Canvas 是唯一 creation / AI editing workspace，旧 Video editor Parked | Founder Editor A 裁决；`mobbin-editor-boundary-evidence.md` |

## 3. 当前 route zones

以下是当前代码的**观察值**，用于决定保留、合并、隐藏或退役；不是对未来 sitemap 的自动批准。

### Founder v1 scope decision

2026-08-30，Founder 决定 **Campaigns 暂时砍掉，不进行该板块设计**。因此：

- Campaigns 不进入 Founder-facing sitemap v1；
- `campaign list / detail / confirm / trends / workbench` 全部归入 `Parked`，不能作为下游 screen design 输入；
- 当前 routes 与业务 code 仍是现状证据，不因修改 IA 文档而被删除；
- 从导航隐藏、redirect、数据保留与未来恢复策略应在 sitemap 冻结后的独立 implementation spec 处理。

### A. Founder-facing application shell

| Area | 当前表面 | 当前 route evidence | IA 状态 |
|---|---|---|---|
| Home | Founder overview | `app/(home)/page.tsx` | 已确认顶层；`home.analysis` detail 与 Schedule handoff 已冻结 |
| Create | Prompt-first workspace | `app/create/page.tsx` | 已确认顶层 |
| Create | Full-screen Canvas | `app/create/canvas/page.tsx` | 已确认是 Create child |
| Library | Cross-Canvas content library | `app/library/page.tsx` | 顶层与 Generation history / Uploads / Favorites / Collections / Elements taxonomy 已确认 |
| Library | Video editor | `app/library/editor/page.tsx` | **Parked：不进入 v1 sitemap，不作为 Library child；code 与 route 的隐藏 / redirect 留给后续 implementation** |
| Brand | Jasper IQ 式 marketing context hub | `app/brand/page.tsx` | 顶层、route-backed v1 child views 与 ownership 已冻结；具体 screen 尚未设计 |
| Campaigns | Campaign list | `app/campaign/page.tsx` | **Parked：不进入 v1 sitemap，不继续设计** |
| Campaigns | Campaign detail | `app/campaign/[id]/page.tsx` | **Parked** |
| Campaigns | Generation confirmation | `app/campaign/[id]/confirm/page.tsx` | **Parked** |
| Campaigns | Trends | `app/campaign/trends/page.tsx` | **Parked** |
| Campaigns | Workbench | `app/campaign/workbench/page.tsx` | **Parked** |
| Schedule | Calendar | `app/schedule/page.tsx` | **长期 ownership 已确认；deferred from beta，不进入 beta 主导航或 screen design** |
| Schedule | Analytics | `app/schedule/analytics/page.tsx` | **不进入未来 Schedule IA**；当前 route 的隐藏 / redirect 属于 sitemap 冻结后的 implementation |
| Settings | Preferences | `app/settings/page.tsx` | beta 归 Workspace / General；不再称 generic Preferences，也不把 Otto / publishing controls 混成 Automation page |
| Settings | Connections | `app/settings/connections/page.tsx` | 当前 settings child；workspace-scoped |
| Settings | Billing & credits | `app/billing/page.tsx` | 当前 settings child，route 不嵌套；页面已明确是 workspace billing |
| Identity | Profile | `app/profile/page.tsx` | 未来是同一 Settings experience 的 Personal / Profile 深链；workspace name 应迁往 Workspace / General |

### B. Separate boundary surfaces

| Zone | 当前表面 | IA treatment |
|---|---|---|
| Auth | login、signup、verify、forgot/reset password | 独立 auth journey，不放进 merchant navigation |
| Public/legal | privacy、terms、data deletion | Public information architecture |
| External review | Schedule share preview | Public read-only surface；不套 merchant shell |
| Admin | `/admin*` | Internal product；单独 sitemap，不进入 Founder-facing v1 |
| Disabled | `/crm*` | 当前 redirect / hidden；不能因 files 还在就列为 active product area |
| Compatibility | `/otto`、`/northstar-immersive*`、`/campaign/calendar` | Redirect only；不进入 sitemap |
| Design review | `/design-system*`、`/product-patterns*` | Review fixtures；永不进入 product sitemap |

## 4. Founder-approved working model

```text
Fikirtive application shell
├─ Home
│  └─ Marketing analysis drill-down
├─ Create
│  └─ Canvas · full screen
├─ Library
│  ├─ Generation history · by Canvas / Chat
│  ├─ Uploads
│  ├─ Favorites
│  ├─ Collections
│  └─ Elements
│     ├─ Products
│     ├─ Characters
│     ├─ Official avatars · read-only
│     ├─ Clothes
│     └─ Locations
├─ Brand
│  ├─ Brand voice
│  ├─ Audiences
│  ├─ Knowledge base
│  ├─ Style guide
│  └─ Visual guidelines
└─ Settings
   ├─ Personal
   │  └─ Profile
   └─ Workspace
      ├─ General
      ├─ Connections
      └─ Billing & credits

Cross-surface: Ask Otto
Account menu: Profile · Sign out
Outside merchant shell: Auth · Legal · Public share · Admin
Deferred / Parked outside beta: Schedule · Publishing defaults / approvals · generic Settings Automation · Campaigns · Video editor · CRM
```

本树的 product-area ownership 已完成逐区裁决；正式 sitemap 见 `product-map.md`。

## 5. 裁决完成状态

Founder-facing v1 的 product-area ownership、detail containers、cross-surface handoff 与 Parked destinations 已完成裁决。
Founder 于 2026-08-30 批准冻结 closure candidate；`product-map.md`、`surface-contract.md` 与 `core-flows.md` 已登记为
current design authority。当前 runtime 差异见 `runtime-convergence.md`，它们是 implementation backlog，不再是 Sitemap open question。
