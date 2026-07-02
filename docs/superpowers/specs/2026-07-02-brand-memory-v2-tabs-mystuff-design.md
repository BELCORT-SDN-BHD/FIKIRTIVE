# Brand memory v2 修订 — 6-tab + 产品图 + My Stuff 统一素材库

日期：2026-07-02 · 分支：`claude/brand-memory-rebuild`（在 PR #103 之上重排，**一次 merge**）
状态：**待创始人审核** · mockup：`~/Desktop/brandmem-v2-tabs-mock.png`

## 创始人修订（推翻/新增的拍板）

| # | 修订 | 取代 |
|---|---|---|
| R1 | Brand memory = **6 tabs，一区一个**（About / Look & feel / Customers / Products / Offers / Do & don't） | 原拍板 2「单页 6 分区」 |
| R2 | Products tab = **Shopify-showcase 式图片卡**；产品加图片（引用 My Stuff 素材，data JSON 加字段，不改库） | 原「纯文字行」+ 原 YAGNI「不加 imageUrl」 |
| R3 | **My Stuff 一并重设计**：统一素材库（过滤器不分页）+ 用户可加素材 | 原 My Stuff rebuild 待办 |
| R4 | 加素材 = Upload + **Generate reference（固定 format 每类一个）**；不做聊天；enhance = 模板内可选润色 | 新增 |

## A · Brand memory 6-tab（mockup 板 A/B）

- **聊天 + Undo 条全局置顶**（tabs 之上）：OTTO 一轮可能同时改多区，undo 必须全局。
- Tab 胶囊栏（现有 shadcn Tabs 习语，同 OttoStuff `rounded-[14px] bg-muted p-1`）：
  `About · Look & feel · Customers <n> · Products <n> · Offers <n> · Do & don't`
  - 有记录数的 tab 显示条数（muted 小字）。
  - **珊瑚点**：OTTO 本轮改过的 tab 上亮 6px coral 圆点，随高亮 4s 淡出逻辑同步清除。
  - diff/undo/高亮机制**原样复用**（v1 已建），只是行/卡分散到各 tab。
- 各 tab 内容 = v1 各分区原样搬家（FactSection ×3、SegmentCards、OfferList），**Products tab 重做**（见 B）。
- URL 状态：`?tab=products`（浅路由，刷新/分享保位）。

## B · Products tab — showcase 卡

- 3 列图片卡：图（150px，无图 = 「Add image · from My Stuff」占位）→ 名 + mono 价格 → 描述 2 行 → 徽章（OTTO learned / You added / Archived）+ updated + ✎/⧉(duplicate)/Archive。
- ⭐ Pinned 徽章图左上；「+ Add product」虚线卡；Archived 变暗排最后 + 「hidden from Otto」注。
- 搜索框 + Add 按钮工具行（沿用 v1 逻辑）。
- **数据**：`ProductRecordData` 增 `imageAssetId?: string`（zod 加字段即可 —— data 是 JSON 列，**零 migration**）。
- 「Add image」→ 打开 **My Stuff 选择弹窗**（同一个库组件，picker 模式，只显示图片类）→ 存 `imageAssetId`。
- 图片渲染用现有 `assetUrl`/storage 路径（display-only）。
- OTTO 侧不让模型直接写 `imageAssetId`（skill 参数不加它 —— 图片归 UI 管，防模型幻觉 asset id）。

## C · My Stuff 统一素材库（mockup 板 C）

- 现 cast/ads 双 tab → **过滤器**：`All · Images · Videos · Cast · Product shots · Ads`（+搜索）。
  - 数据源不变（entities + ads + generations，页面已加载），过滤为纯前端分类。
- 瓦片：图/视频缩略 + 名；悬停操作：**Use as reference**（现有 mention/canvas 语义）· **Set as product image**（打开产品选择器：选哪个产品 → 写它的 imageAssetId）· Rename · Delete（沿用现有 EntityTile 逻辑）。
- **⭐ 关联标签**：被某产品用作图的素材，左上角显示 `⭐ <产品名>`（由 brand records 反查 imageAssetId，纯展示）。
- **Picker 模式**：同一 grid 组件以 modal 打开（从产品卡进入），只显示图片，点选返回 assetId。

## D · 加素材 = Upload + Generate reference（固定 format）

**引擎全现成，零新表、零新花钱路径：**

| 需要 | 现成的 |
|---|---|
| 类型 | `EntityType = CHARACTER / LOCATION / PRODUCT / BRANDMARK`（enum 已在库里，**不加不改**） |
| 上传 | `createEntity(formData)`（ingestFile→asset→referenceImage→锁 base）已存在 |
| 生成 | `startRefGen`（**冻结**，只调用）+ 现有费用确认模式 |

**流程**：`[+ Add] → Upload / Generate reference`
- **Upload**：类型 + 名字 + 文件 → `createEntity`（原样）。
- **Generate**：选类型（友好名：Avatar · Product shot · Location · Brand mark）→ 每类小表单（主体描述 1 框 + 可选备注 + 可选参考照）→ **固定模板**组装 structuredPrompt → 现有 refgen 路径 + 费用确认 → 生成物落 My Stuff（entity refs，原样）。
- **模板 = 每类一个可读文件**：`apps/web/lib/reference-formats/{avatar,product-shot,location,brandmark}.ts`（导出：label、表单字段、`buildPrompt(fields)`、模板正文常量 —— 创始人可直接改文件调 format；正文英文）。各模板烘焙客观最佳实践：
  - avatar：干净中性背景、正面平光、头肩构图、表情中性、无遮挡
  - product-shot：白/米底 studio、无杂物、居中、柔和阴影
  - location：空场景无人、广角定场、自然光
  - brandmark：纯底、居中、无变形
- **Enhance（可选钮）**：把用户那句主体描述润色进模板的描述位（走现有 enhancePrompt 类 LLM 路径/或纯模板插值 v1 先不接 LLM —— 实现时定，标注在 plan）；**模板骨架永不被改写**。

## 钱路（BINDING）

- `startRefGen` / `refgen-actions.ts` / 一切冻结文件**零修改**，只从 UI 调用现有导出。
- Generate 前费用确认照现有模式；Upload/链接/过滤/tab 全 $0。
- `imageAssetId` 仅 display；不进任何计费逻辑。

## 测试 / 验收

- 纯函数 TDD：reference-formats 各 `buildPrompt`（字段插值 + 骨架不变式）；product `imageAssetId` zod；My Stuff 过滤分类函数。
- UI：skin-preview 更新 mock（含带图产品 + 各过滤类素材）→ 截图 vs mockup。
- 手动主线：切 6 tabs → OTTO 改产品价 → Products tab 亮点 + 卡高亮 → Undo → 从产品卡开 picker 选图 → My Stuff 里该素材出现 ⭐ 标 → [+ Add]→Generate 表单出现费用确认（**不真花钱，mock 下验证**）。

## 不做（YAGNI）

- product↔PRODUCT-entity 深度合并（两个"产品"概念各司其职：record=营销事实，entity=视觉参考；asset 是共同货币）→ 将来再议。
- 生成后自动 set-as-product-image；My Stuff 无限滚动/虚拟列表；模板接 prompt-mastery skills（那分支未合）。
- 聊天入口（明确不做，见 R4 理由：仓库不是工作台）。
