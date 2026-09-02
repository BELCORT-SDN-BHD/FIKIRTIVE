# Founder-facing surface contract v1

> **状态：Founder approved and frozen — 2026-08-30；beta scope amended — 2026-08-31。** Surface contract 定义职责与 handoff；准确 route 继续由 `@fikirtive/core/navigation` 持有。`schedule.*` 保留长期 ownership，但全部 deferred from beta。

| Surface key | 唯一职责 | 壳类型 | 主要入口 | 主要出口 / handoff |
|---|---|---|---|---|
| `home` | Aggregate marketing health、drivers 与 top performers | Application shell | 主导航 Home | `home.analysis`；Create；Ask Otto |
| `home.analysis` | 按 source、channel、Product、published item、date 与 comparison 深入分析；保留并恢复 Home filter state | Application-shell detail page | Home driver / top performer；Schedule `View performance` | 返回同一 Home state；Create；Ask Otto |
| `create` | 开始新创作、继续最近 Canvas | Application shell | 主导航 Create；Home creation entry | 新建或打开 `canvas` |
| `canvas` | Founder 直接开始工作的 unit：Otto conversation、澄清、费用确认、uploads、image / video generation、AI refinement、layout、history、export / share | Full-screen workspace | Create；Library object 的 create / refine action | 每个 Generation 进入 Library history；带 selected Generation 进入 Schedule；返回 Create |
| `library.generations` | 浏览与复用全部 Generations；按 Canvas / Chat history 找回 | Application shell 内的 Library view | 主导航 Library；Canvas 自动记录 | 打开 Generation；送入 Canvas；送入 Schedule；favorite / add to Collection |
| `library.generations.detail` | 预览 Generation、provenance、origin Canvas / Chat、Context used、usage 与 follow-up actions | Route-backed side panel | Generation history；Favorites；Collection | 返回原 Library state；Use in Canvas；Schedule；Download；Favorite；Collection；Trash |
| `library.uploads` | 浏览与复用 Founder 上传的 media Assets | Application shell 内的 Library view | Library；Canvas upload | 打开 Upload；送入 Canvas；promote into Element |
| `library.uploads.detail` | 预览 Upload、source、processing state、usage 与 follow-up actions | Route-backed side panel | Uploads；Favorites；Collection | 返回原 Library state；Use in Canvas；promote into Element；Schedule；Trash |
| `library.favorites` | 查看 favorite links，不复制 underlying object | Application shell 内的 Library view | Library object favorite action | 打开 canonical object；移除 favorite link |
| `library.collections` | Founder-created organization links，不复制 underlying object | Application shell 内的 Library view | Library object add-to-collection action | 打开 Collection detail；选择具体 object |
| `library.collections.detail` | 搜索、排序、批量选择与管理一个 Collection 的 membership | Application-shell child page | Collections | 打开 canonical object；移除 membership；返回 Collections |
| `library.elements.products` | 管理 Product 与 linked media；facts / constraints 的 canonical owner 是 Otto IQ Product catalog | Application-shell child page | Library Elements；Otto IQ；`@` picker | 链接进 Brand Knowledge base；作为 Canvas context；返回 Elements |
| `library.elements.characters` | 管理 Founder-owned reusable character identity、approved reference assets 与 consent state | Application-shell child page | Library Elements；`@` picker | 作为 Canvas context；返回 Elements |
| `library.elements.official-avatars` | 浏览、搜索、预览、收藏与使用 Fikirtive-owned read-only avatars | Application shell 内的 Library view | Library Elements | 作为 Canvas context；生成结果进入 Founder Generation history |
| `library.elements.official-avatars.preview` | 预览 read-only identity、官方 reference assets 与 use action；不提供 rename / edit identity | Route-backed side panel | Official avatars；Favorites；`@` picker | Use in Canvas；Favorite；返回原 Library state |
| `library.elements.clothes` | 管理可复用服装或造型 reference、asset links 与 styling / usage notes | Application-shell child page | Library Elements；`@` picker | 作为 Canvas context；返回 Elements |
| `library.elements.locations` | 管理可复用场景、店铺或拍摄环境 reference、asset links 与 environment / usage notes | Application-shell child page | Library Elements；`@` picker | 作为 Canvas context；返回 Elements |
| `brand.voice` | 建立、预览与维护 persistent Brand voice | Application-shell Brand child view | 主导航 Brand 默认入口；Brand sub-navigation | Create / Canvas visible context；其他 Brand sections |
| `brand.audiences` | 管理 reusable audience context | Application-shell Brand child view | Brand sub-navigation | Create / Canvas visible context；其他 Brand sections |
| `brand.knowledge` | 管理 text / URL / file-derived knowledge，并链接 canonical Product IDs | Application-shell Brand child view | Brand sub-navigation | Create / Canvas visible context；Product；其他 Brand sections |
| `brand.style` | 管理 persistent writing style rules | Application-shell Brand child view | Brand sub-navigation | Create / Canvas visible context；其他 Brand sections |
| `brand.visual` | 管理 persistent visual guidelines 与 linked Library media | Application-shell Brand child view | Brand sub-navigation | Create / Canvas visible context；Library；其他 Brand sections |
| `schedule.calendar` | 唯一 publishing calendar 与 draft / scheduled / publishing / published / failed states | Application shell | 主导航 Schedule；Canvas selected Generation；Library object | `schedule.composer`；`schedule.item-detail` |
| `schedule.composer` | 选择 media、channel、caption 与 publish time，并预览 post / calendar state | Contextual overlay on Calendar | Calendar empty slot；Canvas selected Generation；Library object | 保存后回 Calendar；Keep creating；View in calendar |
| `schedule.item-detail` | 显示 item status、preview、channel、publish time 与轻量 result metrics | Contextual detail panel on Calendar | Calendar item | 编辑；返回 Calendar；View performance → `home.analysis` |
| `settings.personal.profile` | 当前用户的 display name 与 email | Shared Settings experience | Account menu Profile | Settings Workspace；返回原 surface |
| `settings.workspace.general` | Workspace name 与 workspace lifecycle | Shared Settings experience | 主导航 Settings | 其他 Workspace settings |
| `settings.workspace.connections` | 全 workspace 使用的 external connections | Shared Settings experience | Settings；相关空状态 | Home / Library；未来 publishing surface |
| `settings.workspace.billing` | Shared credits、plan、usage 与 payment controls | Shared Settings experience | Settings；credit balance | 返回触发付费动作的 surface |
| `otto` | 在当前上下文调用同一业务 action layer | Panel / full-screen conversation，依 surface 而定 | 全局 Ask Otto；Canvas 内置 conversation | 返回当前 surface；不建立 Otto-owned duplicate page |
| `otto.reference-picker` | 在 composer 内搜索并插入 typed references；不复制 Library 或 Otto IQ object | Anchored overlay component | 输入 `@`；composer reference action | removable mention token；回到同一 composer |
| `public.share` | 无 merchant 权限的 read-only review | Public standalone | Share link | 关闭 / 外部离开 |

## Parked / non-authoritative surfaces

- `schedule.*`：deferred from beta；不进入当前主导航或 screen design。长期唯一 publishing-calendar ownership 保留，beta legacy entry destination 是 Home。
- `settings.workspace.publishing` 与 publishing approvals：随 Schedule deferred；没有 direct publishing 时不建立空 Settings page。
- generic `settings.workspace.automation`：不进入 beta。未来只有在 Otto defaults、spend control 或 collaborator approvals 形成具体 user contract 后，才建立清楚命名的 destination。
- `campaigns.*`：v1 Parked，不参与新 screen design；legacy entry 的 destination surface 是 Home。
- `library.video-editor`：v1 Parked；不承诺 trim / splice / captions / music；legacy entry 的 destination surface 是 Create。
- `schedule.analytics`：不进入未来 Schedule IA；destination surface 是 `home.analysis`。
- `crm.*`：disabled；保持在 Founder sitemap 之外，legacy entry 的 destination surface 是 Home。
- compatibility redirect 与 review fixtures：不是 product surface。
