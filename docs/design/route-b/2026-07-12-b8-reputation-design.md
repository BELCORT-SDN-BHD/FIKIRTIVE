# B8 · 口碑经济（评价 + 转介绍 + 忠诚）—— 设计全图

> **性质**：路线乙 B8 块设计工位交付物（docs-only，非 spec、非 schema、非代码）。epoch `claude-20260712-03` 工单 L4c·第二波。华语（宪法 9）；本 PR 无任何产品代码。
> **基线**：main@`1b1414d9`（含 B0 发布契约 #240）。矩阵签署件为界：`docs/ops/route-b/matrix/08-B8.md` 行 B0-63~B0-67。
> **定位（缺失大陆第 2 名）**：老带新转介绍 + 会员积分/等级忠诚 + 评价经营，是复购「第二笔钱」；**零新平台 API，纯已有地基延伸**（`MISSING-CONTINENTS:53`）。城里 65 个原型页 + 候选表全域关键词零命中——**本域是零原型大陆**（§三如实标）。
> **模板地位**：本文是第二波工位之一，沿用两个试产工位（CRM/Campaign）定型的模板 v1.1（§〇 + 13 节）。范本注解以「模板注」标出。
> **第一违宪陷阱**：「评价×奖励」合体流 = 宪法 8 v2.11 二裁**永久不做**（Google 明令禁止激励换评价）。请评线与奖励线必须**结构性分离**——数据层、UI 层、Otto 话术层三处都不许把「留评」与「给奖」耦合（§一排除、§六机器闸、§五话术律）。
> **不写已退役的本地 Route-B 台账**：状态与证据写入对应 current GitHub task/PR，不在本文件复制 current truth。

## 人话对照表（内部代号必带人话——工作规矩②）

| 代号 | 人话 |
|---|---|
| 合体流 / gating | 「留好评就给奖励」的合体按钮（宪法 8 禁）/ review gating = 只挑满意客户请评、劝阻差评（Google 硬禁） |
| 请评线 ⊥ 奖励线 | 请评（催评价）与奖励（积分/转介绍奖）两条业务线**永久分离**，各自都做、永不在同一动作/字段/消息里耦合 |
| 官方评价链接 | 平台（Google/Shopee/Lazada）后台生成的那条「来给我评价」链接；平台**没有**代发催评的 API，只能我方自建触达去分享它 |
| 请评触达 | 成交后用 WhatsApp/短信把官方评价链接发给顾客（是「触达」，必过 B7 同意/频控） |
| AI 回评 | Otto 用商家品牌语气起草「回复一条评价」（差评公关 / 好评致谢），人批准后回到平台 |
| 信任凭证 | 把好评转成对外可展示的星级/证言卡（轻量展示，非可嵌 JS widget） |
| Referral | 转介绍关系（谁介绍了谁）+ 奖励发放追踪（发多少、发了没） |
| VoucherToken | L0 六原语之一（`E5-06`）：一个优惠码 token，顾客在**商家自己的**结账页核销，钱在商家账户结算 |
| EasyStore 积分只读 | 忠诚积分数值**只读镜像**自 EasyStore（B6 B0-42），FIKIRTIVE 永不代管、永不自建积分账本 |
| 缝 1/3/4/5/7/8/9 | 九条扩展缝（§十）= Otto 技能 / 记账花钱 / 渠道连接器 / 租户 ownerId / 界面设计系统 / 卡片五道缝 / 人机对等清单 |
| 审批公式 | `needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`（宪法 4），两类例外：余额即闸、routine 预授权 |
| 六态 | B0 契约六级状态 `spec-ready→code-complete→sandbox-verified→review-submitted→live-verified→release-certified`（+ 第 0 级 `listed`） |
| Birdeye 三把锁 | 全量触达无情感预检 / 奖励永不挂评价 / 反 gating 入商家条款（`GRILL-VERDICTS:237` 借鉴书） |
| SleekFlow 安全网 | 发前额度预检 / 掉档弹横幅 / 天数化降速剧本（`GRILL-VERDICTS:237`；触达失败态标准答案） |

---

## 〇、spec 底钉出处（第一交付点 —— 含「曾判不要待复核」正面处理）

**本域无独立 spec 底稿**（不同于 Campaign 有 2026-07-08 施工图）。口碑经济是「缺整域全线零落点」的缺失大陆，其 spec 底 = 一组分散的判决/研究原文。逐条钉出处 + 时效核对：

| spec 底源 | 文件:行 | 内容 | 本图落点 |
|---|---|---|---|
| 缺失大陆第 2 名全节 | `docs/research/MISSING-CONTINENTS-2026-07-10.md:51-66` | 商家第一性工作 7 条 + 龙头清单 + 承接论证 + 诚实栏 | §一范围、§二锚、§五承接 |
| 矩阵签署件 B0-63~67 | `docs/ops/route-b/matrix/08-B8.md:19-23` | 五能力行 + 批准来源 + 宪法 8 分离闸 | §一映射 |
| 宪法 8「合体流永久不做」 | `docs/BLUEPRINT.md:75` | 请评与奖励两线永久分离（Google 禁激励换评价） | §一排除、§六机器闸 |
| 边界四层表 | `docs/BLUEPRINT.md:47-48` | 请评/推荐/复购与唤回=本体负责；积分等经营事实=**只读**、永不代管永不自建账本 | §六积分边界、§七💰 |
| Birdeye 三把锁 + 差异化候选 | `docs/research/GRILL-VERDICTS-2026-07-03.md:237` | 全量触达无情感预检/奖励永不挂评价/反 gating；质量分驱动自动爬坡调度器=Otto 独门 | §五话术律、§九 C 档 |
| 平台真相 C3（一键请评） | `docs/research/PLATFORM-TRUTH-2026-07-10.md:216-219` | 三平台全无「催评」API；须自建触达分享官方链接；AI 回评可行；禁 review gating | §一排除、§三、§十一 |
| 主计划 §二签认 | `docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:48` | 「口碑内置『请评×奖励永久分离』」+ 设计后加体量过目 | §一、§九 |

### 〇.1 「请评+AI 回评窄候选·曾判不要-成本性待复核」—— 正面处理（本节第一交付点）

`MISSING-CONTINENTS:66` 明写：城里唯一相关物是「一条被主动砍窄的『请评+AI 回评』窄候选（还是『曾判不要-成本性』待复核状态）」。**钉出处 + 给结论**：

**出处（两处，逐字）**：
1. **原始判词**：`docs/research/2026-07-03-klaviyo.md:161`——「Reviews（请评/展示/AI 情感）| **存疑 / 建议不要**（整套）；其中『AI 回复评价』可归自动回复区 | 完整 Reviews 需**站内 widget + 订单量计费引擎，重**；但『自动回复 Google/Shopee 评价』是 SEA SMB 的真实痛点，**轻得多**。」
2. **候选台账**：`docs/northstar/WHATPASS-V2-CANDIDATES.md:254`——「Reviews 轻量版（自动请求评价+AI 回复评价）| Klaviyo Reviews | 好评能提升信任度，但完整套件（站内 widget+按订单量计费）对 SMB 过重 | **先做『下单后自动请评+AI 起草评价回复』，不做完整站内展示套件** | 判词栏：**曾判不要-成本性（完整套件排除，轻量子集转正候选）**。」

**结论：这条「曾判不要」不挡 B0-63，反而正是它的批准来源。** 依据三条：
1. **判词是分层的，不是一刀切**：「建议不要」明确**只针对完整 Reviews 套件**（站内可嵌 widget + syndication + 按订单量计费引擎）——被排除的是那套**重**基建。同一判词把**轻量子集**（下单后自动请评 + AI 起草回评）标为「**转正候选**」。B0-63（成交后请评流程）+ B0-64 的 AI 回评 = 正是这个被转正的轻量子集，**不在排除范围内**。
2. **待复核状态已被后续判决闭合**：（a）平台真相 C3（07-10）已完成「成本性/可行性」复核——请评只做自建触达分享官方链接（无重计费引擎），AI 回评可行；（b）矩阵签署件（07-12）已把 B0-63/64 **签为 in-scope**（批准来源=缺失大陆第 2 名 + 宪法 8）。按任务纪律「冲突以矩阵为准」，**矩阵 supersede 候选台账的 limbo 状态**。
3. **成本性排除的那半边，本图照样明示排除**（§一）：**完整站内评价展示 widget 套件 + 按订单量计费引擎**——本图的 B0-65（好评转信任凭证）做**轻量对外展示**（星级/证言卡，可分享到 link-in-bio/社媒），**不做可嵌 JS widget、不按订单量计费**。成本性判词在这半边仍然生效并被遵守。

