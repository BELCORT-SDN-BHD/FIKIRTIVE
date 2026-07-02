# WHAT-Pass 判决记录(拍板会输出,持续累积)

> **O 区:已封卷(2026-07-03)。** 14 簇全部有判决。

> founder 逐批拍板的正式记录;harmony 设计与蓝图 v2 的直接输入。

## O 区(2026-07-03 拍板)

| 项 | 判决 | 内容 |
|---|---|---|
| O-08 定价 | **定调** | **席位订阅 + credits 用量双轨(Zoho 式)**:全部 feature 用量走 credits,座位数叠加收费。具体档位随 G 区细化。 |
| O-01 + O-06 | **要,绑定顺序** | 对客 AI agent 要做,但 **O-06(护栏+试驾场)是硬前置**,顺序如 money-gate 一样不可绕。 |
| O-02 + O-05 | **要,routine 授权模型定调** | "自动的手、有闸的钱包":执行自动,花钱/对外发布默认停下等批准。**例外 = 用户明确设定的 routine**(例:每周一 per 用户时区,研究 trend → 做 posts → 自己发):routine 创建时的明确确认 = 预授权,执行免逐次审批。这就是蓝图"定时任务/自主 Otto 必须 founder 共同设计花钱闸"的第一轮设计:授权发生在 routine 定义时,配预算上限 + 范围声明 + kill switch + 事后摘要。远期:手机 App 作为 routine 管理面。 |
| O-11 | **不要(开放)** | skill 永久 BELCORT 内部编写。理由(founder):我们是全平台不是单 feature,内部处理更好控制。 |
| GTM 节奏 | **定调** | **Content creation 最先上线赚钱**。不走 funding,直接市场变现,利益最大化。 |
| UIUX | **升格宪法** | 除 agent-operates-100% 外,UIUX 是第二卖点/留存支柱。标杆 = Apple;gamification 参考 Duolingo 但因面向专业用户,做 **minimal gamification**(具体形态 harmony 阶段设计)。 |

### O 区第二批判决(founder 2026-07-03)
| 项 | 判决 | 内容 |
|---|---|---|
| O-04 品牌记忆自养 | **要**(默认确认) | "懂你"层;补"从批改学习" |
| O-07 Otto 绩效面板 | **要(简版)**(默认确认) | 周报级起步 |
| O-09 NL vs 可视 builder | **要,分域**(founder 修正) | **创作域保留可视画布**(canvas 的灵感本来自 Grok —— Grok 正式加入对标名单);**规则/自动化域**(flows/routine/分群)才用"Otto 写可读规则文件替代拖拽画布" |
| O-10 效果反哺闭环 | **要**(founder 升级:"也很重要") | 建设顺序仍是归因/分析先立,但判决为要,不是以后 |
| O-12 就地 AI 按钮 | **要**,设计关键(founder 强调) | **设计原则候选:就地按钮 = Otto 的手,不是第二个匿名 AI** —— 同一大脑、同一记忆、coral 身份;harmony 阶段出交互方案 |
| O-13 connectors → 团队协作 | **Slack/Notion connectors 不要;团队协作 FEATURE 要**(founder 转向) | 在 FIKIRTIVE 内做 team collab(多席位、协作、审批)—— 直接支撑席位收入模型;新簇,归 G 区细化 |
| O-14 对外 MCP | **不要(永久)** | founder 定案:"如果会用其他 LLM,代表我们的 Otto harness 不够好,就代表 FIKIRTIVE 不好。不要有这个机会。" —— 不留逃生口,质量压力全压在 Otto 上;外部 agent 永不获得操作面 |
| 差异化叙事 | **确认** | 首发 = "SEA 的创作超级员工"先赚钱;投放闭环第二章;"一个员工 + 100% 覆盖"为结构承诺 |

## 追加判决(founder 2026-07-03 深夜)

