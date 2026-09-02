# Library screen pattern

> **状态：Founder approved and frozen — fixture implementation accepted。**  
> **上游权威：** `../../information-architecture/` 已冻结的 Library taxonomy、surface ownership 与 reuse flow。  
> **参考证据：** [`references.md`](references.md)。
> **Backend handoff：** [`backend-handoff-contract.md`](backend-handoff-contract.md)；记录 production 所需真实能力，不授权本 UIUX session 修改 backend。后续接线先读该文第 8 节「接线执行配方」，并在当时核对 live contracts。  
> **当前视觉：** [`selected-direction.png`](selected-direction.png)；Founder 选择“第一款的中间 + 第二款的边框”。
> **Official avatars 视觉：** [`official-avatars-selected-direction.png`](official-avatars-selected-direction.png)；Founder 于 2026-08-30 选择 avatar-card ideation 第 2 款。

## 1. 谁与成功标准

**主要用户：** 需要快速找回、整理与重用 creation content 的小生意 Founder。

**一句成功：** Founder 进入 Library 后，不需要先建立 folder，也能在几秒内找到任一 generation、upload 或 reusable Element，并把它带回 Canvas 继续创作。

## 2. 设计结论

Library 是一个 **browse-and-reuse workspace**，不是第二个 Home、第二个 Canvas，也不是传统文件管理器。

- 默认打开 `Generation history`，不增加 Library overview / dashboard。
- 同一个 application shell 内只有五个一级 views：`Generation history / Uploads / Favorites / Collections / Elements`。
- 页面上方固定 `Library` title、全局 search 与当前 view actions；一级 views 使用紧凑 secondary navigation。
- `Elements` 内再切换 `Products / Characters / Official avatars / Clothes / Locations`，不把五类对象提升为主导航。
- Grid 负责快速扫描；asset actions 只在 hover、selection 或 detail surface 中出现，避免每张卡都变成 control panel。

## 3. Screen architecture

### 3.1 Generation history

- 主内容按时间分组，例如 `Today / Yesterday / August 2026`。
- 使用保持原始比例的紧凑 media grid；video 显示 duration，图片不附加长期可见的大段 metadata。
- toolbar 只保留高频 filters：`All / Images / Videos`、`Canvas or chat`、`Date`。低频条件进入一个 `More filters` popover。
- 搜索覆盖名称、prompt、Canvas、Chat 与已解析的 reference label。
- 单击 asset 打开 route-backed detail side panel，同时保留 grid scroll、search 与 filters。
- `Select` 进入 multi-select；selection bar 只提供 `Add to collection / Favorite / Download`，不在本阶段加入 batch edit 或 folder automation。
- 历史使用稳定的 progressive loading，并保留时间分组；UI 不一次渲染无止境记录，也不要求 Founder手动分页。

### 3.2 Uploads

- 与 Generation history 共用同一 grid、search、filters、selection 与 detail pattern。
- header action 为 `Upload files`；上传完成后资产立即出现在当前时间组。
- Upload detail 显示 file name、format、dimensions / duration、uploaded date 与 linked Elements / Collections。
- Upload 不因被加入 Collection、Favorite 或 Element 而复制文件。

### 3.3 Favorites

- Favorites 是同一 asset / Element 的 saved view，不建立新对象。
- 可混合显示 Generation、Upload 与 Element，但每项必须有清楚的 type label。
- 取消 Favorite 后从当前 view 消失，同时原对象仍留在它的 canonical view。

### 3.4 Collections

- Collections landing 是简洁 collection grid：cover、name、item count、last updated。
- `New collection` 打开小型 dialog，只要求 name；不建立 Project、brief、nested folder 或 smart-folder rule。
- Collection detail 是 child page，复用 Library grid 与 selection pattern。
- Collection 只保存对象链接；同一对象可以属于多个 Collections。

### 3.5 Elements

- Elements landing 默认 `Products`，并显示 type tabs：`Products / Characters / Official avatars / Clothes / Locations`。
- Element card 以 identity 为主：cover、name、type、linked media count；不用 generation prompt 充当对象名称。
- Product child page 显示 Otto IQ canonical facts 与 linked Library media；Library 不复制 product facts。
- Character、Clothes、Location 使用 child page管理 identity 与 linked media。
- Official avatar 是 Fikirtive-owned read-only catalog：支持 search、filter、preview、favorite 与 `Use in Canvas`；不显示 rename、edit 或 delete。
- 使用 Official avatar 产生的新 Generation 自动进入 Founder 的 Generation history，avatar identity 本身仍是 read-only。

## 4. Media detail pattern

Generation、Upload 与 Official avatar 使用 route-backed side panel：Founder 可 deep-link，也可关闭返回原 grid state。

Panel 顺序固定：

1. large preview；
2. primary action：`Use in Canvas`；
3. secondary actions：`Favorite / Add to collection / Download`（只显示适用项）；
4. provenance：来源 Canvas / Chat、created time、format、dimensions / duration；
5. creation context：prompt、references used 与 generation lineage。

Prompt 与 metadata 默认可读但不抢过 media；长内容折叠。`Use in Canvas` 传递同一个 typed object ID，不复制 asset。