**一句话**：曾判不要的是「重」，转正的是「轻」；B0-63/64/65 全部落在「轻」侧，与判词**一致不冲突**。§一排除清单把「重」侧钉死，闭合此条。

### 〇.2 时效核对结论

klaviyo 判词成于 2026-07-03（WHAT-pass 批次），平台真相 07-10 复核，矩阵 07-12 签署。三者**无实质冲突**：07-03 划「轻/重」界，07-10 钉平台可行性，07-12 签署轻量子集入册。宪法 8 v2.11（07-10 二裁）新增「合体流永久不做」是**加约束**（分离铁律），与「做轻量请评」不矛盾——请评做、奖励做、只是**永不合体**。本图采此三源合流口径。

---

## 一、范围与矩阵行映射（含明示排除 + 页内剥离清单）

### 1.1 本设计覆盖的能力行（矩阵签署件 `08-B8.md`）

| 功能ID | 能力（人话） | 批准来源 | 本文档落点 | 子域 |
|---|---|---|---|---|
| B0-63 | 成交后请评流程（**与奖励永久分离**） | 缺失大陆第 2 名工作 1；宪法 8 v2.11 分离铁律 | §3 评价经营台 + §5 请评触达 + §6 表 A + §7 触达闸 | 评价 |
| B0-64 | 多平台评价统一监控 + 差评预警（含站内评分经营） | 缺失大陆第 2 名工作 2 + 第 3 名工作 4 | §3 监控台 + §4 六态 + §6 表 B | 评价 |
| B0-65 | 好评转信任凭证（星级/证言对外展示） | 缺失大陆第 2 名工作 3 | §3 凭证页 + §6 表 C | 评价 |
| B0-66 | 转介绍 referral 奖励 + 追踪（谁介绍谁/发多少奖） | 缺失大陆第 2 名工作 4；宪法边界表「推荐」 | §3 转介绍页 + §6 表 D + §7💰判定 | 奖励 |
| B0-67 | 会员积分/等级忠诚计划〔积分只读部分与 B6 EasyStore 衔接〕 | 缺失大陆第 2 名工作 5；宪法边界表「复购与唤回」 | §3 忠诚页 + §6 表 E + §11 EasyStore 只读 | 奖励 |

**一句话总纲**：三条子域，**结构性两分**——
- **评价线（B0-63/64/65）**：请评触达 → 多平台监控/差评预警 → AI 回评（差评公关/好评致谢）→ 好评转凭证。**全程无奖励**（宪法 8）。
- **奖励线（B0-66/67）**：转介绍老带新（谁介绍谁 + 发奖追踪）+ 会员积分/等级忠诚（积分只读镜像自 EasyStore）。**全程不碰请评**（宪法 8）。
两线共享的只是**同一个客户对象**（CRM 的 Contact，§十一）与**同一个 Otto 品牌记忆**（起草语气），**绝不共享「留评↔给奖」的耦合字段/按钮/话术**。

### 1.2 接口面（本设计只画边界，不建对方的楼）

