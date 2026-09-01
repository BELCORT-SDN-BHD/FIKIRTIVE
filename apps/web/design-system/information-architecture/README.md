# Fikirtive Founder-facing IA v1

> **状态：Founder approved and frozen — current design authority。**  
> **范围批准：** 2026-08-30，Founder 批准建立 Founder-facing IA / Sitemap v1。  
> **冻结批准：** 2026-08-30，Founder：“批准冻结 closure candidate”。  
> **Beta scope amendment：** 2026-08-31，Founder 决定当前 beta 暂不提供 Schedule；其长期 publishing ownership 保留，但不进入 beta 导航、screen design 或 acceptance。

## 1. 这份 SSOT 解决什么

本目录负责 Fikirtive 商家端的 **Information Architecture（信息架构，IA）**：

- 一个产品能力属于哪个 product area；
- 页面、workspace、详情面与 overlay 的父子关系；
- 用户从哪里进入、完成后去哪里；
- 哪些表面使用 application shell，哪些是 full-screen carve-out；
- Home、Otto 与各业务板块之间的边界。

Sitemap 是 IA 的页面树视图，不是 IA 的全部。最终 v1 同时包含：

1. `product-map`：板块与页面层级；
2. `surface-contract`：每个表面的目的、入口、出口、壳类型与 owner；
3. `core-flows`：跨板块的关键用户旅程；
4. `reference-picker-contract`：Otto Chat 中 `@` reference 的唯一 interaction contract；
5. `navigation-contract.json`：active、Parked 与已知 runtime navigation drift 的机器可读 contract。

冻结 IA 与真实 App 的差异继续由 `runtime-convergence.md` 记录；每一批 observable implementation 必须建立独立 spec。
当前第一批 candidate 是 `frontend-convergence-phase-1-spec.md`，只覆盖 application shell、active navigation 与 legacy
route ownership，不重新定义 Sitemap。

## 2. 与现有 SSOT 的职责分工

| 决定 | 唯一 owner |
|---|---|
| 产品长期边界与价值循环 | `docs/BLUEPRINT.md` |
| 商家端 product area、页面归属与跨面 flow | 本目录 |
| 准确 route、主导航 label、分组与 redirect | `packages/core/src/navigation.ts` |
| 视觉 token 与 primitive | `../foundations/`、`../primitives/` |
| 某个 pattern 内部的布局与交互 | `../patterns/` |
| 页面数据、权限与业务 action | product code / domain source |

本目录不复制 `SHELL_ROUTES` 或 `MERCHANT_NAV` 的 route 字面量。IA 只使用稳定 surface key；实际地址始终从
`@fikirtive/core/navigation` 读取。Current-state inventory 可以记录观察到的 route 作为取证，但它不是第二份
runtime authority。

## 3. 谁与成功标准

**主要用户：** 没有完整营销团队的小生意 Founder。  
**一句成功：** Founder 无论从 Home、Otto 或任一业务板块开始，都知道自己在哪里、下一步能完成什么，且不会遇到两个 Home、两个创作入口或两个日历。

### Checkable acceptance

1. 每个 Founder 可达的商家表面都有唯一 product-area owner。
2. Home、Create、Canvas、Library、Brand、Settings 与 Otto 的关系只有一种解释；Schedule 保留长期 ownership 但明确 deferred from beta；Campaigns 明确 Parked。
3. 每个主板块都有清楚的 children、入口、出口和返回目标。
4. application shell、full-screen workspace、detail page、tab、drawer/dialog 与 public share surface 有明确使用规则。
5. beta acceptance 覆盖 marketing health、new creation、reuse asset、apply brand context；schedule/publish 只保留未来 ownership flow，不算 beta acceptance。
6. Auth、legal、public share、admin、disabled、redirect 与 review-only routes 被明确分区，不混进商家 sitemap。
7. IA 不复制 runtime route truth；导航 drift 可以由现有 `navigation.ts` 围栏继续发现。
8. 本目录已登记为 `design-system/authority.json` 的 current authority；runtime drift 必须登记并收敛。
9. Otto `@` reference picker 有唯一 target taxonomy、resolution 与 browse-only container rule。

## 4. 非目标

- 不在本阶段重画任何 screen。
- 不因为现有 route 存在，就承诺它应该继续存在。
- 不设计后台 schema、permissions 或 Otto action implementation。
- 不把 admin、review fixtures 或隐藏的 CRM 当成 Founder-facing 产品能力。
- 不为未来 agency、多品牌或移动端预造没有被批准的结构。

## 5. 工作顺序

1. `current-state-inventory.md`：核对当前 Blueprint、导航、routes 与已批准 patterns。
2. Founder grill：按 product area 逐批解决归属与 flow，不一次抛出几十题。
3. `product-map.md`：画出最终 sitemap。
4. `surface-contract.md`：逐面冻结职责、壳类型、入口与出口。
5. `core-flows.md`：冻结跨板块 handoff。
6. Founder 验收后更新设计权威地图与防漂移检查。**已完成。**

