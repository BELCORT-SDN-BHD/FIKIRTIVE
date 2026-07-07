# Otto Campaign 策划师设计(C 线)—— 从"查 trend"到"整个 campaign 排好"

> **性质**:C 线冲刺的施工图(华语,宪法 9;docs-only PR,本 PR 无任何代码)。
> **本 spec 待 founder 过目后才动工**(蓝图第五章:图纸先行)。
> **founder 原话(2026-07-07 口述,忠实转录)**:
> "我要的是,完全 otto 去研究现在的 trendy,那些东西,然后给我意见那种,或者直接设计好一整个专业 campaign,跨度可以是长达几个月(或几天),然后基本上用几个小时的时间安排好整个 campaign或更多…还需要 search trend 那些(我记得有一个 saas 也是在做的,就是 search trend auto 看那一个是最好的 video 或 pattern 然后产出这样,很智能这样)"

## 人话对照表(工作规矩②)

| 内部代号 | 人话 |
|---|---|
| Block S | 已上线的"Otto 深度研究"管线(搜索→读页→写报告,#118) |
| 缝 1 / 缝 5 / 缝 8 / 缝 9 | 新技能怎么接 / 新数据表怎么接 / 聊天里新卡片怎么接 / 人工按钮与 Otto 技能对照表 |
| GEN_CARD / PackCard | 生成提案卡(用户批了才花钱)/ 一组提案卡的打包展示 |
| O-10 | "投放效果数据反哺创作"判决(要) |
| routine 四件套 | 预算上限 + 范围声明 + kill switch + 事后摘要(自动化预授权的必配件) |
| 7-3 / 7-7 | 2026-07-07 判决:批量出片必须显示总价确认页 / Otto 花大钱前先复述理解+报价 |

---

## 一、人话概述:这个功能长什么样

用户对 Otto 说:**"帮我策划下个月的 campaign。"** 然后:

1. **Otto 先查 trend**:轮内轻查(现有 researchWeb:搜索+读页,$0 审批、search 按次计量)拿当下热点;需要深挖时走现有深研管线(proposeResearch 研究卡 → 用户批 → 后台跑 → 研究报告),报告带来源引用。
2. **Otto 交出一张「Campaign 提案卡」**(新卡种,$0):主题、目标、跨度(几天到几个月)、节奏,以及 **N 条内容的日历** —— 每条:日期、平台、形式(图/5s/10s 视频)、钩子(hook)、生成 brief(英文,宪法 9)。卡上同时显示**预估生成总价**(credits)。
3. **用户改/批**:改主题、删几条、换日期,或直接批。没选进日历的备选点子落入"想法清单"轻对象(N-Buffer 判决形态:不建 Buffer 式管道,只留一张极轻清单防沉底)。
4. **批准后 Otto 批量干活**:按日历铺生成提案卡 → 走现有生成闸批量出片(打包确认、总价可见)→ 成片经现有 schedulePosts 批量进排期(**只建草稿**,一分钱不花、一条不发)。
5. **用户最终点发**(排期区逐条批),或 —— 第三期 —— 用户建立 routine 预授权后自动发布(四件套齐备)。

**一句话**:研究 → 提案 → 生成 → 排期 → 发布 → 复盘,全链在一个屋檐下,每个花钱/对外动作都过既有的闸。用户花几个小时"过目+点头",不是几个星期"亲手做"。

---

## 二、架构:全部骑现有轨道,不铺新钢轨

本 spec **不新建任何钱原语、不新建队列、不新建发布路径**。新增件只有三个:一个 $0 技能、一个新卡种、一张最薄的容器表。

### 2.1 新 skill:`proposeCampaign`(缝 1,$0)

- 三字段:`cost:"free" / effect:"write" / reach:"internal"` → **不弹审批**(与 propose / proposeResearch / schedulePosts 同姿势)。
- 职责:把策划结果持久化为一张 `CAMPAIGN_CARD`(ChatMessage),并创建/关联一行最薄 Campaign(§2.4)。**只写卡和容器行,不碰生成、不碰排期、不碰钱**。
- `requires` 资讯门:`goal`(这个 campaign 要达成什么)+ `period`(跨度)—— 缺了先问,不瞎编。
- 输入 schema 要点(识别字段由 ctx 提供,模型永远不传 ownerId —— 工厂硬规则):
  `{ title, goal, period:{start,end,tz}, theme, rationale(trend 依据摘要+来源), items:[{date, platform, format:"image"|"video5s"|"video10s", hook, brief(English)}] (≤40), ideas:[…备选,可空] }`
- 登记六处(缝 1 施工配方):`registry.ts` + `registry.test.ts` 钉名单(25→26)+ `migration.test.ts` gate 断言 + `CATALOG.md` 重生成 + `instructions.ts` 何时用它 + **parity manifest(缝 9)**。

### 2.2 新卡种:`CAMPAIGN_CARD`(缝 8 五道缝清单 —— 一处不穿即 F23 死占位)

| # | 缝 | 本卡的施工点 |
|---|---|---|
| 1 | 持久写 | `ChatMessageKind` 加 `CAMPAIGN_CARD`(PG enum,加性 migration,镜像 RESEARCH_CARD 先例);payload 内 server 端铸稳定 id |
| 2 | 重放 | `otto-ui-messages.ts:threadToUiMessages` + `lib/types.ts` kind 联合加项 |
| 3 | 流式注入 | `otto-stream-bridge.ts` tool_output 白名单加 `proposeCampaign`(回 `{cardId}`)+ `TOOL_STEP_LABELS` 叙述条目 |
| 4 | 注入/去重 | `injectCardMessage` 接受新 kind(按 durableId 去重);本卡 $0 无 genJobId,不接 `syncCardJobIds` |
| 5 | 渲染分支 | `OttoChatStream.tsx` 加 CampaignCard 组件分支:日历视图 + 逐条编辑 + 预估总价 + Approve 按钮 |

**卡→钱定律照旧**:卡只是 display+parameters;任何花钱都发生在用户点批之后、由 server 从持久化的卡重算重验(anti-flip),CAMPAIGN_CARD 永远不携带自己的花钱路径。

### 2.3 trend 研究:复用 Block S,零新件

- **轻查**:researchWeb(free/read/external → 不审批;search 计价照判决 **3x**,basic ≈0.3 / advanced ≈0.5 显示 cr/次,随轮计量,消费明细单列 search 类目)。
- **深挖**:proposeResearch → RESEARCH_CARD → 用户批 → reserve 深度档上限 → worker 研究循环 → RESEARCH_REPORT + settle 实扣(全部是 #118 已通电的现役管线)。
- 提案卡的 `rationale` 必须带来源引用(研究报告已有此结构)—— Otto 不捏造 trend。

### 2.4 轻量 Campaign 容器(缝 5)—— 最薄的一行,不升格 project

- **判决边界**:红旗六已拍"独立 Campaign 对象,不升格 project"—— 完全体(预算/编排/归因/UTM/campaign 级报表)仍是 P3。本 spec 只落 harmony-01 §六明文授权的**"Campaign 最小版可随需要提前"**:同一张 `Campaign` 表、最小字段先行,P3 在原表上长成完全体 —— **不另造 CampaignPlan 影子对象**(harmony-01 第一原则:禁止影子副本)。
- 最小字段:`id / ownerId(+organization 关系,进 TENANT_MODELS)/ name / status("DRAFT"|"ACTIVE"|"DONE"|"CANCELLED",code-validated 字符串,house style)/ goal / startAt / endAt / planJson(提案卡快照)/ createdAt / updatedAt / deletedAt`。
- **归组走可空外键**(harmony-01 §四①):`Project.campaignId` **今天已在**(schema.prisma:66 预留软引用);`ScheduledPost.campaignId?` 与 `Generation.campaignId?` 为加性 migration 补上。一个产物只属于零或一个 campaign,不建关联表。
- GM-03(campaign 目标进度条,GM 卷已拍"要")的落点就是这行的 `goal`/`status` —— 字段本 spec 预留,UI 随 P3 完全体,不在本 spec 范围。

### 2.5 生成:走现有 generate 闸,批量 = 打包确认

- 第一期:批准 campaign 卡后,Otto 用现有 **proposePack** 铺 GEN_CARD(≤8/批,分批铺),用户**逐条批**,每条走 generate 七步闸(幂等键 `cowork:<cardId>` once-EVER)。
- 第二期:**打包批** —— 批量确认页显示**总价 + 逐条明细**(判决 7-3 硬性要求,复用 PackCard 模式;判决 7-7 "大单确认页:Otto 花大钱前先复述理解+报价"在此落地)。用户一次确认后,server 侧仍**逐 card 过 generate 闸**(每张卡自己的幂等键;确认页的"一次点头" = 对这批卡的批准,不是绕闸)。
- 价格永远 server 端从卡重算;卡上的预估价只是展示(铁律①:spend 面只显示 credits)。

### 2.6 排期与发布:schedulePosts 原样复用

- 成片(已生成的 Generation)经现有 schedulePosts 进排期:**只建 DRAFT**、单一写权威(ctx.schedule.draft 与人工 createScheduledPost 同一个 server 函数)、每条带 campaignId 归组。
- 发布照旧走排期区既有状态机(DRAFT → 用户批 → SCHEDULED → worker 发布);**本 spec 不碰发布 worker**。
- 渠道边界:schedulePosts 今天只认 instagram|facebook;**X(第一个能真发的渠道)= B 线交付**,其 adapter 落地后本功能的"真发布"自动接通(加渠道 = schedulePosts 的 channel 枚举加一项 + 缝 4 adapter,不改本 spec 任何结构)。

### 2.7 数据流(全链一图)

```
"帮我策划下个月的 campaign"
  → researchWeb 轻查(免批,search 3x 计量)/ proposeResearch 深研(用户批,reserve→settle)
  → proposeCampaign:CAMPAIGN_CARD($0)+ Campaign 最薄行(DRAFT)
  → 用户改/批(卡上编辑)
  → proposePack 铺 GEN_CARD(第一期逐条批;第二期打包总价确认)
  → generate 闸 × N(reserve→settle,幂等键各卡独立)
  → schedulePosts 草稿 × N(campaignId 归组,$0,不发布)
  → 用户点发(排期区)∥ 第三期:routine 预授权自动发(四件套)
  → 复盘:O-10 效果数据喂下一期提案(第三期)
```

---

## 三、审批经济学(宪法第 4 条逐段对账)

`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`,两类明示例外照旧:

| 环节 | 三字段 | 审批? | 备注 |
|---|---|---|---|
| trend 轻查(researchWeb) | free/read/external | **免批**(外部读不闸) | search 费随轮计量(例外①:余额即闸),3x 判决 |
| 深研(proposeResearch→执行) | 卡 $0;执行 spend | 研究卡用户点批 = 审批 | 现役管线,reserve 上限 settle 实扣 |
| Campaign 提案卡(proposeCampaign) | free/write/internal | **免批**,$0 | 只写卡+容器行 |
| 生成(generate × N) | spend | **必批**:第一期逐条;第二期打包总价确认页(7-3/7-7) | 每卡幂等键,重复点击不双扣 |
| 排期草稿(schedulePosts) | free/write/internal | 免批,$0 | 只建 DRAFT,发布另有闸 |
| 发布 | write/external | **必批**(用户逐条点发) | 排期区既有状态机 |
| 自动发布(第三期) | write/external | **routine 预授权**(例外②):审批发生在 routine 创建时 | 四件套缺一不可:预算上限/范围声明/kill switch/事后摘要(P1½-3 的字段级约束,不是文档) |

---

## 四、对标:founder 记得的那家 SaaS,以及我们怎么赢

**结论先行:founder 记得的最可能是 Kalodata**(TikTok Shop 数据分析,SEA 卖家圈 2025-26 铺天盖地的教程/联盟推广;"search trend → 看哪条视频最能卖 → 照着产出"就是它的原话级卖点)。其次可能是 Virlo.ai(描述几乎逐字吻合,但营销面向欧美创作者圈)。

| 家 | 实际做什么 | 定价 | 实与虚 |
|---|---|---|---|
| **Kalodata + Kaloclip** | 爬 TikTok Shop 数据,按**真实成交额**(不是播放量)排出最能卖的视频/达人/商品;导出爆款脚本 + AI 改写;新品 Kaloclip 从商品链接/脚本直接合成带货视频(英/印尼/泰语,支持批量)。kalodata.com;clip.kalowave.com | Starter ~$45.9/月,Pro ~$99-110/月,7 天试用;Kaloclip 另按 credits 收 | GMV 归因数据是真护城河;"AI 深谙 TikTok 电商"是包装 —— 分析与生成是两个松散拼接的产品,**到渲染出文件为止:无排期、无发布、无效果回路** |
| **Virlo.ai** | 每天扫 ~150 万条短视频(TikTok/Reels/Shorts + Meta 广告库),outlier 检测抓"远超账号基线"的爆款;由 trend 生成脚本→9:16 成片;号称能排期发布到 TikTok/IG/YouTube。virlo.ai/features | Starter $49/月(2,000 credits),Pro $199/月(12,000 credits) | 趋势/outlier 检测确实强;生成套件新且弱(评测:走量可以,替代工作流不行);三家里唯一名义上闭环到发布,**但发布后的效果不反哺下一轮生成** |
| **TikTok Symphony** | TikTok 官方 AI 套件:Assistant(趋势研究,Creative Center 实时数据)+ Creative Studio(文/图→视频、数字人、30+ 语配音)+ Symphony Agent(用 top 广告数据+趋势+品牌目标自动攒广告)。ads.tiktok.com/business | 免费(赚你的广告费) | 数据源三家最好但只有 TikTok;"agent"名不副实 —— 产出只进 Ads Manager,无 organic 跨平台,成片 AI 味明显 |

(已排除:Foreplay 到 AI brief/分镜给人类团队为止;AdCreative.ai 生成为主、竞对侦察浅;Opus Clip/Vidyo 只会剪你自己的素材;TrendTok/Trendpop/Minea 只展示趋势,不产出。)

**我们赢在哪(三家共同的空白)**:
1. **全链一屋檐**:他们全是"研究→生成"的单资产反应式循环;研究→提案→生成→排期→发布→复盘(O-10)在 FIKIRTIVE 是同一份数据、同一个 Otto。Kalodata 到文件为止,Symphony 只进 TikTok 广告,Virlo 发了不回头。
2. **品牌记忆**:三家每次生成都从模板+prompt 冷启动;Otto 带 6-tab 品牌知识库 + 产品档案,提案卡天生"懂这家店"。
3. **跨月编排**:三家全是"今天抓 trend 今天出一条";「Campaign 提案卡」给的是数天到数月的叙事节奏和日历 —— remember→plan→publish→learn 仍是无主之地。
4. **审批经济学**:批量出片有总价确认、失败自动退款、明细可查(铁律③)—— 对手的 credits 都是黑盒。

**不抄什么**:不抄 Kalodata 的爬虫型第三方 GMV 数据业务(合规敞口 + 我们不是分析工具;O-10 用**自家真实投放数据**反哺,更干净);不抄 Virlo 的 credits 大礼包定价(宪法 5:毛利地板 + 永禁 unlimited);不抄"agent"营销话术盖住半自动的做法 —— Otto 的自动化边界(哪步免批哪步必批)如实告诉用户(铁律③状态诚实)。

---

## 五、分期与验收

> 依赖总览:**第一/二期零外部依赖**(草稿与生成全可用);"真发布"依赖 **B 线 X 发布**(第一个能真发的渠道)或 Meta App Review 到钥匙;第三期依赖 P1½-3 Routine 模型(方向已拍,spec 另过 founder)。

### 第一期 —— 提案卡 + 手动逐条批(最小可卖)
- 交付:proposeCampaign skill(六处登记)+ CAMPAIGN_CARD(五道缝全穿)+ Campaign 最薄行(缝 5 全套:TENANT_MODELS、requireOwner、2-org 隔离测试)+ ScheduledPost/Generation 补 campaignId 可空外键(加性 migration)。
- 流程:研究(现有)→ 提案卡 → 用户批 → proposePack 分批铺卡 → **逐条批生成** → schedulePosts 草稿。
- 验收:①对话"帮我策划下个月的 campaign"→ 流式 UI 出活卡(非死占位,F23 反例);②卡上改/删条目后批准,铺出的 GEN_CARD 与日历一致;③生成后排期区三视图可见 N 条 DRAFT 且带 campaign 归组;④`pnpm lint:parity` 绿 + registry.test 钉 26 名单 + catalog 重生成;⑤全程真实花费为 0 的 e2e(mock provider)。

### 第二期 —— 打包批 + 批量生成排期(7-3/7-7 落地)
- 交付:批量确认页(总价+逐条明细,PackCard 模式)+ 批准后 server 循环过 generate 闸 + 批量 schedulePosts;新增 server action 出生即登记 parity manifest(缝 9)。
- 验收:①确认页总价 = 逐条 server 重算之和;②一次点头批 N 条,重复提交/双击零双扣(每卡幂等键测试);③任一条失败自动退该条、其余不受累(状态诚实);④**money-safety-review 过闸**(碰批量 spend 路径)。

### 第三期 —— routine 化 + 效果反哺(O-10)
- 交付:campaign 挂 routine("每月 1 号研究 trend → 出下月提案卡"或全自动直至发布);四件套 = 字段 + DB 约束(随 P1½-3);O-10 反哺 = 提案卡的 rationale 增加"上期表现"节(读现有 per-ad performance / analytics 面)。
- 验收:①超预算 RoutineRun 被 DB 层拒绝;②kill switch 即时生效;③每次 run 后事后摘要卡;④下一期提案卡引用上期真实数据(可点开对账);⑤routine 细化 spec 依蓝图第六章明文**另过 founder**。

---

## 六、costing 概算与毛利口径

**本 spec 零新收费点** —— 全部复用既有费率,不触发"新收费点 costing 先行"闸。若未来要做"campaign 一口价打包 SKU"(A4 族),届时 costing 先行(宪法 5),不在本 spec。

| 环节 | 费率(既有,config 层) | 毛利 |
|---|---|---|
| Otto 策划对话 | 实耗 × 2.0(均值 ≈0.6 显示 cr/轮) | 50% |
| search | 3x(basic ≈0.3 / advanced ≈0.5 显示 cr/次) | ~67% |
| 深研 | 深度档 reserve 上限,settle 实扣(Block S 既定) | 同 Otto 劳动口径 |
| 图 / 5s / 10s 视频 | 1 / 8 / 14 显示 cr | 65% / 51% / 45% |

**用户侧一单概算(显示 credits;策划劳务 = 研究+对话轮,区间取决于深研档与来回轮数)**:

| 规模 | 内容构成(示例) | 生成 | 策划劳务概算 | 一单合计 |
|---|---|---|---|---|
| 一周小 campaign | 6 图 + 1×5s | 14cr | ~5-15cr | **~20-30cr(≈$2-3)** |
| 一月中 campaign | 12 图 + 6×5s + 2×10s | 88cr | ~10-30cr | **~100-120cr(≈$10-12)** |
| 三月大 campaign | 60 图 + 24×5s + 6×10s | 336cr | ~20-50cr | **~360-390cr(≈$36-39)** |

- 毛利口径:每一项都在宪法 ≥45% 地板之上(生成 45-65%、劳动 50%、search 67%);campaign 策划把**高 margin 的 Otto 劳动 + 批量生成**捆进同一单 —— 正是"利润主场 = Otto"的定价哲学落点。
- 效率良心条款适用:策划轮受益于引擎升级(prompt caching / 分域装载,P0.5);提案卡一次成型、避免反复重述上下文,属于"省用户钱"的结构设计,不是收入优化。
- 数字全部进 config 层,本表只是概算口径;劳务区间上量后用 /admin/cost 真实均值回填。

---

## 七、明确不在本 spec 范围

- Campaign 完全体(预算/归因/UTM/campaign 级报表)= P3(红旗六判决原样);本 spec 只用最薄行 + 可空外键归组。
- 发布 worker、渠道 adapter(X = B 线;Meta 实发布等 App Review)。
- Routine 数据模型本体(P1½-3,另 spec 另批)。
- 批量变体矩阵(A2)/ Hook 生成器(A1)= 工厂线交付;本功能只消费它们成熟后的能力,不重复建。
- 一口价打包 SKU(A4 族)—— 若做,costing 先行。

---

**结尾:本 spec 为 C 线图纸,待 founder 过目后动工。** 第一期不碰钱路结构(生成仍走唯一的 generate 闸),第二期起 money-safety-review 全程随行。
