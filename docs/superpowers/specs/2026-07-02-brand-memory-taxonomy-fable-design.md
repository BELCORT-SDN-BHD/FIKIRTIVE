# Brand memory 分类法重设计 — 静态事实 vs 活集合（FABLE 研究稿）

日期：2026-07-02 · 分支：`claude/brand-memory-rebuild` · 状态：**待创始人拍板（见 §5 开放问题）**
关系：建立在 `2026-07-02-brand-memory-rebuild-design.md` 之上（不推翻，是升级 —— 见 §4）。
实现者：Opus（本文不含任何产品代码）。

---

## TL;DR

创始人的直觉是对的：品牌知识**不是一种东西**。「品牌是谁 / 长什么样 / 什么不能做」是**慢变的单例事实**，平铺卡片就够；但**产品、客群、优惠**是**活集合** —— 会持续增长、每条是有生命周期的结构化记录，硬塞进「一行自由文本」是错的。建议：6 个分区 = 3 个静态事实区（About / Look & feel / Do & don't）+ 3 个活集合区（Your customers / Your products / Your offers）。v1 **零新表**：活集合记录复用现有 Memory 表（category 当 kind 判别符，content 存 zod 校验过的紧凑 JSON），rebuild spec 的 diff/undo 机制原样适用。注入按「分区预算」分层：静态全量、客群/优惠只注 active、产品注摘要+Top-N，另加一个 $0 只读 skill `lookupProducts` 让 OTTO 按需查全量目录 —— 目录再大也不爆 context。

---

## 1. 核心命题：静态事实 vs 活集合 —— 成立，但要再切一刀

「静 vs 活」是对的第一刀。但研究下来，真正驱动设计的是**两个维度**：

| 维度 | 问题 | 影响什么 |
|---|---|---|
| **变化频率**（静 / 活） | 这条知识多久变一次？ | UI 形态（卡片 vs 列表）、写入机制 |
| **规模上界**（有界 / 无界） | 条目数会涨到多少？ | **注入策略**（全量 vs 摘要+按需查询） |

六个桶落在四象限里的位置**不同**，所以「每个桶需要不同设计」这个直觉成立：

| 桶 | 变化频率 | 规模 | 结论 |
|---|---|---|---|
| About the brand | 静 | 少（<10 条） | 平铺事实卡，全量注入 |
| Look & feel | 静 | 少 | 平铺事实卡，全量注入 |
| Do & don't | 静 | 少 | 平铺事实卡，**永远全量注入**（安全约束） |
| Your customers | 半活（月级） | **有界**（2–6 个客群） | 结构化卡片组，active 全量注入 |
| Your offers | **活 + 自带日期**（周级） | 有界（同时 active 的 <10） | 带日期的记录列表，**只注入未过期的** |
| Your products | 活（随生意涨） | **无界**（几十→几百） | 记录列表，摘要+Top-N 注入 + 按需查询 |

**行业印证**（细节见 §8 来源）：
- Jasper 的 IQ 层就是这么切的：Brand Voice / style guide（静态单例）与 Audiences、Knowledge Base（活的、结构化、可增长）是**分开的功能与数据形态**，生成时各自注入。
- Shopify 把产品做成带 `status: ACTIVE | DRAFT | ARCHIVED` 生命周期的记录 —— 「归档而非删除」是产品集合的标准力学。
- Google Merchant 的 promotions feed **必填** `promotion_effective_dates` —— 优惠这个类型**天生带生效日期**，没有日期的优惠模型是残缺的。
- Meta 商品目录的必填字段只有 9 个（id/title/description/availability/condition/price/link/image_link/brand）—— 说明「产品记录」的最小可用形态很小，我们可以取更小的子集。

**一个反直觉的修正**：客群（customers）不是无限列表。CDP/Jasper 的实践里，可用的客群画像通常只有个位数（多了反而没人维护、生成时也用不过来）。所以客群是「**卡片组**」不是「无限滚动列表」；真正需要无限滚动力学的只有**产品**。

---

## 2. 建议的分类法（6 桶）

页面顺序（聊天框仍置顶，机制不变）：

```
[Chat with Otto]                       ← rebuild spec 原样
ABOUT THE BRAND      ← 静态事实卡
LOOK & FEEL          ← 静态事实卡
YOUR CUSTOMERS       ← 客群卡片组（2–6 张）
YOUR PRODUCTS        ← 产品列表（可搜索、View all 展开）
YOUR OFFERS          ← 优惠列表（Active / Past 分组）
DO & DON'T           ← 静态事实卡
```

