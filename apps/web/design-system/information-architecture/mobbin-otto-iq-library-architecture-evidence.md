# Mobbin evidence — Otto IQ 与 Library asset architecture

> 研究日期：2026-08-30。  
> 任务：补完整用户上传、平台生成、Canvas history、Library assets、References 与 Otto IQ 的对象边界和 lifecycle。  
> 状态：Evidence + historical recommendation；Founder 后续裁决见 §7，当前 contract 以 `product-map.md`、
> `surface-contract.md` 与 `reference-picker-contract.md` 为准。  
> 方法：严格使用 Mobbin MCP `search_flows`，检查 Runway、Canva、Visual Electric、Leonardo AI、Jasper 与 Grok 的完整 flows 和截图。

## 1. Mobbin evidence

### Runway：Session、Generation 与 Asset 是不同视图

- [Assets](https://mobbin.com/flows/42378429-e18d-4ab0-8542-1645158c9b8f)
- [Searching Runway](https://mobbin.com/flows/89fe055e-ab1c-4fe2-b144-7e29f0f9e335)
- [My session](https://mobbin.com/flows/db83dced-1260-4c2f-8efb-6299c54230d5)
- [Create a custom character](https://mobbin.com/flows/619ef90f-67d8-4b2c-9f6e-b7909ef4baa4)

Runway 的 Home 同时呈现 Recent Sessions 与 Recent Generations；Assets 内再分 All generations、Private、Shared、Favorited，
并支持 folder、type、media、tag、sort 与 upload。全局搜索会分别返回 AI tools、Assets 与 Projects。这说明：Session 是工作上下文，
Generation 是一次 AI operation，Asset 是可搜索、可复用的媒体；它们不能只靠一个 category 字段混成同一种卡片。

Custom Character flow 会从现有 Assets / folders 中选择多张图片训练成之后可重复使用的 object。Reference 因此是引用 assets 的语义对象，
不是媒体文件副本。

### Canva：统一搜索，但用 filters 与 object type 控制规模

- [Projects](https://mobbin.com/flows/169239d0-f760-4868-9ba0-8c3be178cbc7)
- [Filtering projects](https://mobbin.com/flows/510f0a3c-5da3-44d9-b852-15dd50e849fe)

Canva 的 Projects 可以统一搜索 designs、folders 与 uploads，但会用 Owner、Category、Date modified、type tabs、grid / list 与 sort
区分对象。它适合说明统一检索，不适合原样照搬成 Fikirtive 的 domain model：Canva 的核心 object 是 Design，而 Fikirtive 的核心工作对象是
agentic Canvas session。

### Visual Electric：Canvases、Library、References 三分

- [Canvases](https://mobbin.com/flows/fc2f0929-1128-4d4c-82a4-b4937b15c6fe)
- [Creating a reference](https://mobbin.com/flows/9cb95ef4-ebca-4258-92ee-5a82dd3171d1)

Visual Electric 把 Canvases、Library 与 References 明确分开。Reference creation 会将一张或多张图片转成带 name、prompt 与 exclude
constraints 的可复用 object。这最接近 Fikirtive 的 Products / Characters / Clothes / Locations，但 Fikirtive 需要更完整的 business facts
与 consent / usage constraints。

### Leonardo AI：Generation feed 很强，但容易把 discovery 与 private truth 混淆

- [Library](https://mobbin.com/flows/91c3ac40-653a-4489-b140-b831c791da75)

Leonardo 把 Your generations、Followed feed、Liked feed 与 Collections 放在 Library 下，并可从一张结果继续 Edit、Remix、Upscale、
Create video 或 Use as guide。这证明 asset detail 应保留 lineage 与 follow-up actions；同时也提醒 Fikirtive 不应把 public discovery feed
混进 Founder 的 private workspace truth。

### Jasper IQ：File 只是输入，保存的是可应用 context

- [Jasper IQ](https://mobbin.com/flows/0f6eea06-b833-4732-87fa-c20ea68a7a8b)
- [Adding knowledge](https://mobbin.com/flows/5bbff547-1046-4875-80d2-e2f956f8b166)
- [Uploading a file](https://mobbin.com/flows/45c89bc3-7323-466a-ac92-77ea7a11f896)

Jasper 接受 paste text、URL 与 file，但会把输入处理成 Brand voice / Knowledge 等有名称、tags、visibility 与 preview 的 context object。
原始文件是 ingestion source，不等于 IQ object 本身。Fikirtive Otto IQ 也应该采用这条边界。

### Grok：适合 creation entry，不足以承担 Library

- [Imagine](https://mobbin.com/flows/e8598a7f-01ba-47ee-b28e-9a82b9bf7b53)
- [Imagine history](https://mobbin.com/flows/9464567b-6eb5-497b-a3de-356e32fde3b6)

Grok 的 History 是 prompt / conversation history；Imagine discovery grid 不是可管理的私有 Library。它适合 Fikirtive 的 minimal creation entry，
但不能作为 asset management 的主要参考。

## 2. 推荐的 Fikirtive object model

```text
Project / Canvas
├─ Conversation history
├─ Generation runs
│  ├─ Prompt + model + settings + credits + status
│  ├─ Input asset ids
│  ├─ Context manifest ids
│  └─ Output asset ids
└─ Canvas layout / selection state

Library
├─ Assets · one media file, one asset id
│  ├─ Source: Generated / Uploaded / Imported
│  ├─ Visibility: Private / Shared
│  ├─ Lifecycle: Processing / Ready / Failed / Trash
│  └─ Links: project / generation / reference / schedule usage
├─ References · semantic reusable objects
│  ├─ Products
│  ├─ Characters
│  ├─ Clothes
│  └─ Locations
└─ Collections · organization links only, never file copies

Otto IQ
├─ Brand voice
├─ Audiences
├─ Knowledge base
├─ Style guide
├─ Visual guidelines
└─ Links to Library references / assets where needed
```

### Object responsibilities

- **Project / Canvas**：保存“这次工作发生了什么”，包括对话、run history 与画布位置。
- **Generation run**：不可变的 operation record；回答用了什么 prompt、model、credits、inputs 与 context，产生哪些 outputs。
- **Asset**：媒体文件的唯一真源；同一文件即使出现在多个 Project、Reference 或 Collection，也只有一个 asset id。
- **Reference**：Founder 会反复选择的视觉对象；只链接 asset ids，并保存会影响生成一致性的业务语义与 constraints。
- **Collection**：人工整理工具；加入或移出 Collection 只改变链接，不移动或复制文件。
- **Otto IQ context**：可被 Otto 应用的长期知识与规则；上传文件只是建立它的 source，不自动成为普通视觉 Asset。

## 3. 推荐 lifecycle

### User upload

```text
Choose file
→ Processing / validation
→ Ready asset
→ attach to current Canvas or leave in Library
→ optional: promote into Product / Character / Clothes / Location reference
```

- 相同 file hash 的重复上传应复用同一 asset，不建立副本。
- 上传失败留在可重试的 ingest state，不出现一张看似可用但实际损坏的卡片。
- 不强迫 Founder 上传前先理解所有 category；上传成功后再建议用途。

### Platform generation

```text
Prompt + visible context manifest
→ Generation run
→ candidate output assets
→ Canvas history / selection
→ keep, reuse, schedule, download or trash
```

- 每个 candidate 都必须有 asset id 与 lineage，避免从 Canvas history 消失。
- 但“是否所有 candidate 默认挤进 Library 主视图”需要 Founder 重新裁决；见 §6。

### Delete / remove

- Remove from Collection：只解除 Collection link。
- Remove from Reference：只解除 Reference link，asset 继续存在。
- Delete Asset：先显示被哪些 Reference、Canvas、Schedule item 使用；进入 Trash，不立即永久删除。
- Delete Canvas：删除工作上下文不能自动删除仍被 Library / Reference / Schedule 使用的 assets。

## 4. Otto IQ context stack

每次生成的 context 应由三层组成，并在 UI 中可见：

```text
Persistent context
Brand voice · Audience · Knowledge · Style · Visual guidelines

Project context
Project brief · approved directions · selected References

Prompt context
Current instruction · attached assets · one-off overrides
```

推荐交互：Otto 可以自动建议相关 context，但不能静默把整个 Library 送入模型。Composer 与 generation detail 都要显示
`Context used`，按 Brand / Product / Character / Clothes / Location / Attachments 分组；Founder 可在生成前移除或替换。

## 5. Library information architecture recommendation

```text
Library
├─ Assets
│  ├─ Smart views: All / Recent / Favorites / Shared / Trash
│  ├─ Filters: Source / Media type / Project / Used in / Date / Creator
│  ├─ Collections
│  └─ Search
└─ References
   ├─ Products
   ├─ Characters
   ├─ Clothes
   └─ Locations
```

Asset detail panel 应最少显示：preview、source / provenance、created by / date、media metadata、origin Canvas / generation、
References using it、Schedule usage，以及 `Use in Canvas / Add to Reference / Schedule / Download / Add to collection / Move to trash`。

## 6. Founder decisions required before changing the sitemap

### Q1 — Generated candidates 的默认可见性

- **A：所有 candidates 自动进入 Library 主视图。** 最直接，但大量失败方向会污染 Library。
- **B（推荐）：所有 candidates 都有 asset id 并可在 Canvas history / All generations 找回；Library 默认只显示 Founder keep、使用、收藏或发布过的 assets。** 不丢数据，同时保持资产库可管理。

### Q2 — Collections

- **A（推荐）：加入 Collections，但只作为 Assets 的组织方式，不成为新的主导航或 file owner。**
- **B：v1 不做 Collections，只依赖 filters / search。** 更轻，但资产规模增长后整理能力不足。

### Q3 — Otto automatic context

- **A（推荐）：Otto 自动建议 context，但生成前必须可见、可移除；generation detail 永久记录 Context used。**
- **B：只有 Founder 手动选择的 context 才能使用。** 控制最强，但日常操作较重。

## 7. Founder resolution — 2026-08-30

- 不建立 Founder-facing Project 或 Project Brief；用户直接进入 Canvas。
- 所有 Generation 都能在 Library / Generation history 找回，并按 Canvas / Chat history 浏览。
- Favorites 与 user-created Collections 只建立组织链接，不复制 underlying object。
- Library taxonomy 收敛为 `Generation history / Uploads / Favorites / Collections / Elements`。
- Elements 包含 Products、Characters、Official avatars、Clothes 与 Locations；Official avatars 为 Fikirtive-owned read-only。
- Product facts 归 Otto IQ Product catalog；Library Products 是同一 Product ID 的 linked-media view。
- Otto 可建议 context，但不能静默附加；Founder 必须在发送或付费 generation 前看见并可移除。具体 `@` flow 见
  `reference-picker-contract.md`。
