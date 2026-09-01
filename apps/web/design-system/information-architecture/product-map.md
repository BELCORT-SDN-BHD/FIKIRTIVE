# Founder-facing product map v1 / beta scope

> **状态：Founder approved and frozen — 2026-08-30；beta scope amended — 2026-08-31。** 本文件使用稳定 surface key，不复制 runtime route 字面量。  
> **用户：** 没有完整营销团队的小生意 Founder。

## 1. Product map

```text
Fikirtive application shell
├─ Home
│  └─ Marketing analysis detail · source / product / published item / date
├─ Create
│  └─ Canvas · full-screen creation workspace
├─ Library
│  ├─ Generation history · browse by Canvas / Chat
│  │  └─ Generation detail · route-backed side panel
│  ├─ Uploads
│  │  └─ Upload detail · route-backed side panel
│  ├─ Favorites · organization links
│  ├─ Collections · user-created organization links
│  │  └─ Collection detail · child page
│  └─ Elements
│     ├─ Products · child page · Otto IQ canonical facts + linked Library media
│     ├─ Characters · child page · founder-owned reusable identity
│     ├─ Official avatars · read-only preview panel
│     ├─ Clothes · child page · garment / outfit / styling reference
│     └─ Locations · child page · scene / store / shooting environment
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

Cross-surface assistant
├─ Ask Otto
└─ `@` reference picker · anchored composer overlay

Account menu
├─ Profile → Settings / Personal / Profile
└─ Sign out

Outside merchant shell
├─ Auth
├─ Legal / public information
├─ Public share / review
└─ Admin

Deferred / Parked outside beta
├─ Schedule · long-term publishing owner retained
├─ Publishing defaults / publishing approvals · return with a real publishing capability
├─ Generic Settings Automation · no beta destination without concrete controls
├─ Campaigns
├─ Manual Video editor
└─ CRM

Non-product routes
├─ Compatibility redirects
└─ Design-system / product-pattern review fixtures
```

## 2. Product-area rules

- **Home** 是唯一 business overview，回答 marketing health；不是 creation home。
- **Home analysis** 是 Home 的 detail page；Campaign 只可作为分析维度，不是 v1 navigation object。
- **Create** 是独立 product area；入口页负责开始或继续创作，**Canvas** 是 Founder-facing work unit，负责完整 agentic creation。UI 不建立 Project 或 Project Brief。
- **Library** 是跨 Canvas 的 content truth；Generation history、Uploads、Favorites、Collections 与 Elements 是同一 product area 的 views，不复制底层对象。
- **Brand** 只拥有 reusable marketing context。Product、Character、Clothes 与 Location 的媒体真源仍在 Library；Brand 与 Canvas 通过链接使用。
- **Schedule** 仍是长期唯一 calendar 与 publishing operations owner，但不进入当前 beta、主导航或本轮 screen design。未来恢复时，深入表现分析仍回到已筛选 Home。
- **Settings** 是一个 experience，以 Personal / Workspace 分 owner scope，不形成两套 settings。
- **Settings beta** 只包含 Profile、General、Connections 与 Billing & credits；不为 future publishing 或含糊的 Automation 建空页面。
- **Otto** 是跨 surface 的 assistant，不是主导航板块，也不拥有第二套业务 action。
- **Canvas** v1 不承担 manual timeline editor；旧 Video editor Parked。
- **Product** facts 由 Otto IQ 持有；Library Products 是同一个 Product ID 的浏览入口与 linked media view，不是副本。
- **Official avatar** 是 Fikirtive-owned read-only Element；使用它产生的新 Generation 归 Founder 的 Library。
- **Reference picker** 是 Canvas / Otto Chat 内的 overlay component，不新增 product area 或主导航。
- **Media detail** 使用 route-backed side panel；Collection 与 editable Element 使用 Library child page。
- **Brand** 五个 sections 是同一个 Brand experience 的 route-backed child views，不建立 Brand home。
- **Schedule** 未来只有一个 Calendar；composer overlay 与 item detail panel 都返回同一 Calendar state。本规则保留 ownership，不构成 beta feature commitment。

## 3. Navigation visibility

beta 主导航只显示 `Home / Create / Library / Brand / Settings`。Schedule、Campaigns、Video editor、CRM、Analytics 与 Otto
都不新增主导航项：Schedule 延后但保留长期 ownership，Analytics 归 Home，Otto 跨面存在，其余 Parked 或 disabled。
