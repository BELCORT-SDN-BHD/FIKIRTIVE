# FIKIRTIVE 定价模型输入数据集(Costing Inputs)— 2026-07-03

> ⚠️ **2026-07-03 状态批注**:本文件是账单核实**之前**的原始输入快照 —— 缺口 #1/#2/#4/#6/#8 已在 costing-model 用真实 BytePlus 账单/官方价闭合(缺口 #3 的 1080p 实测仍开);图按**张**计费 $0.035(非本文的 token 推算);"典型回合 settle 低是 caching 压低"的猜测**已证伪**(repo 未启用 caching,低是因为实际轮次远短于预扣上限)。**一切以 `harmony-04-costing-model.md` 为准**;本文件保留作推导审计线索。

> **性质**:harmony 交付物 4 的输入数据集(只收数字与出处,不做定价决定)。

- 全部数字均来自代码常数、已合并 PR 的实测记录、或 docs/ 内的研究/设计文档,逐条标注 `file:line`。
- **代码里没有、账单上才有的数字一律标「未知」**,集中列在 §4 缺口清单。
- 标注 `【推算】` 的行是把两个已记录的数字相乘/相除得出的参考值,不是账单事实。

---

## ① 我们的成本面(COGS:每个花钱点的公式、数据点、未知项)

### 1a. 图像生成(Seedream 5.0,BytePlus Ark)

| 项 | 数值 | 出处 |
|---|---|---|
| 代码记账成本(record-only) | **$0.04/张**(`GEN_PRICE_USD_PER_IMAGE`) | `packages/core/src/gen.ts:89` |
| ⚠️ 该常数的性质 | fal 时代基数,注释明写「left at 0.04 pending the founder's actual Ark per-image rate」 | `packages/core/src/gen.ts:86-88` |
| 实测 token 消耗 | **16,384 output_tokens / 张(2048²)**,billed 1 张(usage: generated_images=1) | PR #92 评论(付费验证,founder 批准);`docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:27-29` |
| 按预付包价推算成本 | 【推算】16,384 × $3.30/M ≈ **$0.054/张** | token 数见上;$3.30/M 见 1d |
| 审计口径 | F39:image ≈ $0.05(记账 $0.04 反而略低估) | `docs/audit-2026-07-02-full.md:309` |
| 真实 Ark 图像单价 | **未知**(console PAYG 价未读到;若 >$0.10/张 需重估) | 缺口 §4-2;`docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:108` |
| Ark 模型 id | `seedream-5-0-260128` | `packages/generation/src/byteplus.ts:6` |

参考图(refgen)独立同值:`REFGEN_PRICE_USD_PER_IMAGE = 0.04`(`packages/core/src/refgen.ts:39`,同为 fal 基数、同样待 Ark 账单校正)。

### 1b. 视频生成(Seedance 2.0 fast,BytePlus Ark)

| 项 | 数值 | 出处 |
|---|---|---|
| 代码记账成本(record-only) | **$0.03/秒**(720p 5s ≈ $0.15) | `packages/core/src/gen.ts:151`(注释:市场 benchmark 估值,「CONFIRM against the actual Ark invoice」) |
| 实测 token 消耗(普通 gen) | **108,900 tokens / 5s / 720p / 24fps**(t2v 与 i2v token 数相同;墙钟 ≈ 87–92s) | `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:40-42`(真实 API 实测) |
| 扣费系数(deduction) | i2v = ×1.0;t2v ≈ ×1.6("Without Video Input") | 同上 `:54` |
| 按预付包价换算 | 720p i2v = **$0.36**;720p t2v = **$0.58**;1080p i2v ≈ $0.81(est);1080p t2v ≈ $1.29(est) | 同上 `:45-52`(1080p token ≈245,000 为 2.25× 估算,**未实测**) |
| 审计口径 | F39:记账基数与 BytePlus 实价错位(曾记 fal $0.2419/s,本分支已改 $0.03/s 估值)——记账仍非账单事实 | `docs/audit-2026-07-02-full.md:306-313` |
| Ark 模型 id | `dreamina-seedance-2-0-fast-260128` | `packages/generation/src/byteplus.ts:7` |
| 时长上限(护 COGS) | `GEN_VIDEO_SECONDS = 5`;批量上限 `MAX_GEN_COUNT = 4` | `packages/core/src/gen.ts:78, 75` |