总览表：

| 桶（UI label） | 类型 | 数据形态 | OTTO 写 | OTTO 读（注入） |
|---|---|---|---|---|
| About the brand | 静态事实 | 自由文本行（现状） | `rememberBrandFact(about)` | 全量 |
| Look & feel | 静态事实 | 自由文本行 | `rememberBrandFact(look)` | 全量 |
| Do & don't | 静态事实 | 自由文本行 | `rememberBrandFact(rules)` | **全量，预算内最高优先** |
| Your customers | **活集合（有界）** | segment 记录 | `saveCustomerSegment`（upsert） | active 全量（压缩成每群一行） |
| Your products | **活集合（无界）** | product 记录 | `saveProduct`（upsert） | 摘要 + Top-N + `lookupProducts` 按需 |
| Your offers | **活集合（带日期）** | offer 记录 | `saveOffer`（upsert） | 只注 active/即将开始，过期自动剔除 |

### 2.1 静态三桶（About / Look & feel / Do & don't）

- **完全沿用 rebuild spec**：自由文本行 + source 徽章 + 行内编辑 + 「Add a fact」+ OTTO 实时改+撤销。
- 与 rebuild spec 唯一差别：category 枚举从 4 个变 3 个（`customers` 从静态枚举里移出，见 §4）。
- BrandKit / BrandRule 照旧作为独立下层，不合并（rebuild spec 已锁定）。

### 2.2 Your customers — 客群卡片组

**数据形态**（字段名参考 Jasper Audiences + CDP 常用画像属性，取创始人能 2 分钟填完的子集）：

```ts
// zod: CustomerSegmentRecord
{
  name: string,          // "Young working moms" — 必填，upsert key
  who: string,           // 一两句：他们是谁（人口特征 + 场景）— 必填
  pains?: string,        // 他们的痛点
  wants?: string,        // 他们想要什么 / 什么打动他们
  channels?: string,     // 在哪触达（"IG Reels, TikTok"）
  toneTips?: string,     // 对这群人说话的语气微调（在 brand voice 之上）
  status: "active" | "archived",   // 默认 active
}
```

- **力学**：增长慢（月级）；软上限 **6 个 active**（第 7 个时 UI 提示归档一个 —— 不是硬限制，是维护性设计）；归档不删除。
- **UI**：卡片组（grid，每张 = 迷你画像卡：name 加粗 + who + 徽章），非滚动列表。卡上 ✎ 打开字段表单（不是裸 JSON）。「+ Add a customer group」。
- **OTTO 写**：`saveCustomerSegment`（cost:free / effect:write / reach:internal → 免审批，同 rememberBrandFact 门）。按 normalized name upsert —— 「我们的宝妈客群现在也看小红书了」→ 更新 channels，不新建。
- **OTTO 读**：所有 active segment 压缩成每群一行注入：`- Young working moms: <who>; pains: <pains>; reach: <channels>; tone: <toneTips>`。6 群 × ~200 字符 ≈ 1.2k 字符封顶。
- **对全输出面的价值**：图片/视频（拍给谁看）、广告（受众+文案角度）、CRM 回复（对方大概率是哪群人、用什么语气）、社媒（每群轮流做内容）。

### 2.3 Your products — 产品列表（无界集合）

**数据形态**（Meta 必填 9 字段的营销子集 —— 我们是「营销记忆」不是商店，availability/condition/GTIN 等电商字段全部 YAGNI）：

```ts
// zod: ProductRecord
{
  name: string,          // 必填，upsert key
  description?: string,  // 一两句：是什么 + 核心卖点
  price?: string,        // 展示用自由文本 "RM 49" — display-only，永不进任何计费/spend 逻辑
  url?: string,          // 产品页链接（进广告 CTA 有用）
  sellingAngle?: string, // 打广告时的角度（"convenience for busy moms"）
  tags?: string[],       // "bestseller" | "new" | 自由标签
  status: "active" | "archived",   // Shopify 三态取二（draft 对营销记忆无意义）
}
```

