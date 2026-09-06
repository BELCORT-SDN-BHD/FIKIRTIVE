# Harmony 01 —— 全城数据模型和声图

> **性质**:harmony 阶段交付物 1/6(总审查员执笔,基于 WHAT-pass 全部判决)。
> 回答一个问题:**每个区的数据长什么样、怎么互指,才能让"一份数据全城通用 + Otto 全操控 + scale 到 Salesforce 级"同时成立。**
> 本文是设计不是 schema —— 动工时每个对象各出 spec,migration 全部 additive(遵守建筑规范)。

---

## 一、五条数据宪法(从蓝图推导,新对象一体适用)

1. **一份数据,全城引用**:客户(Contact)、活动(Campaign)、资产(Asset)只有一份,各区通过外键引用,禁止任何区自建影子副本。
2. **租户铁幕无新例外**:每个新表带 `ownerId`(无默认值)+ 进 `TENANT_MODELS` 守卫 + 领头 `(ownerId, …, deletedAt)` 索引。
3. **双模在数据层的含义**:没有"Otto 专用表"。Otto 和人读写**同一批对象**,走**同一批 server actions**(宪法第 7 条单一动作层的数据面)。
4. **按终局设计,按阶段落地**:对象形状按 Salesforce 级终局画(红旗三),但每阶段只建当期需要的表和字段,全部 additive。
5. **每个新对象出生即登记**:进 Parity Manifest(读 skill + 写 actions)、进 CATALOG、进本文的对象总表 —— 三处不齐,审查不放行。

---

## 二、现有对象(不动,只列桥接点)

| 现有对象 | 角色 | 和声桥接点 |
|---|---|---|
| Organization / Membership / User | 租户 + 成员 | Membership 扩**席位与角色**(见 §五) |
| Project | **创意工作间**(canvas 的家) | 保持原样;不升格为 Campaign(红旗六) |
| ChatThread / ChatMessage | **Otto 内部对话**(人↔Otto) | 永不与客户对话混用 —— 客户对话是新对象 Conversation |
| GenJob / Generation / Asset | 生成与资产(内容寻址) | Generation 增 `campaignId?`(可空,additive) |
| Entity(CHARACTER/PRODUCT/LOCATION/BRANDMARK) | 视觉实体(@提及) | CHARACTER 升级挂训练身份(§四·C06);与商务对象 Product 互指不合并 |
| Memory(brand memory) | 品牌自由记忆 | 与结构化 BrandKit 并存互补(§四·B01) |
| CreditAccount / CreditLedger | **我们的服务账道** | 不动;通道费走第二账道(§四·钱) |
| MetaConnection / MetaActionExecution | Meta 渠道(范本) | 短期不动;新渠道走通用 ChannelConnection,Meta 日后择机迁入(additive) |
| CanvasNode / RenderJob / CaptionJob / Transcript | 画布与管线 | 不动 |

---

## 三、新对象总表(15 个,按落地阶段排)

> 阶段记号:**P1 创作变现**(工厂/资产/排期先锋)· **P2 消息进场**(WhatsApp/收件箱)· **P3 CRM+Campaign**· **P4 深化**(报表引擎/生命周期/agency)