## 5. Essential states

- **First-use empty：** 解释 generations 会自动出现，并提供 `Create something`；Uploads 提供 `Upload files`。
- **Search miss：** 显示 active query / filters 与 `Clear filters`，不能说 Library 是空的。
- **Loading：** 保留 grid geometry；不使用一整页 spinner。
- **Failed preview：** 保留 asset identity、metadata 与 retry，不把对象从 history 静默移除。
- **Selection：** selection bar 进入后不移动 grid；Escape 退出 selection。
- **Read-only：** Official avatar actions 与 Founder-owned Element actions明确不同。

## 6. Checkable acceptance criteria

1. Library 没有 overview Home；默认入口是 `Generation history`。
2. 五个一级 views 与冻结 IA 完全一致，没有 Folder、Project、Project Brief 或第二套 asset taxonomy。
3. Generation history 能按时间、media type、Canvas / Chat 与 date 找回内容，并支持 unbounded progressive loading。
4. Generation、Upload、Favorite、Collection 与 Element 都引用 canonical object；移动或整理不复制文件或 facts。
5. 单击 media 打开 route-backed side panel，关闭后恢复原 grid scroll、query、filter 与 selection state。
6. Detail panel 清楚显示 preview、reuse action、provenance、prompt / references 与 lineage。
7. `Use in Canvas` 是主要 reuse action；Library 内不出现 creation composer 或完整 Otto conversation。
8. Collections 只有一层，由 Founder 命名；同一对象可加入多个 Collections。
9. Elements 包含 Products、Characters、Official avatars、Clothes 与 Locations；Product facts 只来自 Otto IQ。
10. Official avatars 可 preview / favorite / use，但不可 rename / edit / delete。
11. Grid、toolbar、tabs、panel、dialog、selection bar 与 states 全部消费现有 Design System owners，不建立新 token 或 duplicate primitive。
12. Review fixture 使用 realistic media 与 data，但不伪装 production upload、generation、persistence、delete 或 backend search 已接通。
13. 所有 visible core controls 必须有真实、可见、可撤销的结果：sort、search、filters、tabs、selection、detail、Collections 与 Elements 不能以无状态 toast 代替互动；fixture-only upload 明示不持久化。
14. Official avatar 不符合当前 search / filters 时，detail panel 立即关闭并清除 stale `avatar` route state；系统不会自动选择另一个演员。

## 7. Non-goals

- nested folders、smart folders、DAM workflow、approval queue 或 team permission redesign；
- 在 Library 直接生成或编辑 media；这些动作进入 Canvas；
- manual video editor；
- Product facts、Brand context 或 Official avatar identity 的第二份编辑入口；
- mobile Library redesign；
- 本 spec 阶段修改 production `/library` route。

## 8. Founder acceptance

**Spec approval：** Approved and frozen。  
**日期：** 2026-08-30。  
**Founder 原话：** “可以”。  
**Implementation approval：** Founder accepted the completed fixture on 2026-08-30：“ok 看起来没问题”。

## 9. Change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-30 | Drafted | 基于冻结 IA 与 Mobbin generative / asset-management evidence，建立 minimal Library screen candidate；等待 Founder 验收。 |
| 2026-08-30 | Founder approved | Founder：“可以”。Spec 冻结；下一步先选择视觉方向，再制作 fixture-only review implementation。 |
| 2026-08-30 | Visual selected | Founder：“第一款的中间 + 第二款的边框看起来不错”，随后“ok”。保存为 `selected-direction.png`，批准制作 review fixture。 |
| 2026-08-30 | Implementation in review | 建立独立 `/product-patterns/library` review route；production `/library` 不变。 |
| 2026-08-30 | Interaction completeness | Founder 要求 “make sure everything clickable，包括但不限于 sorting”。补齐四种排序、Canvas / Chat / Date / source filters、clear、selection actions、route history、Upload picker、Collection create / drill-in 与 Element preview；所有 session-only 行为保持 honest disclosure。 |
| 2026-08-30 | Founder accepted | Founder 完成 visual 与 interaction 验收：“ok 看起来没问题”。Library fixture 成为后续 production implementation 的 approved reference。 |
| 2026-08-30 | Official avatars visual selected | Founder 提供 actor-card 资讯规格，并选择 ideation 第 2 款：较大的 portrait cards、use-case shortcuts 与 route-backed evidence panel。实现范围仅限前端 fixture；identity、generation engine 与 persistence 由后端 authority 持有。 |
| 2026-08-30 | Official avatars implementation ready | 完成 6 位 realistic official actors、Gender / Age / Vibe / industry filtering、route-backed detail、character sheet / in-action evidence、Favorite 与带 typed actor reference 的 `Use in Canvas`。使用正式 Design System primitives；Founder visual acceptance pending。 |
| 2026-08-30 | Founder-approved QA fix | Founder：“好的，修吧”。筛选排除已选演员时关闭 detail 并清理 route；不自动替换选择。 |
| 2026-09-02 | Documentation authorized | Founder 要求在既有 backend handoff 补充接线执行配方，供后续任务细化；本次仅更新文档，不冻结未来 implementation 或上线范围。 |
