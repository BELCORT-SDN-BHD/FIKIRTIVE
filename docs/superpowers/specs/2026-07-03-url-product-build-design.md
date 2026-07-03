# B-02 URL 一键建档 —— 设计 spec

> **性质**:P1 广告工厂 Wave 1「冷启动」第一块砖(harmony-03 路线图第一行)。
> **一句话**:贴商品链接 → Otto 抓名称/图/描述 → 建成 Product 档案。工厂的**入料口**。
> **founder 已拍(2026-07-03)**:① 第一块砖 = B-02(不是先盖工厂流水线);② 抓来的图存**远端链接**(MVP,不下载自存)。

## 一、定位与边界

- **不碰钱路**:纯「外部读」+ 现有 $0 内部写。money-guard 冻结文件零改动。
- **不碰资产上传路**:图只存远端 URL,不下载进资产库(升级票 U-B02-1)。
- 复用蓝图第一缝(defineOttoSkill)+ 第四缝(现有 `ctx.research` 端口)+ 现有 Product 数据模型。全流程可 Otto 驱动(宪法 7)。

## 二、成功标准

1. 聊天里「建档这个链接 `<url>`」→ Otto 抓取 → 给出**草稿** → 用户确认/改 → 落库为 `product` BrandRecord。
2. 产品页有「贴链接」入口:粘贴 URL → 预填新建表单 → 保存。
3. MVP 解析覆盖:通用 OG 标签 + JSON-LD `Product` schema(覆盖多数商品页,含 Shopify/WooCommerce)。
4. 草稿**必确认**,绝不静默建档。
5. 抓取失败/端口缺失 → 优雅报错,不崩、不假装成功(宪法「有根据不捏造」)。

## 三、现有地基(建在缝上,不重造)

| 已有 | 位置 | B-02 怎么用 |
|---|---|---|
| `ctx.research.fetchUrl(url)`(G3a 已上线) | `packages/otto/src/context.ts` | 端口已在;fetchUrl 返回清洗文本、**无 og:image**,不动它 —— 在同一端口**加** `fetchProductMeta` |
| `productRecordData`(name/description/price/url/sellingAngle/tags/category/imageAssetId) | `packages/core/src/brand-records.ts` | 加一个零迁移字段 `imageUrl` |
| `saveProduct` skill($0 内部写,upsert by name) | `packages/otto/src/skills/save-product.ts` | 加 `imageUrl` 透传;确认后由它落库 |
| `researchWeb` skill(free/read/external 范本) | `packages/otto/src/skills/research-web.ts` | 照抄它的端口调用 + 优雅降级写法 |
| `ProductShowcase.tsx` | `apps/web/components/otto/memory/` | 渲染时 `imageAssetId` 优先,回退 `imageUrl` |
| `brand-record-actions.ts` | `apps/web/lib/` | 加一个 session-scoped 抓取 action 供 UI 用 |

## 四、设计

### 1. 数据 —— 加零迁移字段 `imageUrl`
- `productRecordData` 加:`imageUrl: z.string().url().max(1024).optional()`。
- 存在 JSON `data` 里,**无 Prisma 迁移**(与 `imageAssetId`/`category` 同法)。
- `ProductShowcase`:有 `imageAssetId` 用之,否则回退 `imageUrl`,都无则现有占位。

### 2. 端口 —— `ctx.research` 加 `fetchProductMeta`
```
fetchProductMeta(url): Promise<{ title?: string; description?: string; imageUrl?: string; price?: string }>
```
- 真实现注入在 web + worker 的 `buildOttoContext`(与现有 `research.fetchUrl` 注入并列)。
- 实现步骤:fetch HTML(复用现有 research fetch transport 的超时/大小上限)→ 解析
  ① OG meta:`og:title` / `og:image` / `og:description` / `product:price:amount`
  ② JSON-LD `Product`:`name` / `image` / `description` / `offers.price(+priceCurrency)`
  ③ 回退:`<title>` / `<meta name=description>`。
- 合并优先级:JSON-LD > OG > 回退。`price` 拼成展示文本(如 `RM 49`);拿不到就不给(绝不编价——宪法「有根据不捏造」)。
- 外部读,**不 gated**,$0。

