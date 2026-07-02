# 产品分类（type-to-create）+ OTTO 自动归类 — 设计 spec

日期：2026-07-03 · 分支：`claude/product-categories`（off main `0d9062a`）· 状态：创始人已拍板
拍板（2026-07-03）：① 分类 = **打字即建**（Shopify tag 式，零额外状态）；② **独立新 PR**（#103 已 merge）。

## 机制

- **数据**：`productRecordData` 增 `category?: z.string().max(40)`（JSON data 字段，零 migration，同 imageAssetId 模式）。
- **分类表 = 派生**：现有产品 category 的去重集合。新建 = 在表单里打新名字；没产品的分类自然消失；改名/合并 = v2。
- **规范化**：保存时 trim；比较/归组时大小写不敏感（显示保留原写法，首次出现的写法为准）。

## OTTO 自动归类

- `saveProduct` 技能加 `category` 可选参数（merge 语义免费获得：不传不清）。
- 注入升级（`getBrandContextText` products 段）：每行产品带 `[category]`；摘要行列出去重分类表（OTTO 知道现有分类体系）。预算 800 不变。
- 指令纪律（instructions.ts Brand memory 块加一行）：保存产品时，合适就用现有分类，否则起一个简短新分类；用户说"帮我把产品分类"→ 对未分类产品逐个 saveProduct 补 category（自动生效+可撤销，机制现成）。

## UI（Products tab）

- 搜索行下加**分类过滤 chips**：`All · <各分类(计数)> · Uncategorized(计数)`（只在 ≥1 个分类存在时显示；chips 样式同 tab 胶囊）。
- 产品卡 meta 行加 category 小徽章（灰 pill，无则不显示）。
- 添加/编辑表单加 `Category` 输入 + `<datalist>`（现有分类提示，打新名字即建）。
- 高亮/undo/diff 机制不动（category 变化天然被 diffRows 捕捉）。

## 钱路（BINDING）

零花钱路径变化；纯 data/display。冻结文件不碰。

## 测试

- core：category 字段接受/长度上限/可选（TDD）。
- otto：saveProduct 传 category 落 data；不传时 merge 保留旧 category（守护测试）。
- web：注入含 `[category]` 与分类表行（TDD）；过滤/归组纯函数（TDD）。
- 视觉：skin-preview mock 加分类 → chips + 徽章 + datalist 截图验证。

## 不做（YAGNI)

分类改名/合并工具；多级分类；offers/segments 分类（有需要再说）；分类排序。
