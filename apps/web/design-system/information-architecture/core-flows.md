# Founder-facing core flows v1

> **状态：Founder approved and frozen — 2026-08-30；beta scope amended — 2026-08-31。** 每条 flow 只描述 product-area handoff，不复制 route 或 backend implementation。Schedule flow 保留为未来 ownership，不属于 beta acceptance。

## 1. Check marketing health

```text
Home
→ 选择 goal / date / comparison
→ 阅读 aggregate health、drivers 与 top performers
→ Home analysis · current source / Product / published item / date context
→ 返回同一 Home filter state
→ 必要时 Ask Otto 解释或建议下一步
```

Home 是分析 owner；Schedule 不能复制完整 analytics dashboard。

## 2. Start a new creation

```text
Create
→ 输入 outcome 或选择起点
→ Canvas
→ Otto 只询问会改变结果的问题
→ 明确 generation scope 与 credits
→ Founder confirm
→ 生成 / refine / variation
→ 每个 Generation 自动进入 Library / Generation history
```

Create 是入口，Canvas 是 workspace；Home 不展开成第二个 creation home。

## 3. Reuse an existing asset or reference

```text
Library
→ Generation history / Uploads / Favorites / Collections / Elements
→ 搜索 / 筛选 / 选择
→ Send to Canvas
→ 以同一 asset / reference context 继续生成
→ 新结果保留 lineage 并自动回 Library
```

Product、Character、Official avatar、Clothes 与 Location reference 不复制媒体；它们引用 canonical object 与 Library asset truth。

## 4. Reference context inside Otto Chat

```text
Canvas / Otto composer
→ type @
→ Recent + type entry
→ continue typing to search all approved targets
→ select Product / Character / Official avatar / Location / Clothes / Generation / Upload
→ removable mention token
→ send
→ Otto resolves canonical typed IDs
→ Generation provenance records Context used
```

Canvas、Chat、Favorites 与 Collections 只用于查找具体对象，不作为整包 mention target。完整 interaction 见
`reference-picker-contract.md`。

## 5. Build and apply brand context

```text
Brand
→ 从 text / URL / file 建立 context
→ 分类到 Brand voice / Audiences / Knowledge base / Style guide / Visual guidelines
→ 预览 applied / unapplied difference
→ 保存
→ Create / Canvas 显示当前采用的 context
→ Founder 可更换或移除
```

Knowledge base 链接 Library Product object，不建立第二份 product facts。

## 6. Schedule and publish a creation

> **Deferred from beta。** 当前 beta 不显示 Schedule 入口、不承诺 publish / calendar capability；以下 flow 只保留未来恢复时的边界。

```text
Canvas selected Generation
→ Schedule composer handoff
→ result 同时已经存在 Library
→ 选择 channel / date / publishing defaults
→ schedule / publish
→ 返回 Calendar 查看 status
→ 打开轻量 item detail
→ View performance
→ Home analysis with published item / channel / date context
```

Schedule 是唯一 calendar；Home 是深入 performance analysis owner。

## 7. Change personal or workspace settings

```text
Account menu Profile
→ Settings / Personal / Profile

Main navigation Settings
→ Settings / Workspace
→ General / Connections / Billing & credits
```

两条入口进入同一个 Settings experience，只是 owner scope 与默认 section 不同。Schedule、publishing defaults、publishing approvals
与 generic Automation 不属于 beta Settings。

## 8. Upload and promote

```text
Canvas or Library
→ Upload
→ Processing
→ Ready in Library / Uploads
→ Use in Canvas
or
→ Promote into Product / Character / Clothes / Location
```

Upload 先成为一个 canonical Asset。Promote 只建立 Element 与 Asset 的链接，不复制 media file。

## 9. Resume Canvas work

```text
Create or Library / Generation history
→ choose Canvas
→ restore Canvas layout + Chat history + selection
→ continue with Otto
→ new Generations return to the same Library history
```

Canvas 是 Founder-facing work unit；不经过 Project 或 Project Brief gate。

## 10. Organize without copies

```text
Library object
→ Favorite or Add to Collection
→ create organization link
→ open from Favorites / Collection
→ resolve the same canonical object ID
```

Remove from Favorites 或 Collection 只删除组织链接，不删除 Generation、Upload 或 Element。

## 11. Use an Official avatar

```text
Library / Elements / Official avatars
→ preview read-only identity
→ Use in Canvas or @mention
→ generate
→ Founder-owned Generation enters Generation history
```

Official avatar identity 由 Fikirtive 拥有并保持 read-only；Founder 拥有使用它产生的新 Generation。

## 12. Remove and Trash

```text
Remove Canvas card
→ remove placement only

Remove Favorite / Collection membership
→ remove organization link only

Move Library object to Trash
→ show active Element / Canvas / Schedule usage
→ hide from normal Library views
```

永久删除、retention period 与 restoration implementation 不由 Sitemap v1 定义。