| # | 对象 | 区 | 阶段 | 一句话 |
|---|---|---|---|---|
| 1 | **Product** | 资产 | P1 | 商务产品档案:名称/价格/URL/图(assetIds)/描述 —— 工厂 C-01"贴链接"的落点,B-02 URL 建档写进这里 |
| 2 | **BrandKit** | 资产 | P1 | 结构化品牌包:logo(assetIds)/色板/字体/语气/语言市场 —— 与自由态 Memory 互补,生成校验(C-08)读它 |
| 3 | **PersonaIdentity** | 资产 | P1 | 训练型人设(C-06):挂在 Entity(CHARACTER) 上的 `trainingRef`(供应商引用/状态/源图),"训练一次永久锁脸" |
| 4 | **ScheduledPost**(+ PostVariant 子行) | 排期 | P1½ | 排期发布单:内容/媒体/多渠道/时区时刻/状态机(DRAFT→NEEDS_APPROVAL→SCHEDULED→PUBLISHING→PUBLISHED/FAILED);每渠道一条 PostVariant 承载逐平台定制(S-04) |
| 5 | **ChannelConnection** | 渠道缝 | P1½ | 通用渠道连接(kind: WHATSAPP/IG/FB/TIKTOK/SHOPEE/…,加密 token,状态)—— **发布可插拔的数据面**;每种渠道一个 adapter 实现同一接口 |
| 6 | **Routine / RoutineRun** | Otto | P1½ | 定时自主任务(O-05):cron+时区/目标 prompt/**范围声明/每次+每月预算上限/kill switch**;Run 记录花费+产出+摘要 —— routine 授权模型的数据面 |
| 7 | **Contact / ContactIdentity** | CRM | P2 | 客户唯一档案 + 多渠道身份(waPhone/igHandle/fbPsid/email…,`(ownerId, channel, externalId)` 唯一)—— **跨渠道合并(M-12)靠 Identity 表,不靠猜** |
| 8 | **Conversation / CustomerMessage** | 客服 | P2 | 客户对话线程(contactId+channelConnectionId+状态+受理人[人或 Otto])与消息(方向/媒体/送达态)—— 与 Otto 的 ChatThread 严格分离 |
| 9 | **KnowledgeDoc** | 客服 | P2 | AI 知识文件(M-13):可读、版本化、按 org —— O-06 护栏的溯源对象("这句答案来自哪份文件") |
| 10 | **ChannelFeeWallet / ChannelFeeLedger** | 钱(第二账道) | P2 | 通道费独立账道(红旗五):MYR 计价、充值/扣费/直传记录 —— **与 CreditLedger 物理分离**,设计详见 harmony-05 |
| 11 | **Campaign** | Campaign | P3 | **独立业务容器**(红旗六):目标/预算/周期/状态机/UTM 基串;艺术品(Generation)、帖(ScheduledPost)、广告(Meta refs)、对话(Conversation)以 `campaignId?` 可空外键归组 —— 加字段不建关联表,additive 且干净 |
| 12 | **Deal / PipelineConfig** | CRM | P3 | SMB-lite 交易:名称/contactId/阶段/金额/币种;pipeline 阶段按 org 可配 —— 看板(R-02)的数据面 |
| 13 | **Segment** | CRM/生命周期 | P3 | 分群:NL→编译成规则 JSON(宪法第 10 条:确定性编译,不靠模型天赋)+ 物化成员表;Campaign/群发/自动化共用 |
| 14 | **ApprovalRequest** | 横切 | P3 | 统一审批原语(kind: SPEND/PUBLISH/AD_LAUNCH/CONTENT;payload hash 绑定 —— 沿用 G7 审批 hash 模式):Otto 卡片审批和团队审批(G-11)是它的两个表面 |
| 15 | **Company** | CRM | P4 | B2B 公司档案(Contact 可选归属)—— respond.io 级不需要,Salesforce 级需要,按红旗三留在深化期 |

---

## 四、关键和声决策(容易做错的六处,先钉死)

**① Campaign 归组用"可空外键",不用关联表。** `Generation.campaignId?`、`ScheduledPost.campaignId?`、`Conversation.campaignId?` —— 一个产物只属于零或一个 campaign。理由:SMB 心智里"这条内容是为 Raya 活动做的"就是单归属;干净、可索引、additive。真到 Salesforce 级多归属需求时再加关联表(additive 不冲突)。

**② Contact 合并靠 Identity 表。** 同一个客户今天从 WhatsApp 来、明天从 IG 来:两条 ContactIdentity 指向一个 Contact。合并动作 = 把 identity 重指 + 留 merge 审计,永不物理删数据。归因(P 区)从 identity 的首触 campaign 记 `firstTouchCampaignId`。

**③ 客户对话与 Otto 对话永不同表。** ChatMessage 已经承载七种卡片和 Otto 状态机,再塞客户消息 = 把两个不同安全域(内部 agent / 外部消费者)焊在一起。Conversation/CustomerMessage 独立,O-06 护栏(试驾场/溯源/转人工)全部长在新对象上。

**④ 审批是一个原语、两个表面。** 数据层一张 ApprovalRequest(带 payload hash,审批后内容漂移即失效 —— G7 已验证的模式);Otto 聊天里的卡片审批和团队审批队列(乙方做甲方批)都写读这张表。这样"谁批了什么"全城一个审计口径。

**⑤ Routine 是授权对象,不是 cron 配置。** Routine 行本身就是"用户签过字的授权书":范围声明 + 预算上限 + kill switch 是**字段**,不是文档约定。RoutineRun 超预算 = 数据库层拒绝(reserve 对 routine 余额),不是代码自觉。

**⑥ Product ≠ Entity(PRODUCT)。** Entity 是"视觉上这是什么"(@提及、参考图);Product 是"商务上卖什么"(价格/URL/库存感)。互指(`Product.entityId?`)不合并 —— 工厂要商务档案,画布要视觉实体,各取所需。

---

## 五、租户内阶级(席位的数据面,红旗二/G-01)

Membership 扩两个维度(additive):
- **seatType**:`CREATOR`(创作席,全功能)/ `APPROVER`(审批席,看+批+评论)—— 计费按 seatType 数(G-01 双档)
- **orgRole**:`owner` / `admin` / `member` —— 权限矩阵(能否管成员/改品牌包/连渠道/设 routine)

审批流(G-11)= ApprovalRequest 上的 approverRole 约束。org 内权限矩阵与市政厅 SECTION_MATRIX 同哲学:**一张可读表,不是散落的 if**。

---

## 六、阶段落地图(和建设节奏对齐)

```
P1  创作变现先锋:Product + BrandKit + PersonaIdentity(工厂三件套)
P1½ 排期+自动化:ScheduledPost + ChannelConnection + Routine
P2  消息进场:Contact/Identity + Conversation/CustomerMessage + KnowledgeDoc + 第二账道
P3  CRM+Campaign:Campaign + Deal + Segment + ApprovalRequest
P4  深化:Company + 报表引擎数据面(读现有全部对象,自身无新表)+ agency 伞层
```

每个阶段的对象各出 spec 走扩建守则;**任何对象提前需要时可以提前建**(比如工厂想给成片挂 campaign,就把 Campaign 提前到 P1½ 的最小版:只有 id/name/status)。
**已知的两个提前**:①ScheduledPost(P1½)的 NEEDS_APPROVAL 状态依赖审批原语 → **ApprovalRequest 最小版(kind=PUBLISH)随排期区提前到 P1½**,不许排期区临时自建第二套审批(§四④);②Campaign 最小版可随工厂提前(上例)。

---

## 七、给审查员的钉子(动工时逐条查)

- [ ] 新表全部满足 §一 数据宪法五条
- [ ] Conversation 域与 ChatMessage 域零交叉(import 级检查)
- [ ] campaignId 外键全部可空 + additive migration
- [ ] Routine 预算护具是字段+DB 约束,不是文档
- [ ] ApprovalRequest 带 payload hash,复用 G7 verifyApproval 模式
- [ ] ContactIdentity 唯一索引 `(ownerId, channel, externalId)`
- [ ] 第二账道与 CreditLedger 零共享表/零共享 finalizer(详见 harmony-05)
