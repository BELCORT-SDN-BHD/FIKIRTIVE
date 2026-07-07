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
| G-11 审批权限+团队协作 | **要** | 与 O-13 团队协作合并设计;founder 硬要求:**非常丝滑的体验**(宪法第 11 条 UIUX 适用;v1.7 重编号) |
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

## 定价终案(founder 2026-07-03 全数认可;宪法第 5 条已同步 —— v2.1)

**定价规则(入宪)**:①每个收费点毛利率(售价−成本)/售价 **≥45%**,目标区 45-50%(不含人工);②市场定位**中下**(靠 Otto+seats 赚钱,内容生成保持竞争力);③全部数字落 config 层。

| 档 | 终案 | 毛利率 |
|---|---|---|
| 图 | 1cr 不动 | 65% |
| 5s 视频 | **7→8cr($0.80)** | 51% |
| 10s 视频 | **14cr($1.40)** | 45% |
| 参考视频 | **参考片上限 6s + 16cr($1.60)** | 46% |
| Otto 劳动 | **OTTO_LLM_MARGIN 1.5→2.0** | 50% |
| search | 3x 不动 | 67% |

**护栏升级**:BytePlus 资源包余量告警 = **P1 必做**(包烧完跳裸价,10s 档毛利 45%→13%)。

**效率良心条款(founder 2026-07-03,入宪)**:"虽然赚钱很重要,但要通过 engineering 和设计让 Otto efficient,不让用户花冤枉钱" —— margin 赚在倍率上,永不赚在浪费上;任何让用户多烧 token 的低效(冗余重发/臃肿上下文/多余步数)按缺陷处理。已知效率工单:①prompt caching(COGS 与用户成本同降 ~90%,先补 meter 的 cache_write 处理)②verdict 轮重发 base64 图(审计已记)③skill 确定性化减少步数(宪法"技能为弱模型设计"同向)。

## GM 卷 —— Minimal Gamification(founder 2026-07-03 拍板,封卷)

| # | 判决 |
|---|---|
| GM-01 连续行动 streak | **不要** |
| GM-02 里程碑时刻 | **要** |
| GM-03 Campaign 目标进度条 | **要** |
| GM-04 Otto 周报成就语气 | **要** |
| GM-05 开店完成度 | **要** |

三条边界照立:永不 XP/等级/排行榜/徽章墙、一切可关、永不打断工作流。落地:GM-05 随 onboarding、GM-03 随 Campaign 区、GM-04 随 O-07 周报、GM-02 随各楼里程碑事件;不单独立项。

## North-Star 未捕获 feature 判决(founder 2026-07-03)

审计见 `docs/research/2026-07-03-northstar-feature-capture-audit.md`(N-01~N-30)。12 个"可纳入"项直接折进相关区/和声;18 个"需拍板"判决:

| # | feature | 判决 |
|---|---|---|
| N (Grok) canvas A/B 分叉 | **要** | 创作区 canvas;差异化单点 + 省 credits |
| N (Grok) 多 clip 拼叙事长片 | **要** | 工厂 Wave 3(成片下一公里) |
| N (Grok) Speed/Quality 双档 | **要** | GenerationProvider 缝 + 定价 config(接 Seedance-mini 草稿档) |
| N (Higgsfield) 实景/OOH 场景模式 | **要** | 工厂 Wave 3 模式扩充 |
| N (LTX) Audio-to-Video | **推迟** | 未来加模型时并入 |
| N (LTX) 视频硬字幕烧录 | **推迟** | 未来加模型时并入 |
| N (Grok) 用户自建+可分享模板 gallery | **以后** | 目前不用 |
| N (SF) Lead Conversion 转化事件 | **不要(太深奥)** | — |
| N (SF) Campaign 首触归因埋点 | **不要(太深奥)** | — |
| N (respond.io) 客户生命周期阶段 | **归 P3 建 CRM 区时再议**(founder 2026-07-03 确认) | — |
| N (Buffer) Ideas 内容孵化管道 | **不建 Buffer 式产品;Otto 做捕获+生成 + 一张极轻"想法清单"防沉底**(founder 2026-07-03 确认) | Otto 行为 + 小数据对象 |
| N (Buffer) 公开评论收件箱 | **要** | P2 客服区(私信 inbox 旁加 public-comment 线程类型) |
| N (HubSpot) 知识库反向回路 | **要** | P2(并入 O-04 品牌记忆自养客户侧 / M-13) |
| N (respond.io) 回复才计费 | **不要(已有定价规则)** | — |
| N (Metricool) 报告 live-URL 分享 | **不要(重叠)** | — |
| N (Metricool) 按天道具计费 | **不要(重叠)** | — |
| N (Adobe) 生成侧内容安全硬闸 | **不要(重叠)** | — |
| N (Adobe) 全城概览页 | **不要(重叠)** | — |

