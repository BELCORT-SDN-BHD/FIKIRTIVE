# P1-01 设计 spec —— 产品 URL 一键建档(B-02)

> **性质**:施工图(第一份 P1 spec)。上位 = 蓝图第六章 P1 + harmony-01(修正见 §0)+ harmony-03 工厂 Wave 1。
> **状态**:founder 已定范围 —— **两层做齐**(免费确定性打底 + 乱页面升级到 LLM)。本稿据此重写,进入 plan → TDD。
> **原则对齐**:双模(人工贴链接 + Otto skill 双入口)· 效率良心(免费先扛,LLM 只在真加质量时 escalate,见 [[efficiency-conscience-meaning]])· **不碰生成 spend-path**(无 genRequest/startGen/fal) · 租户铁幕。
>
> **修正(2026-07-04,#124 money-honesty review)**:**人工面 Layer 2(显式付费 LLM)已撤下**。原设计 UI 标 `$0`,但薄页面会走 `withLlmBudget` 付费调用、且 refId 非 URL 幂等 —— 诚实钱路 UX 违背宪法 2/铁律①。取"安全>效率":人工贴链接改为**确定性-only($0 真成立)**,薄页面少填几格、用户在草稿卡补齐。**Otto 面不变**(本就 `cost:"free"`,由 Otto 自身已计量的 turn 推理补齐)。若日后要人工面 AI 补齐 = 另开独立 PR(诚实 credits 边界 + URL 级幂等 + costing/money-safety 复审 + founder 逐笔批验证)。下文 §2 表"人工面 Layer 2"列、§5 `withLlmBudget` 段、§6"薄页面走 mock"验收项均以本修正为准。

## 0. 侦察修正(动手前的现状核对 —— 已对着 main 代码核实)

harmony-01 把 Product / BrandKit 列为 P1 从零新建 —— **实际 main 上已存在**(#103/#113):
- `BrandRecord`(kind=product)已有字段:**name / description / price / url / sellingAngle / tags / category / imageAssetId**(zod = `@fikirtive/core` `productRecordData`,`packages/core/src/brand-records.ts`)。
  - `price` 是**显示文本**("RM 49"),注释明确"NEVER parsed into any billing/credits logic"。
  - `imageAssetId` 注释明确"**UI-managed(OTTO skills never accept it)**" —— 由 My Stuff 图片选择器管,不是 skill 能写的字段。
- 写入路径已有:Otto `saveProduct` skill + 共享 `upsertBrandRecordFromOtto`(按 nameKey upsert;`packages/otto/src/skills/_brand-record.ts`)。人工面存产品也走同一 upsert。
- 抓取地基已有:`fetchAndExtract` + `MAX_BODY`(`packages/core/src/fetch-extract.ts`,F16;SSRF 硬化、8s 超时、512KB cap)。但它**只返回 stripped text**(`<title>` + 去标签正文)—— JSON-LD 在 `<script>` 里、OG 在 `<meta>` 里,都会被它剥掉,所以本功能需要**原始 HTML**。
- LLM 地基已有:`CoworkTransport` 端口(`packages/core/src/cowork-transport.ts`)—— `mock`(dev 默认,$0,离线)/ `fal` / `modal`,`.chat(skillId, messages, {responseFormat})`。默认 mock 是**钱安全铁律**(stray FAL_KEY 不会静默开真 provider)。计量用 `withLlmBudget({paid})`(`packages/otto/src/meter.ts`),`paid=false` 时**完全不计量**。
- 直接先例:**`researchBrandFromUrl`**(`apps/web/lib/brand-research.ts`)—— 抓 URL → LLM 抽结构化品牌事实 → 返回、**不落库**。和本功能几乎同构,是 web 层 layer-2 的模板。

**结论**:P1 不重建 Product/BrandKit。**唯一真缺口 = 从一个 URL 自动填出 product 记录草稿**。本 spec 只做这一件。(harmony-01 §三对象表将标注更正,另提 doc PR。)

## 1. 用户故事(一句话)

老板贴一个 Shopee/Lazada/官网商品链接 → 系统抓出**名字、价格、描述、卖点**,预填成一张 product 草稿卡,老板确认/微调后保存进 Brand memory。**Otto 也能做同一件事**:"帮我把这个链接加进产品" → 同样抓、同样出草稿给你过目。

## 2. 两层设计(核心 —— founder 定的"做齐")

区别只在:**页面有没有干净的机器标签。** 有 → 免费秒抓;没有 → 才动 LLM。

```
Layer 0  抓原始 HTML(SSRF 安全)
Layer 1  确定性解析($0):①JSON-LD Product(name/offers.price/description/image)
                              ②Open Graph(og:title/og:image/product:price:amount)
                              ③<title> + 首图兜底
   │
   ├─ 字段够齐(至少有 name,且 price/description 命中)     → 完成,不动 LLM(= 不花冤枉钱)
   └─ 字段太薄(乱页面,标签缺失)                          → Layer 2
Layer 2  LLM 补抽(只在薄的时候触发)
```

**两个入口用两种方式实现 Layer 2 —— 但用户拿到的结果等价:**

| 入口 | Layer 1 | Layer 2 | 花钱? |
|---|---|---|---|
| **人工面(My Stuff)** | 共享确定性解析 | **显式 LLM 调用**(brandResearch 模式:`getTransport` + `withLlmBudget` + `mockReply`) | dev=mock=$0;prod 仅在薄页面触发时按 Otto-labor 计量(和 brandResearch 一致) |
| **Otto skill** | 共享确定性解析 | **Otto 自己**读返回的页面文本补齐(它本来就是 LLM)—— 无独立 LLM 调用 | $0(和 `researchWeb` 同理,skill 保持 `cost:"free"`) |

> 为什么人工面要显式 LLM、Otto 面不用:My Stuff 没有环境里的 Otto,薄页面得自己请一次模型;Otto 面则由 agent 本身推理补齐,零额外花费。**双模等价在"产出好草稿"这个结果上成立**,手段不同。

## 3. 范围(v1 做什么 / 不做什么)

**做**:
- **core**(共享、纯/可测):
  - `fetchRawHtml(url)` —— 复用 F16 的 SSRF 护栏 + 超时 + cap,返回 `{ url, html }`(原始 HTML,不剥标签)。与 `fetchAndExtract` 共用同一私有 SSRF-fetch 助手,不改后者公开行为。
  - `extractProductDraft(html, baseUrl)` —— 纯函数,JSON-LD→OG→title 优先级,返回 `{ name?, price?, description?, imageUrl?, sourceUrl, filled: string[] }`(`filled` 记录哪些字段命中,供"薄不薄"判定)。**这是 TDD 的第一块,纯函数最好测。**
- **人工面 web action** `ingestProductFromUrl(url)`(`apps/web/lib`):`requireOwner` → `fetchRawHtml` → `extractProductDraft` → 薄则走 Layer 2(严格照抄 `researchBrandFromUrl`:impersonation spend-block、`withLlmBudget(paid=name!=="mock")`、`mockReply`、JSON 解析兜底)→ 返回**草稿字段**,**不落库**。
- **Otto skill** `ingestProduct`(`packages/otto`,cost:free / effect:read / reach:external → needsApproval=false):经新 ctx 端口 `ctx.productIngest.fromUrl(url)` 拿 `{ draft, text }` → 返回给 Otto。Otto 复述草稿、必要时据 `text` 补齐、问用户确认 → 用户同意 → 现有 `saveProduct`。
- **端口** `ctx.productIngest`:在 web + worker 的 `buildOttoContext` 注入(实现 = `fetchRawHtml` + `extractProductDraft`,原始 HTML 只留在服务端,不下发给 skill)。
- **人工面 UI**:My Stuff 产品区加"从链接添加" —— 粘贴 URL → 预览草稿卡(字段可编辑 + 抓到的图缩略预览)→ 保存走现有 upsert 路径。过设计审(三态 + 丝滑)。
- **Parity Manifest** 登记 `ingestProductFromUrl` ↔ `ingestProduct`。
- **CATALOG 重生成** + 全套测试 + CI 三绿。

**不做(推迟/明确排除,附理由)**:
- ⏭️ **自动把产品图存进图库(`imageAssetId`)** —— `imageAssetId` 现状是"UI-picker 管理、skill 不可写"的字段;自动下载远程图入库会牵动整个 Asset/Generation/storage 子系统,耦合大、风险集中。**v1:草稿只把抓到的 `imageUrl` 当"显示预览"给用户看(不落库);要不要把它收进图库 = 快随的 P1-01b。** 现有的"从图库选图"设 `imageAssetId` 路径不动。(founder 若要 v1 就带自动存图,一句话我加回来,作为最后一个独立 task。)
- ❌ 多商品批量导入(CSV/整店)—— 以后
- ❌ 库存/SKU 同步 —— 不在营销 OS 范围
- ❌ 直接落库不经确认 —— 必须先出草稿给人/Otto 过目(防抓错)

## 4. 走哪些缝(合规检查)

| 缝 | 怎么走 |
|---|---|
| **5 租户模型** | web action 经 `requireOwner`,ownerId 从 session;skill 经 `ctx.orgId`(从验证过的 session,永不取自模型参数)。url 只用于抓取,不进任何 owner 判定。 |
| **9 Parity Manifest** | 新 action `ingestProductFromUrl` 配 skill `ingestProduct`;My Stuff 产品读取配 `lookupProducts`(已存在)。 |
| skill 框架 | `ingestProduct` 走 `skills/AGENTS.md` 五步(端口 → 注入 → skill → registry → 测试 + CATALOG)。 |
| 抓取安全 | 复用 F16 SSRF 护栏(`assertPublicHttpUrlResolved` + `redirect:"error"` + 8s + 512KB),不新写裸 fetch。 |
| LLM 计量 | 人工面 Layer 2 严格照 `researchBrandFromUrl`:`withLlmBudget` reserve→settle,`paid=transport.name!=="mock"`,impersonation 时禁用。 |

## 5. 钱安全边界(动手前钉死)

- **不碰生成 spend-path**:全程无 `genRequest` / `startGen` / `startRefGen` / `dispatchVariantJob` / fal|BytePlus provider 调用。money-safety-review **Step-1 对"生成 spend-path"判 NO → 快速豁免退出**。
- **但**人工面 Layer 2 经 `withLlmBudget`(= reserve/settle 同一 ledger primitive),属 **Otto-labor 计量**,不是生成花费。做法**逐行照抄已审过的 `researchBrandFromUrl`**:同样的 `paid` 判定、同样的 refId、同样的 impersonation 阻断。不发明新的计量姿势。
- **dev 零真花费**:transport 默认 mock → `paid=false` → `withLlmBudget` 完全不计量、不调真模型。TDD 全程 mock,**不触发任何真金调用**(符合 [[ask-before-spending-real-money]])。真 LLM 验证要花钱 → 到那步单独问 founder。

## 6. 验收标准(goal-driven,plan 阶段转成测试)

**Layer 1 纯函数(core,fixture 驱动)**
- [ ] 带 JSON-LD `Product` 的页面 → 正确抽 name/price/description/imageUrl
- [ ] 只有 OG 标签的页面 → 退到 OG 抽取(og:title/og:image/product:price:amount)
- [ ] 什么标记都没有 → name=`<title>`、其余空、`filled` 反映稀薄(不报错)
- [ ] 恶意/超大 HTML 不炸(正则有界;拿的是已 cap 的 body)

**Layer 0 抓取(core)**
- [ ] 内网/非 http(s)/rebinding URL 被 SSRF 护栏拒(复用 `assertPublicHttpUrlResolved` 现有测试)
- [ ] 超 512KB body 被 cap;8s 超时生效

**人工面 web action**
- [ ] 齐页面 → 只走 Layer 1,`transport.chat` **未被调用**(证明"不花冤枉钱")
- [ ] 薄页面 → 触发 Layer 2,dev mock 下 `paid=false`、`withLlmBudget` 不计量
- [ ] impersonation 中 → Layer 2 被阻断(返回提示,不花租户的钱)
- [ ] 返回草稿**不落库**(无 brandRecord.create/update)

**Otto skill**
- [ ] gate:free/read/external、needsApproval=false(`migration.test` 断言)
- [ ] 端口缺失 → 优雅降级(返回 error 文案,不抛)
- [ ] 返回 `{ draft, text }`;**不调 saveProduct**(落库是用户确认后的另一步)

**合规**
- [ ] Parity Manifest 登记 `ingestProductFromUrl` ↔ `ingestProduct`
- [ ] CI 三绿(check/fences + web-build + tests);CATALOG 已重生成

## 7. 给 plan 阶段的拆解建议(TDD 顺序,纯→带 IO→UI)

1. **core Layer 1**:`extractProductDraft(html, baseUrl)` 纯函数 + fixtures(JSON-LD / OG / 裸页各一)—— 红→绿从这里起。
2. **core Layer 0**:`fetchRawHtml(url)`;把 `fetchAndExtract` 里的 SSRF-fetch 抽成私有助手,二者共用(不改 `fetchAndExtract` 公开签名/行为)。
3. **web action** `ingestProductFromUrl`:组装 Layer1 +(薄则)Layer2,照抄 brandResearch 的计量/impersonation/JSON 兜底;测"齐页面不调 LLM""薄页面走 mock""不落库"。
4. **ctx 端口 + 注入**:`ctx.productIngest` 定义(`context.ts`)+ web/worker `buildOttoContext` 注入。
5. **Otto skill** `ingestProduct`(五步)+ registry + gate 测试 + Parity 登记 + CATALOG 重生成。
6. **My Stuff 人工面**:粘贴 → 草稿卡(可编辑 + 图预览)→ 保存。过设计审。

---
**给 founder 的一句话**:第一块砖不是"建产品库"(已建好),是"让贴链接自动建档这件事成立"。两层做齐 —— 齐页面免费秒抓、乱页面才请 AI;dev 全程 mock 零真花费;不碰生成钱路;产品图自动入库这一小块 v1 先只做预览、留作快随(你要带上就说一声)。