## 6. Change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-30 | Scope approved | Founder：“批准，这个是很重要的SSOT”。批准建立 v1；具体 sitemap 尚待逐区裁决与最终验收。 |
| 2026-08-30 | Founder decision | Campaigns 不进入 Founder-facing v1 sitemap，停止该板块的 UI 设计。现有 code、data 与 routes 的隐藏或退役属于后续独立 implementation，不在 IA 文件修改时顺手删除。 |
| 2026-08-30 | Founder decision | Creation → Schedule 采用 direct handoff + automatic Library：所有成果自动索引进 Library，但 Canvas 可携带选中 asset 直接进入 Schedule；Schedule 也可从同一 Library 选择。 |
| 2026-08-30 | Superseded taxonomy | 早期决定使用一个 Assets surface 与多维 filters；随后被 `Generation history / Uploads / Favorites / Collections / Elements` 取代。底层“不复制同一对象”原则继续有效。 |
| 2026-08-30 | Founder decision | Brand 采用 Jasper IQ 式 marketing context hub，保留 Fikirtive design system。v1 sections 为 `Brand voice / Audiences / Knowledge base / Style guide / Visual guidelines`；支持从文字、URL、文件建立 context，并在保存前预览应用前后差异。Create / Canvas 必须显示当前采用的 context，允许更换或移除。 |
| 2026-08-30 | Superseded taxonomy | 早期 `Assets / References` 分区随后收敛为新的 Library taxonomy。Product 不复制、Character identity 与真人 consent 规则继续有效。 |
| 2026-08-30 | Founder decision | Analytics 采用 A：Home owns aggregate marketing health 与深入分析；Schedule 只拥有 publishing operations、单条 published item 的轻量结果，以及 `View performance` 返回已筛选 Home 的 handoff。v1 不新增 Analytics 主导航；现有 `/schedule/analytics` 的隐藏 / redirect 留给 sitemap 冻结后的 implementation。 |
| 2026-08-30 | Founder decision | Settings 采用 A：一个 Settings experience，以 `Personal / Workspace` 分 scope。Account menu 的 Profile 直接进入 Personal / Profile；主导航 Settings 进入 Workspace。Workspace owns General、Automation & approvals、Publishing defaults、Connections、Billing & credits；workspace name 从 personal Profile 责任中移出。现有 routes 可保留，但不得呈现两套 settings language。 |
| 2026-08-30 | Founder decision | Video editor 采用 A：v1 不承诺手动 trim / splice / captions / music；Canvas 是唯一 creation / AI editing workspace。`/library/editor` 与其现有 code 暂时 Parked，不作为 Library child 或导航入口；实际隐藏 / redirect 留给 IA 冻结后的 implementation spec。 |
| 2026-08-30 | Superseded label | Reference categories 后续改称 Library `Elements`，并加入 Official avatars。Products、Characters、Clothes、Locations 的语义与只链接 media、不复制 file 的原则继续有效。 |
| 2026-08-30 | Founder decision | Founder-facing product 不建立 Project 或 Project Brief。用户直接打开 Canvas 开始任何创作；Canvas 保存 Otto conversation、uploads、generations、layout 与完整 history。任何内部 legacy Project record 都不能成为 UI concept。 |
| 2026-08-30 | Founder decision | Library 采用 `Generation history / Uploads / Favorites / Collections / Elements`。所有 generations 可在 Generation history 找回，并按 Canvas / Chat history 浏览；Favorites 与 Collections 只保存组织链接，不复制对象。 |
| 2026-08-30 | Founder decision | Elements 包含 Products、Characters、Official avatars、Clothes 与 Locations。Official avatars 由 Fikirtive 提供、read-only；Founder 可以 browse / search / preview / favorite / use，但不能修改 identity。其生成结果属于 Founder 并进入 Generation history。Product facts 的 canonical owner 是 Otto IQ，同一个 Product ID 在 Library 只作为带 linked media 的 browse view。 |
| 2026-08-30 | Founder decision | Otto `@` reference picker 采用裸 `@` 显示最多 5 个 Recent＋分类入口，继续输入后跨 Products、Characters、Official avatars、Locations、Clothes、Generations 与 Uploads 统一搜索。Canvas、Chat、Favorites 与 Collections 只用于 browse，不作为整包 mention target。详细 contract 见 `reference-picker-contract.md`。 |
| 2026-08-30 | Founder approval and freeze | Founder：“批准冻结 closure candidate”。批准 `home.analysis`、Library detail containers、Brand child views、Schedule contextual containers、scope-separated Settings、五条补充 flow 与 Parked surface destinations。IA v1 由 Review candidate 升为 current design authority。 |
| 2026-08-31 | Beta scope amendment | Founder：“这个beta 不会有schedule的功能先。” Schedule 的长期 calendar / publishing ownership 与 future flow 保留；当前 beta 主导航、screen design 与 acceptance 全部排除 Schedule。现有 route / navigation 的隐藏或 redirect 进入 runtime convergence backlog。 |
| 2026-08-31 | Settings beta scope approved | Founder 同意精简 beta Settings：Personal / Profile；Workspace / General、Connections、Billing & credits。Publishing defaults / publishing approvals 随 Schedule deferred；没有具体 user contract 前不建立 generic Automation page。 |