### 3. Skill —— `draftProductFromUrl`(free / read / external,不 gated)
- 参数:`{ url: z.string().url() }`。
- `execute`:调 `ctx.research.fetchProductMeta(url)` → 返回草稿 `{ name(=title), description, imageUrl, price, url }`。**不写库**。
- 端口缺失或抓取失败 → 返回 `{ error }` 文案(照 `researchWeb` 降级写法)。
- 门控自证:`cost:free + effect:read + reach:external` → `needsApproval = false`(外部**读**不 gated;只有外部**写**才 gated)。
- Otto 行为:拿到草稿 → 呈现给用户 → 用户确认/改 → 调现有 `saveProduct` 落库。

### 4. Skill —— `saveProduct` 加 `imageUrl` 透传
- `params` 加 `imageUrl: z.string().url().max(1024).optional()`,原样进 `upsertBrandRecordFromOtto`。其余不动。

### 5. UI —— 产品页「贴链接」入口(同 PR)
- Products tab 顶加:URL 输入框 + 「抓取」按钮。
- server action `draftProductFromUrl`(`brand-record-actions.ts`,`requireOwner` + session-derived owner,与现有一致)→ 调 `fetchProductMeta` → 返回草稿 → **预填现有产品新建表单** → 用户确认 → 走现有 `saveProduct` action 保存。
- 抓取中/失败有明确态;失败保留手动填。

### 数据流
```
聊天路径:  user「建档 <url>」→ draftProductFromUrl(read $0)→ 草稿 → user 确认 → saveProduct(write $0)→ BrandRecord(product)
UI 路径:    粘贴 URL → action fetchProductMeta → 预填表单 → user 确认 → 同一个 saveProduct 路 → BrandRecord(product)
```

## 五、安全 / 边界

- **money-guard**:每次提交后跑 `git diff main...HEAD --stat` 审冻结文件,必须空。本设计不碰任何冻结文件。
- **SSRF/滥用防护**(实现时落地):`fetchProductMeta` 走 http(s) only + 拒绝私网/环回 IP + 限制 redirect 跳数 + body size cap + 超时。优先复用现有 research transport 已有的防护;若现有 transport 无内网防护,则在本端口实现里补上(plan 阶段核实现状)。
- **抓来的图仅存 URL**(founder 决定,MVP):对方 CDN 防盗链/失效 → 升级票 U-B02-1 重存自资产库。
- **不静默建档**:草稿必经用户确认。
- **不捏造**:抓不到的字段留空,绝不用模型编价格/描述。

## 六、测试(TDD)

- `fetchProductMeta` 解析器单测:纯 OG 页 / 纯 JSON-LD 页 / 两者都缺(回退 `<title>`+`<meta desc>`)/ 无图 / 价格缺失。
- `draftProductFromUrl` skill:端口缺失 → error;抓取抛错 → error;成功 → 草稿字段正确;**门控断言**(needsApproval=false);端口必需 guard。
- `saveProduct`:`imageUrl` 透传落库;`productRecordData` 校验 `imageUrl`(合法/超长/非 URL)。
- `ProductShowcase`:`imageUrl` 回退渲染(有 assetId 时不回退)。
- catalog 重生成(`pnpm --filter @fikirtive/otto run catalog`)后无 diff 遗漏。

## 七、升级票(蓝图纪律 —— 建票即带触发条件)

| 票 | 内容 | 触发条件 |
|---|---|---|
| U-B02-1 | 抓来的图下载自存进资产库(更耐久) | hotlink 失效信号 ≥ 阈值 或 用户抱怨图挂 |
| U-B02-2 | Shopee/Lazada 专用解析(防爬/需官方 API) | 用户贴这两个平台链接的失败率 ≥ 信号线 |
| U-B02-3 | 多商品批量导入(整站目录) | 工厂周产量需求(founder 定阈值) |

## 八、明确不做

- 不改 `fetchUrl` / `researchWeb`(它们被现有研究区用着)。
- 不碰钱路 / 资产上传 / idempotency。
- 不做图片下载自存(U-B02-1)、平台专用解析(U-B02-2)、批量导入(U-B02-3)。

## 九、实现落地顺序(plan 阶段细化)

1. `productRecordData` + `imageUrl`(TDD)+ `ProductShowcase` 回退渲染。
2. `ctx.research.fetchProductMeta` 端口类型 + web/worker 注入 + 解析器(TDD)。
3. `draftProductFromUrl` skill(TDD)+ registry 注册 + catalog。
4. `saveProduct` `imageUrl` 透传。
5. UI「贴链接」入口 + server action。
6. 全量验证扫 + money-guard 审计(空)+ runtime QA + draft PR。