| 项 | 判决 | 内容 |
|---|---|---|
| Credit 消费明细(用户侧+官方侧) | **要** | 用户在 Account → Credits 看到分类消费明细(Otto 对话 / 图 / 视频 / 未来任何花费点,可展开单笔);官方在 /admin/cost 扩同口径全租户聚合。**纯只读展示层,零钱路风险** —— CreditLedger 的 refId/kind 结构本来就携带分类,只差 UI。宪法推论:未来任何新花费点必须走同一账本 → 自动进明细,不许旁路。 |
| 收钱绝对正确(不多扣/不漏扣) | **重申为最高铁律**(已是宪法第 2 条的实质) | 架构现状:reserve→settle 账本事务、幂等键+partial-unique 索引防双扣(数据库级)、SETTLE/REFUND 互斥、三类回收器防漏、money-safety-review + 总审查员双闸看守。2026-07-02 审计 P0=0。 |

## G 区(2026-07-03 拍板,封卷)

| 项 | 判决 | 内容 |
|---|---|---|
| G-01 席位形状 | **要,双档** | 创作席(全功能)+ 审批席(只看/批,便宜到老板愿意全员拉进来) |
| G-02 档位哲学 | **功能全开,档位卖规模** | GHL/Klaviyo 流派;呼应"全 feature 走 credits" |
| G-03 credits 政策 | **滚存上限制 + 补充包政策,以 costing 为准** | founder:先算好成本,不占大 costing 就按提议(滚存上限制);**任何定价决定都要 costing 先行** |
| G-04 Otto 劳动计价 | 已定(credits) | harmony 细化扣费心理设计 |
| G-05 免费层 | **能力全开 + 卡量,以 costing 为准** | Buffer 流派;100cr 起点,数字随 costing 模型定 |
| G-05b unlimited 钩子 | **永久不要** | founder:"有悖我们的逻辑,Otto 自动化的时候我们就糟糕了" —— agent 自动化使任何 unlimited 承诺变成本敞口,入宪禁止 |
| G-06 本地定价 | **要,MYR 为主 + 分市场差异定价** | founder:每个市场本地化、不同市场不同价,最大化 margin —— 区域定价入宪 |
| G-07 通道费 | **透明直传** | margin 留给 Otto |
| G-08 Add-on 轴 | 以后 | 保账单简单 |
| G-09 行业开店模板 | **要** | Agency 楼层第一块砖,Otto 化超越 GHL 静态快照 |
| G-10 多客户伞层 | **要,排第三** | 顺序:G-09 → 团队协作+G-11 → G-10 |
| G-11 审批权限+团队协作 | **要** | 与 O-13 团队协作合并设计;founder 硬要求:**非常丝滑的体验**(宪法第 10 条适用) |
| G-12 品牌化报告 | 要(分析区后) | Otto 写人话解读 |
| G-13 rebilling | 以后 + 严设计 | 新 money-path,钱路神圣条款适用 |
| G-14 白标 | **永久不要** | founder:"我要的就是 FIKIRTIVE 变成世界级别的平台" —— 平台不白标,Otto 永不改名换脸 |
| G-15 SaaS Mode | 以后 | 排全部 agency 件之后 |
| G-16 伙伴分成 | 以后 | 基本盘先立 |

## C 区(2026-07-03 拍板,封卷)

判决 = 总审查员提议表全数通过(C-01~C-10、C-12 要;C-11/C-13/C-14/C-15 以后;C-16/C-17 不要),外加 founder 三条关键澄清:

| 澄清 | 内容 |
|---|---|
| C-01 工厂 MVP 打法 | **批准,但升级路线必须严格执行** —— founder:"要很严格的执行那个步骤,不然我还是倾向于直接做到最棒的"。纪律:每个 MVP 占位件(多参考图顶替训练人设、模式砍量、无 avatar 库)必须有**被追踪的升级票 + 触发条件**,MVP 是阶段不是终点;harmony 阶段产出工厂"MVP→完全体"路线图作为正式交付物 |
| C-07 与 Otto 全自动化 | founder 重申:**工厂每一步都必须 Otto 可全自动驱动**(routine/审批规则内),不许设计出"中间必须人手"的断点。口播供应商选型时"Otto 可操作性"是硬性选型标准。**新增具体豁免:充值/购买 credits(money-in)Otto 永不代办**(founder 原话例子:"帮忙充值进 fikirtive 这种"= 真危险类) |
| C-02 边界 + 模型经济学 | founder:结构拆解本来就不会太像(风险可控);更重要的设计约束 —— **Otto 运行时是 cost-efficient 档模型(sonnet 级),不是 Fable/Opus**。所有 skill 的专业判断必须冻进确定性代码/schema/模板(prompt-skills 模式为全城标准),不靠模型天赋 |

