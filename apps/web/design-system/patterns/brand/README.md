# Brand / Otto IQ screen pattern

> **状态：Founder approved and frozen — 2026-08-30。**  
> **上游权威：** `../../information-architecture/` 已冻结的 Brand taxonomy、surface ownership 与 apply-context flow。  
> **参考证据：** [`references.md`](references.md)。
> **Founder-selected visual：** [`selected-direction.png`](selected-direction.png)，2026-08-30 选择最新一组 Option 1。

## 1. 谁与成功标准

**主要用户：** 没有品牌团队、但希望每次创作都保持一致的小生意 Founder。

**一句成功：** Founder 不需要学习 prompt engineering，也能建立、检查和维护 Otto 会长期使用的品牌 context，并在保存前看懂它会怎样改变实际输出。

## 2. Product definition

主导航继续使用 `Brand`。`Otto IQ` 是跨产品使用的 canonical marketing knowledge layer，不新增第二个导航、第二张 Brand home 或第二套资料库。

Otto IQ 是 Founder 对营销事实的统一读取入口，但不是吞下所有原始资料的万能数据库。每种事实只保留一个 owner：

| Object / fact | Canonical owner | Otto IQ relationship |
|---|---|---|
| Product positioning、benefits、approved claims、constraints | Otto IQ Product catalog | 直接持有同一个 Product ID 的营销事实 |
| Product / Character / Clothes / Location media | Library | 只链接 Library asset ID，不复制文件 |
| Audience definition、needs、motivations、market、language | Otto IQ Audiences | 直接持有 reusable marketing understanding |
| Contacts、consent、live segment membership、customer events | Future CRM | 通过稳定 ID 连接；不把联系人名单复制进 Otto IQ |
| SKU、live price、inventory、orders | Future commerce connection | 读取来源事实；不把动态经营数据改写成手工 IQ facts |

`Library → Elements → Products` 继续作为 Founder 管理 Product 与 linked media 的界面；它读写同一个 Otto IQ Product ID。因此 Products 不成为 Brand 的第六个重复 section。

Brand 是一个 application-shell experience，默认直接打开 `Brand voice`：

```text
Brand
├─ Brand voice
├─ Audiences
├─ Knowledge base
├─ Style guide
└─ Visual guidelines
```

- 五个 sections 使用同一套 route-backed list → detail / create pattern。
- Brand 不内嵌一套独立 Otto conversation；全局 `Ask Otto` 可读取当前 section 并帮助建立 draft。
- Otto 建议或提取的内容必须先成为可检查的 draft；Founder 保存后才成为 persistent context。
- Create / Canvas 显示本次采用的 context，可 remove / replace，并在 Generation provenance 记录 `Context used`。

## 3. Shared screen architecture

每个 section 都复用同一个结构：

1. **Section navigation**：五个稳定 sections；不增加 Overview。
2. **Header**：section 名、清楚的一句用途、唯一 primary action，例如 `Add brand voice`。
3. **Context list**：名称、简短说明、来源、更新时间与 processing / ready / failed 状态。
4. **Detail / create surface**：查看来源、编辑提取结果、预览应用差异、保存或取消。
5. **Usage context**：显示该 context 最近在哪里被使用，并可进入对应 Canvas / Generation；不复制媒体或 Product facts。

列表负责找回与管理；detail 负责理解与修改。普通卡片不长期暴露 rename、delete、apply 等整排 actions。

选定 visual direction 采用 **scan first, details on demand**：默认只展开 Evidence；Usage、Instructions 与
Change history 保留为可展开层级。这样不会删掉治理证据，也不会让 Founder 一进页面就面对整份资料表。

页面主标题跟随 active section；`Brand` 只保留在 application-shell breadcrumb。正式 Otto vector states 只用于
Ready / Draft / Processing、empty、failed 等需要解释的状态，不在普通 data rows 重复当装饰。

## 4. Create context flow

五个 sections 共用一个最短、可解释的 create contract：

```text
Add context
→ choose Text / URL / File（只显示适用来源）
→ ingest / extract
→ review editable draft + source
→ compare Without context / With context
→ Save context
```

- `Text`：粘贴 Founder 已有的品牌材料或直接填写。
- `URL`：读取指定页面；失败时保留 URL 与可重试状态，不制造空白成功记录。
- `File`：文件是 ingestion source，不自动成为 Library media，也不是 context object 本身。
- Preview 使用同一个 realistic sample outcome；左右或前后切换展示未应用 / 已应用差异。
- Save 前必须显示 context 名称、所属 section、提取内容与来源；Founder 可编辑、取消或重试。
- 已保存 context 的后续编辑也先形成 draft；不能在离开输入框时静默改变 Otto behavior。

## 5. Section contracts

### 5.1 Brand voice

- 管理 reusable tone / personality context。
- detail 显示 description、representative examples / excerpts、best-used-for tags 与 source。
- Preview 重点比较语气、用词和句式变化，不用抽象 confidence score 代替真实 copy。

### 5.2 Audiences