- **力学**：随生意持续增长；改价/换卖点 = upsert 更新；下架 = archive（保留历史，OTTO 不再用）；`pinned`（Memory 现成字段）= 主推产品，注入时优先。
- **UI**：**列表**（创始人直觉正确）—— 顶部搜索框 + 默认显示 ~8 行（pinned 优先，再按 updatedAt），底部「View all (37)」展开滚动。每行：name · 一行 description · price · status pill · ✎ / archive。每行显示 `updatedAt`（「3 天前更新」）—— 价格新鲜度一眼可见。
- **OTTO 写**：`saveProduct`（同门，免审批）。upsert by normalized name；`status:"archived"` 走同一个 skill。
- **OTTO 读（关键 —— context 预算的答案）**：
  1. **摘要行**：`Products: 37 total (5 pinned). Pinned: A, B, C. Recently updated: D, E.`
  2. **Top-N 详情**（N=10：pinned 优先→updatedAt 倒序），每条一行：`- <name> — <description>; <price>; angle: <sellingAngle>`。
  3. **新增 $0 只读 skill `lookupProducts(query)`**（cost:free / effect:read / reach:internal → 免审批）：按 name/tags/描述子串查询，返回 ≤5 条完整记录。这是标准的 retrieval-on-demand 模式（把「指针+摘要」放 context、全量数据靠 tool call 取，见 §8）—— 目录涨到几百条也不爆 prompt。
  4. OTTO prompt 里加一句纪律：*提到具体产品/价格前，若不在 Top-N 里，先 lookupProducts。*

### 2.4 Your offers — 优惠列表（带日期的集合）

**数据形态**（Google Merchant promotions feed 的必填集合是最好的先例：id、标题、生效日期、渠道、券码 —— 取子集）：

```ts
// zod: OfferRecord
{
  title: string,         // "Raya sale — 20% off everything" — 必填，upsert key
  details?: string,      // 条件、范围（"skincare line only, min RM50"）
  code?: string,         // "RAYA20"
  appliesTo?: string,    // 自由文本，可提产品名
  startsAt?: string,     // ISO date
  endsAt?: string,       // ISO date — 核心字段，驱动自动过期
}
```

- **力学（本桶的独特点）**：**status 不落库，读时从日期推导**：`endsAt < now → expired`，`startsAt > now → scheduled`，否则 `active`。推导制 = 永远不需要后台任务改状态、diff/undo 永不和「系统写」冲突。过期记录**留在 UI**（Past 分组，置灰，可一键 duplicate 复活），但**永不注入** OTTO。
- **UI**：列表分两组 —— 「Active & upcoming」（日期 pill：`Ends Jul 15` / `Starts Jul 10`）+ 「Past」（默认折叠、置灰）。无 endsAt 的 = 长期优惠，正常 active。
- **OTTO 写**：`saveOffer`（同门，免审批）。「Raya 促销延到 20 号」→ upsert 改 endsAt。
- **OTTO 读**：只注入 active + 7 天内将开始的（标注 upcoming），每条一行含日期和 code。同时 prompt 纪律：*不得在产出里使用过期优惠；优惠必须带自 offer 记录，不得编造折扣。* —— 这直接防「广告里写了个不存在的折扣」这类真实世界事故。
- **对全输出面的价值**：广告与社媒（促销素材主料）、CRM 回复（「现在有什么优惠？」答案永远新鲜）、图片/视频（促销 banner 文案）。

### 2.5 注入总策略（getBrandContextText 重构后的形状）

现状问题（grounding）：`getBrandContextText` 把 take-100 的 memory 行 + BrandKit + BrandRule 拼完后 `slice(0, 3000)` —— **Brand rules 拼在最后，恰恰是最先被截掉的**。改为**分区预算制**，每区独立封顶、rules 最先保住：

| 注入段 | 内容 | 预算（字符） |
|---|---|---|
| Do & don't + BrandRule | 全量 | 600（超出 = UI 提示精简，不静默截断） |
| About + Look & feel + BrandKit | 全量 | 1200 |
| Your customers | active segments，每群一行 | 900 |
| Your offers | active/upcoming，每条一行 | 500 |
| Your products | 摘要 + Top-10 一行/条 | 800 |
| **合计** | | **~4000 ≈ 1k tokens**（现状 3000，微涨） |

注入点不变：`otto-actions.ts` 的 `brandBrain.context`（每 run 一次）。示例输出块（给 Opus 对齐格式用）：