## S/A/R/P/M/L/B 七区 + 红旗题(2026-07-03 拍板,WHAT-pass 封卷)

七区默认判决全数通过(见底稿各区提议),红旗题判决:

| 红旗 | 判决 | 内容 |
|---|---|---|
| 一 S 平台矩阵 | **TikTok/Shopee/Lazada 类全要** | 且**发布基建必须平台可插拔**(加新平台 = 加一个 adapter,不改核心)—— 渠道缝延伸为发布缝 |
| 二 A 报表引擎 | **要(我的"不做"被否,违宪纠正)** | founder:"Otto 是在原有都建设很棒的基建上的自动化操作员,用户一定也要 100% 可以操作全平台的东西" —— 双模无例外;这也是卖 seats 的根 + **user org 内部也要阶级制度**(租户侧 RBAC,与团队协作/审批同件设计) |
| 三 CRM 深度 | **分阶段:respond.io 级起步 → 长到 Salesforce 级深度** | 架构按终局深度设计(未来可加自定义对象等);Otto 让专业级简单化 + 丝滑 UIUX 消化复杂度 |
| 四 商家收款 | **同意:以后;先不过我们** | 起步形态 = 生成收款链接跳商家自己账户,资金流不经 FIKIRTIVE |
| 五 WhatsApp BSP | **要,M 区第一波;通道费单独收,不进 credits** | founder:通道过路费混进 credits 不是 best practice —— **计费架构:credits(我们的服务)与通道费(透明直传)两条独立账道**(respond.io WABA 余额形态) |
| 六 Campaign 容器 | **独立 Campaign 对象,不升格 project** | founder:"要 scale 去 Salesforce 那种,干净最重要" |
| 七 email | **以后,但必须建**(不是不要) | 附 GTM 战略(founder):**dev 用 FIKIRTIVE 来 market FIKIRTIVE,大获成功 = 名声大噪的最佳路径**(dogfood 即营销) |

## 市政厅 X 题(2026-07-03)

| 题 | 判决 |
|---|---|
| X-01 阶级 | 五级维持;当前团队 = founders only,细化等真实团队出现 |
| X-02 授信上限 | founder 委托总审查员建议,采纳:**finance 单笔 ≤1,000 显示 credits(≈$100),日累计 ≤3,000(≈$300),超限进 founder 审批队列**;数字放矩阵文件随时可调 |
| X-03 冒充 | best practice 采纳:**仅 super-admin(现 = founders)可冒充;永久保持禁写(F15);每次需填理由、横幅可见、30 分钟自动过期、全量留痕** |
| X-04 双人确认 | best practice 采纳:封/删租户、负数信用调整、全租户级模型开关、租户数据导出 → 团队 >1 人后双人确认;founders-only 期间 = 键入确认 + 冷却延时 |
| X-05 内容可见深度 | best practice 采纳:**默认仅元数据;看全文需显式"开 case"动作(留痕);finance 永远看不到内容只看账**;moderator 因职责可看被举报内容 |

---

# ✅ WHAT-pass 全卷封盘(2026-07-03):158 簇 + 7 红旗 + 5 市政厅题,全部有判决。

## 追加判决(founder 2026-07-03)

| 项 | 判决 | 内容 |
|---|---|---|
| Search API(Tavily)计价 | **3x(200% margin),不并进 Otto 1.5x** | founder:"那么便宜,可以 200% 的 margin"。basic $0.008 → 收 ~3 internal credits($0.03);advanced $0.016 → ~5 internal($0.05)。**落地形态**:像 LLM token 一样走 turn 计量(withLlmBudget 的 settle 加 search 项,各用各的 margin 率),skill 保持 free/read/external —— **不做每次搜索弹审批**(否则 Otto 每查一下都要用户点头);消费明细里单列 "search" 类目(founder 的 credit 明细指令自动覆盖)。费率进 config 层,永不硬编码。 |