### 1c. 整段参考视频生成(reference_video,PR #97)

| 项 | 数值 | 出处 |
|---|---|---|
| 实测 token 消耗 | **324,900 completion_tokens / 一条 5s/720p 参考视频生成**(≈ 普通 gen 的 3 倍;~184s 生成完;task cgt-20260702213559-dbkk5) | PR #97 评论(付费验证,founder 批准) |
| 按预付包价推算 | 【推算】324,900 × $3.30/M ≈ **$1.07**(若 1:1 扣费)— 对比收费 7cr=$0.70 为**倒挂**;PR #97 记录的处置建议:若实际 COGS > $0.70 超 20%,下调 `REF_VIDEO_MAX_SECONDS` 而非涨价 | PR #97 评论;$3.30/M 见 1d |
| 真实成本 | **未知**(取决于 Ark 账单单价 + reference_video 的扣费系数)= F39 数据点 | 缺口 §4-1 |
| 输入视频时长窗(护 COGS) | `REF_VIDEO_MIN_SECONDS = 2` / `REF_VIDEO_MAX_SECONDS = 10`(BytePlus 按输入时长计费,收费却是平价/分辨率) | `packages/core/src/gen.ts:79-83` |

### 1d. BytePlus 预付包经济学

| 项 | 数值 | 出处 |
|---|---|---|
| fast pack | **$33 / 10M tokens = $3.30/M**;90 天过期、不退款、耗尽后转 PAYG | `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:45` |
| 一包容量 | ≈ 90 条 720p i2v(10M ÷ 108,900) | 同上 `:111` |
| PAYG 账单单价 | **未知**(是否 = $3.30/M 未经发票核实) | 缺口 §4-1 |

### 1e. fal 视频模型价目(目前未启用,但常数仍在生效路径上)