```
Brand rules:
NEVER: ...  ALWAYS: ...

About the brand: ...; ...
Look & feel: ...; ...  Brand kit: Name/Colors/Fonts/Tone

Your customers:
- Young working moms: 25-38, urban; pains: no time; reach: IG Reels; tone: warm, direct

Your offers (active):
- Raya sale — 20% off everything (code RAYA20, ends 2026-07-15)

Your products: 37 total (5 pinned). Top:
- Latte Blend — smooth everyday coffee; RM 49; angle: affordable daily ritual
(use lookupProducts for the rest)
```

---

## 3. 数据模型：三个选项（钱路零接触）

先说不变量：**只动数据/展示层**。冻结 spend 路径全程不碰；三个写 skill 全是 `cost:"free"`；`price` 是展示用字符串，永不进任何计费逻辑。

### 选项对比

| | **A · 复用 Memory 表**（推荐 v1） | **C · 一张通用 BrandRecord 表** | **B · 三张专表** |
|---|---|---|---|
| 做法 | category 当 kind（`product`/`customers`/`offer`），content 存紧凑 JSON（zod 校验后序列化） | `{id, ownerId, brandId, kind, data Json, status, startsAt?, endsAt?, source, updatedAt, deletedAt}` | Product / CustomerSegment / Offer 各一张，字段全类型化 |
| 迁移 | **零**（无 schema 变更） | 1 个 migration | 3 个 migration |
| CRUD/undo | **现有 `*Memory` actions + rebuild spec 的 diffMemory/undo 原样适用** | 新 actions + undo 要扩展 | ×3 套 |
| 日期/状态查询 | 应用层 JSON parse 后过滤（几十~几百行，毫秒级，够用） | 真列可索引 | 真列可索引 |
| 风险 | JSON-in-string（用「唯一写入口 + zod」压住，见 §7） | data 仍是 Json | 无，但最重 |
| 适合 | ≤~200 SKU、先跑通产品形态 | 需要真日期列/大目录 | 接 Shopify/Meta feed 导入时 |

**推荐：A 起步**，理由：本功能的最大不确定性是**产品形态**（分区对不对、字段够不够、创始人用不用），不是查询性能。A 让 rebuild spec 的整套联动机制（快照→diff→高亮→undo）**对结构化记录免费生效**（记录就是 Memory 行，undo = 还原旧 content 字符串）。**毕业触发器**（写死在验收里，防止 A 变成永久债）：单 org 产品 >200 条、或要做 feed 导入、或要按日期做 DB 级查询 → 迁移到 C（一次数据搬运，非重写 —— 前提是下面的封装纪律）。

### A 方案的三条纪律（给 Opus 的实现要求）

1. **唯一写入口**：所有记录读写走 `packages/…/brand-records.ts` 纯函数层（`parseProductRecord` / `serializeOffer` / …，zod 校验）；UI 和 skill 都不许手拼 JSON 字符串。模型输出 → zod → 服务端序列化，**裸 LLM 文本永不直接进 content**。
2. **记录 vs 松散笔记共存**：同一 category 下，content 能被 zod 解析 = 结构化记录（渲染成卡/行）；不能 = 松散笔记（渲染成普通事实行，排在记录下方）。→ 旧数据零迁移（见 §4），聊天里说一句「把我的产品笔记整理成产品条目」就是迁移。
3. **status 推导制**：offer 的过期、product 的展示排序都在读时算，**不写回** —— 保证 OTTO/用户是仅有的两个写者，undo 语义干净。

### OTTO skill 面（全部走 defineOttoSkill 三字段门）

| skill | cost/effect/reach | 审批 | 说明 |
|---|---|---|---|
| `rememberBrandFact`（改） | free/write/internal | 免 | 枚举 → `about \| look \| rules` |
| `saveProduct`（新） | free/write/internal | 免 | upsert by name；archived 同入口 |
| `saveCustomerSegment`（新） | free/write/internal | 免 | 同上 |
| `saveOffer`（新） | free/write/internal | 免 | 同上 |
| `lookupProducts`（新） | free/**read**/internal | 免 | 摘要外按需查询，≤5 条 |

（实现注：也可合并为一个 `saveBrandRecord(kind, data)` 判别联合 —— 少 2 个 tool 槽位，但分开的 per-skill description 对模型引导更准。倾向分开，Opus 可按 tool-budget 实测定，不是创始人决策。）

---

## 4. 和现有 rebuild spec 的关系