**可直接纳入的 12 项**(founder 未反对,总审查员折进地基):AI 配乐+音效(并 C-07 扩为视频声音全家桶)、多机位一键出图、视频换脸/换角、卡点模板(创作区)、冷启动时段种子表(A/S 区)、营业时间自动回复原语(M 区)、consent/勿扰字段(CRM)、字段变更留痕(复用 ActionEvent)、消息互动信号触发源(L-07)、单帖可分享预览 URL(排期区)等 —— 各随所属区 spec 落地。

**从本轮推断的 founder 决策原则(入 [[present-options-dont-decide]] 精神)**:①能让 Otto 做的别建手动工具;②太深奥/企业级不碰;③重叠即砍;④依赖未来能力的推迟;⑤创作区保持丰富(赚钱先锋)。

## 追加判决(2026-07-07)

> 来源 = founder 2026-07-07 拍板(会话内),由总审查员经 PR 入档;founder 合并本 PR = 确认。执行层挂靠见 `docs/MASTERPLAN.md`。

| 项 | 判决 | 内容 |
|---|---|---|
| Otto 对话计费模式 | **维持每轮 reserve→settle;origami"思考免费"原则不采纳** | founder 原话:"OTTO对话还是要扣credit的,这个是我们的costing那边要cover的" —— Otto 劳动 margin(2.0x)是利润主场(宪法 5/定价终案),对话轮计费是 costing 模型的收入项,不做免费化 |
| 基础设施选型 | **不迁 Sevalla;Railway + Neon 维持** | Sevalla 贵 2-3 倍 + 迁移风险不值;现架构成本已核(harmony-04 §5b:固定层薄,对定价几乎无约束) |
| GitHub 组织与保护 | **迁 BELCORT-SDN-BHD org + 升 Team 档 + main ruleset 硬保护** | 补上"私库 free 档无分支保护"的老缺口(合并纪律从约定强制升级为机器强制)。org 迁移已生效(origin 已指向 BELCORT-SDN-BHD/FIKIRTIVE);Team 档与 ruleset 落地后由总审查员同步更新 `.claude/CLAUDE.md` 的相关表述 |
| 引擎与债务的顺序 | **改进路线 = "最好的全都做";顺序 = 先修引擎(prompt caching + 技能分域装载)再规模化清偿对等债务** | 质量效率优先;引擎 spec = `docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md`(动工前待 founder 过目,宪法第五章);对等债 84 条分批表见 MASTERPLAN 第三章 |
| 2026-07-07 审计清理授权 | **批次 1/2 已授权执行(PR #179 / #180);批次 3 未授权,逐项另批** | #179 = 已验证死码删除;#180 = 说谎文档修正 + parity 债务棘轮(基线 84)。批次 3(死付费端点/死表 DROP/脚本确认锁/scripts 归档/重复代码统一)逐项见 MASTERPLAN 第七章待拍板清单 7-10~7-14 |

## 追加判决(2026-07-07 第二批 —— 待拍板 14 项清零)

> 来源 = founder 2026-07-07 拍板(同日第二批,会话内),由总审查员经 PR 入档;founder 合并本 PR = 确认。对应 `docs/MASTERPLAN.md` 第七章待拍板清单 7-1~7-14 + 两笔引擎授权。

| 项 | 判决 |
|---|---|
| 7-1 数据库备份 | ③ 都做 —— Neon 已确认在 Launch 档(founder 截图证实,BELCORT org);夜间 pg_dump→R2 已开工;founder 待办:检查 Neon restore window 设置 |
| 7-2 Hook 生成器 | 要(工厂第二步挂靠) |
| 7-3 批量变体矩阵 | 要(工厂第一/二步),硬性附带:批量确认页显示总价(复用 PackCard 模式,宪法 3 计费透明) |
| 7-4 改台词折价 SKU | 要,costing 先行 |
| 7-5 成品广告打包 SKU | 要,costing 先行(harmony-04 成本模型算完工厂第二步全链成本后定数,数字进 config 层) |
| 7-6 SEA 选角库 | 按工厂第三步原节奏,不提前;工厂第二步期间做 $0 预备(选角标准 + 肖像授权法务框架调研) |
| 7-7 大单确认页 | 要 —— Otto 花大钱前先复述理解+报价,用户确认才动手;第一落点 = 批量变体 |
| 7-8 真人插手自动化即停 | 要 —— 入未来客服/消息区设计原则(硬规则非开关) |
| 7-9 勿扰名单硬约束 | 要 —— 入设计原则 + 数据模型预留;自动化系统层面跳过勿扰联系人 |
| 7-10~7-14 批次 3 五项 | 全批(7-11 删旧登录系统死表排在备份合并后) |
| 引擎验证花费 | 批,上限 $1(Anthropic 真实调用,验证缓存生效+账单下降) |
| 引擎升级总授权 | "批准且若有更好的架构/方法,都批准"(spec 内改进免逐项再批;真实花费仍逐笔问) |

### 两条工作规矩(founder 2026-07-07 明示,约束所有 agent)

1. **市场归 founder,工程归 agents**:"要如何 market 那些是我的问题,不是 coding agents 的问题,只要做好我要的 features 就行了" —— agent 的建取舍只看 founder 判决 + 工程质量,不得以市场定位(SEA 等)作为推理依据。
2. **对 founder 沟通用人话**:不用 harmony-xx / Wave-N / F-xx 类内部代号;给 founder 读的文档须带人话对照表。

## 追加判决(2026-07-07 第三批)

> 来源 = founder 2026-07-07 拍板(同日第三批,会话内),由总审查员经 PR 入档;founder 合并本 PR = 确认。执行层挂靠见 `docs/MASTERPLAN.md` §〇点六「冲刺」。

| 项 | 判决 | 内容 |
|---|---|---|
| ① 冲刺开跑 | **双线开跑**(founder 原话:"好的。冲刺。") | A 线(staging+发版流程设计 → #178 canvas 收尾 → 吐槽清单+全产品挑刺 → 上线闸)与 B 线(X 发布 spec → 过目 → 施工)并行;C 线方向另见⑤;工厂第二步排冲刺后 |
| ② X/Twitter 采纳为新渠道 | **要**(founder 产品判决) | 用户 OAuth 模式(用户永不需要自己的 API),平台(BELCORT)养一个开发者应用;走渠道缝(Meta 范本);spec = `docs/superpowers/specs/2026-07-07-x-publishing-design.md`(待 founder 过目后动工) |
| ③ credits = 平台唯一硬通货 | **确认** | founder 原话:"credit 这个制度就是在 FIKIRTIVE 平台上,硬通货/货币" —— 平台上一切对用户的收费以 credits 计价(money-in 显示法币、通道费独立账道两条宪法既有边界不变);新渠道(含 X)收费点一律走 credits 账本 |
| ④ staging + 发版流程正规化 | **要,设计先行** | founder 原话:"关于 staging 的,那个也请你设计好,包括接下来每个版本要如何设计" —— staging 环境与每个版本的发版流程出正式设计(A 线第一件) |
| ⑤ Otto Campaign 策划师 | **方向确认,spec 在途(另一 PR)** | founder 口述:Otto 研究 trend → 建议或直接设计整个专业 campaign(跨度数天到数月)→ 几小时排好整个 campaign;spec 动工前照例待 founder 过目 |