- 管理 reusable audience context，例如目标人群、需求、顾虑、动机、市场与语言。
- 一次 creation 可以选择一个 primary audience，并额外引用具体 Product 或 Element。
- Audience 不是 CRM segment，不保存联系人名单，也不自动承诺投放能力。
- Future CRM 可以把一个或多个 live segments / customer signals 链接到 Audience；CRM 仍拥有 contacts、consent、events 与实时 membership，Otto IQ 只保存可复用的营销理解与连接关系。

### 5.3 Knowledge base

- 管理 text / URL / file-derived business knowledge、approved claims、FAQs 与 campaign facts。
- 可以链接 canonical Product ID；Product facts 仍由 Otto IQ Product catalog 持有。
- 同一个 Product 在 Library、Knowledge base 与 `@` picker 中都是同一对象，不复制第二份 facts。

### 5.4 Style guide

- 管理 writing conventions：preferred wording、capitalization、formatting、required phrases 与 avoid rules。
- 使用可扫描的 `Do / Avoid` examples；不要求 Founder理解抽象 rule schema。
- 与 Brand voice 分开：Voice 回答“听起来像谁”，Style 回答“必须怎样写”。

### 5.5 Visual guidelines

- 管理 visual direction、logo usage、colors、type、imagery principles 与 approved / avoid examples。
- 示例媒体只链接 Library asset IDs，不复制文件。
- 这是给 Otto / Canvas 使用的 persistent context，不在 Brand 内建立第二个 creation editor。

## 6. Essential states

- **First use**：解释这一 section 会怎样影响 Creation，并提供一个 primary `Add…` action。
- **Ready**：显示 context 名称、说明、来源、更新时间与最近 usage。
- **Processing**：明确正在读取 URL / file，可离开页面；不能显示为可用 context。
- **Failed ingestion**：保留 source 与原因，提供 Retry / Edit source / Remove draft。
- **Unsaved draft**：清楚标记 `Draft`；离开前要求 discard / keep editing。
- **Preview**：同一个 sample 的 Without / With context 都可读，且 context 改变后可重新生成 preview。
- **Empty search**：区分“没有 records”和“筛选没有结果”。
- **Delete**：先显示 usage impact；本 pattern 只定义确认语义，不实现 backend lifecycle。

## 7. Checkable acceptance criteria

1. Brand 默认进入 `Brand voice`，没有 Brand overview / dashboard。
2. 五个 sections 与冻结 IA 完全一致，且拥有 route-backed state。
3. 五个 sections 复用一套 list → detail / create pattern，不分别发明 layout 与 primitive。
4. Text / URL / File 只作为 ingestion source；保存的是可应用 context object。
5. 保存前必须 review editable draft，并比较 `Without context / With context`。
6. Otto 建议不能静默生效；Founder 明确保存后才成为 persistent context。
7. Brand 不嵌入第二套 Otto chat；使用全局 `Ask Otto` 与 shared action layer。
8. Knowledge base 链接 canonical Product ID，不复制 Product facts。
9. Visual guidelines 链接 Library assets，不复制 media。
10. Create / Canvas 能显示、remove / replace 本次使用的 Brand context；Generation detail 记录 `Context used`。
11. Processing、failed、draft、empty 与 usage-impact states 都有诚实 UI，不用 toast 伪装 persistence。
12. 全部 controls 消费现有 Fikirtive Design System owners；coral 只属于 Fikirtive / Otto moments。

## 8. Non-goals

- multi-brand / agency switching；
- team visibility、approval matrix 或 public sharing；
- CRM segments 或 audience contact lists；
- 在 Brand 内生成、编辑或管理媒体文件；
- 复制 Product catalog、Library 或 Canvas；
- 在本 screen-pattern 阶段修改 production `/brand`、schema、ingestion backend 或 permissions。

## 9. Founder approval gate

**Spec status：** Founder approved and frozen — 2026-08-30。  
**下一步：** 连接 Mobbin，使用 Jasper IQ screenshots 与当前 Fikirtive Design System 制作三款 visual directions；选定方向前不开始 frontend implementation。

## 10. Change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-30 | Drafted | Library fixture 验收后，按冻结 sitemap 进入下一块 Brand / Otto IQ；建立 screen spec candidate，等待 Founder 批准。 |
| 2026-08-30 | Clarified | Founder 确认 Otto IQ 应成为主要营销知识真源；补充 federated ownership：Products 归 Otto IQ facts、媒体归 Library，Audience 未来链接 CRM 而不复制 contacts / consent / events。 |
| 2026-08-30 | Approved and frozen | Founder 回复 `ok继续`；冻结 Brand / Otto IQ screen spec，进入 visual direction gate。 |
| 2026-08-30 | Visual selected | Founder 选择最新一组 user-friendly visual directions 的 Option 1；批准窄 context list、单一 detail surface 与 Evidence / Usage / Instructions / Change history progressive disclosure。 |
| 2026-08-30 | Founder refinement | section 切换后主标题必须同步；允许使用更多正式 vector art 辅助表达，但集中在状态与 first-use moments，避免挤占 detail content。 |
| 2026-08-30 | Backend boundary recorded | Founder 决定在未来连接 backend 时建立内部 `Otto IQ engine`，统一管理 context ingestion、review state、provenance、versioning、retrieval 与外部 canonical records 的 links；当前 Brand pattern 只是 Founder-facing management surface，不提前实现 engine。术语边界以根目录 `CONTEXT.md` 为准。 |