| | 内容 |
|---|---|
| **原样保留** | 聊天置顶 + chips；「自动生效 + 可撤销」联动（快照→refetch→diffMemory→高亮+Undo 条）；source 徽章；Analytics 基准排版；BrandKit/BrandRule 不合并；钱路条款 |
| **升级** | 4 分区 → **6 分区**（新增 Your products / Your offers；Your customers 从「松散事实」升级为「segment 卡 + 松散笔记共存」） |
| **改动** | `remember-brand-fact` 枚举：spec 原定 `about\|look\|customers\|rules` → 改为 `about\|look\|rules`（customers 的结构化写走 `saveCustomerSegment`）；`memory-sections.ts` 的 SECTIONS 常量 6 项；diffMemory 不用改（记录仍是 Memory 行） |
| **旧 category 读时映射（更新版）** | `Brand/Voice → about`；`Audience → customers`（显示为客群区松散笔记）；`Products → product`（显示为产品区松散笔记）；`Rules → rules`；未知 → `about`。仍然零破坏性 migration |
| **丢弃** | 无。rebuild spec 没有与本设计冲突的已锁定决策 |
| **researchBrandFromUrl** | v1 不动（还是产 3–6 条事实，category 映射同上）。升级为也抽产品/优惠 = 开放问题 7 |

实施顺序建议：rebuild spec（静态三桶 + 聊天联动）先落地为 Phase 1，本设计的三个集合区为 Phase 2 —— 两者不互相阻塞，但共享 `memory-sections.ts` 的分区常量，先定枚举再动工。

---

## 5. 给创始人的开放问题（每条附默认建议）

1. **存储方案**：A 复用 Memory 表（零迁移，undo 免费生效）/ C 一张通用记录表（真日期列）/ B 三张专表（最重，feed 导入才值）。→ **默认 A**，毕业触发器写进验收（>200 SKU 或 feed 导入时迁 C）。
2. **页面结构**：单页 6 分区（产品/优惠默认只显示前几行 + View all 展开） vs Brand memory 内部分 tabs（Facts / Products / Customers / Offers）。→ **默认单页**（一眼全览 = 文件系统式；产品多了再加 tabs 不迟）。
3. **OTTO 自动写记录**：产品/客群/优惠记录是否沿用事实的「自动生效 + 可撤销」（不逐条确认）？→ **默认是**（与已锁定的决策 2 一致；全部 $0 且可 undo）。
4. **产品要不要存价格**：price 会进广告文案 —— 新鲜时是效率，过期了是真实世界的错价风险。→ **默认要**：display-only 自由文本 + 行上显示「上次更新」+ OTTO 纪律「价格只能来自记录，不确定就不写价格」。
5. **过期 offer 的行为**：到期后静默从 OTTO 上下文剔除 + UI 置灰（安静），还是同时在聊天里提醒你（「Raya 促销昨天到期了」）？→ **默认静默**，主动提醒 = v2。
6. **产品规模假设**：按 ≤200 SKU 设计（摘要 + Top-10 + lookupProducts 兜底），还是第一天就按千级目录 + Shopify/Meta feed 导入设计？→ **默认 ≤200**（你的用户画像是中小商家；feed 导入是清晰的 v2）。
7. **建站研究要不要升级**：researchBrandFromUrl 是否 v1 就升级为「顺手抽出产品和优惠记录」（每次研究多一点 LLM 花费）？→ **默认不升**：先聊天驱动（「把网站上的产品记下来」→ OTTO 用 researchWeb + saveProduct 也能做到），观察用法再决定。

---

## 6. 不做（YAGNI）

- **Shopify / Meta product feed 导入**（明确的 v2；也是 B/C 方案的毕业触发器之一）。
- **Meta feed 全字段对齐**（availability / condition / GTIN / google_product_category …）—— 营销记忆不是商店。
- **产品图片字段接 reference-gen**（把产品参考图自动喂给图像生成）—— 有价值，但等 #84 reference-vision 的用法稳定后再接；v1 连 imageUrl 字段都不加（少一个没人填的框）。
- **向量检索 / RAG / embeddings**：Jasper、Writer 在企业规模才需要（Writer 为此专门建 graph-RAG）；我们 ≤200 SKU 用名称/标签子串匹配绰绰有余。
- **客群与 Meta Audience Insights 自动同步**；**价格货币校验**（display-only 字符串）；**持久化撤销栈**（沿用 rebuild spec 的页内 undo）；**BrandKit/BrandRule 合并**（维持既有决定）。