| 邻块 | 接口行 | 边界（谁写谁读见 §6） |
|---|---|---|
| **B6** 回执 + EasyStore 只读 | B0-42（EasyStore 订单/顾客/交易/**积分**只读 + webhook 不保证送达→reconciliation）；B0-41（回执脊柱：成交 BusinessEvent） | 忠诚积分**只读镜像**自 B6，永不代管；「成交后请评」的**成交时机**读 B6 的 Receipt/BusinessEvent |
| **B5** WhatsApp 收件箱 | B0-31（真对话通道）；B0-37（售前对话）；B0-36（Comment-to-DM 公开评论收件箱） | 请评触达 = 用 B5 的 WhatsApp 通道**发官方评价链接**；差评→可经 B5 Comment-to-DM 承接 |
| **B2** 量测 L0 + 分析 | B0-09（口碑/转介绍/忠诚效果衡量归 B2；状态与证据写对应 GitHub task/PR）；E5-06（六原语含 VoucherToken/AttributionEvent/SourceTag） | 口碑动作**写** AttributionEvent（喂 B2）；效果**数值**在 B2 读/算，不在 B8 自算；转介绍奖励载体**复用 VoucherToken**（L0 原语） |
| **B7** 唤回 + 生命周期 | B0-44（同意 opt-in/opt-out）；B0-45（抑制名单=运行时硬约束）；B0-46（频控）；B0-43（会员积分到期→唤回 broadcast） | **请评也是触达**：ReviewRequest 发前**读** B7 consent + 抑制 + 频控；忠诚积分到期的**唤回本体归 B7**（B8 只提供忠诚对象与到期信号） |

### 1.3 明示排除（范围外，写清出处）

| 排除项 | 出处 | 处置 |
|---|---|---|
| **「评价×奖励」合体流** | 宪法 8 v2.11（`BLUEPRINT.md:75`）；矩阵 B0-63/B0-66 闸列 | **永久不做**。请评线与奖励线数据/UI/话术三层分离（§六机器闸）。这是本域第一违宪陷阱。 |
| **完整站内评价展示 widget 套件 + 按订单量计费引擎** | `2026-07-03-klaviyo.md:161`「成本性建议不要」；`WHATPASS:254`「完整套件排除」 | **不做**。B0-65 好评凭证只做**轻量对外展示**（星级/证言卡，分享到 link-in-bio/社媒），非可嵌 JS widget、非按订单量计费。见 §〇.1 结论 3。 |
| **Review gating（只挑满意客户请评/劝阻差评/店内施压）** | `PLATFORM-TRUTH:114/219`（Google 硬禁，违规下架评价+挂警示牌）；Birdeye 三把锁「反 gating」 | **不做**。请评**全量无情感预检**——请评逻辑里不许有「先判满意度再决定发不发」（§五话术律、§六 ReviewRequest 无 satisfaction 门）。 |
| **平台原生「一键催评/邀评」** | `PLATFORM-TRUTH:108/174/216`（Google/Shopee/Lazada 全无催评 API） | **不宣称**。请评只做**我方自建触达**（WhatsApp/短信/邮件）去分享官方评价链接；文案不许说「平台原生请评」。 |
| **口碑/转介绍/忠诚的效果数值衡量**（新客数/NPS/复购率） | 矩阵 B0-09（归 B2；状态与证据写对应 GitHub task/PR）；缺失大陆第 2 名工作 7 | **归 B2**。B8 只**写** AttributionEvent（口碑动作事件），不自算 NPS/复购率。 |
| **会员唤回 broadcast 本体** | 矩阵 B0-43（归 B7）；边界表「复购与唤回」 | **归 B7**。B8 定义忠诚对象 + 积分到期信号；「积分到期→发唤回」的触达编排归 B7 唤回。 |
| **GBP 请评/回评薄试** | 矩阵 B0-75（归并行泳道薄试；请评/奖励三隔离）；主计划「GBP 归并行泳道」 | **不在本工位**。GBP 有独立 API 申请窗口 + 独立三隔离，另行薄试。 |
| **代持/代发 referral 现金奖金池** | 宪法 8「代持商家资金永久不做」；边界表永久不做 | **永久不做**。转介绍发奖 FIKIRTIVE 永不经手资金，只追踪 + 生成 token / 只读积分（§七💰判定）。 |

### 1.4 页内剥离清单（零原型域的诚实版）

> **模板注**：CRM/Campaign 两个试产工位的「页内剥离」是把 A′ endgame 全图的多余卡剥回各家。**本域没有这个动作**——因为本域**零原型**（§三详述）。为诚实兑现模板此栏，逐条列「有无可剥」：

| 潜在复用面 | 是否存在原型 | 处置 |
|---|---|---|
| 评价/请评/回评面 | **无**（A′ immersive 全域零命中；仅 `schedule/share-preview` 因 "review" 词根偶中，与评价无关） | 无可剥；从对标反推新建（§三） |
| 转介绍面 | **无** | 无可剥；新建 |
| 忠诚/积分面 | **无** | 无可剥；新建 |
| 忠诚积分**只读字段**若出现在 CRM 档案页 | 未来接线态（非本域原型） | **非剥离，是接线**（§十一）：积分只读镜像可在 CRM Contact 档案页展示一行，但**对象归属仍在 B8 忠诚表**，CRM 只读链回。此为 §十一接线，非页内剥离。 |

---

## 二、对标锚清单（spec-ready 硬门 —— 无锚不开工）

> **锚的作用**：升级 `spec-ready` 的证据之一。本域**零原型**，对标锚是唯一的形态来源（§三从锚反推）。每锚四件套：**对象+版本 / 关键旅程 / 通过阈值 / 并排打分法**。
> **诚实标注**：下表版本为本工位知识截止的**近似值**；**spec 冻结当日必须实机复核版本号 + 抓真截图**（列入 §8 假设台账 H-08）。不假装现在抓了图。

### 2.1 锚一：Birdeye / Podium（**评价管理基准**，B0-63/64/65）

- **对象+版本**：Birdeye Reputation + Podium Reviews（多渠道声誉管理，2025-26 版；复核项 H-08）。
- **关键旅程（三条）**：
  1. **请评**：成交后自动/一键把评价邀请发给顾客（我方口径：分享官方评价链接，**全量无 gating**）。
  2. **统一监控 + 差评预警**：Google/FB/Shopee/Lazada 多平台评价汇一屏，新差评第一时间告警。
  3. **回评**：一屏内逐条回复评价（我方胜负手：Otto 用品牌语气起草差评公关/好评致谢）。
- **通过阈值（评价子域=平齐即可）**：三旅程功能齐 + **合规硬线全过**（无 gating、无「原生催评」虚假宣称、AI 回评前拿授权）+ 双 100%（Otto 能替做）。
- **我们要赢在哪**：Otto + 品牌记忆天生是**评价回复引擎**（`MISSING-CONTINENTS:66`）——差评公关/好评致谢用商家自己的语气，正中核心能力；对手回评靠模板或人工。
- **并排打分法**：见 2.5。胜负手维 = 「回评质感（品牌语气）」；诚实败点候选 = 站内展示深度（我方轻量，不做可嵌 widget）。

### 2.2 锚二：ReferralCandy / Talkable（**转介绍基准**，B0-66）

- **对象+版本**：ReferralCandy + Talkable（老带新推荐引擎，2025-26 版；复核项 H-08）。
- **关键旅程（三条）**：
  1. **设计奖励**：店主设「介绍成功给推荐人 X、给新客 Y」的奖励结构。
  2. **追踪归因**：谁介绍了谁、介绍链是否成交、该发多少奖（who→whom→converted→owed）。
  3. **发奖**：奖励发放（我方口径：**只读积分镜像 / 生成 VoucherToken / 商家手工**——FIKIRTIVE 永不经手资金，§七）。
- **通过阈值**：介绍关系可追踪 + 奖励发放**不碰 FIKIRTIVE 资金账道**（宪法 8）+ 与请评**结构性隔离**（Referral 表无 review 外键）。
- **我们要赢在哪**：转介绍是「自动化 + CRM 的活」，城里**分群打标 / broadcast+送达追踪 / 勿扰合规全部现成**（`MISSING-CONTINENTS:66`），接上「谁介绍了谁/积分累计」追踪就能跑；对手是独立 app，我方在**同一屋檐**下与 CRM/唤回连通。
- **并排打分法**：胜负手维 = 「与 CRM 客户对象打通（推荐人=Contact）」；诚实败点候选 = 病毒系数/多层裂变分析（我方 A 档不做，C 档候选）。

### 2.3 锚三：Smile.io / LoyaltyLion（**忠诚基准**，B0-67）

- **对象+版本**：Smile.io + LoyaltyLion（积分/等级/VIP 忠诚计划，2025-26 版；复核项 H-08）。
- **关键旅程（三条）**：
  1. **积分累积**：顾客消费累积积分（我方口径：**只读镜像自 EasyStore**，B8 不自建积分账本）。
  2. **等级/VIP**：按累计消费/积分分等级（我方口径：tier 规则在 B8，积分数值只读）。
  3. **积分兑换/到期唤回**：积分到期前提醒回购（**唤回本体归 B7**，B8 提供到期信号）。
- **通过阈值**：积分展示**只读边界干净**（永不代管/永不自建账本，宪法边界表）+ 忠诚对象与 CRM Contact 打通 + 到期信号能喂 B7 唤回。
- **我们要赢在哪**：忠诚 + 唤回是「复购/唤回」边界内的「第二笔钱」；我方 broadcast + 送达追踪 + 勿扰合规现成，接上积分累计就能跑。
- **诚实分级**：忠诚子域证据弱（§八 H-01）——**渗透率无马来西亚硬数据**（`MISSING-CONTINENTS:133`），故忠诚建议**起步做薄**（只读积分展示 + 简单 tier），深度留 founder 体量过目。

### 2.4 锚四（SEA 本地）：Avocado Loyalty（**马来西亚本地忠诚基准**，B0-67）

- **对象+版本**：Avocado Loyalty（东南亚/马来西亚本地忠诚方案，2025-26 版；复核项 H-08）。
- **关键旅程**：本地商家（餐饮/零售）的积分卡 + WhatsApp 触达 + 简单等级。
- **通过阈值**：**本地语境对齐**（WhatsApp-first、马来西亚商家常见形态）；作为「不脱离本地」的下限校准，防止照抄欧美 Smile.io 的重形态。
- **诚实分级**：本地锚主要用于**校准起步深度**（别做太重），非功能全量对标。版本/形态 spec 当日实机复核（H-08）。

### 2.5 并排截图打分法（水准判官统一配方 —— 复用 CRM 试产配方）

1. **抓图规则**：同视口（桌面 1280×800 + 移动 390）、同旅程**终态**（非空态）、对手真账号真数据 vs 我方 staging 真数据。每条关键旅程一对图，命名 `anchor-<锚>-<旅程>-{them,us}.png`，作为 exact-head 附件/链接写入对应 GitHub task/PR。
2. **五维打分（每维 0/1/2，满分 10）**：功能完整度 / 信息密度得当（对齐 Analytics 屏 gold standard）/ 零学习曲线（宪法 11）/ 视觉质感（Apple 标杆 + coral 只属 Otto）/ 双模覆盖（Otto 能否 100% 代做）。
3. **判级**：平齐 = 功能维 ≥ 对手且质感维 ≥ 我方基准；超过 = 平齐 + 至少一维严格高于对手（胜负手：品牌语气回评 / 与 CRM 打通）；未及 = 任一维 < 对手 → **进待裁清单**（发生了什么/试了什么/差距/2-3 选项）。
4. **门槛**：起步上市要求四锚各自「关键旅程」达**平齐**（忠诚锚因证据弱，起步平齐门槛可由 founder 体量过目下调）；「超过」加分不设门槛；「未及」必须显式登记待裁（终验第⑫节）。

---

## 三、信息架构与页面清单（零原型域 —— 从对标反推，给理由）

> **零原型如实写**：A′ immersive `northstar-immersive/` 全 18 区**无任何口碑相关面**（grep `review/referral/loyalt/reputation/testimonial/nps/rating/points/reward` 仅 `schedule/share-preview` 因词根偶中，与评价无关）。**本域页面清单从 §二对标锚反推**，非从原型做减法。反推逻辑：每子域取对标的核心旅程 → 落一个人工入口页 → 起步只做该旅程的最小闭环。

| # | 页面（人工入口路由） | 从哪个锚反推 | 承载能力行 | 起步深度（§九初判） |
|---|---|---|---|---|
| 1 | `reputation/reviews` 评价经营台 | Birdeye/Podium 请评+监控+回评 | B0-63 + B0-64 | A 档：请评触达 + 单平台监控 + AI 起草回评 |
| 2 | `reputation/testimonials` 信任凭证 | Birdeye 好评展示（轻量） | B0-65 | B 档：好评→星级/证言卡对外分享 |
| 3 | `reputation/referrals` 转介绍 | ReferralCandy/Talkable | B0-66 | A 档：奖励设计 + who→whom 追踪 + token/手工发奖 |
| 4 | `reputation/loyalty` 忠诚 | Smile.io/LoyaltyLion + Avocado | B0-67 | A 档：EasyStore 积分只读展示 + 简单 tier |

### 3.1 页面一 · 评价经营台（`reputation/reviews`）

**信息架构（A 档最小版，自上而下）**：
- 页头：标题 + CRM/口碑区内导航。
- **Otto 洞察条**（本页唯一 coral 触点）：一句人话（例「有一条 2 星评价 3 小时未回，我起草了一版回复，看看？」）。
- **请评区（B0-63）**：成交后待请评的顾客列表（成交时机读 B6 回执，§十一）→「发官方评价链接」按钮（触达走 B5，过 B7 同意/频控）。**全量列出，无满意度预筛**（反 gating）。
- **监控区（B0-64）**：多平台评价流（起步单平台，见 §十二 Q2）+ 星级/来源 + 差评预警徽章 +「Otto 起草回复」入口。
- **回评动作**：每条评价 → Otto 起草（差评公关/好评致谢）→ 人批准 → 回到平台（AI 回评，需平台授权）。

**明示不做**：站内可嵌评价 widget、按订单量计费引擎（§一排除）；请评前的满意度门（宪法/Google 禁）。

### 3.2 页面二 · 信任凭证（`reputation/testimonials`）

**信息架构**：从监控到的评价里，选高分好评 → 生成对外可展示的**星级/证言卡**（轻量）→ 分享到 link-in-bio 微站（B0-73，跨块）/ 社媒帖 / WhatsApp Status。**非可嵌 JS widget**（§一排除，成本性判词）。

### 3.3 页面三 · 转介绍（`reputation/referrals`）

**信息架构**：
- **奖励设计区**：店主设「推荐人得 X、新客得 Y」结构（奖励载体 = 只读积分 / VoucherToken / 手工，§七）。**此区无任何「留评得奖」选项**（宪法 8）。
- **追踪区**：介绍关系表（推荐人 Contact → 新客 Contact → 是否成交 → 应发奖/已发奖）。Otto 读「这个月谁带来最多新客」。
- **发奖动作**：生成 VoucherToken（顾客在商家结账核销）/ 反映 EasyStore 积分 / 标记手工已发。**FIKIRTIVE 不经手资金**。

### 3.4 页面四 · 忠诚（`reputation/loyalty`）

**信息架构**：
- **会员列表**：忠诚会员（= CRM Contact 的子视图）+ 积分（**只读镜像自 EasyStore**）+ 等级。
- **等级规则区**：tier 定义（按累计消费/积分，确定性规则）。**积分数值只读，B8 不写积分账本**。
- **到期信号**：积分即将到期的会员 → 一个信号，**交接 B7 唤回**（B8 不发唤回 broadcast）。

---

## 四、每表面六态（happy / empty / loading / denied / failure / retry + 移动端）

> 六态是 `sandbox-verified` 的证据 + 终验第⑥节全旅程证据。逐表面列，宁写「无」不留空。denied 标准答案 = requireOwner + 不泄露存在性；failure 标准答案 = 局部降级 + 显式重试。

### 4.1 评价经营台（`reputation/reviews`）

| 态 | 表现 |
|---|---|
| happy | 请评列表有待请评顾客；监控区有评价流；差评预警徽章；Otto 洞察条一句人话。 |
| empty | 全新商家：请评区「成交后这里会列出可以请评的顾客——先接上 WhatsApp 与回执」；监控区「还没连评价来源」+ 连接引导。**空态即教学**（宪法 11）。 |
| loading | 骨架屏；监控区评价流骨架；不闪空态再填。 |
| denied | 非本租户/未登录 → requireOwner 拦截回登录；跨租户读一字节=事故（宪法 6）。评价台不对 Otto 冒充态开放外发（回评=external write=审批）。 |
| failure | **平台监控 API 拉取失败 → 局部降级**：该平台卡显「暂时读不到 <平台> 的评价 · 上次同步 <时间>」+ 重试；**不整页崩**，请评区不受累。请评触达失败见 §5.1 SleekFlow 安全网。 |
| retry | 局部重试各源独立；请评触达重试**幂等**（同顾客同官方链接短期内不重复发，避免骚扰=频控叠加 B7）。 |
| 移动端 | 单列；请评/监控分 tab；Otto 洞察条常驻顶部；回评起草全屏 sheet（涉外发，精确卡）。 |

### 4.2 信任凭证（`reputation/testimonials`）

| 态 | 表现 |
|---|---|
| happy | 好评候选 + 已生成证言卡预览 + 分享入口。 |
| empty | 无好评可转：「还没有高分评价——先在评价台经营口碑，好评会流到这里」。 |
| loading | 卡骨架。 |
| denied | requireOwner；非本租户凭证 → 「Not found」（不泄露存在性）。 |
| failure | 生成证言卡失败 → 局部错误 + 重试；已选评价不丢。 |
| retry | 重试幂等（同评价不重复建卡）。 |
| 移动端 | 证言卡纵向堆叠；分享 sheet（分享=发布=审批，§7）。 |

### 4.3 转介绍（`reputation/referrals`）

| 态 | 表现 |
|---|---|
| happy | 奖励结构已设 + 介绍关系流 + 应发/已发奖状态。 |
| empty | 未设奖励：「设计一个『老带新』奖励，追踪谁介绍了谁」引导；**无「留评得奖」诱导**（宪法 8）。 |
| loading | 列表骨架。 |
| denied | requireOwner；跨租户介绍关系不可见。 |
| failure | 生成 VoucherToken 失败 → 局部错误 + 重试；追踪数据不丢；**发奖幂等**（同一 referral 不重复发 token，业务幂等非钱幂等，§7）。 |
| retry | 重试幂等。 |
| 移动端 | 关系流单列；发奖动作精确卡（涉真实价值发放，虽 FIKIRTIVE 不经手，仍全屏确认）。 |

### 4.4 忠诚（`reputation/loyalty`）

| 态 | 表现 |
|---|---|
| happy | 会员列表 + 积分（只读）+ 等级 + 到期信号。 |
| empty | 未连 EasyStore：「连上 EasyStore 后，会员积分会自动出现在这里（只读）」。 |
| loading | 列表骨架；积分数字骨架（避免 0→真数跳变）。 |
| denied | requireOwner。 |
| failure | **EasyStore 积分拉取失败/webhook 未送达 → 局部降级 + reconciliation 提示**（`06-B6.md` B0-42：webhook 不保证送达）：显「积分数据可能滞后 · 上次对账 <时间>」+ 重新对账；**不假装积分为 0**（错误的积分比没有更危险）。 |
| retry | 重新对账幂等。 |
| 移动端 | 会员卡纵向；积分/等级两行；到期信号徽章。 |

> **模板注**：本域 failure 态有两处特殊——（a）评价监控/EasyStore 积分是**外部只读源**，失败标准答案是「局部降级 + 显式『上次同步/对账时间』+ 重试」，**禁止把读不到当成 0/空**；（b）请评/发奖是**触达/价值动作**，失败要走 SleekFlow 安全网（§5.1），不静默。

---

## 五、人工 / Otto 双执行矩阵（宪法 7 双 100% —— Otto 品牌记忆代写回评 = 本域核心卖点）

> 每能力一行：人工路径 + Otto 话术例（设置/异常/取消）。数据面走**同一批 server actions**。**核心卖点**：Otto 用品牌记忆代写**差评公关 / 好评致谢**（`MISSING-CONTINENTS:66`「Otto + 品牌记忆天生就是评价回复引擎」）。

| 能力 | 人工路径 | Otto 话术例（设置 / 异常 / 取消） |
|---|---|---|
| **请评触达**（B0-63） | 评价台请评区 → 选顾客 →「发官方评价链接」（via WhatsApp） | 设置：「给这周成交的顾客请评」→ Otto 起草请评话术、**全量列出无满意度预筛**（反 gating）、回「12 位可请评（其中 3 位被频控/勿扰挡下），发吗？」→ 人批准。异常（无官方链接）：「你还没连 <平台> 的评价链接，先连？」。取消：不发。**Otto 永不在请评话术里挂奖励**（宪法 8，§5 律）。 |
| **差评公关回复**（B0-64，核心卖点） | 回评动作 → 编辑 → 回平台 | 设置：「这条 2 星说等太久，帮我回」→ Otto **用品牌语气**起草致歉+补救话术、回草稿请人批。异常（涉退款承诺）：Otto 标「这条我提到了补偿，你确认要承诺吗？」不擅自许诺。取消：不回。**回=external write=审批闸**（§7）；需平台授权代客户回复。 |
| **好评致谢**（B0-64，核心卖点） | 回评动作 → 编辑 → 回平台 | 设置：「5 星好评帮我谢一下」→ Otto 用品牌语气起草感谢。取消：不回。 |
| **差评预警**（B0-64） | 监控区差评徽章 | 「有差评告诉我」→ Otto 主动「刚有一条 2 星（<平台>），建议 <N> 小时内回，我起草了一版」（洞察条，$0 读）。 |
| **好评转凭证**（B0-65） | 凭证页选好评 → 生成证言卡 | 「把这条好评做成可以放主页的证言」→ Otto 挑高分评、生成星级/证言卡。**分享=发布=审批**（§7）。取消：不建。 |
| **转介绍奖励设计**（B0-66） | 转介绍页设奖励结构 | 「设一个老带新：介绍人得 RM10 券、新客得 RM5」→ Otto 落奖励结构（载体=VoucherToken/只读积分/手工）、回「这样设对吗？」**Otto 不提供『留评得奖』选项**（宪法 8）。取消：不设。 |
| **转介绍追踪 / 发奖**（B0-66） | 追踪区看关系 / 发奖动作 | 「这个月谁带来最多新客」→ Otto 读关系回一句人话（$0 读）。发奖：「给达标的推荐人发券」→ Otto 生成 VoucherToken / 反映 EasyStore 积分，**FIKIRTIVE 不经手资金**（§7）。异常（已发过）：命中业务幂等→「这几位上次已发，跳过」。 |
| **忠诚积分/等级查看**（B0-67） | 忠诚页 | 「Siti 有多少积分、什么等级」→ Otto 读 EasyStore 只读镜像回一句人话（**永不代管**）。 |
| **忠诚到期唤回**（B0-67→B7 交接） | 忠诚页到期信号 → 交接 B7 | 「快到期的会员帮我起草唤回」→ Otto 用品牌记忆**起草**、**只起草不发**（发=B7 唤回 broadcast，external write=审批）。取消：丢草稿。 |

> **宪法 8 话术律（本域铁律）**：任何 Otto 请评话术**永不携带奖励诱导**；任何 Otto 奖励话术**永不以「留好评」为发奖条件**。两线在话术层结构性隔离——这是 Google review-gating 禁令在 Otto 侧的落地（Birdeye 三把锁「奖励永不挂评价」）。
> **双模缺口债**：每条 Otto 列若起步未实现，登记 `missing(debt-nn)` 挂 `parity-debt.md`，B8 验收=债清零。新 Otto 能力=缝 1 skill（§10）。

---

## 六、数据契约需求单（喂 B2 数据契约 spec —— 字段级跨块契约只写这节）

> **原则**：本域「缺整域全线零落点」，五表**是新对象**（非 harmony-01 既有），但**不凭空发明**——每表字段来自 §二对标 + 矩阵行 + 宪法边界。全部 additive migration；租户铁幕：每表带 `ownerId`（无默认）+ 进 `TENANT_MODELS` 守卫 + 领头 `(ownerId, …, deletedAt)` 索引（缝 5）。
> **本节唯一职责**：字段级「谁写谁读」跨块契约。页面级复用叙述在 §十一，不在此重复。

### 6.1 需要的表 / 字段（起步 A 档）

**表 A · ReviewRequest**（请评线 —— **无任何奖励字段**，宪法 8 结构隔离）：

| 字段 | 类型 | 说明 / 出处 |
|---|---|---|
| `id` / `ownerId` | id | 租户领头键 |
| `contactId` | fk | 指向 CRM Contact（§十一） |
| `platform` | enum(`google`/`shopee`/`lazada`/`fb`…) | 请哪个平台的评价 |
| `officialLinkRef` | text | 商家后台生成的官方评价链接引用（**非平台催评 API**，`PLATFORM-TRUTH:108`） |
| `channel` | enum(`whatsapp`/`sms`/`email`) | 触达通道（起步 whatsapp，走 B5） |
| `status` | enum(`pending`/`sent`/`suppressed`/`failed`) | `suppressed`=被 B7 同意/抑制/频控挡下 |
| `triggeredByEventId` | fk? | 成交事件引用（读 B6 回执，§十一）——「成交后」的锚点 |
| `sentAt` / `createdAt` / `deletedAt` | ts | 软删 |
| **禁止字段** | — | **无 `rewardId` / `incentive` / `satisfactionScore`**——请评不挂奖励（宪法 8）、不做满意度预筛（反 gating）。此「禁止清单」是机器闸（§6.5）。 |

**表 B · ReviewItem**（监控只读镜像 + 回评状态）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `platform` / `externalReviewId` | enum / text | 平台 + 平台内评价 ID |
| `rating` | int | 星级（差评预警输入） |
| `body` | text | 评价正文（**只读镜像**自平台，B8 不改评价本体） |
| `replyStatus` | enum(`none`/`drafted`/`replied`) | 回评状态 |
| `replyBody` | text? | Otto 起草/已回的回复（回=external write，§7） |
| `capturedAt` / `createdAt` | ts | 采集时间（failure 态显「上次同步」） |
| **唯一索引** | — | `(ownerId, platform, externalReviewId)`——防重复镜像 |

**表 C · Testimonial**（好评转凭证，轻量）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `reviewItemId` | fk | 来源好评 |
| `displayText` / `starRating` | text / int | 对外展示内容 |
| `createdAt` / `deletedAt` | ts | **无 widget embed 字段**（§一排除，成本性） |

**表 D · Referral**（奖励线 —— **无任何 review 字段**，宪法 8 结构隔离）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `referrerContactId` / `refereeContactId` | fk | 推荐人 / 新客（均指向 CRM Contact，§十一） |
| `status` | enum(`invited`/`converted`/`rewarded`) | 介绍→成交→已发奖 |
| `convertedEventId` | fk? | 成交事件（读 B6 回执验证真成交） |
| `rewardKind` | enum(`easystore_points`/`voucher_token`/`manual`) | 发奖载体（**三者全不经 FIKIRTIVE 资金**，§7） |
| `rewardVoucherTokenId` | fk? | 若发券 → 指向 L0 VoucherToken（E5-06，复用 B2 原语） |
| `rewardIssuedAt` / `createdAt` / `deletedAt` | ts | |
| **禁止字段** | — | **无 `reviewRequestId` / `reviewItemId`**——发奖永不以留评为条件（宪法 8）。机器闸（§6.5）。 |

**表 E · LoyaltyMember**（忠诚对象 —— 积分只读镜像）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `contactId` | fk | 指向 CRM Contact |
| `pointsBalance` | int | **只读镜像自 EasyStore**（B6 B0-42）；B8 **永不自建积分账本**、永不代管（宪法边界表 `BLUEPRINT.md:48`） |
| `tier` | enum/text | 等级（**tier 规则在 B8，积分数值只读来自 EasyStore**） |
| `pointsSyncedAt` | ts | 上次对账（failure 态显示；webhook 不保证送达→reconciliation） |
| `pointsExpireAt` | ts? | 到期信号（**交接 B7 唤回**，B8 不发 broadcast） |
| `createdAt` / `deletedAt` | ts | |

**（配套）LoyaltyTier 规则**（可 JSONB 内联 or 小表）：确定性等级规则（累计消费/积分门槛→等级），宪法 10 确定性，不模型猜。

### 6.2 事件写入（口碑动作写什么 AttributionEvent —— B2 直接消费）

> B8 是**写方**，B2（B0-09）是**读方+算方**（新客数/NPS/复购率）。格式化到 B2 能直接消费：复用 E5-06 的 AttributionEvent（不新建事件表）。

| 触发动作 | 写 AttributionEvent | kind | 归属 |
|---|---|---|---|
| 请评发出 | `kind=review_requested` + platform + channel | 评价线 | B8 写，B2 读 |
| 监控到新评价 | `kind=review_received` + rating | 评价线 | B8 写，B2 读 |
| 回评发出 | `kind=review_replied` | 评价线 | B8 写，B2 读 |
| 介绍成交 | `kind=referral_converted` + referrerContactId | 奖励线 | B8 写，B2 读（算「带来多少新客」） |
| 发奖 | `kind=referral_rewarded` + rewardKind | 奖励线 | B8 写，B2 读 |
| 忠诚兑换/到期 | `kind=loyalty_redeemed` / `loyalty_expiring` | 奖励线 | B8 写（积分数值只读自 EasyStore），B2 读（复购率） |

> **给 B2 的一句话**：B8 只**写**口碑动作事件（上表），效果**数值**（NPS/复购率/新客数）由 B2 B0-09 从这些事件 + 回执 + 归因**自算**，B8 不自算。事件格式对齐 E5-06 AttributionEvent 现形，B2 无需为 B8 建新消费逻辑。

### 6.3 EasyStore 积分只读边界（宪法边界表，永不代管）

- **谁写积分数值**：EasyStore（商家自己的系统）。B8 **只读镜像**（B6 B0-42 通道）。
- **谁写 tier 规则**：B8（确定性规则，宪法 10）。
- **B8 永不做**：写积分、扣积分、代管积分余额、自建积分账本（宪法边界表 `BLUEPRINT.md:48`「积分等经营事实——只读，永不代管、永不自建账本」）。
- **webhook 不保证送达**：积分镜像走 reconciliation（B6 B0-42 明文）；failure 态显「上次对账时间」，不假装 0。

### 6.4 请评触达的 B7 读契约（请评也是触达）

> ReviewRequest 发送前**必须读** B7 三闸，与唤回同源：

| 项 | B8 读什么 | B7 拥有 |
|---|---|---|
| 同意（B0-44） | `marketingConsent`（opt_out 者不请评） | B7 运行时 + CRM 字段 |
| 抑制名单（B0-45） | 发前查抑制（运行时硬约束，非字段） | B7 自动化系统层 |
| 频控（B0-46） | 同顾客短期请评次数上限（避免催评骚扰） | B7 运行时 |

**契约**：请评的**发送资格最终裁决在 B7 运行时**（叠加抑制/频控），B8 只发起请评意图；被挡下的记 `status=suppressed`（§6.1 表 A）。这条让 B7 spec 知道：请评触达要接入与唤回**同一套** consent/抑制/频控闸，不另开一套。

### 6.5 宪法 8 结构隔离的机器闸（本域最关键契约）

> 请评线与奖励线的分离不能只靠「设计时注意」，要有**机器可查的结构闸**：
- **ReviewRequest 表禁含** `rewardId`/`incentive`/`satisfactionScore`（§6.1 表 A 禁止清单）。
- **Referral 表禁含** `reviewRequestId`/`reviewItemId`（§6.1 表 D 禁止清单）。
- **任何 migration 若给这两表加互指外键 = 违宪 8** → REVIEWER-PLAYBOOK 审查硬拦 + 建议进 CI schema 断言（类比 TENANT_MODELS 守卫）。
- **给 B2 的一句话**：口碑效果事件里，`review_*` 与 `referral_*`/`loyalty_*` 两族事件**不共享关联键**，B2 算效果时不得反推「留评→给奖」的耦合归因。

---

## 七、权限 / 花费闸逐行初判（含💰判定：转介绍发奖走什么账道）

> 审批数学（宪法 4）：`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`。逐行：

| 动作 | cost | effect | reach | needsApproval | 闸 |
|---|---|---|---|---|---|
| 看评价台/监控/追踪/忠诚（读） | 无 | read | internal | ❌ | requireOwner |
| 建请评/建 referral/存 tier 规则（内部写） | 无 | write | internal | ❌ | 字段变更留痕 |
| **Otto 起草回评/请评话术/唤回草稿**（LLM 轮） | turn 计量 | write(草稿) | internal | ⚠️例外① | 余额即闸（Otto 通用轮计费，非 B8 新收费点） |
| **请评触达真发**（WhatsApp 发官方链接） | 通道费 | write | **external** | ✅ | **归 B5/B7**，通道费走第二账道（宪法 5）；B8 到「起草+交接」为止 |
| **AI 回评真发**（回复到 Google/Shopee/Lazada） | 平台 API | write | **external** | ✅ | 审批 + **需平台授权代客户回复**（`PLATFORM-TRUTH:219`）；起步范围见 §十二 Q3 |
| **好评凭证对外分享/发布** | 无 | write | **external** | ✅ | 发布=审批（§4.2） |
| **转介绍发奖** | 见 §7.1💰判定 | write | 见下 | 见下 | 见 §7.1 |
| **忠诚积分展示** | 无 | read | internal | ❌ | 只读镜像（永不代管） |

### 7.1 💰判定：转介绍发奖走什么账道（本工位最重节）

**问题**：转介绍「发奖」若涉真实价值发放——它走什么账道？宪法 5 通道费/credits 边界？

**判定：转介绍发奖 NOT 走 FIKIRTIVE credit ledger（缝 3），NOT 触发 money-safety-review 符号清单。** 逐条论证：

1. **奖励是「商家的价值」，不是「FIKIRTIVE 的花费」**。三种载体全部**不经 FIKIRTIVE 资金**：
   - **(a) EasyStore 积分**：商家在自己系统发积分，B8 **只读镜像**（宪法边界表 只读，永不代管）。
   - **(b) VoucherToken**（L0 六原语 E5-06）：FIKIRTIVE 生成一个**优惠码 token**，顾客在**商家自己的结账页**核销，折扣/钱在**商家账户**结算——类比宪法 7 释义②「售前订金付款链接：钱进商家账户是商家的生意动作，不触犯 money-in 豁免」。FIKIRTIVE 只生成 token，不结算价值。
   - **(c) 商家手工发奖**：B8 只标 `status=rewarded`。
2. **缝 3（credit ledger）管的是「FIKIRTIVE 向用户收 AI 花费」**——reserve→settle/refund + 幂等键，用于生成图/视频/search 的 credits。转介绍奖励**不是 FIKIRTIVE 收钱、也不是 FIKIRTIVE 付钱**，故**不碰缝 3**。
3. **money-safety-review 符号清单不适用**。该清单（`typed genRequest gate / startGen / startRefGen / dispatchVariantJob·createVariant·regenerateVariant / coworkGenerate / idempotencyKey·dedup / partial-unique 幂等索引 / apps/worker/src/jobs/gen.ts 的 fal provider 调用`）全部是 **AI 生成花钱路径**的符号；转介绍发奖 diff **不触碰任何一个**（无 genRequest、无 fal 调用、无 credit reserve）。故本域**无 money-safety-review 触发面**。
4. **server 侧闸要求（给 Referral 发奖状态机——给 spec 的硬要求，不许只写「有闸」）**：
   - `status` 迁移 `converted→rewarded` 必须由**「商家系统事实」或「token 生成成功」**驱动，**不由 FIKIRTIVE 扣款驱动**（因为根本没有 FIKIRTIVE 扣款）。
   - **业务幂等**（非钱幂等）：同一 `Referral.id` 不重复发奖——`rewardIssuedAt` 一次性写入 + `(ownerId, referrerContactId, refereeContactId)` 唯一约束防重复建介绍关系；重复发奖动作命中「已发」短路（§4.3 failure 幂等）。
   - **成交验证**：`converted` 前须有 `convertedEventId`（读 B6 回执验证真成交），防刷单骗奖（对齐 `PLATFORM-TRUTH:160` 禁刷单精神）。
   - **VoucherToken 若复用 L0**：该 token 的安全属性（额度/核销/防重放）归 **B2 的 VoucherToken 原语**，B8 只**消费**该原语，不重建 token 安全逻辑。
5. **宪法 5 通道费/credits 边界**：credits = FIKIRTIVE 向用户收的 AI 花费；转介绍奖励 = 商家向顾客发的价值；**两者不同账道，永不混**。
6. **红线（永久排除）**：若日后 referral reward 被设计成「FIKIRTIVE 代持奖金池/代发现金」→ 撞宪法 8「代持商家资金永久不做」→ **永久排除**。起步明确：FIKIRTIVE 永不代持、永不代发资金。

**结论**：本域**无 FIKIRTIVE 自有收费点**。唯一 FIKIRTIVE spend = **Otto 起草轮**（turn 计量，例外①，走 Otto 通用轮计费，非 B8 新点）。真发消息/回评的**通道费归 B5/B7**（external write）。转介绍/忠诚发奖是**商家价值**，走商家自己的账道（EasyStore 积分只读 / VoucherToken 商家结算 / 手工），**不触发 money-safety-review**。若 VoucherToken 复用 L0 原语，安全归 B2。

---

## 八、假设台账（每假设：依据文件:行 / 待验证方法）—— 设计闸门

| # | 假设 | 依据 | 待验证方法 | 标记 |
|---|---|---|---|---|
| H-01 | **忠诚计划渗透率证据弱**——缺「马来西亚多少% 中小商家实际在跑忠诚计划」硬数据，证据主要来自厂商博客/市场报告（有商业动机） | `MISSING-CONTINENTS:133`（诚实栏原文） | 起步做薄（只读积分展示+简单 tier）；深度进 founder 体量过目再定；不因写得笃定当硬数据 | **Hypothesis** |
| H-02 | 评价子域证据较扎实（81–88% 看评价 + 马来西亚假评价敲诈真实案例） | `MISSING-CONTINENTS:133` | 可放心作为评价子域优先级依据 | 较扎实 |
| H-03 | 「曾判不要」只挡完整 widget 套件，不挡 B0-63/64 轻量子集 | `klaviyo:161` + `WHATPASS:254` + 矩阵签署 | §〇.1 已给结论；spec 时若 founder 复议再调 | 已闭合 |
| H-04 | 平台无「催评」API，请评=自建触达分享官方链接；AI 回评可行但需授权；禁 gating | `PLATFORM-TRUTH:108/174/216-219` | spec 时逐平台复核官方文档（Google/Shopee/Lazada 现行 API） | 已核（07-10） |
| H-05 | 转介绍发奖不经 FIKIRTIVE 资金，不触发 money-safety-review | 宪法边界表 `BLUEPRINT.md:48`；释义② `BLUEPRINT.md:52` | 总审查员 spend-path 复核确认无 genRequest/credit 触碰 | 待复核 |
| H-06 | 忠诚积分只读镜像自 EasyStore，webhook 不保证送达→reconciliation | `06-B6.md` B0-42 | B6 spec 联审读取契约 + 对账机制 | 待联审 |
| H-07 | 请评触达接入与唤回同一套 consent/抑制/频控 | `07-B7.md` B0-44/45/46；判决 7-9（origami） | B7 spec 联审确认请评走同一运行时闸 | 待联审 |
| H-08 | 四对标锚版本为近似值，spec 当日实机复核 + 抓真截图 | 本文 §二 | spec 冻结日实机抓版本号 + 并排截图作为 exact-head 附件/链接写入对应 GitHub task/PR；不假装抓图 | 待复核 |
| H-09 | 五表为新对象，非 harmony-01 既有（缺整域） | `MISSING-CONTINENTS:19/66`（零落点） | B2 数据契约 spec 时确认无既有对象可复用；additive migration | 待联审 |
| H-10 | VoucherToken 可作 referral 奖励载体（复用 L0 原语） | `02-B2.md` E5-06 六原语 | B2 spec 确认 VoucherToken 语义支持 referral 场景 | 待联审 |

---

## 九、深度档位 A / B / C + 成本估算（founder 体量过目直接输入）

> Fable 警告「前五每个大陆都是小产品，不裁可能让全程翻倍」——**A 档必须真的小**。三档，founder 用 Q6 机制逐项裁本程做多深。工作量级为相对量级（非工时承诺）。

### A 档 —— 最小可上市（真小；口碑起步骨架）

- **页面**：4 页各最小版（评价台/凭证/转介绍/忠诚），但**每页只做一条核心旅程**。
- **能力**：请评触达（分享官方链接，Otto 起草，**全量无 gating**，发经 B5/B7）+ AI 起草回评（**人批准，起步单平台 Google**）+ 转介绍最薄追踪（who→whom + 手工/token 发奖）+ 忠诚积分**只读展示**（EasyStore 镜像 + 简单 tier）。
- **新表**：5（ReviewRequest/ReviewItem/Testimonial 精简/Referral/LoyaltyMember）+ 复用 AttributionEvent/VoucherToken/Contact。
- **工作量级**：中。**风险**：宪法 8 结构隔离正确性、请评↔B7 触达边界、EasyStore 只读对账。
- **判定**：满足评价子域 Birdeye 级起步平齐（请评+监控+回评齐）；忠诚因证据弱（H-01）**起步做薄即可**。**这是上市下限**。

### B 档 —— 对标平齐（Birdeye/ReferralCandy/Smile 全）

- **A 档 +**：多平台统一监控（Google/FB/Shopee/Lazada，受平台授权/PII 审约束）、好评转凭证对外展示（星级/证言卡分享）、转介绍自动奖励（token 自动生成 + 归因）、忠诚等级规则（tier 自动化）+ 差评预警 SLA。
- **工作量级**：中→大。**风险**：多平台 API 各自授权/PII 安全审（Lazada/Shopee，`PLATFORM-TRUTH`）；证言卡对外展示的合规。
- **判定**：评价/转介绍平齐；忠诚平齐（受 H-01 约束建议仍克制）。

### C 档 —— 超越（Otto 独门 + 主动）

- **B 档 +**：**质量分驱动的自动爬坡调度器**（`GRILL-VERDICTS:237` 明列「全行业空白，Otto 独门」的差异化立项候选）——按回评质量/评分自动调节请评节奏；转介绍病毒系数分析；忠诚等级自动化旅程；Otto **主动**提议（差评未回主动起草、到期会员主动唤回草稿）。
- **工作量级**：大。**风险**：自动爬爬调度器若滑向「模型天赋」违宪法 10（须确定性规则）；主动性与「永不抢占主场」平衡（宪法 11）。
- **判定**：Otto 独门「超过」，胜负手加分档，非上市门槛。

### 固定件（founder 可勾选的裁量面）

| 裁量项 | A | B | C | 备注 |
|---|---|---|---|---|
| 评价监控平台数 | 1（Google） | 4（+FB/Shopee/Lazada） | 4 + 自动爬坡 | 受平台授权/PII 审约束 |
| 好评凭证展示 | 无 | 轻量证言卡 | + 自动优选 | 永不做可嵌 widget（§一排除） |
| 转介绍发奖 | 手工/token | + 自动 token | + 病毒系数 | 全不经 FIKIRTIVE 资金 |
| 忠诚深度 | 只读积分+简单 tier | + tier 自动化 | + 等级旅程 | 受 H-01 证据弱约束 |

> **建议（仅在 founder 问时）**：起步锁 **A 档**上市；忠诚因证据弱（H-01）**建议 A 档最薄**（只读展示，不建复杂等级引擎）；评价子域证据扎实（H-02），其请评+回评可优先做实到 A⁺。质量分调度器（C 档 Otto 独门）价值高但留后。最终由 founder 体量过目裁。

---

## 十、九缝映射（每个新件走缝几；新 Otto 能力 = 缝 1 skill 名列表）

| 新件 | 走哪条缝 | 说明 |
|---|---|---|
| 五张口碑表（ReviewRequest/ReviewItem/Testimonial/Referral/LoyaltyMember） | **缝 5**（Tenant model：requireOwner + ownerId 全链 + TENANT_MODELS 守卫） | 缺整域新对象，租户隔离强制 |
| 四个口碑页面 UI | **缝 7**（.gb + shadcn；coral 只属 Otto） | Otto 洞察条=唯一 coral 触点 |
| 请评/建 referral/回评/发奖等 server actions | **缝 9**（Parity Manifest：每 action 出生即配 skill 或明示豁免，CI 拦截） | 宪法 7 机器围栏 |
| AttributionEvent 写（口碑事件） | **缝 5**（写，租户隔离；读在 B2） | B0-09 效果衡量归 B2 |
| **FIKIRTIVE 收钱点** | **缝 3** ➖ **不碰** | **关键结论：本域无 FIKIRTIVE 钱原语**（§七💰判定）；转介绍发奖=商家价值，不走缝 3 |
| 请评触达通道 | **缝 4** ➖ 复用 | 复用 B5 WhatsApp connector，不新建渠道 |
| 平台评价监控/回评 API（Google 起步；Shopee/Lazada 后） | **缝 4**（Channel foundation：OAuth + 加密 token） | 需平台授权；起步 Google，多平台进 B 档 |
| VoucherToken（referral 奖励载体） | 复用 **B2 L0 原语**（非新缝） | 安全属性归 B2，B8 消费 |
| Otto 回评卡（差评公关/好评致谢卡） | **缝 8**（ChatMessage 卡片五道缝） | 若为聊天内卡片类型（ReviewReplyCard） |

**新 Otto 能力 = 缝 1（defineOttoSkill）skill 名清单**（起步）：

| skill 名（建议） | 类型 | 能力 |
|---|---|---|
| `listReviews` / `getReviewItem` | free/read | 读监控评价（读对等，宪法 7） |
| `draftReviewReply` | write（草稿，turn 计量） | Otto 用品牌记忆起草差评公关/好评致谢（**核心卖点**），只起草不发 |
| `draftReviewRequest` | write（$0/草稿） | 起草请评话术，**全量无 gating、永不挂奖励**（宪法 8） |
| `sendReviewRequest`（交接 B5/B7） | write（external，通道费） | 发官方评价链接，过 consent/抑制/频控，发=审批 |
| `listReferrals` / `getReferral` | free/read | 读介绍关系 |
| `designReferralReward` | write（$0） | 落奖励结构，**永不含留评得奖选项**（宪法 8） |
| `issueReferralReward` | write（$0，生成 token/只读积分） | 发奖（**不经 FIKIRTIVE 资金**，业务幂等） |
| `listLoyaltyMembers` / `getLoyaltyPoints` | free/read | 读忠诚积分（**只读镜像，永不代管**） |
| `draftLoyaltyWinBack`（交接 B7） | write（草稿，turn 计量） | 到期会员唤回起草，只起草不发 |

> 每个 skill 走缝 1 注册五步；对应人工 action 进 Parity Manifest（缝 9），CI 扫描未登记即拦。

---

## 十一、与既有城的接线（页面级复用/边界叙述 —— 不与 §六字段契约重复）

### 11.1 CRM（B8-CRM 试产工位）

- **复用 Contact，不建第二份客户档案**：Referral 的 referrer/referee、LoyaltyMember 的 member、ReviewRequest 的 contact **全部指向 CRM 的 Contact**（harmony-01 #7）。口碑域**不建自己的客户对象**。
- **忠诚积分只读字段可在 CRM 档案页展示一行**（类比 CRM 试产的 `totalOrdersMyr` 只读），但**对象归属仍在 B8 LoyaltyMember 表**，CRM 档案页只读链回。此为接线，非页内剥离（§1.4）。
- **VIP/高价值识别同源**：CRM 试产 §12-Q8 已提「口碑域 VIP 与 CRM Segment VIP 建议同源」——本域转介绍/忠诚的高价值识别**复用 CRM Segment 的确定性规则**，不另建一套 VIP。

### 11.2 B5 收件箱 / B7 唤回

- **请评触达用 B5 WhatsApp 通道**发官方评价链接；差评可经 B5 Comment-to-DM（B0-36）承接为对话。
- **忠诚到期→唤回归 B7**：B8 提供 `pointsExpireAt` 信号，B7 的会员唤回 broadcast（B0-43）消费；B8 不发 broadcast。
- **请评/唤回共用 B7 运行时闸**：consent/抑制/频控（§6.4），不另开一套。

### 11.3 B6 回执 + EasyStore / B2 效果

- **成交时机**：「成交后请评」的成交锚点读 B6 的 Receipt/BusinessEvent（B0-41）；转介绍 `converted` 验证也读 B6 成交事件。
- **积分只读**：LoyaltyMember.pointsBalance 只读镜像自 EasyStore（B6 B0-42），reconciliation。
- **效果数值归 B2**：口碑/转介绍/忠诚效果（新客数/NPS/复购率）在 B2 B0-09 算，B8 只写事件（§6.2）。

### 11.4 资产区 brand memory

- Otto 起草差评公关/好评致谢/请评话术时**读 brand memory 的品牌语气**（这是「Otto + 品牌记忆=评价回复引擎」的落地）；brand memory 不因口碑域改动，只被读。

### 11.5 L0 量测（B2）/ link-in-bio（B0-73）

- **VoucherToken 复用 L0**（referral 奖励载体，§7）。
- **好评凭证对外展示**可分享到 link-in-bio 活页微站（B0-73，跨块）——B8 生成证言卡，微站消费展示；载体归属见 §十二 Q5。

---

## 十二、開放问题（需 founder 或跨块裁定，逐条）

| # | 问题 | 为什么要裁 | 选项 |
|---|---|---|---|
| Q1 | **请评时机**：成交后多久发请评？ | 成交事件从 B6 回执来；太早太晚都伤转化 | 需 B6 spec 联审定成交信号；触发延迟（即时/N 小时/N 天）建议做成 config，founder 定默认 |
| Q2 | **评价监控起步平台**：起步做几个平台？ | Google 只能分享链接式请评；Shopee/Lazada 有 PII 安全审（2 周，`PLATFORM-TRUTH`） | A. 起步只 Google（最轻）；B. Google+FB；C. 四平台。**建议 A**（A 档），多平台进 B 档 |
| Q3 | **AI 回评起步范围**：回哪些平台的评价？ | Lazada/Shopee 回评需 PII 解码安全审；Google/FB 较轻 | A. 起步 Google/FB 回评；B. 含 Shopee/Lazada（需过安全审）。**建议 A** |
| Q4 | **转介绍奖励默认载体**？ | 三载体（EasyStore 积分/VoucherToken/手工）体验不同 | 需 founder 定默认；建议 VoucherToken（钱在商家账户，最干净）+ 手工兜底 |
| Q5 | **好评凭证对外展示载体**？ | link-in-bio（B0-73）vs 社媒帖 vs WhatsApp Status——跨块 | 需与 B0-73 owner 联审；B8 只生成证言卡，展示面归微站/社媒 |
| Q6 | **忠诚 tier 是否起步内建**？ | EasyStore 可能已有积分/等级，B8 重复建 tier 有风险 | A. 起步只读展示 EasyStore 积分不建 tier；B. B8 建 tier 规则。**受 H-01 证据弱**，建议 A（最薄） |
| Q7 | **质量分自动爬坡调度器**（Otto 独门，`GRILL:237`）是否本程？ | C 档胜负手，但工程量大 + 须确定性（宪法 10） | 建议留 C 档/后程，A 档不做 |
| Q8 | **宪法 8 结构隔离 CI 断言**是否本程上？ | 机器闸（§6.5）比「设计时注意」更硬 | 建议 spec 时把「禁止 review↔reward 互指外键」做成 schema 断言，随块上 |

---

## 十三、给第三波工位的模板改进建议

> 本工位是第二波（口碑，零原型+多子域+违宪陷阱域）。相对 CRM/Campaign 两个试产（都有原型/spec 底），本域暴露三处模板可强化点：

1. **零原型域应有固定「对标反推法」小节**：CRM/Campaign 的 §三都是「对齐 A′ 页做减法」，但缺失大陆域**无原型**。建议模板在 §三给两条分支写法：（a）有原型→做减法（列剥离）；（b）零原型→从对标反推（列反推逻辑 + 理由）。本图 §三、§1.4 已示范，建议固化进模板。

2. **违宪陷阱域应在 §〇/§一显式列「本域违宪陷阱清单」**：本域第一陷阱=宪法 8 合体流，且分离要落到**数据/UI/话术三层**。建议模板对「宪法点名分离/禁止」的域，强制一节「违宪陷阱 + 三层落地 + 机器闸」（本图 §6.5 示范 schema 断言级机器闸，比口头「注意」硬）。

3. **💰判定应区分两类账道**：本域的关键发现是「转介绍发奖=**商家价值**，不是 FIKIRTIVE 花费」，与 Campaign 的「打包生成=FIKIRTIVE 收费」是**两类完全不同的账道**。建议模板 §七给标准二分结论模板：（i）**FIKIRTIVE 收费点**（走缝 3 + money-safety-review）vs（ii）**商家价值发放**（只读/token/手工，不碰缝 3，不触发 money-safety-review，但需列 server 侧业务幂等/成交验证闸）。避免第三波把「涉钱」一律误判为 money-safety-review 触发面。

4. **「曾判不要待复核」类判词的处理范式**：本图 §〇.1 示范了「分层判词（重被排除/轻被转正）+ 后续判决闭合待复核 + 排除的那半边照样明示排除」三步。建议模板对「批准来源含历史两可判决」的行，固定此三步处理法，防止把老判词当一刀切。

5. **外部只读源的 failure 态标准答案**：本域评价监控/EasyStore 积分都是外部只读源，failure 标准答案是「局部降级 + 显式『上次同步/对账时间』+ 重试，禁止把读不到当 0/空」。建议把这条补进模板 §四的 failure 标准答案（现模板只写「局部降级+显式重试」，未点出只读源的「上次同步时间」这一诚实要件）。

---

> **交付自检（对照 `FINAL-REPORT-STANDARD` 终验七节）**：§5 双执行矩阵→兑现终验③双模演示（Otto 品牌语气回评=核心卖点）；§4 六态→兑现⑥全旅程证据；§2 对标锚→兑现④对标三栏（Birdeye/ReferralCandy/Smile/Avocado）；§6 数据契约→兑现⑧schema/consent（含宪法 8 机器闸）；§7 花费闸→兑现⑨（💰判定：无 FIKIRTIVE 钱路）；§12 开放问题→兑现⑫待裁清单（写「无」不藏）。**结论**：本设计全图为 B8-口碑经济的 spec-ready 提供了完整锚清单、数据契约底座与宪法 8 分离机器闸，可直接进入 spec 冻结。**第一违宪陷阱（合体流）已在数据/UI/话术三层结构性封堵；转介绍发奖经论证不触发 money-safety-review（商家价值账道）；忠诚证据弱已诚实标 Hypothesis。** 待 founder 体量过目裁深度档（建议 A 档，忠诚最薄）后动工。