`videoRateUsdPerSec`(`packages/core/src/gen.ts:146-165`,注释称「Verified against each model's fal pricing page」)。这些同时是**记账基数**和(对非 flat 模型的)**收费基数**(见 §2):

| 模型 | $/秒(gen.ts 行号) |
|---|---|
| kling(2.5,恒静音) | 0.07(L148) |
| kling-2.6 | 有声 0.14 / 无声 0.07(L149) |
| kling-3 | 有声 0.168 / 无声 0.112(L150) |
| seedance-2-fast | 0.03(L151,BytePlus 估值,见 1b) |
| ltx-2 | 2160p 0.24 / 1440p 0.12 / 其余 0.06(L152) |
| veo3.1-lite | 1080p 0.08/0.05;720p 0.05/0.03(有声/无声,L153) |
| veo3.1-fast | 有声 0.15 / 无声 0.10(L154) |
| veo3.1 | 4k 0.60/0.40;其余 0.40/0.20(L155) |
| pixverse-v6 | 1080p 0.115/0.090;720p 0.060/0.045;540p 0.045/0.035;360p 0.035/0.025(L156-160) |
| grok-imagine | 720p 0.07 / 480p 0.05(另有 $0.002/图输入费未计入,L161) |
| wan-2.5 | 1080p 0.15 / 720p 0.10 / 480p 0.05(L162) |
| hailuo-02 | 0.08(固定 6s@1080p,L163) |
| seedance-2(完整版,token 计价折算) | 1080p 0.682 / 720p 0.3024 / 480p≈0.134(L164) |

当前生产只放行一个图模型 + 一个视频模型:`activeImageModel()="seedream"`(`packages/core/src/model-config.ts:7-9`);`activeVideoModel()` 默认 `veo3.1-lite`、prod 经 `OTTO_DEFAULT_VIDEO_MODEL` 指到 `seedance-2-fast`(`packages/core/src/model-config.ts:11-17`;prod env 值见缺口 §4-5)。其余模型被 `assertSpendableModel` 挡住(`model-config.ts:19-28`)。

### 1f. Otto / LLM(Anthropic)

| 项 | 数值 | 出处 |
|---|---|---|
| 模型 | 主 `claude-sonnet-4-6`,529 过载时同级降级 `claude-sonnet-4-5`(计价仍按 sonnet) | `packages/otto/src/model.ts:16-25` |
| 代码内 token 价目 | Sonnet 4.6:**$3/M in · $15/M out · $0.30/M cached-in**;Opus 4.8:$5/M in · $25/M out · $0.50/M cached-in;未知模型一律按 sonnet(绝不免费) | `packages/core/src/llm-prices.ts:19-22, 24-25` |
| ⚠️ 价目性质 | 硬编码表;cache-write 溢价没有单列,注释称折进 margin(「real tokens + cache-write/overhead + thin margin」) | `packages/core/src/llm-prices.ts:45-48` |
| 每步上限 | context ≤ **12,000 tokens**;output ≤ **1,500 tokens** | `packages/core/src/otto-budget.ts:4-6` |
| 每回合步数上限 | **10 步**(`OTTO_MAX_STEPS`) | `packages/core/src/otto-budget.ts:8` |
| Otto 回合(4 处调用) | maxSteps=10:`apps/web/app/api/otto/stream/route.ts:243`、`apps/web/lib/otto-actions.ts:493,649`、`apps/worker/src/otto-resume.ts:87` | 各行号 |
| 单发 LLM(3 处) | maxSteps=1:cowork 草稿/润色 `apps/web/lib/cowork-actions.ts:97,187`、品牌研究 `apps/web/lib/brand-research.ts:112` | 各行号 |
| Anthropic 实际账单费率 | **未知**(代码表 ≠ 发票;cache-write、batch 折扣等未核) | 缺口 §4-4 |

### 1g. 零成本/平台成本点(记录完整性)

- 抽帧(video-frame)走本地 ffmpeg、Meta 连接器走免费 Graph API——无 per-use COGS。
- cowork planner 在 `paidAllowed=false`(beta 默认)时强制 MockTransport,$0(`packages/core/src/runtime-config.ts:39-51`)。
- 存储 = Cloudflare R2(S3 兼容,`packages/storage/src/index.ts:18,39-56`);存储/出口费**不在代码里**→ 缺口 §4-8。托管 = Railway,同样不在代码里。

---

## ② 我们现有的收费面(常数 + 包)

### 2a. Credit 记账单位

| 常数 | 值 | 出处 |
|---|---|---|
| `CREDITS_PER_USD` | 100(1 internal credit = $0.01) | `packages/core/src/spend.ts:61` |
| `INTERNAL_PER_DISPLAY` | 10(1 显示 credit = 10 internal = **$0.10**) | `packages/core/src/spend.ts:64-65` |
| 上取整规则 | `displayedFromUsd` = ceil 到 $0.10 一档、**最低 1 显示 cr**(绝不为零、绝不少收) | `packages/core/src/spend.ts:67-71` |
| 售价锚 | 基准 **RM0.50/显示 cr**(FX 假设 USD1≈RM4.7;margin 藏在「每次扣几 cr」里,不在 credit 价里) | `docs/superpowers/specs/2026-06-29-monetization-credit-packs-byteplus-design.md:19` |

### 2b. 每次生成扣多少(charge,与 COGS 分离;reserve == settle 恒等)

| 动作 | 扣费 | 出处 |
|---|---|---|
| 图像 | **1 显示 cr / 张**(count × 10 internal) | `packages/core/src/spend.ts:90` |
| 参考图(refgen) | **1 显示 cr / 张** | `packages/core/src/spend.ts:93-95` |
| 视频(seedance-2-fast,flat 计价) | **720p → 7 显示 cr;1080p(及其它)→ 16 显示 cr**,按分辨率平价、与时长无关 | `packages/core/src/spend.ts:75-80, 84-87`(`FLAT_PRICED_VIDEO_MODELS`、`VIDEO_CREDITS_BY_RESOLUTION`) |
| 整段参考视频 | 同上(charge 端不区分是否带 reference_video → 仍 7cr@720p;COGS 却 ≈3×,见 §1c) | `packages/core/src/spend.ts:82-89` |
| 视频(非 flat 的 fal 模型,当前未启用) | `displayedFromUsd(真实 USD 成本)`——**即按成本上取整到 $0.10 收,近乎零 margin** | `packages/core/src/spend.ts:88` |
| 记账冻结 | worker 在提交点冻结 `spentUsd = genSpentUsd(...)`(record-only,报表用) | `packages/core/src/spend.ts:28-39`;`apps/worker/src/jobs/gen.ts:624`(另 302 回填 / 687 失败路径) |

设计文档记录的毛利参照(基于 §1 的估算成本,非发票):图 1cr=$0.10 vs ~$0.04–0.05 ≈ **2–2.5×**;720p 视频 7cr=RM3.50 vs $0.36(i2v)≈ **1.9×**(`docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:62`)。

### 2c. Otto LLM 计费公式(reserve→settle)

实收公式(`actualCostInternal`,`packages/otto/src/meter.ts:64-76`):

```
internal_credits = ceil( [ (input−cached)×inputPerToken
                         + cached×cachedInputPerToken
                         + output×outputPerToken ] × margin × 100 )
```

- **margin = 1.5×** 默认(`OTTO_LLM_MARGIN_DEFAULT = 1.5`,`packages/core/src/llm-prices.ts:49`;可被 `OTTO_LLM_MARGIN` env 覆盖,`llm-prices.ts:53-56`)。
- 预扣(reserve)= 最坏情况:`ceil((12,000×in + 1,500×out)×margin×100) × maxSteps`(`packages/core/src/otto-budget.ts:19-39`;`packages/otto/src/meter.ts:107-114`)。
  - 【推算】sonnet@1.5×:单步 = ceil((12,000×$3e-6 + 1,500×$15e-6)×1.5×100) = **9 internal**;整回合(10 步)预扣 **90 internal = 9 显示 cr**,settle 后退差额。
- 实际典型回合 settle ≈ **0.3–0.5 显示 cr**(prompt-caching 压低,设计文档记录值)(`docs/superpowers/specs/2026-06-29-monetization-credit-packs-byteplus-design.md:28`)。
- fn 抛错全额退款;无 usage 信息则按全额预扣收(`packages/otto/src/meter.ts:116-142`)。

### 2d. 免费额度与包

| 项 | 数值 | 出处 |
|---|---|---|
| 新 org 一次性赠送 | **20 显示 cr**(= 200 internal = $2 名义)(`SIGNUP_GRANT_CREDITS = 20 × INTERNAL_PER_DISPLAY`;幂等 key `signup:<orgId>`;#543 从旧 100 下调为验证后入账的欢迎赠金) | `packages/core/src/spend.ts`;发放点 `apps/web/lib/auth-guard.ts` |
| MYR credit 包(live Stripe) | **Starter RM25 → 50cr(RM0.50/cr)· Standard RM100 → 220cr(RM0.4545/cr,+10%)· Pro RM250 → 600cr(RM0.4167/cr,+20%)** | `docs/superpowers/plans/2026-06-29-monetization-phase1-stripe-packs.md:17,50`;`docs/review/LIVE-SURFACE-2026-07-02.md:102`;`docs/review/DECISION-INVENTORY-2026-07-02.md:126` |
| 包的实现位置 | 包 = Stripe 上带 `metadata.credits` 的 active Price,代码只读不存(改包不用重新部署);**live priceIds 只存在于 Stripe 后台,repo 里没有** | `apps/web/lib/billing-actions.ts:5-30`;缺口 §4-9 |
| 包毛利底线(设计值) | 全图 ≈3×;最差全 1080p 视频 ≈ **1.56×**(基于估算成本) | `docs/superpowers/specs/2026-06-29-monetization-credit-packs-byteplus-design.md:37` |
| 单条完整 campaign 单位经济 | ≈ **16–19 cr ≈ RM8–9.5**(省 ~12 / 话痨 ~30) | 同上 `:41` |
| 历史注意 | 该 spec 的「720p 3cr / 1080p 11cr、图成本 $0.03」是**旧设计值**,已被 phase2 设计(founder 确认 7cr/16cr)和现行代码取代 | spec `:24-26` vs `packages/core/src/spend.ts:80` |

---

## ③ 竞品价位对照表(只收价格点;详情以各研究文档为准)

> 信源 = `docs/research/2026-07-03-*.md`(研究日期 2026-07-03;各文档内已标注未核实项)。汇总全景另见 `docs/research/GRILL-WORKSHEET-2026-07-03.md:203-215`。

| 产品 | 价格阶梯 | credits/用量含量 | 出处 |
|---|---|---|---|
| **Higgsfield** | Free $0;Starter **$15**;Plus **$49**(年付 $39);Ultra **$129**(年付 $99);Business $89/席(年付 $62);另有一来源提到 Basic $5(未核实) | Free ~10cr/天带水印;$15→200cr(部分模型、无 Veo3 系);$49→1,000cr 全模型;$129→3,000cr(可扩 9,000)+365 天 unlimited pass;Business 1,500cr/席共享池;**credits 当月清零**;补充包 ~$5/100cr、90 天过期(未核实);agent 对话也烧 credits、生成前报价须批准 | `docs/research/2026-07-03-higgsfield.md:15-32` |
| **LTX Studio** | Free $0;Lite **$15/月**;Standard **$35/月**;Pro **$125/月**;Enterprise 定制;年付 8 折 | Free 一次性 800cr;Lite 8,000cr/月(**仅个人用途**);Standard 28,000cr/月(**商用授权从这档起**);Pro 110,000cr/月;credits 按输出秒扣、模型越贵扣越多、每模型费率不公开;14 天内用量 ≤1,200cr 可退 | `docs/research/2026-07-03-ltx-studio.md:13-25,133` |
| **Canva** | Free $0;Pro **US$15/月**(US$120/年);Business US$20/人/月;AI Pass **US$100/人/月**;Enterprise 询价(第三方估 $20k–50k/年);**MY 本地价:Pro ≈ RM250/年**(涨价前 RM249.90),支持 FPX/GrabPay | Free 基础 AI(Magic Media 视频**终身 5 个** credit);Pro 约 500 AI credits/月(全 AI 共享一池,视频 credit 每月约 50 个、每段 4 秒);AI Pass 放大 40×(Pro)/20×(Business) | `docs/research/2026-07-03-canva.md:14-21` |
| **respond.io** | Starter **$79/月**;Growth **$159/月**;Advanced **$279/月**(年付基准;月付贵约 20%) | Starter 5 席+无限 MAC 但无自动化/无 AI Agents;Growth 10 席 + 1,000 MAC 起 + AI Agents;MAC 超额 $12/100(Growth)、$15/100(Advanced);加席 $12/$20/$24 每人;AI credits fair-use 内含(如 Growth 5,000 MAC 档含 50,000 AI credits;客服型 1cr/条、销售型 2cr/条);WhatsApp 会话费零加价直传 | `docs/research/2026-07-03-respond-io.md:15-28` |
| **Buffer** | Free $0;Essentials **$5/月/频道**(年付 $60/频道);Team **$10/月/频道**(年付 $120/频道);>10 频道量级折扣(第三方称第 11–25 个约 $3.33/月/频道,未核实) | Free 3 频道、每频道 10 条待发帖;付费墙只卡量不卡能力面;**AI 功能全免费无限**;不数坐席(Team 档无限成员) | `docs/research/2026-07-03-buffer.md:13-19` |
| **GoHighLevel** | Starter **$97/月**;Unlimited **$297/月**;Agency Pro **$497/月**(年付 $970/$2,970/$4,970) | $97 档功能几乎全开(3 sub-accounts、无限 contacts/users);档位卖规模+转售权;通信/AI 按成本价计量(GHL 只在 carrier 费抽 5%),$497 档可加价转售;add-on:AI Employee $50/$97 每月每 sub-account、White Label App $497/月、HIPAA $297/月 | `docs/research/2026-07-03-gohighlevel.md:15-52` |
| **Metricool** | Free $0;Starter 5 brands ≈ **€16–20/月**(年付;月付 $25);10 brands ≈ €29–36;Advanced 15 brands ≈ $53–67、25 ≈ $85、50 ≈ $159–210;Custom(50+ brands、White Label)面谈 | 按 Brand 计价、团队成员免费;AI credits per brand/月:Free 5 / Starter 20 / Advanced 35;X 连接 add-on ~$5/月/账号(未核实);Hashtag Tracker **€25/天/网络** 纯按天买 | `docs/research/2026-07-03-metricool.md:15-26,109` |
| **ManyChat** | Free $0(25 contacts);Essential **$14**;Pro **$29**(500 contacts 起约 $15,随量爬);Business **$69**;Advanced/Elite **$139 起** | 按 active contacts:Essential 250 / Pro 2,500 / Business 7,500 / Advanced 25,000+;**AI 是 $29/月 add-on,任何档不含**;超额 Essential/Pro ~$0.10/contact、Business ~$0.018–0.025;10k contacts+AI 真实月费 ≈ $94–98(含消息费可达 $130–260) | `docs/research/2026-07-03-manychat.md:13-32` |
| **Klaviyo** | Free $0;Email 计划:**$20/月@500 profiles → $30@1k → $60@2.5k → $100@5k → $150@10k → $720@50k → $1,380@100k → ~$2,300@250k**;涨档有 25% 涨幅上限 | 全档功能一样、价格纯随名单涨;Free 250 profiles/500 邮件/150 SMS credits;SMS 包 $15/月 1,250cr 起(美国 ~$0.009/cr,WhatsApp 同池);add-on:Reviews $25/月@250 订单起、Marketing Analytics $100/月起、Advanced KDP $500/月起、Customer Hub $30/月起、Customer Agent 按解决对话数($75/月含 75 次促销 $50;另一来源 $200/月+$0.70/次,互斥未核实) | `docs/research/2026-07-03-klaviyo.md:15-25` |

企业级参照(单行,只记价):HubSpot Free 2 席 / Starter $7–20/席 / Marketing Pro $800/月+$3k onboarding,Breeze Customer Agent **$0.50/解决一次(=50 credits)**(`docs/research/2026-07-03-hubspot-crm-sales.md:177`、`2026-07-03-hubspot-service-ops.md:120`);Salesforce $25→$330/席、Marketing Cloud $1,250–1,500/月起;Adobe GenStudio 无公开价(估年费六位数 USD,未核实)(`docs/research/GRILL-WORKSHEET-2026-07-03.md:210-214`)。

---

## ④ 缺口清单(必须由 founder / 账单提供的数字)

| # | 缺什么 | 为什么挡定价 | 现状/依据 |
|---|---|---|---|
| 1 | **Ark 账单单价($/M token)+ 各场景扣费系数**(普通 t2v/i2v、reference_video 是否 1:1) | 视频与参考视频的真实 COGS 全系于此;PR #97 的 324,900 tokens 只有对上发票才知道 7cr 收费是赚是亏(按 $3.30/M 推算 ≈$1.07 > $0.70 收费) | = 审计 F39;`docs/audit-2026-07-02-full.md:306-313`;PR #97 评论 |
| 2 | **Ark Seedream 图像单价**(PAYG console 价) | `GEN_PRICE_USD_PER_IMAGE=0.04` 仍是 fal 基数;若真实 >$0.10/张,1cr 收费就亏 | `packages/core/src/gen.ts:86-89`;phase2 设计 `:108` |
| 3 | **1080p Seedance 真实 token 数**(现为 2.25× 估算 ≈245,000) | 16cr@1080p 的毛利判断建立在估算上 | phase2 设计 `:109` |
| 4 | **Anthropic 实际账单费率**(cache-write 溢价、实际发票 vs 代码硬编码表) | Otto 1.5× margin 是否真覆盖 cache-write/overhead 只有发票能证 | `packages/core/src/llm-prices.ts:19-22,45-48` |
| 5 | **prod Railway 的 `OTTO_LLM_MARGIN` / `OTTO_DEFAULT_VIDEO_MODEL` 实际值** | 代码默认 margin 1.5、默认视频模型 veo3.1-lite;prod 依赖 env 覆盖,repo 里查不到 | `packages/core/src/llm-prices.ts:53-56`;`model-config.ts:11-17` |
| 6 | **Stripe 手续费率**(MYR 本地卡/FPX 等) | 包毛利(尤其 RM25 小包)未扣支付通道费;代码与文档均未建模 | 无代码出处(缺口) |
| 7 | **USD/MYR 汇率管理**(peg 假设 4.7,包价固定 RM 整数) | credit 引擎 USD 锚定 vs MYR 售价,汇率漂移直接吃 margin;spec 只说「re-check yearly」 | monetization spec `:19,86` |
| 8 | **基础设施成本**(Railway 托管、R2 存储/流量、fal 备用) | 不在任何代码常数里;定价模型的固定成本层为空 | `packages/storage/src/index.ts`(R2);缺口 |
| 9 | **live Stripe priceIds**(3 个包) | repo 无记录,只在 Stripe 后台;改包/对账要先从 dashboard/CLI 恢复 | `apps/web/lib/billing-actions.ts:7-8`;memory `fikirtive-stripe-config` |
| 10 | **BytePlus 预付包燃烧监控口径** | fast pack 90 天过期不退款;spentUsd 记账基数本身待 #1 校正,烧包速度报表因此失真 | phase2 设计 `:45,111`;F39 |

---

*编制:2026-07-03,worktree `claude/blueprint`。所有 file:line 以该 worktree 当前代码为准。*