## 7. 风险 / 坑

| 风险 | 缓解 |
|---|---|
| **错价/过期优惠进已发布的广告**（真实世界伤害，本设计最大风险） | 过期读时剔除；price display-only + updatedAt 可见；OTTO prompt 纪律（价格/折扣只能引记录）；外部发布本就有 SoD 审批门兜底 |
| **JSON-in-string 腐化**（A 方案） | §3 三纪律：唯一写入口 + zod + 服务端序列化；UI 编辑 = 字段表单，永不裸编 JSON |
| **现状 rules 被截断**（拼接顺序在最后，`slice(0,3000)` 先砍它） | 分区预算制修复 —— 这是现状就该修的点，随本设计一并落地 |
| **upsert 撞名/近似重复**（"Latte" vs "Iced Latte" 建成两条） | v1 接受：normalized-name 精确 upsert + UI 列表让创始人肉眼合并；不做模糊匹配（会误合并） |
| **注入格式漂移**：category 现在是 prompt 的 section 头，6 分区改名会瞬间改变所有 run 的 prompt 形状 | 注入格式做 snapshot 测试（纯函数，好测）；改名 = 有意识的决定而不是副作用 |
| **网站研究 → 记忆的注入面**（研究文本变成未来所有 run 的 prompt 内容） | 既有风险、非本设计新增；结构化字段反而比整段 prose 缩小了注入面。记录 source 徽章让来源可见 |
| **松散笔记 vs 记录的判别**（content 以 `{` 开头的用户 prose 误判为记录） | zod 校验不过 = 一律按笔记渲染，fail-open 到更朴素的形态，无数据损失 |

## 8. 参考来源

- Meta 商品目录必填字段（id/title/description/availability/condition/price/link/image_link/brand）：[Meta Product Data Specifications](https://www.facebook.com/business/help/120325381656392)
- Shopify 产品生命周期（ACTIVE/DRAFT/ARCHIVED，归档不删除）：[Shopify ProductStatus](https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus)
- Google Merchant promotions feed（promotion_id / long_title / offer_type / **promotion_effective_dates 必填** / redemption_channel）：[Promotions data specification](https://support.google.com/merchants/answer/2906014)
- Jasper Brand Voice（静态 voice 单例，样文训练）：[Jasper Help — Brand Voice](https://help.jasper.ai/hc/en-us/articles/18618693085339-Brand-Voice)；Jasper IQ 知识层（voice/style/audience/knowledge 分层注入每次生成）：[Jasper 发布稿](https://www.prnewswire.com/news-releases/jasper-launches-the-industrys-first-ai-knowledge-layer-built-specifically-for-marketing-302302233.html)
- Jasper Audiences（客群 = 结构化画像卡，独立于 voice，按 campaign 套用）：[Jasper Help — Audiences](https://help.jasper.ai/hc/en-us/articles/36829917506203-Audiences)、[Introducing Audiences](https://www.jasper.ai/blog/introducing-audiences)
- Writer Knowledge Graph（企业级才上 graph-RAG 检索 —— 佐证我们 v1 不需要 RAG）：[Writer — Knowledge Graph concepts](https://dev.writer.com/home/knowledge-graph-concepts)、[Graph-based RAG](https://writer.com/product/graph-based-rag/)
- CDP 客群建模（画像属性：人口/行为/生命周期；active 客群通常个位数）：[BlueConic — Customer Segmentation](https://www.blueconic.com/resources/customer-segmentation)、[CDP.com — Customer Segmentation](https://cdp.com/glossary/customer-segmentation-definition/)
- Context 工程（目录类数据 = 摘要+指针进 context、全量靠 tool call 按需取）：[Redis — AI Agent Context](https://redis.io/blog/ai-agent-context/)、[Weaviate — Context Engineering](https://weaviate.io/blog/context-engineering)
- 本仓 grounding：`packages/db/prisma/schema.prisma`（Memory/BrandKit/BrandRule）、`apps/web/lib/memory-actions.ts`（getBrandContextText 的拼接与截断）、`apps/web/lib/otto-actions.ts:162`（brandBrain 注入点）、`packages/otto/src/skills/remember-brand-fact.ts`、`packages/otto/src/skills/AGENTS.md`（skill 三字段门）、`docs/superpowers/specs/2026-07-02-brand-memory-rebuild-design.md`
