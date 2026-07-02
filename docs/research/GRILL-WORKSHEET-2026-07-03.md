# FIKIRTIVE WHAT-Pass 拍板底稿(2026-07-03)

> **性质**:founder 拍板会工作底稿(158 个功能簇,来自 17 家对标的全量深研)。
> **怎么答**:每簇一个编号,回「**要 / 不要 / 以后**」即可,可整批答("C-01到C-05要,C-06以后")。
> 有三个可选修饰:「要,但砍到 XX」「以后,等 XX 触发」「不要,除非 XX」。
> **双份价签提醒(宪法第 7 条)**:每个「要」= 人工操作面 + Otto skill 通路两份工程量。
> 拍板结果将进入 harmony 设计 → 蓝图 v2 → 分区 spec。此文件本身不是宪法,拍完即归档。
>
> 建议顺序:**先 O 区**(Otto 差异化定位,决定其他一切取舍的权重)→ G 区(定价/打包)→ 各功能区。


---

# O 区 —— Otto/AI 差异化(先拍这个,它决定一切)

# O 区 · Otto/AI 打法横切(差异化战场)

## 先看地图:每家的 AI 打法一句话 + 归类

归类口径:**① AI 替商家接客**(对着商家的客户说话)/ **② AI 辅助单点操作**(工具里塞 AI 按钮,人仍是操作者)/ **③ agent 替用户操作平台**(agent 是操作员)。

| 家 | 一句话 | 归类 |
|---|---|---|
| **Higgsfield Supercomputer** | 创意域的"agent 员工":brief→拆计划→报价→批准→成品,skills/memory/connectors/scheduled tasks 全套齐 | **③ 唯一接近者**,但只覆盖创意一个区 |
| Salesforce Agentforce | 按席位卖的 CRM 上叠"AI 岗位"(SDR/客服/教练),topics+actions 白名单圈死,agent 做岗位任务、不驾驶产品 | ①为主 + ② |
| HubSpot Breeze | 免费副驾 + 100+ 嵌入式 AI + 四五个窄域 agent 按结果计费;最自主的 Social Media Agent 也停在"建议+人审" | ① + ② |
| GHL AI Employee | 一堆各管一摊的单功能 AI(接电话/聊天/回评/写文案)的伞品牌;平台本身仍要人(或 agency)来开 | ①(纯替商家接客) |
| Klaviyo K:AI | 40+ 嵌入式 + Marketing/Customer Agent 双 agent 写回同一 profile;Composer(beta)一句话出 campaign 但黑盒且限自家渠道 | ① + ②,Composer 逼近③ |
| Canva Magic → AI 2.0 | 宣布"从带 AI 的设计平台变成带设计工具的 AI 平台":对话式 + Living Memory + connectors + 定时任务 | ②→③ 转向中,只覆盖创意生产面 |
| Adobe GenStudio | agent 是 feature 嵌在各企业 SKU 里,Agent Orchestrator 编排,Brand Intelligence 当共享大脑 | ②(企业内容供应链) |
| respond.io / ManyChat | 挂在收件箱/画布上的对话 AI(RAG+护栏+转人工;AI Goals 有 agent 雏形但限 IG 对话内) | ① |

结论一行:**③这个位置,全市场只有 Higgsfield 真的站着,而且只站在创意一个区。**其余全部是①和②。这就是 Otto 的战场地形。

---

### O-01 【AI 替商家接客的对话 agent(Customer-facing AI Agent)】
- **谁有**: HubSpot(Breeze Customer Agent,$0.50/解决,9 渠道,宣称 65% 解决率、约 8,000 客户在用), Salesforce(Agentforce Service Agent,pay-per-resolution,自报 70% 自主解决), Klaviyo(Customer Agent,预建 retail skills:查单/退换/物流), respond.io(AI Agents,RAG+低置信度转人工,$159 档起), GHL(Conversation AI + Voice AI,52 语言接电话), ManyChat(AI Replies/AI Goals,仅 IG,$29 add-on)
- **是什么**: AI 直接替商家跟**商家的客户**说话:答 FAQ、查订单、筛资格、约时间,答不上转人工。这是①类玩家最密集的一格,按结果计费已被三家大厂验证。
- **SMB 度**: 高 — 马来西亚 SMB 没有客服部,只有老板和 WhatsApp;"没人回消息"是每天在漏钱的洞。
- **FIKIRTIVE 现状**: 零(自动回复区还在愿景;Otto 目前只对内干活,不对商家的客户说话)。
- **利弊**: 做 = Otto 从"后台员工"变"前台+后台一个人",是全 OS 论文的必经一楼;成本 = WhatsApp BSP 接入是新运营面,且"对消费者说话"的幻觉/合规风险是全新的安全面。
- **双模注**: 人工面 = 统一收件箱里人回 + 快捷话术;Otto 代劳 = 接管对话、按知识文件作答、低置信度自动转人工。

### O-02 【一句话→整套 campaign 的编排 agent(NL Brief→Campaign Orchestration)】
- **谁有**: Klaviyo(Composer,private beta:一句 prompt→分群+多渠道文案+排期), Salesforce(Campaign Creation/Campaign Designer Beta:AI 组装完整旅程、人只审核,锁 $1,500-3,250/月档), HubSpot(Marketing Studio:一个 brief 生成整套 campaign 资产), Adobe(Content Production Agent,beta), Canva(AI 2.0 Agentic Orchestration), Higgsfield(Supercomputer:brief→计划→报价→批准→交付), GHL(Funnel AI)
- **是什么**: 用户说一句话,agent 拆成受众+素材+触点+排期的整套 campaign 草稿。当前所有大厂全部停在"AI 组装、人审核发布"——这是③的门口,没人真踩进去。
- **SMB 度**: 高 — SMB 极度想要"说一句话出 campaign",但付不起 Salesforce/HubSpot 的门票。
- **FIKIRTIVE 现状**: 部分有 — Otto 本体就是这个定位;创作(canvas 图/视频)和 Meta 建 PAUSED campaign 两段已通,缺 campaign 对象、排期、多渠道触点把整条链缝起来。
- **利弊**: 做 = Otto 论文的正面主战场,竞品全卡在"人审门口"留出了空间;成本 = 端到端可靠性要求高,一次糟糕的整套输出比十次单点失败更伤信任。
- **双模注**: 人工面 = campaign 页手动建受众/素材/排期;Otto 代劳 = brief→整套草稿→报价卡→批准→执行。

### O-03 【Agent 花钱前报价与审批门(Approve-before-Spend)】
- **谁有**: Higgsfield(Supercomputer 每次执行前列预估 credits、点头才跑,连 LLM 对话都计价), HubSpot(Social Media Agent 全部帖子须人工审批;Prospecting Agent 起草人审后发), Salesforce(human-in-the-loop + Guardrails 信任叙事), Adobe(内建 Reviews & Approvals + Workfront 多级审批), Canva(Design Approvals)
- **是什么**: agent 动手(尤其花钱、对外发布)之前,把"要做什么+要花多少"摆出来等批准。市场共识:agent 自主的边界就画在钱和发布上。
- **SMB 度**: 高 — 老板敢不敢把店交给 AI,全看这道门让不让人放心;直接对上"安全第一"。
- **FIKIRTIVE 现状**: 部分有 — ask-before-spend 惯例、canvas cost-confirm、G7 build-as-PAUSED + launch 单独 gate 都在;缺的是产品化成统一"报价卡"UI(计划+分项成本+一键批准),现在是散落的 confirm 弹窗。
- **利弊**: 做 = 低成本(整合既有机制)高信任回报,Higgsfield 已验证 SMB 接受这个交互;风险 = 审批门太密会把"超级员工"用成"每步签字的实习生",颗粒度要调。
- **双模注**: 人工面 = 每个花钱动作的确认弹窗;Otto 代劳 = 出统一报价卡,批准后整批执行并留痕。

### O-04 【Agent 品牌记忆与上下文自养(Agent Memory & Brand Context)】
- **谁有**: Higgsfield(Memory:跨 session 记项目上下文,"再来一张像第三张那样的"), Canva(Living Memory 持久记忆风格 + Enterprise 档 Team Context 从公司文件学), Adobe(Brand Intelligence:吃审批/拒稿/批注记录持续更新品牌理解;Add Brand from URL 30 秒建档), Klaviyo(双 agent 写回同一 profile 的数据飞轮), ManyChat(AI Behavior 读 IG bio 自动建议人设)
- **是什么**: agent 的"懂你"层:品牌资产+语气+偏好持续积累,并且从老板的日常批改里自动学——不用维护品牌手册。Adobe 把"拒稿=训练信号"讲成了架构。
- **SMB 度**: 高 — SMB 最怕 AI 产出"不像我的店";记忆同时是换不走的黏性,竞品共同的护城河设计。
- **FIKIRTIVE 现状**: 部分有 — brand memory 在规划/重建中;Otto 有会话内上下文,无产品化的跨 session 记忆。
- **利弊**: 做 = 生成质量+黏性双收,URL 一键建档能把 onboarding 压到分钟级;成本 = 数据管道,且记错比没记更伤(错误偏好会连续产废)。
- **双模注**: 人工面 = 资产区手动维护可读的品牌文件;Otto 代劳 = 从批改/拒稿自动沉淀,生成时自动引用。

### O-05 【定时自主任务(Scheduled Agent Tasks)】
- **谁有**: Higgsfield(Scheduled Tasks:每日广告变体、每周竞品分析、每月内容日历), Canva(AI 2.0 Scheduling:定时后台批量产内容), GHL(生日/老客唤醒等预置定时自动化,工具级), HubSpot(scheduled workflow triggers,工具级非 agent 级)
- **是什么**: 给 agent 排班:"每天早上出 3 条广告变体""每周一给我竞品报告",到点自己干。Higgsfield 证明 SMB 会为"定时自动出素材"付钱。
- **SMB 度**: 高 — "我睡觉它也在干活"是"员工"和"工具"的分水岭体感。
- **FIKIRTIVE 现状**: 零(与 Otto scheduled skills 天然同构,但未建)。
- **利弊**: 做 = Otto 从"叫一下动一下"升级成常驻员工,留存与 credits 消耗双升;成本 = 无人值守的失败处理与费用失控风险,必须和 O-03 报价门联动。
- **双模注**: 人工面 = 一个可读的"例行任务"开关面板(文件系统式);Otto 代劳 = 到点执行、产出待审、超预算自动停。

### O-06 【Agent 护栏与上线前试驾场(Guardrails & AI Playground)】
- **谁有**: ManyChat(AI Playground:上线前模拟对话+每个答案显示引用了哪条知识+知识缺口检测;AI Behavior 人设护栏;Knowledge v2 可审核知识源), respond.io(guardrails+低置信度自动转人工+测试环境), Salesforce(Agentforce Guardrails:托管+自定义双层、话题白名单、Trust Layer), Adobe(brand validation 生成时校验、免费不耗 credits), Klaviyo(Agent Guidance:语气+决策规则+升级人工规则)
- **是什么**: 让老板"敢开 AI"的那套东西:定人设和边界、上线前试聊、答不了自动转人工、答案可溯源到知识条目。
- **SMB 度**: 高 — 对话 AI 直接对客户说话,一次翻车就是真实客户;"敢开"比"更聪明"先决。
- **FIKIRTIVE 现状**: 部分有 — skill 层 3-field fail-closed gate、money-gate 是内部护栏;面向客户对话的护栏/试驾场/溯源为零(因 O-01 未建)。
- **利弊**: 做 = O-01 的前置件,与"安全"北极星同构,ManyChat 的 playground 是现成的样板;成本 = 护栏系统本身要维护,过紧会把 agent 弄笨。
- **双模注**: 人工面 = 可读的规则/知识文件 + 试驾沙盒;Otto 代劳 = 按护栏自答、低置信度转人工并说明原因。

### O-07 【Agent 绩效/解决率面板(Agent Accountability Dashboard)】
- **谁有**: HubSpot(Customer Agent Analytics:解决率/转人工率/内容缺口;"72h 无转人工才算解决"的计费判定), respond.io(Responses/Resolutions 报表:首响时长、解决率), Salesforce(70% 自主解决率当公开销售武器;pay-per-resolution 自带判定), Klaviyo(按解决对话计费=自带度量)
- **是什么**: 回答"AI 员工这个月干了多少活":替你答了多少、答不上什么、省了多少时间。竞品把这个数字同时当销售武器和计费依据。
- **SMB 度**: 中偏高 — 老板付钱给"员工"就会问产出;没有面板,Otto 的劳动是隐形的。
- **FIKIRTIVE 现状**: 零(Analytics 页在规划,未含 Otto 劳动口径)。
- **利弊**: 做 = Otto 价值可见化 = 续费理由 + 未来按结果计费的地基;成本 = "解决/未解决"的判定本身是产品难题。
- **双模注**: 人工面 = Analytics 里一个"Otto 干了什么"版块;Otto 代劳 = 自己发周报("本周我回了 84 条,3 条转给你")。

### O-08 【AI 劳动怎么收钱(Agent Pricing Models)】
- **谁有**: HubSpot(2026-04 起按结果:$0.50/解决、$1/lead、$0.10/答,统一 HubSpot Credits), Salesforce(三轨并存:$2/会话、Flex Credits $0.10/动作、pay-per-resolution), Klaviyo(Customer Agent 按解决计费;Marketing Agent 捆绑订阅), GHL(从纯 token 进化到 $97/月 unlimited fair-use——因为按量造成使用焦虑), respond.io(AI fair-use 内含当获客钩子), ManyChat(反例:AI 整个是 $29/月 add-on), Higgsfield(agent 劳动烧 credits,连对话都按复杂度计价)
- **是什么**: 市场在三种收法之间试:按结果(解决才收)、打包进订阅(fair-use)、按用量(token/credits)。GHL 与 respond.io 的共同经验:对"劳动"按次收费会抑制核心行为。
- **SMB 度**: 高 — 这不是功能是定价决策,直接决定 SMB 敢不敢让 Otto 多干活。
- **FIKIRTIVE 现状**: 部分有 — credits 引擎(USD 锚定、reserve/settle)已跑,生成按 credits 已上线;Otto 劳动(回复/分析/操作)怎么计价未定。
- **利弊**: 按结果 = 风险移到卖方、对犹豫客户杀伤力大,但判定+margin 难;打包 = 鼓励使用但重度用户吃利润;按量 = 干净但有使用焦虑。三种都有大厂验证,是纯选择题。
- **双模注**: 人工操作免费是全行业共识;差异全在"Otto 干活"那部分怎么标价(依既有原则:定价永不写死在代码里)。

### O-09 【自然语言替代 builder(NL-as-the-Builder)】
- **谁有**: Klaviyo(Segments AI:说人话生成分群条件), HubSpot(AI 生成分群 Starter 起), Salesforce(Marketing Cloud Next 自然语言分群), ManyChat(Flow Builder AI Assistant,问卷式生成流程), GHL(Agent Studio 是反例:把节点画布施工包卖给用户)
- **是什么**: 用一句话替代拖拽画布:生成分群、规则、自动化流程。竞品的学习曲线抱怨(respond.io 上手 2-3 小时、GHL 2-4 周、"很多人没发出第一条自动化就放弃")证明 builder 本身就是痛点。
- **SMB 度**: 中偏高 — SMB 不想学 flow builder;但"生成的东西我看得懂、改得动"是信任底线。
- **FIKIRTIVE 现状**: 部分有 — Otto 本体天然是这条路线;缺"生成物落成可读规则文件"的产品面(自动回复/CRM 区未建,还没有 builder 可替代)。
- **利弊**: 做 = 直接吃掉竞品最大的抱怨(复杂度),与 file-system 哲学同构(Otto 写规则文件、人可改);风险 = 完全无可视 builder 时,排错与"它为什么这么做"的可解释性要靠别的面补。
- **双模注**: 人工面 = 可读规则文件 + 简单开关(不做 GHL 式画布是一个候选立场);Otto 代劳 = 自然语言进、规则文件出、双向同步。

### O-10 【效果反哺自主闭环(Performance→Next-Creative Loop)】
- **谁有**: Adobe(Ad Refresh + Content Intelligence:属性级归因→疲劳检测→几次点击换血;Next Best Creative 在 roadmap), Canva(Grow 2.0 Automatic Refresh:按 Meta 实际表现自动预生成下一轮素材——**SEA 未上线**), Klaviyo(双 agent 数据飞轮:客服写回 profile→营销更准), Higgsfield(Virality Predictor 只做发布前预测,无实测回路)
- **是什么**: agent 自己看投放数据→判断哪条疲劳/哪种属性有效→自动出下一轮素材。这是"agent 自主"在营销域的最高级形态,大厂都只做到半自动建议。
- **SMB 度**: 中偏高 — "哪种图会赚钱、疲劳了换哪条"是 SMB 问 agency 最多的问题;前提是有投放量。
- **FIKIRTIVE 现状**: 部分有地基 — Meta 读(G6)+写(G7)两端都握着、创作区在场;闭环本身零。
- **利弊**: 做 = 聚合器缺投放端、单域工具缺生成端,结构上只有 all-in-one 做得成的组合技;成本 = 依赖属性打标+归因先建好,自动换素材涉 spend-path 须走 money-gate。
- **双模注**: 人工面 = 分析页看数据、手动换素材;Otto 代劳 = 盯数据→报告"这条疲劳了"→批准后自动出下一轮。

### O-11 【预置岗位 agent 与 skill 生态(Packaged AI Employees & Skills)】
- **谁有**: Higgsfield(AI Employees:Cartoon Animator 24 skills / Motion Designer 43 / Product Photographer 24;Skills 可安装/复用/跨团队分享/slash command 触发,**可从 Claude、Claude Code、Codex、ChatGPT 导入 skills 和 memory**), GHL("AI Employee" 伞品牌 + Agent Studio 自建), HubSpot/Klaviyo(Custom Agents,Beta), Salesforce(Agent Builder:topics+actions 声明式圈范围)
- **是什么**: 把 agent 能力打包成"岗位"或可安装的 skill 来卖:预置员工降低上手,skill 市场造生态。Higgsfield 的 skills 形态与 FIKIRTIVE 的 defineOttoSkill 惊人同构。
- **SMB 度**: 中 — 本质是包装术,但影响购买心智("我雇了个摄影师"比"我开了个功能"好懂)。
- **FIKIRTIVE 现状**: 部分有 — defineOttoSkill 框架 + 15 skills 已跑,但 skills 是 BELCORT 写的内部件,无用户侧安装/分享/导入;"一个 Otto"方向已锁(不拆多员工)。
- **利弊**: 做(skill 分组展示/行业包)= 上手叙事 + Agency 楼层交付效率(类 GHL Snapshots 的行业包);风险 = 拆多员工与既定方向相悖,skill 市场是 15M 用户体量的玩法。
- **双模注**: 人工面 = skill 开关面板(文件系统式,已符合);Otto 代劳 = 按任务自动选 skill,用户无需指定岗位。

### O-12 【嵌入式点状 AI(Embedded AI Everywhere)】
- **谁有**: HubSpot(100+ 嵌入式 AI:写邮件/摘要/评分/转写), Klaviyo(K:AI 40+:subject line/send time/表单时机), Salesforce(Einstein 十几个点状功能散布各档), Canva(Magic Studio 全家桶), GHL(Content AI / Workflow AI 节点,按次计价)
- **是什么**: 在每个工具界面塞一个 AI 按钮:写文案、择时、打分、摘要。行业 table stakes,②类的主体形态。
- **SMB 度**: 中 — 单点提效真实但同质化;"有 AI 按钮"已是用户默认预期。
- **FIKIRTIVE 现状**: 部分有 — 创作区生成本身是 AI 原生;"每楼每处塞按钮"的路线未走(Otto 对话是统一入口)。
- **利弊**: 跟随 = 满足"就地小改"习惯(改语气/翻译不想专门跟 agent 对话);不跟 = 保住"一个员工"叙事纯度、省 N 个小功能维护。两路线不互斥,颗粒度是决策点。
- **双模注**: 人工面 = 界面内就地 AI 小按钮;Otto 代劳 = 同一能力经对话调用——同能力双入口的维护成本要计。

### O-13 【Agent 外接 connectors(Tool Connectors)】
- **谁有**: Higgsfield(30+:Slack/Drive/Notion/Gmail/Figma), Canva(AI 2.0 Connectors:Slack/Gmail/Drive/Notion/HubSpot/Microsoft/Atlassian/Linear), Adobe(Agent Orchestrator 跨自家 SKU 编排)
- **是什么**: 让 agent 伸手进用户的其他工作工具(读 Gmail、写 Notion、发 Slack),从"产品内员工"扩成"工作流员工"。
- **SMB 度**: 低 — SEA SMB 主战场在 WhatsApp/Meta/TikTok/Shopee,不在 Notion/Slack;这是欧美知识工作者语境。
- **FIKIRTIVE 现状**: 零(Meta connector 是渠道接入,不属此类)。
- **利弊**: 做 = 伸进用户日常工具的黏性;成本 = 每个 connector 都是持续维护面,对 SEA ICP 偏企业虚胖。
- **双模注**: 人工面 = 无(纯 agent 能力);Otto 代劳 = 跨工具取数/投递。

### O-14 【对外被 agent 操作(MCP/CLI/Open Agent Interface)】
- **谁有**: Higgsfield(hosted MCP 端点暴露 30+ 模型、OAuth 免 API key、订阅 credits 直接通用;CLI 给 coding agent;Cloud API + Python SDK。注意:unlimited/免费额度不走 MCP/CLI), Canva(Design Model 接入 ChatGPT/Claude/Gemini,MCP 式分发)
- **是什么**: 反向开放:让**别人的** agent(Claude/ChatGPT/coding agents)来操作你的平台,把自己变成 AI 生态里的一个工具,当分发获客渠道用。
- **SMB 度**: 低(间接)— SMB 用户不直接感知;价值在获客渠道与生态位。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做 = 蹭 agent 生态分发,FIKIRTIVE 的 skill 面技术上天然可暴露;风险 = "让别人的 agent 操作 FIKIRTIVE"与"卖 Otto"有战略张力(外部 agent 顶替了 Otto 的位置),先内后外是已记录的候选立场。
- **双模注**: 人工面 = 无;这是"Otto 之外的第三种操作者"——外部 agent,边界由 founder 划。

---

## Otto 差异化定位选项(选项并列,不替 founder 决定)

| 选项 | 定位一句话 | 依据 | 代价/风险 |
|---|---|---|---|
| **A. 生成完的下一公里** | 不比"生成得更好",比"生成完之后":素材→排期→投放→回复→归因一个员工跑通 | Higgsfield 消费者版无发布/投放/回复闭环;①②类玩家全部出不了自己那格 | 要求多个区同时到"能用",闭环没缝完之前故事不成立 |
| **B. SEA 本地超级员工** | WhatsApp-first + BM/华语/Manglish + MYR 计价 + Shopee/TikTok 语境 | 全部竞品 USD 计价、email-first、无 SEA 渠道;Canva Grow/Klaviyo WhatsApp 都还没到 SEA | 窗口会关(Canva Grow 开 SEA、Klaviyo WhatsApp GA 之日);本地化不是护城河只是先手 |
| **C. 一个员工 vs 一堆 agent 拼盘** | 单一身份、跨区记忆、单一对话入口——对比 GHL 拼盘/Breeze 各管一摊/Einstein 点状互不知情 | GHL 五六个 AI 各自开关各自计费互不知情;HubSpot/Salesforce agent 之间不互通 | 叙事优势要靠 O-04 记忆和跨区动作真实兑现,否则只是营销话术 |
| **D. operates 100% 覆盖率承诺** | 每个手动功能天生是 Otto skill,不存在"AI 够不着的角落"——对比 Agentforce topics/actions 白名单 | Salesforce/HubSpot 的 agent 只覆盖被显式建模的动作;defineOttoSkill 框架已是这个架构 | 覆盖率承诺 = 每建一楼都背一份 agent 化成本;100% 是纪律不是一次性功能 |

四个选项不互斥;A+B 是市场切入角度,C+D 是产品结构角度。

## Higgsfield Supercomputer × Otto 逐能力对比表

(市场上唯一的③类同类;他们 15M 用户、$500M ARR、只站创意一个区)

| 能力 | Higgsfield Supercomputer | Otto 现状 | 他们有、我们没有的 |
|---|---|---|---|
| **覆盖域** | 只操作创意 district(brief→素材);消费者版无 CRM/回复/投放/排期/归因;企业版 2.0 才伸向"发布+优化" | 创作 + Meta 投放写入(build-as-PAUSED)已通;全 OS 是愿景 | (反向:我们有投放写入端,他们消费者版没有) |
| **Skills** | 可安装、可复用、可跨团队分享、slash command 触发;**可从 Claude/Claude Code/Codex/ChatGPT 导入 skills 和 memory** | defineOttoSkill 框架 + 15 skills,BELCORT 内部编写 | 用户侧安装/分享;外部 skills+memory 导入 |
| **预置岗位** | AI Employees 4 个(24-43 skills/个) | 单 Otto("一个员工"方向已锁) | 岗位化包装 / skill 分组的展示方式 |
| **Memory** | 跨 session 项目记忆("再来一张像第三张那样的") | 会话内上下文;brand memory 在建 | 产品化的跨 session 生成偏好记忆 |
| **Connectors** | 30+(Slack/Drive/Notion/Gmail/Figma) | 零(Meta 是渠道不是工具 connector) | 整类全缺(SEA SMB 价值低,见 O-13) |
| **Scheduled Tasks** | 每日广告变体/每周竞品分析/每月内容日历 | 零 | 整类全缺(见 O-05) |
| **审批(花钱门)** | 每次执行前展示预估 credit 成本、批准才执行;统一报价交互 | ask-before-spend + canvas cost-confirm + G7 launch gate,机制在但散落 | 统一"报价卡"产品化 UI |
| **计费** | agent 劳动烧 credits(连文字请求按复杂度和所选 LLM 计价) | 生成烧 credits(引擎就绪);Otto 劳动计价未定 | 劳动计价机制本身(是否要学存疑——GHL/respond.io 反向证据见 O-08) |
| **LLM 路由** | Opus/GPT-5.5/Gemini 用户可选 + auto 路由 | 内部固定选型 | 用户侧模型选择(其研究已标注:对 SMB 是噪音) |
| **对外接口** | MCP(30+ 模型、OAuth、credits 通用)/ CLI / Cloud API | 零 | 整类全缺(战略张力见 O-14) |
| **反馈回路** | Virality Predictor 只做发布前"预测" | 有真实 ads/organic 数据两端,可做"实测归因→反哺" | (反向:闭环地基我们占优) |
| **本地化** | USD、英文文化梗、无 SEA 运营;Trustpilot 3.2、高峰排队 | MYR 计价、SEA 在地 | (反向:我们占优) |

---

## O 区遗漏检查

刻意没设簇的三样,以及为什么:

1. **多 LLM 手动选择**(Higgsfield 让用户挑 Opus vs GPT-5.5)— 其自家研究已标"对 SMB 是噪音,auto 路由才是对的默认";只留在对比表一行,不值得一个 founder 决策簇。
2. **Agent 施工包**(GHL Agent Studio、HubSpot/Klaviyo Custom Agents 这类"给你造 agent 的节点画布")— 与"出厂即全能员工"路线正相反,本质是 n8n 式把集成负担还给用户;作为 O-09/O-11 的反例引用即可,不是 FIKIRTIVE 会做的方向选项。
3. **Voice AI / 电话 agent**(GHL Voice AI、respond.io Voice AI Agents、Salesforce Voice)— 属于自动回复区的**渠道选择**问题而非 AI 打法横切,且 SEA 电话获客弱、WhatsApp 语音才是本地形态;留给回复区的 worksheet 处理。

另注:Breeze Intelligence/Clearbit 式 2 亿画像数据资产、Supercomputer 2.0 的 NVIDIA/SOC2 企业叙事,均为收购/规模型壁垒或 Fortune 500 虚胖,不构成 SMB 层面的决策项,未设簇。

---

# G 区 —— Agency 楼层 + 定价打包

# G 区 — Agency 楼层 + 定价打包横切

> 性质:WHAT-pass 候选清单,不是决定。信源 = docs/research/2026-07-03-* 全部 17 份报告;本区聚焦 ①agency 机制 ②定价打包结构。凡"利弊"均中立呈现,决定权在 founder。

## G 区定价模型全景(17 份报告 → 12 条产品线对比)

> 注:HubSpot 3 份、Salesforce 3 份各合并为一行;campaign-management-cross 是横切研究、无独立定价,不占行。

| # | 产品 | 主计费轴 | 入门价 | 用量/credits 层 | Agency/转售层 | 对 FIKIRTIVE 订阅层的启示 |
|---|---|---|---|---|---|---|
| 1 | GoHighLevel | 平台订阅按规模档 | $97/$297/$497 | 通信/AI 成本价按量 + 一排 per-sub-account add-ons | sub-accounts/Snapshots/白标/SaaS Mode/加价转售 | 功能全在 $97 档,档位卖"规模+转售权"不卖功能 |
| 2 | Klaviyo | active profiles(功能不锁档) | Free;$20@500→$2,300@250k profiles | SMS/WhatsApp 走 credits;Customer Agent 按解决对话数 | Portfolio 多账号管理(免费) | 规模计费+25% 涨幅上限;每条新产品线单开计费轴 |
| 3 | respond.io | 订阅档 + MAC + 席位 | $79/$159/$279 | MAC 超额 $12–15/100;AI fair-use 内含 | Multiple Workspaces(Advanced 档) | "回复才计费"对齐价值时刻;WhatsApp 会话费零加价 |
| 4 | ManyChat | active contacts | Free 25 个;$14/$29/$69/$139 | 超额 contacts + AI $29/月 add-on + Meta 会话费平台外 | 多客户 workspaces + partner 50–100% 分成 | value-metric 反噬标本:免费层 1,000→25 引发"pricing trap"骂名 |
| 5 | Buffer | per-channel(不数坐席) | Free;$5/$10/频道/月,量级折扣 | 无(AI 免费无限) | Team 档三级权限拼多客户;独立 Agency 档已取消 | 能力面全免费、付费墙只卡"量" |
| 6 | Metricool | per-Brand(团队成员免费) | Free;5 brands ≈ €16–20/月 | AI credits per-brand;Hashtag Tracker €25/天按天买 | 50+ brands Custom 档 + White Label | Brand=唯一计价原子;贵且偶发的功能按天剥离卖 |
| 7 | Canva | freemium + 席位 | Free;Pro $15;Business $20/人;**MY Pro ≈ RM250/年** | AI credit 池封顶 + AI Pass $100/月放大 | Brand Kit/Controls/审批(Business/Ent) | 全场唯一本地价+FPX/GrabPay;AI 重度用户单独收割 |
| 8 | Higgsfield | 订阅 + credits(月清零) | Free;$15/$49/$129;Business $89/席 | 全部烧 credits(agent 对话也烧);廉价模型 unlimited add-on | Business 席位共享 credit 池 | approve-before-spend 报价卡;"unlimited"话术不诚实 → Trustpilot 3.2 |
| 9 | LTX Studio | 订阅 + credits | Free;$15/$35/$125 | credits 按输出秒,模型越贵扣越多 | Brand Kit/组织管理锁 Enterprise | 商用授权本身当付费墙(Standard 起才可商用) |
| 10 | Adobe GenStudio | 企业 quote:席位×用量×容量 | 无公开价(估年费六位数 USD,未核实) | Generative Actions 6 万/年;品牌校验免费、生成收费 | 双层席位(创作席贵/审批席便宜)+ Agency System of Record | "校验免费、生成收费"的消耗边界设计 |
| 11 | HubSpot(Mkt/Sales/Service 三 Hub) | per-seat + marketing contacts | Free 2 席;Starter $7–20/席;Mkt Pro $800/月 + $3k onboarding | HubSpot Credits;Breeze agent 2026-04 起按结果计费 | 无 sub-account 产品;靠 partner agency 网络 | 免费引流 + 席位陡坡;AI 按"完成的任务"扣 |
| 12 | Salesforce(CRM/Mkt/Service 三线) | per-seat;marketing 按 org | $25→$330/席;MC $1,250–1,500/月 org 起 | Data Cloud/Flex credits;add-ons 让实际账单翻倍 | Multi-Business-Unit(Enterprise);实施 partner 生态 | 反面参照:定价工程把 95%+ MY SMB 挡在门外 |

---

### G-01 【计价原子的选择(Pricing Atom: Brand / Channel / Seat / Contact)】
- **谁有**: Metricool(Brand 计价、团队成员无限免费), Buffer(per-channel、不数坐席), GHL(无限 users、按 sub-account 数), Klaviyo/ManyChat(按联系人数), respond.io(席位+MAC 双轴), HubSpot/Salesforce(per-seat), Adobe(双层席位:创作贵审批便宜)
- **是什么**: 每家先选一个"规模单位"来收钱——按品牌数、频道数、人头、还是联系人数;这个选择决定客户长大时账单怎么涨、升级动机是什么。Metricool/Buffer/GHL 都刻意不数人头,让团队随便加人,收入跟客户的生意规模走而不是跟内部人数走。
- **SMB 度**: 高 — 马来西亚 SMB 常是"老板+店员+兼职"混编,不数人头的原子(org/brand)对他们摩擦最小。
- **FIKIRTIVE 现状**: 部分有 — org 模型已在(Organization + settings、credit 按 org 计量);订阅层未建,计价原子未选。
- **利弊**: 选对原子定价心智极简、agency 场景收入自动随客户数增长;但原子一旦选定极难改——Klaviyo 改 active-profile 口径导致老客账单 $150→$375 的怨气是前车之鉴。
- **双模注**: 人工面 = 账单页"你有 N 个 org/brand、各多少钱";Otto 面 = Otto 的劳动与花费按 org 归集,报价卡按 org 报。

### G-02 【功能全开、档位卖规模(Full-Feature Tiers, Sell Scale Not Features)】
- **谁有**: GHL($97 档功能几乎全开,$297/$497 只卖 sub-account 数+转售权), Klaviyo(所有档功能完全一样、价格纯随名单涨), Buffer(付费墙只卡量不卡能力面);反面流派:respond.io(Starter $79 被评为"诱饵档",自动化锁 $159), HubSpot(campaigns/automation 锁 Pro $800/月), LTX(商用授权+旗舰模型锁档)
- **是什么**: 两种流派——低档全功能、高档只解锁规模;或关键功能锁高档当升级钩子。前者低档用户体验完整、口碑好、升级动机自然("长大了自然要多开户");后者入门便宜但用户一碰墙就骂。
- **SMB 度**: 高 — MY SMB 预算敏感且最恨"阉割版";在靠 FB group/WhatsApp 转介绍的口碑市场,全功能低档更利传播。
- **FIKIRTIVE 现状**: 零 — 订阅档位结构还不存在(credit 包已 live,订阅层是 open GTM 项)。
- **利弊**: 全功能开放让每个 SMB 完整体验 Otto、避免功能怨气;代价是放弃"功能解锁"这根升级杠杆,上探只能靠规模/用量/Agency 权限。
- **双模注**: 人工面 = 定价页档位对比表;Otto 面 = Otto 在任何档都全能,档位只差"能开几个 org、能花多少 credit"。

### G-03 【订阅 + Credits 双层(Subscription + Credits Metering)】
- **谁有**: Higgsfield(订阅送月度 credits、月清零、补充包 90 天过期、廉价模型 unlimited add-on), LTX(credits 按输出秒、模型分层扣), Canva(AI credit 池 + AI Pass $100/月收割重度), Adobe(Generative Actions,校验免费生成收费), Metricool(AI credits per-brand), HubSpot(HubSpot Credits 500/3,000/5,000)
- **是什么**: 订阅当底租,生成/AI 的硬成本用 credits 计量,重度用户用加购包或"放大档"单独收。Higgsfield 还证明"廉价模型不限量 + 旗舰模型走 credits"可当留存钩子——但条款不诚实直接反噬口碑(Trustpilot 3.2)。
- **SMB 度**: 高 — 生成成本必须封顶 SMB 才敢用;但"月清零/过期作废"制造焦虑,是普遍差评源。
- **FIKIRTIVE 现状**: 已有对应楼 — credit 引擎全量在跑(USD 锚定 1cr=$0.10、reserve/settle、MYR credit 包 live);缺"订阅送多少 credits、是否滚存"这层设计。
- **利弊**: 双层被全行业验证、与现有引擎零改造衔接;风险全在细节——清零/过期/unlimited 措辞是口碑雷区。
- **双模注**: 人工面 = 余额实时显示+充值页(已有);Otto 面 = 花钱前报价卡(ask-before-spend + canvas cost-confirm 已同构)。

### G-04 【Otto/AI 劳动怎么计价(Agent Labor Pricing: Bundled vs Outcome vs Per-Use)】
- **谁有**: Klaviyo(Marketing Agent 捆绑付费档;Customer Agent 按解决对话数收), HubSpot(Breeze 2026-04 起按结果计费——任务完成才扣 credits), GHL(从纯 token 计价进化到 $97/月 unlimited fair-use,因按次收费抑制使用), respond.io(AI fair-use 内含当获客钩子), ManyChat(AI 是 $29/月 add-on,任何档不含), Higgsfield(agent 连对话都烧 credits,配 approve-before-spend)
- **是什么**: agent 的"劳动"有四种收法:捆绑进订阅、按结果计费、按次/token、独立 add-on。GHL 的教训是按次计费让用户不敢用 AI;Klaviyo/HubSpot 证明 SMB 接受"按结果付钱"。
- **SMB 度**: 高 — Otto 是 FIKIRTIVE 的主角,这条决定 SMB 敢不敢让 Otto 天天干活。
- **FIKIRTIVE 现状**: 零(未定价) — Otto 劳动目前不计费,只有生成走 credits;founder 既定方向是 margin 押在 Otto(订阅+per-task 候选)。
- **利弊**: 劳动打包进订阅消除使用焦虑、与"video 近成本卖"互补成完整 margin 故事;按结果计费收入上限更高但计量与争议成本大,两者皆有市场验证。
- **双模注**: 人工操作(工具本体)各家都不计费;Otto 的劳动本身是计价对象——无论选哪种,前提是 Otto 的动作有清晰可数的单位(对话/任务/成果)。

### G-05 【免费层设计(Free Tier as Acquisition Weapon)】
- **谁有**: Buffer(AI+评论收件箱+Start Page 全免费、付费只卡量), Canva(免费档"终身 5 个视频 credit"制造饥饿), Klaviyo(Free 250 profiles 连 Marketing Agent 都含), Metricool(Free 1 brand/约 20 帖/30 天历史), ManyChat(反面:免费层 1,000→25 contacts 砍 97.5% 引发社区反弹), Higgsfield(每天 ~10 credits 带水印), Salesforce/HubSpot(Free 2 席引流档)
- **是什么**: 两种用法——Buffer 式"能力全给、量收费"让用户免费期练出全产品肌肉记忆;Canva 式"给一小口尝味道"制造升级饥饿。ManyChat 证明事后砍免费层比一开始不给伤得更重。
- **SMB 度**: 高 — MY 微型企业决策链短、试了才买,免费层就是他们的整个评估流程。
- **FIKIRTIVE 现状**: 部分有 — 100 free credits/org(已从 1,000 砍到 100),无功能限制概念;无正式 Free tier 定义。
- **利弊**: 大方的免费层加速口碑获客、给 Otto 第一天就"挣到钱"的证明机会(对应 GHL Missed-Call-Text-Back 的 aha 时刻);成本是真金白银的生成费+白嫖率,且日后收紧会像 ManyChat 一样反噬。
- **双模注**: 人工面 = 免费额度进度条;Otto 面 = 免费期 Otto 主动展示"我今天帮你做了 X"是最强转化路径。

### G-06 【本地货币与本地支付(Local Currency & Payment Rails)】
- **谁有**: Canva(全场唯一:MY Pro ≈ RM250/年、FPX/GrabPay/信用卡);其余 11 条产品线全 USD 计价(GHL 币种设定后不可改;respond.io 总部在 KL 也收 USD)
- **是什么**: 用马币标价+本地支付轨道收钱。Canva 证明 MY SMB 付费意愿没问题——摩擦解决了他们早就在付;其余家全让 MY 用户扛汇率+跨境信用卡门槛。
- **SMB 度**: 高 — RM 标价是"这产品是给我的"的第一信号;很多 MY 小商家根本没有可跨境扣款的卡。
- **FIKIRTIVE 现状**: 部分有 — Stripe MYR credit 包已 live(RM25/100/250);订阅层 MYR 未做;界面仍有 $ 硬编码遗留(货币显示项)。
- **利弊**: 本地化定价是对全部 17 份对标里几乎无人做的结构性差异;成本是汇率价差管理(credit 引擎 USD 锚定 vs MYR 售价需要有人盯)。
- **双模注**: 人工面 = RM 定价页 + FPX 结账;Otto 面 = Otto 报成本直接说 RM(报价卡本地化)。

### G-07 【通道费的姿态(Channel Fee Posture: Pass-Through vs Markup)】
- **谁有**: respond.io(WhatsApp 官方 BSP、Meta 会话费零加价直传 + 平台内 WABA 余额管理,当信任卖点), GHL(通信费成本价计量、$497 档开放 agency 加价、自己只抽 carrier 5%), ManyChat/Klaviyo(会话费平台外收/换算成自家 credits), HubSpot(WhatsApp 模板超额约 $70/千条)
- **是什么**: 将来接 WhatsApp/通信类"过路费"时,平台有三种姿态:赚差价、透明直传、或推到平台外。respond.io 把"不赚 Meta 差价"做成营销卖点,同时把充值/余额留在自己平台里赚钱包粘性。
- **SMB 度**: 中高 — WhatsApp 是 MY 生意主渠道,会话费姿态直接影响信任;但要等 FIKIRTIVE 接通道时才真正落地。
- **FIKIRTIVE 现状**: 零 — 尚未接 WhatsApp/通信通道;credit 引擎已具备计量底座。
- **利弊**: 透明直传换信任、把 margin 留给"智能"(与"video 近成本、赚 Otto"同构);赚差价多一条收入但答不上"为什么你比 Meta 贵"。
- **双模注**: 人工面 = 通道费余额/充值面板(respond.io WhatsApp Fees 模块形态);Otto 面 = Otto 群发前先报"这波 Meta 大约收 RM X"。

### G-08 【Add-on 第二计费轴(Add-ons & Pulse Pricing)】
- **谁有**: Klaviyo(每条产品线单开计费轴:Reviews 按订单量、Analytics $100/月、Customer Agent 按对话), GHL(一排 per-sub-account add-ons:AI Employee $50–97、WhatsApp $10、Listings $30), Metricool(X add-on ~$5/月;Hashtag Tracker €25/天按天买、买 4 送 1), Canva(AI Pass $100/月), ManyChat(AI $29/月)
- **是什么**: 把"贵且偶发"或"特定人群才要"的能力从订阅里剥出来单独收——按月 add-on、按天道具、或挂在另一个规模量(订单/对话)上。Metricool 的按天计费专治"成本高、使用天然脉冲式"的功能。
- **SMB 度**: 中 — 用得上的觉得公平;但 add-on 一多就变 GHL/ManyChat 式"标价 $29 实付 $130",反成怨气源。
- **FIKIRTIVE 现状**: 部分有 — credit 包本质是按量 add-on;无功能型 add-on。
- **利弊**: 保持主订阅价干净、重成本转嫁给真重度用户(未来深度竞品扫描/大规模聆听类适用);风险是账单碎片化伤"简单"心智,与 all-in-one 叙事有张力。
- **双模注**: 人工面 = add-on 开关/商店页;Otto 面 = Otto 要用到未开通能力时先报价请求开通(Higgsfield agent 报价模式)。

### G-09 【行业开店模板 / 配置快照(Snapshots & Cross-Account Cloning)】
- **谁有**: GHL(Snapshots:整个 sub-account 配置——workflows/漏斗/pipeline/模板/字段/tags——打包一键导入,官方十几个行业包 + 第三方买卖市场), Klaviyo(Portfolio 跨账号克隆表单/分群/整个 campaign), ManyChat(35+ 模板 + 伙伴 white-label 模板包生态), Metricool(报告模板复用), Adobe(starter templates + logo swap 多品牌换标)
- **是什么**: 把一套调好的配置打包成"快照",新账号一键装——把 10 小时人肉开荒压成 10 分钟。GHL 靠它让 agency 规模化交付,甚至长出了 snapshot 买卖市场。
- **SMB 度**: 高 — 对 MY SMB 是"开箱即营业"(餐饮/美容/补习行业包);对 agency 是交付效率核心件,两头都值钱。
- **FIKIRTIVE 现状**: 部分有(哲学同构) — Otto skills 已是可读文件+开关;但无 org 级"打包→导入"机制,brand memory 骨架未模板化。
- **利弊**: 模板=可读文件,天然符合 file-system 管理哲学,且同时服务 SMB onboarding 和 Agency 楼层;成本是行业库要持续养,org 配置的导入/覆盖语义要设计。
- **双模注**: 人工面 = 模板库页"选行业包→导入";Otto 面 = Otto 按行业+brand memory 自动装配开店包(比 GHL 静态快照多一层个性化)。

### G-10 【多客户工作区隔离(Sub-Accounts / Workspaces)】
- **谁有**: GHL(Sub-Accounts:3 个@$97 → 无限@$297,每客户独立 CRM/漏斗/自动化), respond.io(Multiple Workspaces,$279 档), ManyChat(多客户 workspaces 主账号切换), Klaviyo(Portfolio:一个登录管全部品牌账号 + 集中账单 + 全局 dashboard,免费), Metricool(Brand 即隔离单元,50-brand 档), Salesforce MC(Multi-Business-Unit,Enterprise);反例 Buffer(无 workspace,靠频道级权限拼隔离)
- **是什么**: agency 给每个客户一个独立空间(数据/自动化/账单隔离),配一个总控台切换 + 全局看板。这是 agency 生意的地基,各家全押在高档位或专门产品线上。
- **SMB 度**: 中 — SMB 自己单 org 用不到;但 MY 大量 SMB 实际由 freelancer/小 agency 代管,隔离质量决定他们的数据安全。
- **FIKIRTIVE 现状**: 部分有 — org 模型 + operator console(founder/staff 管理后台)已在;缺"agency 主账号管多 org"的伞层。
- **利弊**: 打开 agency 分销渠道(GHL 证明这是规模化引擎)且底层 org 隔离已在;成本是权限/账单/数据边界工程量 + 要把"客户归谁"这层商业关系写进产品(GHL 的 SMB 换 agency 迁移之痛是反面教材)。
- **双模注**: 人工面 = agency 总控台(客户列表 + 切换 + 全局 dashboard);Otto 面 = 每个客户 org 有自己的 Otto(独立 brand memory),agency 看到的是 N 个 Otto 的工作汇总。

### G-11 【Agency-客户审批与权限(Client Approval & Tiered Permissions)】
- **谁有**: Buffer(三级权限 Admin/Full Posting/Requires Approval + Approvals tab,权限按频道分), Metricool(Approval System:审批人一键通过/提修改、过审自动发,Advanced 档), Canva(Brand Controls 硬管制 + Design Approvals 多级), Adobe(Power/Collaborator 双层席位 + Agency System of Record 留痕), HubSpot(content approvals,Enterprise), Salesforce(Approval Processes,Enterprise+)
- **是什么**: "乙方做、甲方点头才发"的流程:分级权限(能编 vs 只能提交)+ 审批队列 + 批注留痕。Adobe 甚至按这个结构定价——创作席贵、审批席便宜。
- **SMB 度**: 中 — 单老板自己发自己批用不上;但 MY 代运营场景"客户点头才发"是常态,也是 agency 避责刚需。
- **FIKIRTIVE 现状**: 部分有 — Otto 的 plan-approval/SoD(人批 agent)已是同构机制;无人-人审批流。
- **利弊**: 把既有"计划→批准→执行"门复用成 agency-客户审批,低成本打开代运营市场;风险是多角色权限矩阵是复杂度深坑(Buffer 证明轻量三级也够用)。
- **双模注**: 人工面 = Approvals 队列 + 按频道/楼层的角色开关;Otto 面 = Otto 产出全进"待审"状态,放行权由同一套权限管。

### G-12 【品牌化客户报告(White-Label Client Reports)】
- **谁有**: Metricool(PDF/PPT + 自定义模板 + 客户 logo + 定时自动寄送;Studio"滚动时间窗 live URL";White Label 去品牌在 Custom 档), Buffer(custom reports 加 logo/封面导出 PDF,Team 档), LTX(pitch deck 一键 PDF), Klaviyo(Portfolio 全局绩效 dashboard), GHL(坐席级报表,$497 档)
- **是什么**: agency 拿去交差的月报:套客户品牌的 PDF/PPT、设一次每月自动寄、或一条永远显示最新数据的 live 链接。报告是小 agency 向客户证明价值的唯一物证,也因此是留存核弹。
- **SMB 度**: 中 — SMB 端多为被动收报告;但"老板每月收到一份看得懂的 RM 报告"对直客 SMB 同样是粘性件。
- **FIKIRTIVE 现状**: 零 — 分析区已 spec(ads+organic+history),无导出/品牌化/定时寄送层。
- **利弊**: 分析区数据就绪后增量成本低、agency 与直客双向增粘;风险小,主要是模板维护 + live URL 的权限边界要想清。
- **双模注**: 人工面 = 报告模板编辑器 + 定时寄送设置;Otto 面 = Otto 每月自动写报告并配一段人话解读(比 Metricool Studio 的 AI 摘要多了品牌记忆)。

### G-13 【用量转售与加价(Rebilling with Markup)】
- **谁有**: GHL(独一档:$497 解锁通信/AI 用量由 agency 自设加价率转售、差价全归 agency、GHL 只抽 carrier 5%;add-ons 也可转售), respond.io(反面姿态:零加价当信任卖点), Higgsfield(Business 席位共享 credit 池——池化但无 markup)
- **是什么**: 平台按成本价给 agency 计量用量,agency 给自己客户自设加价转售,差价归 agency——GHL 用"让利"换 agency 深度锁定。FIKIRTIVE 语境 = 让 agency 给客户 org 配 credit 池并自设 markup。
- **SMB 度**: 低 — SMB 无感(只看到 agency 报的价);价值全在 Agency 楼层的商业模型。
- **FIKIRTIVE 现状**: 部分有(底座) — credit 引擎(USD 锚定、reserve/settle)已具备计量能力;无转售/池化/markup 层。
- **利弊**: 是 agency 锁定的最强机制(agency 的利润生意长在你平台上);成本是开出一个新 money-path 面(分账、结算、争议),与 ask-before-spend 安全哲学需要新的边界设计。
- **双模注**: 人工面 = agency 的 credit 池管理 + 每客户 markup 设置;Otto 面 = Otto 花 credit 时按该 org 的转售价报价,计量自动分账。

### G-14 【白标(White-Label Platform)】
- **谁有**: GHL(自有域名+logo+配色跑整个平台 $297 起;白标手机 App $497/月;Branded Client Portal $49/月/sub-account), Metricool(White Label 仅 Custom 档), ManyChat(伙伴卖 white-label 模板包——模板级白标)
- **是什么**: agency 把平台贴自己的牌子卖给客户(域名/logo/App 全换),客户以为在用 agency 自家软件。GHL 把它做成 $297→$497 的核心升级钩子。
- **SMB 度**: 低 — 终端 SMB 完全无感;纯 agency 生意基建。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 白标是 agency 愿付高价签长约的理由(他们的品牌资产建在你上面);风险是 FIKIRTIVE/Otto 品牌在终端用户面前消失——与"卖 Otto 这个明星员工"的品牌战略直接张力,且白标 App 维护是重活(GHL 白标 App 稳定性差是公开差评)。
- **双模注**: 人工面 = agency 后台品牌设置页(域名/logo/色板);Otto 面 = Otto 要不要也"换名换脸"是白标深度的关键决策(平台白标 vs 员工白标)。

### G-15 【SaaS Mode 自助转售(SaaS Mode / Automated Resale)】
- **谁有**: GHL 独有($497 SaaS Pro:Plan Configurator 自建定价档并挂 snapshot、客户线上自助订阅→自动开 sub-account+配权限、Stripe 自动扣款、欠费自动锁户 dunning)
- **是什么**: 把"agency 转卖平台"全自动化——agency 自设三档价格,客户像买 SaaS 一样自助下单,开户/收钱/欠费锁定全自动。等于 GHL 让每个 agency 变成一家软件公司。
- **SMB 度**: 低 — SMB 只是买家;价值在把 agency 变成分销商网络。
- **FIKIRTIVE 现状**: 零。
- **利弊**: agency 分销的终极形态(GHL 靠它撑起 $497 档的存在意义);工程极重——计费引擎上再套一层计费引擎、支付合规、dunning,且逻辑上排在 sub-accounts/snapshots/rebilling 全部就绪之后。
- **双模注**: 人工面 = agency 的 Plan Configurator(自定价+挂模板);Otto 面 = 新客户自助下单后 Otto 按 snapshot 自动开荒 org(开户与配置一体完成)。

### G-16 【伙伴生态与 agency 获客(Partner Program & Prospecting)】
- **谁有**: ManyChat(Partner Program 首年最高 50% 分成、顶级 100% rev share、认证 Experts 目录——几千代理商靠它吃饭,是其护城河之一), GHL(Prospecting Tool:按地区找本地商户→自动生成"营销体检报告"→一键 outreach;另有 Affiliate Manager), HubSpot/Salesforce(庞大实施 partner 网络,MY 本地也有)
- **是什么**: 两件事:①给 agency/达人分成+认证目录,让他们替你卖;②给 agency 一个"帮潜在客户做免费营销体检"的获客工具。ManyChat 证明代理商生态本身能成为护城河。
- **SMB 度**: 低 — SMB 是被获客的对象;价值在渠道杠杆。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 分成生态是低成本规模化销售(MY 是靠信任/熟人网络的市场,尤其适配);成本是分成体系+伙伴管理是一整摊长期运营,逻辑上排在 Agency 楼层基本盘之后。
- **双模注**: 人工面 = 伙伴后台(分成报表+推广链接)+ 体检报告生成器;Otto 面 = Otto 替 agency 自动生成潜客的"营销体检报告"(GHL Prospecting 的 agent 化版本)。

---

## G 区遗漏检查

1. **GHL 电话/A2P 通信转售全家桶(号码转售、ringless voicemail、carrier 合规)** — 刻意排除:美国本地商户逻辑,SEA 通话获客弱、主战场是 WhatsApp;它虽是 GHL rebilling 的最大标的,但对 FIKIRTIVE 的转售层设计只需借"机制"(已收进 G-13),不需要借"标的物"。
2. **各家 credits 费率表级细节(Higgsfield/LTX"每模型每秒扣几点"、Klaviyo 各国 SMS credit 换算)** — 刻意排除:属执行层数字且多为未核实/随时变动,founder 在 WHAT-pass 决策的是结构(G-03/G-07),不是费率;定价 never hardcoded 也要求这些留在引擎配置层。
3. **HubSpot/Salesforce 的企业定价工程细节(onboarding 费、Agentforce 1 打包、Flex credits 换算)** — 刻意排除:只作为反面参照进了全景表;SMB 完全够不着这个价位,单独立簇没有决策价值。


---

# C 区 —— 创作(图/视频/分镜/编辑)

# 创作区(图/视频/分镜/编辑)— C 区功能簇(按 SMB 价值排序)

> 汇总自:Higgsfield、LTX Studio、Canva、Adobe GenStudio、HubSpot Marketing 五份研究(2026-07-03)。同类功能已跨产品合并;排序以马来西亚 SMB 价值为先。

### C-01 【UGC/广告成片工厂(UGC/Ad Factory)】
- **谁有**: Higgsfield(Marketing Studio,上线 30 天 68,000 用户;10 种模式:UGC 口播/开箱/试穿/测评/TV Spot/Ad Reference 等 + 40+ 预置 avatar + Hook 前 3 秒开场模板 + 商品 URL 自动抓取;另有 UGC Factory 40+ 模板、Click to Ad 商品链接直变广告), LTX Studio(UGC & Ad Editor,一条素材→多版本广告,偏企业档)
- **是什么**: 贴一条商品链接或传几张产品图,选一个"人设"和一种拍法(口播/开箱/试穿等),AI 直接产出可投放的成片广告,免剪辑免摆拍。把"拍一条广告"从请人拍摄变成点几下的事。
- **SMB 度**: 高——Shopee/Lazada/IG 卖家没预算请 KOL 和摄影师,这正是"帮我出一条能投的广告"的直接答案。
- **FIKIRTIVE 现状**: 零(创作区已有 i2v/t2v/多参考图等底层积木,但没有"成品工厂"这一层:无 avatar 库、无模式模板、无 URL 冷启动)。
- **利弊**: 做=对 SEA 电商 SMB 杀伤力最大的单一能力簇,且底层生成积木已在;成本=工程量大(抓取+选角+模式库+音画合成),需分期,且口播依赖对嘴/配音等新供应商。
- **双模注**: 人工面=贴链接→选 avatar→选模式→预览成片的向导式页面;Otto 代劳="给我的辣椒酱出 3 条 TikTok 口播广告"一句话跑完全流程,报价批准后执行。

### C-02 【竞品广告逆向工程(Ad Reference)】
- **谁有**: Higgsfield(Marketing Studio 的 Ad Reference 模式:上传竞品/参考广告,AI 拆解结构后套到你的产品上)
- **是什么**: 把一条跑得好的广告喂给 AI,它拆出开场 hook、节奏、镜头结构,再用你的产品照同样打法重拍一条。SMB 不会写 brief,但都会说"我要像这条一样"。
- **SMB 度**: 高——照抄爆款结构本来就是小商家的日常工作法,这是把它自动化。
- **FIKIRTIVE 现状**: 零(但已有 Meta ads library 搜索能力 + 参考视频/抽帧积木,链路材料齐了一半)。
- **利弊**: 做=可连成"Otto 自己找到同类目爆款→拆解→出你的版本"的闭环,比 Higgsfield 只能手动上传更强;风险=拆解质量不稳,太像原片有抄袭/侵权边界问题。
- **双模注**: 人工面=上传/粘贴一条参考广告→看 AI 拆出的结构→确认后生成;Otto 代劳=Otto 去 ads library 搜爆款、拆结构、直接给你成片候选。

### C-03 【一稿多尺寸(Magic Resize / GenExpand)】
- **谁有**: Canva(Magic Resize/Switch,一键转任意平台尺寸), Adobe GenStudio(GenExpand AI 扩图改比例,一素材适配全 placement), LTX Studio(智能 resize,AI 延伸背景适配任意画幅)
- **是什么**: 做好一张素材,一键变出 FB feed/IG Story/Reel/TikTok 全部尺寸,AI 自动延伸背景而不是硬裁切。用户从此不需要想"尺寸"这件事。
- **SMB 度**: 高——一店多平台是常态,"同一张图要三个尺寸"是每天的重复劳动。
- **FIKIRTIVE 现状**: 零(canvas 4 变体是"4 个方案",不是"1 个方案 × N 个尺寸";分镜卡画幅前置设置是否已有未核实)。
- **利弊**: 做=SMB 最高频刚需之一,生成侧原生解决(按平台批量出尺寸变体)比做像素级编辑器便宜;成本=扩图/延背景依赖模型能力(BytePlus 有无对应能力未核实)。
- **双模注**: 人工面=素材上一个"全平台尺寸"按钮出整套;Otto 代劳=排期/投放前 Otto 自动按目标平台补齐所有画幅。

### C-04 【多语言创意翻译(Magic Translate / 批量翻译)】
- **谁有**: Canva(Magic Translate,134 语言、保留版式、含 LTR↔RTL), Adobe GenStudio(40+ 语言 out-of-the-box 批量翻译、12+ 语言直接生成)
- **是什么**: 设计里的文字直接翻成另一种语言且版式不乱;一套素材一键变 EN/BM/中文三个版本。不是翻 caption,是翻"图里的字"和整套创意。
- **SMB 度**: 高——马来西亚三语市场的日常刚需,同一张促销图本来就要出三语。
- **FIKIRTIVE 现状**: 部分(Otto 写多语文案是本职;"图内文字保版式翻译/一键三语套装"为零)。
- **利弊**: 做=LLM 翻译便宜,且可做出比 Canva 更本地的 Manglish/BM 口语感;成本=图内文字替换渲染有技术门槛,BM 口语质量需人工抽查。
- **双模注**: 人工面=素材上选"出三语版本"直接生成三张;Otto 代劳=Otto 出素材时默认按品牌的语言市场配齐三语。

### C-05 【图像编辑工具箱(Editing Apps:扩图/重打光/换脸/去背/放大)】
- **谁有**: Higgsfield(41+ apps:Expand Image、Relight、Face Swap、Outfit Swap、Skin Enhancer、图+视频 Background Remover、720p→4K Upscale、Inpaint), Canva(Magic Edit/Eraser/Expand/Grab、Background Remover), LTX Studio(图+视频 Upscale、SDR→HDR、背景与物体移除)
- **是什么**: 生成之后的"修"字诀全家桶:圈选改物体、擦杂物、扩画布、重打光、抠背景、放大清晰度、换脸换装。每个都是独立小工具,合起来是"不用 Photoshop"的承诺。
- **SMB 度**: 高——去背+扩图+放大是店家的"设计急救包";差这口气,生成的图就废了。
- **FIKIRTIVE 现状**: 零(canvas 只能整图重出,没有任何局部编辑工具)。
- **利弊**: 做=补齐"生成→可用"最后一公里,且每个工具是独立可排期的小楼、可逐个上;成本=每个工具背后是一个模型能力/供应商选型,累积运维面不小。
- **双模注**: 人工面=选中图→工具条点"去背/扩图/重打光";Otto 代劳="把背景换成夜市、脸修亮一点"一句话完成。

### C-06 【角色一致性/数字分身 + 选角(Soul ID / Elements / Casting)】
- **谁有**: Higgsfield(Soul ID:≥20 张照片约 3 分钟训练出数字分身,跨风格/姿势/光线锁脸,训练后不限量;Character Locking 跨镜头一致;40+ 预置 avatar 选角), LTX Studio(Elements 四类资产 @tag 引用全项目一致;AI Character Generator 文字建人设;Face Switch 真人照片换脸植入;角色可绑定配音)
- **是什么**: 把老板/店员或虚构人设"训练"成 AI 认得的角色,以后每条图/视频里都是同一张脸同一个人设;或从现成 avatar 库挑一个当品牌代言人。
- **SMB 度**: 高——SEA 靠"人设"卖货,老板本人当品牌脸长期出内容,是 TikTok/IG 带货的地基。
- **FIKIRTIVE 现状**: 部分(多参考图/参考视频可做单次一致性;没有"训练一次、永久锁定"的角色资产,也没有 avatar 选角库)。
- **利弊**: 做=品牌人设是长期复用资产,天然沉进资产区变留存钩子;成本=训练/存储成本与归属(创作区生成、资产区存放)要想清,真人肖像授权有合规面。
- **双模注**: 人工面=上传照片→训练→资产区出现"我的分身"随处可 @;Otto 代劳=生成任何素材时 Otto 自动带上品牌人设,不用每次交代"还是那个人"。

### C-07 【数字人口播/配音(Lipsync + TTS + Dubbing + 改台词)】
- **谁有**: Higgsfield(Lipsync Studio 聚合 6 个对嘴模型,脚本/音频→会说话的 avatar,可用自己的 Soul ID 当主播), LTX Studio(TTS 配音、AI 配乐音效、AI Dubbing 克隆原声译 175+ 语言+自然对口型、AI Voice Editor 打字改台词不重拍)
- **是什么**: 让视频里的人开口说话:打一段脚本就有人对镜头念;念错价格/换促销词直接改字重合成,不用重拍;同一条口播还能翻成 BM/中文/淡米尔语并对好口型。
- **SMB 度**: 高——口播是转化率最高的广告形态,SMB 恰恰最没有"会出镜的人";多语 dubbing 对马来西亚混语市场是真痛点。
- **FIKIRTIVE 现状**: 零(视频无音频/对白能力)。
- **利弊**: 做=补上 UGC 工厂(C-01)的声音一半,"改台词不重拍"省钱心智极好;成本=对嘴/TTS 是新供应商新钱路须单独议价,声音克隆有授权风险。
- **双模注**: 人工面=分镜/素材上贴脚本→选声音→出片;Otto 代劳=Otto 写好口播稿、配好声音、直接交付带音成片。

### C-08 【品牌约束生成 + 生成时校验(Brand-constrained Generation)】
- **谁有**: Adobe GenStudio(Brands/Products/Personas 三种档案作生成护栏;brand validation 实时校验+品牌分,免费不耗 credits;Brand Intelligence 从审批/拒稿行为持续学习), Canva(Brand Kit + Guidelines + Brand Controls 硬管制 + Team Context AI 学品牌上下文), LTX Studio(Brand Kit,企业档)
- **是什么**: 生成时自动带上品牌的色、字体、语气、logo 用法,产出先过一道"像不像我的店"的检查再给你;老板每次拒稿/批改还会被系统学走,越用越懂你。
- **SMB 度**: 高——SMB 老板最怕 AI 出的东西"不像我的店",这是采用 AI 生成的第一道心理关。
- **FIKIRTIVE 现状**: 部分(brand memory 在建、prompt skills 已注入审美;"生成时校验+品牌分"与"从批改中学习"为零)。
- **利弊**: 做=直接回应 AI 生成的最大信任障碍,且"校验免费、生成收费"的边界(Adobe 做法)符合 credits 心理学;成本=校验/打分模型要持续维护,误报多了反而烦人。
- **双模注**: 人工面=素材角落一个品牌合规分 + 一键"按品牌修正";Otto 代劳=Otto 生成前自动读品牌记忆、生成后自检,不合格自己重跑。

### C-09 【审美预设层(Soul 风格 / Style Presets)】
- **谁有**: Higgsfield(Soul 2.0 自研"高审美"模型 + 20+ 审美 presets:Y2K、Editorial Street Style、Old Smartphone 等,免 prompt 出"有品味"的图), LTX Studio(style presets 一键统一全项目视觉;一张参考图定全项目 aesthetic), Canva(Dream Lab 15 风格 + Style Transfer)
- **是什么**: 把"专业审美判断"冻结成一键选项:用户不写 prompt、不懂术语,点一个风格名就能出明显"贵"的画面,且全项目风格统一。
- **SMB 度**: 高——SMB 与大牌的观感差距主要就是审美,一键"有品味"直接拉开与隔壁档口的档次。
- **FIKIRTIVE 现状**: 部分(seedream/seedance prompt skills 已是"冻结品味"的同思想,但藏在 Otto 内部,没有用户可见可选的预设库)。
- **利弊**: 做=把已有 prompt skills 产品化成可见预设,增量成本低,且预设=可读文件符合 file-system 管理哲学;成本=预设库要持续养,风格时效性强,过气比没有更伤。
- **双模注**: 人工面=生成面板上一排风格卡片点选;Otto 代劳=Otto 按品牌记忆默认选风格,用户说"复古一点"即切换。

### C-10 【模板与热梗内容库(Templates / Trending)】
- **谁有**: Canva(数十万模板 + Creators UGC 供稿飞轮,BM/多语模板齐全), Higgsfield(UGC Factory 40+ 模板、Trending Templates 热梗:Skibidi/Mukbang/K-pop 等、Hook 开场模板), Adobe GenStudio(HTML5/email 模板系统 + starter templates)
- **是什么**: 现成的"抄作业"起点:促销图版式、开箱视频套路、正在流行的梗,点开换上自己的产品就能用。是 SMB 起稿的第一入口。
- **SMB 度**: 高——SEA TikTok 文化重度靠蹭梗,模板消耗量大;但 Canva 级通用模板生态属十年飞轮,追不上。
- **FIKIRTIVE 现状**: 部分(4 个模板 vs 对手的 40+/数十万)。
- **利弊**: 做=模板是运营内容不是代码(可读文件哲学),SEA 本地梗(Raya/双十一/mamak 语境)是 Canva 覆盖不到的差异化;成本=要持续养库,热梗生命周期短,断更比不做难看。
- **双模注**: 人工面=模板画廊按行业/节日/热梗浏览套用;Otto 代劳=Otto 主动提示"这周你的行业在流行这个梗,要不要来一条"。

### C-11 【整版成稿生成(Full-ad Composition / Magic Design)】
- **谁有**: Canva(Magic Design:prompt→成套全图层可编辑设计,含视频自动配乐), Adobe GenStudio(Create Canvas:整版广告/邮件一次生成——图+文案+CTA 一体、批量变体、富文本可改), HubSpot(Marketing Studio:一个 brief 生成整套 campaign 资产)
- **是什么**: 产出的不是一张裸图,而是"能直接投的完整广告":图、标题、文案、CTA 排好版,还能回头逐层编辑。
- **SMB 度**: 中高——SMB 要的最终物是"能发的帖/能投的广告",不是素材半成品;但投放平台自己拼文案目前也能活。
- **FIKIRTIVE 现状**: 零(创作区产出裸图/裸视频;文案是 Otto 单独给,不合成在版面里)。
- **利弊**: 做=把"生成→可投"缩成一步,与 G7 建广告能力天然衔接;成本=排版引擎/可编辑图层是新工程物种,和"生成图"不是同一条技术线。
- **双模注**: 人工面=出稿即完整广告卡,点字改字点图换图;Otto 代劳=Otto 从 brief 直接给 N 版完整广告,选中即可进投放。

### C-12 【运镜预设库(Camera Presets + Cinema Studio)】
- **谁有**: Higgsfield(65 个一键运镜:Bullet Time、Dolly Zoom、FPV Drone、360 Orbit 等,可叠 3 轴;Cinema Studio 选机身/镜头/光圈景深——招牌差异化), LTX Studio(camera motion presets:dolly/crane/pan/handheld + keyframe 运动路径)
- **是什么**: 不懂"dolly in"这类摄影术语的人,点一个预设就能让视频有专业运镜;高级版连机身、镜头、景深都能选,画面质感对标广告片。
- **SMB 度**: 中——运镜让画面"变贵"有感,但对卖货 SMB 是加分项不是刚需;Cinema Studio 的 ARRI/IMAX 级控制对 SMB 明显虚胖。
- **FIKIRTIVE 现状**: 部分(#85 motion presets 已建,同方向;差距是广度——几个 vs 65 个、不可叠加)。
- **利弊**: 做=已有楼加宽,预设=数据不是代码、扩充便宜;成本=每个预设要真调得动模型(Seedance 对复杂运镜的服从度未核实),名不副实反伤信任。
- **双模注**: 人工面=视频生成时从运镜卡片挑选、可叠加;Otto 代劳=Otto 按素材类型自动配运镜(如"产品展示→360 Orbit")。

### C-13 【数据驱动批量生成(Bulk Create)】
- **谁有**: Canva(Bulk Create:CSV/表格→逐行套模板批量出图,300 行×150 字段,Auto-match 自动映射), Adobe GenStudio(variants 引擎批量出多变体多比例), LTX Studio(Flows 节点批量跑 pipeline,含 smart caching)
- **是什么**: 有 50 个 SKU 要出 50 张价格卡?上传商品表,AI 逐行套版自动生成整批,不用一张张做。
- **SMB 度**: 中——多 SKU 电商和餐饮(菜单/价格卡)有真实需求;单品小店用不上。
- **FIKIRTIVE 现状**: 零(canvas 4 变体是"一题多解",不是"多题各一解")。
- **利弊**: 做=FIKIRTIVE 版应是"Otto 读商品表批量生成"而非 CSV 映射 UI,是 agent 化的顺手事;成本=批量=批量烧 credits,失败重试与钱路要走既有 money-gate 设计。
- **双模注**: 人工面=传表→字段对齐→预览→批量出;Otto 代劳=丢一份商品表给 Otto"每个 SKU 一张促销图",报总价批准后跑。

### C-14 【脚本→分镜增强(Script-to-Storyboard)】
- **谁有**: LTX Studio(AI Storyboard Generator:剧本自动拆 scenes→shots 两级、生成前先看 shot breakdown、每镜头结构化控制 shot type/angle/motion、手绘 sketch 定帧、animatics 动态分镜、.txt 剧本导入), Higgsfield(Popcorn:分镜工具,角色/镜头/光线全程一致,任意帧可改)
- **是什么**: 把一段脚本或一个想法自动拆成一场场一镜镜的分镜板,每镜头可单独调机位/角度/时长,先用便宜的图确认、认可了才烧贵的视频钱。
- **SMB 度**: 中——拍系列内容/长广告的用户有价值;15 秒促销片用现有分镜卡已够。
- **FIKIRTIVE 现状**: 部分(分镜卡 F1-F3 已建;缺:两级 scene/shot 层级、剧本文件导入、每镜头结构化预设字段、sketch 定帧、animatics 预览)。
- **利弊**: 做=已有楼逐项加宽,"贴稿子直接出分镜"约等于 Otto 一个 skill 的事;成本=结构化字段增加 UI 复杂度,与"Otto 替你写 prompt"的简洁性有张力。
- **双模注**: 人工面=分镜卡每镜头多几个下拉(景别/机位/运镜);Otto 代劳=贴整段脚本,Otto 自动铺好两级分镜并把新角色/产品沉淀进资产区。

### C-15 【局部重生成(Retake)】
- **谁有**: LTX Studio(Retake:选视频里 2–16 秒区间只重生成这一段,模型强参考前后帧保衔接)
- **是什么**: 视频 15 秒里只有中间 3 秒不满意?圈出那 3 秒重出,前后不动、衔接自然,不用整条重烧。
- **SMB 度**: 中——"只烧坏掉那段的钱"省钱心智极好,但属于体验优化不是能力缺口。
- **FIKIRTIVE 现状**: 零(图侧"改文字→清该帧→单帧重出"已是同一哲学;视频段内重生成为零,且 BytePlus/Seedance 是否支持未核实)。
- **利弊**: 做=与"花钱前明码、只花必要的钱"的信任叙事完全同频;成本=强依赖模型能力,供应商不支持就做不了。
- **双模注**: 人工面=视频时间条上圈选区间→"重拍这段";Otto 代劳="第 5 到第 8 秒重来,人物笑一点"一句话搞定。

### C-16 【发布前评分(Virality Predictor / Similarity Score)】
- **谁有**: Higgsfield(Virality Predictor 发布前评估 hook 爆款潜力;Similarity Score 查 IP 相似度/侵权风险)
- **是什么**: 素材做完先给 AI 打个分:这个开头能不能停住手指?像不像别人的 IP、会不会被投诉?发布前的一道保险。
- **SMB 度**: 中——小团队没人把关,预判+避雷是真保险;但"预测"天然不如真实投放数据可信。
- **FIKIRTIVE 现状**: 零(但我们有真实 ads/organic 数据,能做"实测归因反哺下一批素材"——比预测更硬,那半边归分析区)。
- **利弊**: 做=轻量版(Otto 用 LLM 评 hook)成本极低、是交稿流程顺手一环;成本=评分不准反而误导,与分析区"真数据反哺"存在定位重叠。
- **双模注**: 人工面=素材卡上一个"发布前体检"分数与建议;Otto 代劳=Otto 交稿时自带评分和"为什么这条 hook 弱"的点评。

### C-17 【时间线剪辑器(Timeline Editor)】
- **谁有**: LTX Studio(AI Timeline Editor:trim/转场/变速/倒放 + AI 粗剪,但只能剪平台生成的内容), Canva(Video 2.0 重写的时间线编辑器)。反例:Higgsfield 明确没有时间线,成片要出去外部剪——$500M ARR 也没做这个。
- **是什么**: 把多段生成的 clip 在时间线上排序、剪长短、加转场、配音乐,在产品内出最终成片,不用去 CapCut。
- **SMB 度**: 中低——SMB 手机上有免费 CapCut;"多 clip 顺序拼接导出"够用,全功能剪辑器是重器。
- **FIKIRTIVE 现状**: 零(有 video-editor 可行性研究存档,未建)。
- **利弊**: 做=补上"分镜→成片"最后一环,素材不出 app 直接进排期;成本=剪辑器是长期重投入的工程深坑,Higgsfield 的缺席说明没有它也能活。
- **双模注**: 人工面=轻量时间线(排序/裁剪/拼接/配乐);Otto 代劳=Otto 按分镜顺序自动粗拼+卡点配乐,人只做微调。

## C 区遗漏检查

1. **Flows 节点自动化画布(LTX)**——刻意排除:它是"用户自己搭 pipeline"的 UI 范式,与"Otto 就是自动化层"的宪法相悖;其 smart caching(只重跑变了的节点)思想已体现在 F3 清 firstFrameGenerationId 的既有逻辑里,不构成独立的创作能力簇。
2. **多模型聚合策略(Higgsfield 16+ 模型舱、LTX 模型分层当 upsell 杠杆)**——排除:这是供应商与定价策略,不是用户可感的创作功能簇;FIKIRTIVE 已定 BytePlus 路线,属 HOW/定价层议题,不属本 WHAT 清单。
3. **专业交付面与相邻区条目**——排除:LTX 的 XML/NLE 交接与 Higgsfield 的 Adobe Premiere/AE 插件,ICP 是专业剪辑师不是 SMB;Pitch Deck PDF 导出归 Agency 楼层;GenStudio 的 Add-Brand-from-URL(网址自动建品牌档案)与 Content library 自动打标归资产区——均不在创作区 C 编号内。

---

# S 区 —— 排期发布

# S 区 排期发布区 —— 功能簇 grill 工作表

来源:Buffer / Metricool / Canva Content Planner / HubSpot Marketing Hub(2026-07-03 研究)。FIKIRTIVE 现状基线:排期区 = Coming soon 空地,spec="Buffer-like 3 views",卡 IG App Review(instagram_content_publish)。

### S-01 【排期日历多视图(Calendar Views)】
- **谁有**: Buffer(Calendar Week/Month + All Channels 总览 + 移动端 Day view;2025 新增日历内显示空槽、双击开 composer), Metricool(Planner 拖拽日历,Free 起), Canva(Content Planner,轻量), HubSpot(社媒排程 + Marketing calendar,Pro 起)
- **是什么**: 一个日历把所有平台的待发帖摆在周/月视图上,拖拽改期、点格子直接新建。这是所有排期工具的主界面,也是 FIKIRTIVE spec 里"3 views"的本体(Buffer 真身 = Queue 列表 + Week + Month)。
- **SMB 度**: 高 —— 马来西亚小店主一眼要看"这周还有哪天空着",日历是最直觉的形式。
- **FIKIRTIVE 现状**: 零(排期区空地);spec 已写"Buffer-like 3 views",与 Buffer 真身对得上。
- **利弊**: 做 = 排期区的门面与主动线,四家竞品全有,属入场券;成本 = 日历 UI(拖拽/过滤/跨平台渲染)工作量不小,且 IG 直发要等 App Review。
- **双模注**: 人工面 = 拖拽日历 + 双击开 composer;Otto 代劳 = "帮我把下周排满"直接往日历写入,人只看结果。

### S-02 【队列与发帖槽位(Posting Queue & Slots)】
- **谁有**: Buffer(Queue + posting schedule 槽位,全档位,20 年核心心智), Metricool(Recurring scheduling 近似,Advanced 档)
- **是什么**: 先一次性设定"每周几点发几条"的槽位,内容只管灌进队列,系统自动对号入座。把"何时发"从每帖决策降为一次性配置——Buffer 不倒的核心抽象。
- **SMB 度**: 高 —— 老板一周填一次队列,比每帖挑时间省脑,适合没有专职运营的小店。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做 = 比纯日历好用一个量级,且"往队列灌"比"逐帖挑时间"更容易被 agent 操作;成本 = 队列/槽位/日历三者的数据模型要一开始想清楚,后补难。
- **双模注**: 人工面 = 设槽位 + 拖内容进队列、move to top/bottom;Otto 代劳 = 按品牌节奏自动填队列、快断档时自动补货。

### S-03 【多平台直发支持矩阵(Channel Coverage Matrix)】
- **谁有**: Buffer(12 频道:FB/IG/X/LinkedIn/TikTok/Pinterest/YouTube Shorts/GBP/Threads/Bluesky/Mastodon/Start Page), Metricool(12 平台 + Twitch/GBP), HubSpot(7 个,含 Reddit/YouTube), Canva(约 6 个,帖型受限)
- **是什么**: 每个平台"能不能直发、支持哪些帖型(Reels/Stories/轮播/推文串)"的能力表。竞品差距常在帖型深度而非平台数——Canva 只能发单图 feed 帖被评测点名,就是反面教材。
- **SMB 度**: 高 —— MY SMB 三件套是 FB+IG+TikTok,加 GBP(本地实体店被低估的渠道);四家全都没有 WhatsApp/LINE/小红书。
- **FIKIRTIVE 现状**: 部分有 —— Channel foundation 已并入 main(#74),Meta 连接器 LIVE;IG 发布权限卡 App Review;TikTok/GBP 未接。
- **利弊**: 做深(帖型全覆盖)= 直接超越 Canva 类轻排期、对齐 Buffer/Metricool;成本 = 每个平台 API 各是一条审核+维护长尾,帖型越多矩阵越贵。
- **双模注**: 人工面 = 连接频道 + 每帖勾选目标平台;Otto 代劳 = 自动按各平台能力选帖型、规避不支持的格式。

### S-04 【一稿多发与逐平台定制(Multi-posting & Per-network Customization)】
- **谁有**: Buffer(Customize for each platform + Channel Groups 一键多选), Metricool(Multi-posting + per-network 地点/商品标签/collaborators/@提及,Free 起), HubSpot(有), Canva(无——被评测点名的短板)
- **是什么**: 写一稿同时发多个平台,但每个平台可单独改文案、hashtag、@人、地点。Channel Groups 是把常用频道组合存起来一键全选的糖。
- **SMB 度**: 高 —— 一人团队同一条促销要发 FB+IG+TikTok,不改稿有"机器人感",逐条全改又太累。
- **FIKIRTIVE 现状**: 零(排期侧);创作区已有多变体生成能力可衔接。
- **利弊**: 做 = 排期区标配,且与创作区变体生成天然联动成差异点;成本 = composer 的逐平台状态管理是排期区最大的单体 UI 工程。
- **双模注**: 人工面 = 一个 composer 里切平台 tab 微调;Otto 代劳 = 一稿自动改写成各平台风格(含 EN/BM/中文三语),人扫一眼即可。

### S-05 【最佳发帖时间(Best Time to Post)】
- **谁有**: Buffer(付费档,分析模块驱动), Metricool(Free 起,直接叠加显示在日历上,IG/FB/TikTok/X/YouTube), HubSpot(Pro 起;Breeze Social Agent 也会建议时段)
- **是什么**: 根据自家粉丝的活跃数据推荐发帖时段,Metricool 直接画在日历上让你挑格子。冷启动没数据时一般退回行业默认值。
- **SMB 度**: 高 —— 店主最常问的问题之一就是"几点发比较多人看",这是答案式功能。
- **FIKIRTIVE 现状**: 零;分析区(spec:ads+organic+history)将来是它的数据源。
- **利弊**: 做 = 便宜的"聪明感"来源,把分析区数据变成排期区动作;成本 = 需要先积累受众数据,冷启动准确性有限。
- **双模注**: 人工面 = 日历上高亮推荐时段供人挑;Otto 代劳 = 排期默认落在最佳时段——竞品都把"分析→执行"留给人接线,Otto 可以把这条回路自动焊上。

### S-06 【首评与 Hashtag 组(First Comment & Hashtag Manager)】
- **谁有**: Buffer(首评:IG 专业号/FB/LinkedIn,TikTok 不支持;Hashtag Manager 存组一键插入), Metricool(Saved texts 常用语库,Free 起)
- **是什么**: 发帖同时自动排一条自己的首条评论(IG 惯例是把 hashtag 塞首评、保持 caption 干净);hashtag 组是把常用标签存成组,一键插入 caption 或首评。
- **SMB 度**: 高 —— IG 运营日常刚需,MY 商家 hashtag 用量大。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做 = 实现小、刚需、Buffer 已证明是排期区标配;成本 = 依赖各平台评论 API,支持矩阵有豁口(如 TikTok)。
- **双模注**: 人工面 = composer 里一个"首评"输入框 + hashtag 组选择器;Otto 代劳 = 按内容自动配 hashtag 组并生成首评。

### S-07 【提醒式发布降级(Notification Publishing)】
- **谁有**: Buffer(独有;IG 个人号、FB Groups 等 API 不许直发的场景 → 手机推送提醒 + 人手动发)
- **是什么**: 平台 API 发不了的场景不说"不支持",而是降级为"到点推送提醒、内容一键复制、人手贴上去发"。产品面不变,承诺诚实。
- **SMB 度**: 高 —— MY 大量小商家用 IG 个人号;且这招正好可作 FIKIRTIVE 等 App Review 期间的过渡方案。
- **FIKIRTIVE 现状**: 零;正卡在 IG App Review,这一簇与现状直接相关。
- **利弊**: 做 = 排期区不用等任何平台审核就能先上线、还能覆盖长尾渠道(WhatsApp status/小红书类);成本 = 要有移动推送闭环(App 或 PWA push),FIKIRTIVE 目前没有移动端。
- **双模注**: 人工面 = 到点收推送、点开复制粘贴发;Otto 代劳 = Otto 备好全部内容与提醒,最后一下必须人按(这层天然人机分工)。

### S-08 【常青内容循环与周期排期(Autolists / Evergreen Recycling)】
- **谁有**: Metricool(Autolists 循环重发 + CSV/RSS 导入,付费档;Recurring scheduling,Advanced)
- **是什么**: 把常青内容(营业时间、招牌菜、客户见证)放进循环清单自动重发,或设固定节奏重复发布。内容飞轮,治"没东西发"的病。
- **SMB 度**: 高 —— SMB 最大的痛不是排期而是没内容,循环让 3 条素材养活一个月。
- **FIKIRTIVE 现状**: 零(排期侧);创作区可生成变体来防重复感。
- **利弊**: 做 = 实现成本低、留存价值高,配合创作区变体生成可以比 Metricool 更不像机器人;成本 = 循环内容易被平台判重复/降权,需要变体机制兜底。
- **双模注**: 人工面 = 建清单、设循环节奏;Otto 代劳 = 自动挑常青内容进循环、每轮改写出新变体再发。

### S-09 【Link-in-bio 微站(Start Page / SmartLinks)】
- **谁有**: Buffer(Start Page,免费档就有:链接/视频/表单收集/最新帖 feed + 点击统计), Metricool(SmartLinks,Starter 起可多个,CTR 统计), Canva(Websites 一页式,可绑域名)
- **是什么**: 一个零代码小落地页放在 IG bio,聚合链接/菜单/WhatsApp 按钮,带点击统计。对没官网的微商,这就是"官网"。
- **SMB 度**: 高 —— MY 大量商家无官网,IG bio 那一条链接就是全部流量出口。
- **FIKIRTIVE 现状**: 零;Buffer/Metricool 两份研究都把它标为"存疑/资产区外围"。
- **利弊**: 做 = 便宜、自带流量归因、是用户的流量自留地(粘性);成本 = 独立产品面(编辑器/托管/主题),且是 Linktree 级红海,战线拉长。
- **双模注**: 人工面 = 拖拽编辑微站;Otto 代劳 = 按品牌记忆自动生成/更新微站(新品上架自动挂上去)。

### S-10 【IG 视觉预览糖(IG Grid Preview & Extras)】
- **谁有**: Buffer(九宫格预览 2025 起全档位 + Shop Grid 挂购物链接 + alt text), Metricool(IG feed preview,Free 起)
- **是什么**: 发布前预览新帖排进 IG 主页九宫格的效果;Shop Grid 给每条帖/Reel 挂链接汇成一个 bio 购物页;alt text 是无障碍图片描述。
- **SMB 度**: 中 —— 重视觉行业(餐饮/美容/服饰)在乎主页排面,但不是所有店主都讲究。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做 = 小成本讨好 IG 重度用户,两家竞品都免费给,说明是低价筹码;成本 = 纯 IG 专属,对 FB/TikTok 无复用。
- **双模注**: 人工面 = 排期时看一眼网格效果再调顺序;Otto 代劳 = 生成图时顺带校验九宫格视觉连续性。

### S-11 【排期流内素材与集成(In-flow Media & Integrations)】
- **谁有**: Metricool(内置图/视频编辑器 + media bank 素材库 + Canva/Drive/Adobe Express 集成 + Chrome 扩展), Buffer(Canva/Unsplash/Drive/Dropbox/OneDrive 取图 + 浏览器扩展)
- **是什么**: 排期时不离开工具就能取素材、微调图片、沉淀素材库复用;Chrome 扩展让浏览网页时随手把文章/图剪进排期器。四家竞品都是"接别人的设计工具"。
- **SMB 度**: 中 —— 顺手但非决定性;SMB 已习惯 Canva 出图再上传。
- **FIKIRTIVE 现状**: 部分有 —— 创作区 canvas(Seedream/Seedance 生成 + 4-variant 流)就是自家素材源;资产区/品牌记忆在规划。
- **利弊**: 做 = FIKIRTIVE 是四家里唯一"素材自产"的,排期区直挂创作区输出是结构性优势;成本 = 若再接 Canva/Drive 等外部源,每个集成都是长期维护面。
- **双模注**: 人工面 = composer 里从 canvas/资产库挑图;Otto 代劳 = 排期时缺图直接现场生成补上。

### S-12 【内容标签与 UTM 追踪(Tags & UTM)】
- **谁有**: Buffer(Tags 一套贯穿 ideas/帖子/战役 + Tag pulse 归因), Metricool(URL generator UTM 生成器,Free 起), HubSpot(Tracking URLs 自动带 campaign UTM)
- **是什么**: 给帖子打标签,把同一波 campaign 的内容归组,事后按标签看战役表现;UTM 生成器给发布链接自动带追踪参数。Buffer 用轻量 tags 替代了重型 Campaign 实体——轻,但够 SMB 用。
- **SMB 度**: 中 —— 店主本人少主动打标签,但"这波 campaign 值不值"的答案依赖它。
- **FIKIRTIVE 现状**: 零(排期侧);Campaign 管理区在规划,标签是排期区与它的粘合层。
- **利弊**: 做 = 便宜,且是 Campaign 区/分析区归因的数据入口,不做以后补数据难;成本 = "轻标签 vs 重 Campaign 实体"是一次真实架构选择,选错要返工。
- **双模注**: 人工面 = 发帖时选标签;Otto 代劳 = 自动按 campaign 归组打标并生成 UTM。

### S-13 【草稿与审批流(Drafts & Approvals)】
- **谁有**: Buffer(Drafts + Approvals tab + 三级权限按频道分配 + notes 挂帖讨论,Team 档), Metricool(Approval System 一键通过/提修改,过审自动按时发,Advanced 档), Canva(审批在设计侧,排期流内无), HubSpot(社媒帖审批未见)
- **是什么**: 员工/代运营只能建草稿,提交后由 owner 审批通过才入队发布,审批线程内可留言讨论。Buffer 证明"权限按频道分"就能拼出多客户隔离,不需要重型 workspace。
- **SMB 度**: 中 —— 单人店主用不到;一旦雇人或接代运营就是刚需,两家都放付费高档,说明是团队付费墙。
- **FIKIRTIVE 现状**: 部分有(理念)—— Otto 侧已有 plan-approval/SoD/PAUSED-draft 模式(G7),但排期区人对人的审批流为零。
- **利弊**: 做 = Agency 楼层与雇员场景的地基,且与既有 Otto 审批哲学同构;成本 = 权限模型 + 通知闭环,单人用户完全无感,不影响首发。
- **双模注**: 人工面 = 草稿 → Request Approval → 审批 tab;Otto 代劳 = Otto 产的内容走同一条审批道——人审 Otto 与人审人是同一个界面。

### S-14 【Agent 化排期操作面(Agent-operable Scheduling)】
- **谁有**: Metricool(MCP server:Claude/Cursor/n8n 直接排期/查最佳时间), Canva(AI 2.0 Scheduling:后台定时批量产内容), HubSpot(Breeze Social Media Agent:产策略+帖子建议+时段建议,全部人工审批后才发), Buffer(无 agent,但全档开放 GraphQL API——把自己做成"可被别人的 agent 操作")
- **是什么**: 让 AI 直接操作排期面——从"给建议"(HubSpot)到"可被外部 agent 调用"(Metricool MCP / Buffer API)到"后台代产内容"(Canva)。四家全部停在"建议层或借来的 agent",没有一家的 AI 能走完看数→排期→审批全链。
- **SMB 度**: 中 —— 店主不在乎"agent"这个词,在乎"有人替我把这事办了";体验上就是省事。
- **FIKIRTIVE 现状**: 部分有 —— Otto 本体 + skill 框架已立,"每层楼 100% 可被 Otto 操作"是宪法;排期楼本身还没盖。
- **利弊**: 做 = 这正是相对四家的结构性差异(它们的 AI 没有手,或手是借的);成本 = 排期区从 day-1 要按"人机同面"设计(API 优先、状态可读),比纯 UI 版贵。
- **双模注**: 人工面 = 上述 13 簇的全部 UI;Otto 代劳 = 同一套操作走内部 API 全自动执行、人只留审批点——这簇本质是其他所有簇的"第二用户"。

### S-15 【批量导入排期(Bulk CSV/RSS Import)】
- **谁有**: Buffer(CSV 一次导 100 帖,2025 新增), Metricool(Autolists 支持 CSV/RSS 批量导入)
- **是什么**: 把整月内容做成表格一次性导入排期,是 agency/内容工厂的工作流;RSS 则把博客更新自动变成待发帖。
- **SMB 度**: 低 —— 单店主不做月度内容表,主要是 agency/批量运营向。
- **FIKIRTIVE 现状**: 零;宪法"每层楼可手动"意味着手动版是否要做是个真问题。
- **利弊**: 做 = agency 客户的顺手件、实现直白;成本 = Otto"帮我排 30 条"天然替代此功能,CSV 可能是给不用 Otto 的人修的路。
- **双模注**: 人工面 = 传 CSV → 预览 → 入队;Otto 代劳 = 对话式"把这 30 条排到下月",CSV 这一层可以整个跳过。

## S 区遗漏检查

1. **Streaks / Posting Goals(Buffer 连更打卡+周目标)** —— 刻意排除:这是留存游戏化机制而非排期能力,且与"Otto 替你发"的叙事互相作用微妙(打卡打给谁看),不占 WHAT-pass 的功能决策位;若要讨论应放留存/增长议题。
2. **博客→社媒自动分发 + RSS 灵感流(HubSpot / Buffer Feeds)** —— 刻意排除:前提是客户有内容型博客/网站,SEA SMB 少见;RSS 收集侧更贴创作区的 Ideas 管道,不属排期区。
3. **社媒收件箱/评论互动/监听(Buffer Community、Metricool Inbox、HubSpot Social Inbox)** —— 刻意排除:属自动回复区/CRM 区的地盘,在对应区的工作表里出现,S 区不重复列。

---

# A 区 —— 分析

# 分析区(A)— WHAT-pass 功能簇清单

来源:Metricool / HubSpot Marketing / Salesforce Marketing / Campaign 跨研 / Buffer 五份研究,按功能簇合并去重,SMB 价值高的在前。FIKIRTIVE 现状基线:只有 Connections 里的 Meta 30 天洞察。

### A-01 【多平台社媒账号与帖子级分析(Multi-platform Social Analytics)】
- **谁有**: Metricool(全网络 Analytics,12 平台,Free 30 天/付费无限历史), Buffer(Analyze,FB/IG/X/LinkedIn,含帖型拆分、organic vs boosted 对比), HubSpot(社媒报表,Pro 起,含 visits→leads→customers 链路), Salesforce(Intelligence 报表层,企业级)
- **是什么**: 把各社媒平台的粉丝增长、触达、互动、单帖表现拉进一个仪表盘,不用逐个开 IG/TikTok 后台。可按帖子类型(Reels/轮播/链接帖)拆开看哪种内容有效。历史数据保留时长(30 天 vs 无限)是各家通用的付费杠杆。
- **SMB 度**: 高 — MY 商家主战场就是 FB/IG/TikTok,这是分析区每天打开的底座页。
- **FIKIRTIVE 现状**: 部分有 — 仅 Connections 里 Meta 30 天洞察;规划中的 Analytics 页即此楼。
- **利弊**: 价值是全品类入场券,没有它分析区不成立;成本是每个平台一条 API 接入+配额+字段维护,平台越多长期负担越重。
- **双模注**: 人工面 = 选账号/时间段/指标的多平台仪表盘;Otto 代劳 = 直接问"这个月 IG 怎么样",Otto 读数并给结论。

### A-02 【有机+付费同屏 Campaign 分析(Organic + Paid Campaign Dashboard)】
- **谁有**: Metricool(Campaign Dashboards:同一 campaign 的有机贴+Meta/Google/TikTok 广告合并指标,≥10 帖自动 AI Insights,实时分享链接), HubSpot(Campaigns Performance tab,Pro 起), Salesforce(Campaign 报表/Engagement Metrics)
- **是什么**: 按"活动"而非按"平台"聚合数据:一档 Raya 促销的所有帖子+广告放进一个视图,合并花费、触达、互动。直接回答老板唯一的问题——"这波 campaign 到底值不值"。
- **SMB 度**: 高 — SMB 老板的提问单位是 campaign,不是渠道。
- **FIKIRTIVE 现状**: 零(与 Campaign 管理区共界;广告侧数据源 G6 Meta 读已具备)。
- **利弊**: 是把分析区和 Campaign 区焊在一起的记忆点功能;成本是需要先有"campaign 容器"实体(资产归组),依赖别区先落地。
- **双模注**: 人工面 = 每档活动一个 dashboard + 可分享链接;Otto 代劳 = campaign 结束自动出"值不值"小结。

### A-03 【广告跨平台统一报表(Cross-platform Ads Reporting)】
- **谁有**: Metricool(Meta+Google+TikTok Ads 同一仪表盘,与有机数据同屏), HubSpot(Ads:Meta/Google/LinkedIn/TikTok + "哪条广告带来客户"级 ROI,Pro 完整), Salesforce(Intelligence/Datorama,150+ 连接器,企业级)
- **是什么**: 把各广告平台的花费、曝光、点击、转化、CPC/CPM 拉到一张表,不用开三个广告后台。SMB 版的核心其实是 Meta 一家做深 + 简单的花费对成果。
- **SMB 度**: 高 — 请不起 media buyer 的 SMB 只想要一个后台看完;MY 投放 Meta 绝对主力。
- **FIKIRTIVE 现状**: 部分有 — Meta ads 读(G6)已通、30 天洞察在 Connections;Google/TikTok 为零。
- **利弊**: Meta 侧是现有连接器的自然延伸,增量成本低;每加一个平台(Google/TikTok)都是全新连接器工程+跨平台口径统一成本。
- **双模注**: 人工面 = 广告表现表(campaign/adset/ad 下钻);Otto 代劳 = "上周哪条广告最亏"直接答+给动作建议(执行走 Campaign 区既有 gate)。

### A-04 【最佳发帖时间与格式建议(Best Time & Format Recommendations)】
- **谁有**: Metricool(Best times to post,叠加在日历上,Free 起), Buffer(best time/最佳格式/频率建议,付费档), HubSpot(best time,Pro 起), Salesforce(Einstein Send Time Optimization,Corporate+)
- **是什么**: 用自家受众活跃数据算出"周几几点发最好、什么格式最有效",以建议形式直接喂回排期动作。是"分析产出变成动作"的最短闭环。
- **SMB 度**: 高 — 一人团队没时间研究数据,答案式建议正是他们要的形态。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 数据在分析区、动作在排期区,做好了是两区粘合剂;冷启动没自家数据时只能用行业默认值,准确度会被质疑。
- **双模注**: 人工面 = 排期器里的推荐时段标记;Otto 代劳 = 排期时自动选最佳时段并解释为什么。

### A-05 【AI 报告与主动洞察(AI Reports & Proactive Insights)】
- **谁有**: Metricool(Metricool Studio:大白话描述→AI 生成报告+执行摘要+滚动更新的 live URL;Campaign AI Insights), Salesforce(Datorama AI Insights/异常检测;Einstein Messaging Insights 表现异常报警), HubSpot(AI 报表、Breeze Assistant 答数)
- **是什么**: 两种形态:① 用自然语言要报告("给我本月 TikTok 表现"),AI 生成图表+摘要+可行建议;② 系统主动发现异常("互动掉了 30%")来找你。前者把查数变成问答,后者把"人看数"倒转成"数找人"。
- **SMB 度**: 高 — SMB 要的是答案不是图表;主动报警等于替他们雇了个不存在的分析师。
- **FIKIRTIVE 现状**: 零(但 Otto 的对话形态天然就是这个入口)。
- **利弊**: 与 Otto 定位高度同构、差异化叙事最强的一簇;成本是准确性风险(AI 读错数比没有数更伤信任)+ 依赖底层指标先齐。
- **双模注**: 人工面 = 报告页+异常通知流;Otto 代劳 = 这簇本身就是 Otto 的原生形态,人工面反而是降级出口。

### A-06 【品牌化报告与定时寄送(Branded Reports & Scheduled Delivery)】
- **谁有**: Metricool(PDF/PPT 导出+自定义模板+每月自动寄送,Advanced;White Label 仅 Custom 档), Buffer(Custom reports 加 logo/封面页导出 PDF,Team 档,原 Agency 卖点), HubSpot(报表导出 CSV/PDF)
- **是什么**: 把分析数据变成客户/老板能看的月报:选指标、套品牌模板、导 PDF/PPT,设一次之后每月自动发。Metricool 的变体是"滚动时间窗 live URL"——同一链接永远显示最新的"本月"。
- **SMB 度**: 高(对小 agency)/中(对单店)— MY 小 agency 接案交差的命脉;单店老板偶尔发股东。
- **FIKIRTIVE 现状**: 零。
- **利弊**: agency 留存核弹,实现主要是模板+渲染工程;但价值完全依赖 A-01/A-03 数据先到位,是纯下游功能。
- **双模注**: 人工面 = 报告模板编辑器+寄送计划;Otto 代劳 = "每月 1 号把上月报告发给客户 X"一句话设好,报告文字由 Otto 写。

### A-07 【受众画像(Audience Insights)】
- **谁有**: Metricool(受众画像,含地理), Buffer(Audience insights:年龄/性别/地域), HubSpot(经 CRM 的受众维度)
- **是什么**: 各平台粉丝的年龄、性别、地域、活跃时段汇总,让商家知道"到底谁在看我"。数据主要来自平台 API 原生字段,工作量在展示层。
- **SMB 度**: 中 — 商家有兴趣但低频查看,更多用来支撑投放定向决策。
- **FIKIRTIVE 现状**: 零(Meta API 有现成字段)。
- **利弊**: 实现薄(现成字段+图表);单独不构成付费理由,更像 A-01 的一个 tab 而非独立功能。
- **双模注**: 人工面 = 受众 tab 图表;Otto 代劳 = 建广告受众/写文案时自动引用画像。

### A-08 【竞品对标(Competitor Benchmarking)】
- **谁有**: Metricool(Competitors:FB/IG 等公开数据并排对比,Free 5 个/付费 100 个), HubSpot(AEO 竞品可见度对比,$50/月 add-on,前沿)
- **是什么**: 抓竞品公开账号的粉丝增长、发帖频率、互动率、内容主题,和自己并排比。回答"隔壁店做得比我好在哪"。
- **SMB 度**: 中 — 商家爱看但非日常刚需;竞争激烈品类(餐饮、美容)更有感。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 差异化谈资+留存钩子;IG 竞品数据须走官方 business discovery API,合规限制多、可抓字段有限,FB/IG 之外每加一网成本陡增。
- **双模注**: 人工面 = 竞品列表+并排对比视图;Otto 代劳 = "帮我盯着这 3 家,有大动作告诉我"。

### A-09 【互动健康指标(Engagement Health Score)】
- **谁有**: Buffer(Comment Score:回复率/回复速度/稳定性打成一个分数,全档免费)
- **是什么**: 把"别漏回评论"变成一个可追踪的经营分数,收件箱从任务堆变成指标。是互动运营的分析层,目前市面只有 Buffer 一家做成分数。
- **SMB 度**: 中 — MY 商家评论/DM 量大、漏回普遍,但分数本身属锦上添花。
- **FIKIRTIVE 现状**: 零(与自动回复区共界:数据源在收件箱,展示在分析区)。
- **利弊**: 实现薄,且天然是 Otto 的成绩单展示位("Otto 让你保持 95 分");但依赖收件箱楼层先存在。
- **双模注**: 人工面 = 分数卡片+未回列表;Otto 代劳 = 自动回复直接推高分数,分数变成 Otto 的 KPI。

### A-10 【UTM 与追踪链接(UTM & Tracking URLs)】
- **谁有**: HubSpot(campaign 建立即自动生成 UTM + tracking URL builder + 历史值保留,Pro), Metricool(URL generator,Free 起), Salesforce/Pardot(Custom Redirects 可追踪链接)
- **是什么**: 给每条发出去的链接自动带上活动追踪参数,流量回来才知道是哪个帖、哪档活动带的。是一切链路归因(A-11/A-12)的地基。
- **SMB 度**: 中 — 概念对 SMB 偏 geek,但做成"自动生成、用户无感"就变高价值。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 自动化版实现薄且是归因地基;价值兑现依赖客户网站有追踪(GA 或自家 tracker),否则只剩平台侧数据。
- **双模注**: 人工面 = 链接生成器(理想状态用户根本不用看到);Otto 代劳 = 发帖/建广告时静默带上 UTM。

### A-11 【归因模型(Attribution Models)】
- **谁有**: HubSpot(Pro 含 first/last touch 口径;Enterprise 加 linear/U/W/full-path/time-decay 全模型库), Salesforce(Campaign Influence 单触点→Customizable 多触点;Einstein Attribution 需 ≥50–100 个带角色的商机,Pardot Advanced+)
- **是什么**: 决定"这单生意算给哪个触点":最轻是首触/末触切换,最重是 AI 多触点分账。两家都把重模型锁在企业档——SMB 的数据量本来也撑不起模型。
- **SMB 度**: 低偏中 — SMB 的归因诉求就是"这条广告带来几个询盘",last-touch 够用。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 轻量版(first/last 切换)成本低、让 ROI 报表有口径可讲;多触点模型是企业级泥潭,投入产出严重失衡。
- **双模注**: 人工面 = 报表里一个口径切换器;Otto 代劳 = 答"这单哪来的"时自动选对口径并讲明白。

### A-12 【网站流量分析(Web Analytics / Own Tracker)】
- **谁有**: Metricool(自家 JS tracker,类轻量 GA,含 WordPress/Shopify connector,Free 起), HubSpot(网站流量分析 Free 起,web tracking 全链成熟), Salesforce(Personalization 实时行为追踪,$108k/年,企业级)
- **是什么**: 自带追踪脚本装到客户网站,看流量、来源、访客地理,把"社媒→网站→转化"接起来。没有它,归因链只能停在各平台自己的后台数据。
- **SMB 度**: 中低 — MY SMB 很多没官网(网站就是 IG bio 链接),有电商站的那批才有感。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 补全归因闭环、数据自有;维护一个类 GA tracker 是长期负担(脚本兼容、隐私合规、数据管道)。
- **双模注**: 人工面 = 流量仪表盘+安装引导;Otto 代劳 = "网站这周谁来的"直接答,流量异动纳入主动汇报。

### A-13 【关键词监听与舆情(Keyword Monitoring & Sentiment)】
- **谁有**: HubSpot(Monitoring streams 关键词监听+邮件提醒+AI sentiment(Beta)+Reddit share-of-voice,Pro 起);Metricool/Buffer 均无(只有 hashtag/评论)
- **是什么**: 盯着社媒上提到你品牌/关键词的帖子,配情绪判断和提醒。与 A-08 的区别:对标看的是账号,监听看的是话题和口碑。
- **SMB 度**: 中低 — 被讨论量小的微型商家用不上;连锁/网红店才有舆情需求。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 舆情报警是差异化钩子;抓取面广、噪音高,MY 英巫中三语环境让 sentiment 判断更难。
- **双模注**: 人工面 = 监听流+提醒设置;Otto 代劳 = "有人骂我们就叫我",Otto 筛掉噪音只报要紧的。

### A-14 【自定义报表引擎(Custom Report Builder & Dashboards)】
- **谁有**: HubSpot(custom report builder + dashboards,Free 10 个/Enterprise 100 个), Salesforce(Datorama 拖拽仪表盘+pivot+定时邮件报表), Metricool(自定义报告模板,Advanced)
- **是什么**: 让用户自由拖指标、拼图表、存成自己的仪表盘,而不是只看预置页面。这是"报表产品"和"报表平台"的分水岭。
- **SMB 度**: 低 — SMB 用预置视图就够,自由拼表是 agency/成熟团队行为。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 天花板高、客户锁定强;但是引擎级工程量(指标字典、图表库、权限),且与"Otto 直接答"路线部分互斥。
- **双模注**: 人工面 = 拖拽建表画布;Otto 代劳 = 用户描述要什么,Otto 生成并钉住该视图(Metricool Studio 已验证此形态可行)。

### A-15 【Hashtag 追踪(Hashtag Tracking)】
- **谁有**: Metricool(Hashtag Tracker:X+IG 实时追踪谁在用/量/影响力用户,€25/天/网络按天卖,不含在任何订阅), Buffer(仅 hashtag 管理组,无追踪)
- **是什么**: 追一个 hashtag 的使用量、参与者、最有影响力用户,活动期看战役声量,可出 PDF/PPT 报告。Metricool 把它做成按天付费道具而非订阅功能。
- **SMB 度**: 低 — MY SMB 极少跑 hashtag campaign;偏 event/大品牌玩法,且 X 在 MY 商业价值低。
- **FIKIRTIVE 现状**: 零。
- **利弊**: "贵且偶发的能力按天卖"这个计费模式与 credit 经济天然兼容,是模式参考;功能本身爬取成本高、本区域需求弱。
- **双模注**: 人工面 = 按天开追踪+看报告;Otto 代劳 = campaign 期间 Otto 代开代读,只汇报结论。

### A-16 【数据出口与 BI 连接器(Data Export & BI Connectors)】
- **谁有**: Metricool(Looker Studio connector + API/Zapier/Make,Advanced), Salesforce(Datorama 150+ connectors;全平台 API), Buffer(GraphQL API 全档), HubSpot(API + 报表导出 CSV/XLS/PDF)
- **是什么**: 把平台里的数据放出去,给客户自己的 BI 工具/表格用。服务的是有数据团队的成熟客户和大 agency。
- **SMB 度**: 低 — MY SMB 不碰 BI;要原始数据的通常是 agency 的个别大客户。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 生态钩子、化解"数据绑架"质疑;维护公开 API 面是长期承诺,且 FIKIRTIVE 的等价出口其实是 Otto 对话本身。
- **双模注**: 人工面 = API key/连接器配置页;Otto 代劳 = "把这数据导成 CSV 发我"即席满足八成需求。

## A 区遗漏检查

1. **邮件营销分析**(HubSpot email health/送达率报告、SFMC 发送级追踪+热图)— 刻意排除:FIKIRTIVE 没有邮件通道,这是"邮件营销这栋楼要不要存在"的前置问题,不是分析区能单独决策的;通道若立项,其分析随通道走。
2. **SEO / AEO 工具**(HubSpot topic clusters、Google Search Console 集成、AEO add-on $50/月)— 刻意排除:依赖客户有内容型网站,SEA SMB 主战场在社媒;属内容/网站域,不属社媒分析域。
3. **企业级预测与旅程分析**(HubSpot Customer Journey Analytics/Pathfinder、预测打分、Salesforce Data Cloud identity resolution/Calculated Insights)— 刻意排除:需要企业级数据量和数据底座才跑得动,两家自己都锁在最高档,SMB 单租户数据撑不起模型。

边界注:campaign 目标追踪、预算/花费记录、campaign 对比表等"活动级"分析件已划给 Campaign 管理区(与 A-02 共界),此处不重复编号。

---

# R 区 —— CRM

# R 区 · CRM(对标:Salesforce / HubSpot / GoHighLevel / Klaviyo)

> FIKIRTIVE CRM 区现状:零。以下按 SMB 价值从高到低排;所有归属均为候选,决定权在 founder。

### R-01 【客户对象模型(Customer Object Model: Lead/Contact/Company/Deal)】
- **谁有**: Salesforce(Leads/Contacts/Accounts/Opportunities 四对象全套,全档), HubSpot(Contacts/Companies/Deals,Free 起;独立 Leads 对象 Pro+), GoHighLevel(单一 Contact+tags,无限联系人 $97 起), Klaviyo(unified profile,按 profile 数计费)
- **是什么**: CRM 的"户口本"——每个客户是谁、属哪家公司、聊到哪一单,存成结构化档案。SF/HubSpot 拆成"人/公司/生意"多张表;GHL/Klaviyo 简化成一张联系人档案加标签。整个 R 区其他一切功能都盖在这块地基上。
- **SMB 度**: 高——马来西亚 SMB 心智里往往只有"客户"一个词,GHL 式单表+标签最贴地;三对象全套(含公司层级)偏企业。
- **FIKIRTIVE 现状**: 零(自动回复区有对话联系人雏形,但无结构化档案)。
- **利弊**: 做了每个区(回复/投放/排期)的数据都有地方回流,形成数据引力;成本是底座级长工期工程,对象拆多细一旦定型很难改。
- **双模注**: 人工面 = 客户列表+档案详情页增删改查;Otto 代劳 = 对话/表单/广告进线自动建档、补全、归一。

### R-02 【Pipeline 看板(Kanban Deal Pipeline)】
- **谁有**: Salesforce(Kanban View + Sales Path,全档), HubSpot(Deal Pipelines,Free 1 条起、Pro 15 条), GoHighLevel(多条 Pipelines、阶段变更触发自动化,$97 起)
- **是什么**: 每单生意是一张卡片,按"接洽→报价→成交"等阶段排成看板,拖一下就是推进。SMB 认知里"CRM = 这块看板"。卡片带金额和预计结单日,后面才算得出管道总值。
- **SMB 度**: 高——本地服务业(诊所/装修/美容/补习)追单就是这个动作,Pipedrive 式心智已被市场教育过。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做了 CRM 区立刻"看得懂、用得上",阶段变更是天然的自动化事件源;风险是阶段自动化/业绩拆分/审批做多了就滑向 Salesforce 式复杂。
- **双模注**: 人工面 = 拖卡片改阶段、点开改金额;Otto 代劳 = 按对话进展自动挪卡、提醒卡住的单。

### R-03 【活动时间线(Activity Timeline)】
- **谁有**: Salesforce(Activity Timeline 全档,自动抓取靠 EAC 加购), HubSpot(timeline + Gmail/Outlook 自动 log,Free), GoHighLevel(联系人全渠道时间线,$97 起), Klaviyo(profile 事件流,全档)
- **是什么**: 每个客户档案上一条按时间排的流水:发过什么消息、打过什么电话、填过什么表,回答"这个人聊到哪了"。竞品最大卖点是"不用手抄记录"。
- **SMB 度**: 高——单老板记不住几十个客户各聊了什么,时间线就是外接记忆。
- **FIKIRTIVE 现状**: 部分有(自动回复区有对话线程,但没有挂在客户档案上的跨渠道统一时间线)。
- **利弊**: 这是 Otto 的记忆载体,Otto 每次代操作留痕于此,天然做到 Salesforce 要收费才有的自动记录;成本是要把各区事件都接进来,属横切工程线。
- **双模注**: 人工面 = 打开客户看流水、手动补备注;Otto 代劳 = 所有渠道互动和 Otto 自己的操作自动写入。

### R-04 【进线捕获与自动分配(Lead Capture & Routing)】
- **谁有**: Salesforce(Web-to-Lead 全档 + Assignment Rules Professional+), HubSpot(表单 Free、Lead Form Routing Pro+), GoHighLevel(Forms/Chat Widget + round-robin 轮派,$97 起), Klaviyo(Forms/Pop-ups + 优惠券自动挂车,全档)
- **是什么**: 客户从哪进来——表单、广告点击、聊天挂件——自动变成 CRM 里一条线索并派人跟。没有进线口,CRM 就是一潭死水。SEA 等价物是 WhatsApp 点击广告(CTWA)和 DM 留言进线。
- **SMB 度**: 高——马来西亚 SMB 的进线大头在 WhatsApp/IG 广告而非官网表单,"进线不漏接"直接等于钱。
- **FIKIRTIVE 现状**: 部分有(自动回复区接住 WhatsApp/社媒 DM,Meta 广告已连,但进线未落成结构化线索)。
- **利弊**: 做了就把回复楼和 CRM 区缝起来,进线→建档→跟进成闭环;成本是多渠道身份归一和去重,做不好会生成脏数据。
- **双模注**: 人工面 = 进线列表+手动认领指派;Otto 代劳 = 进线秒建档、自动打招呼、按规则或自行判断派单。

### R-05 【导入与查重(Import & Dedupe)】
- **谁有**: Salesforce(Import Wizard 5 万条/Data Loader 百万级 + Duplicate Rules,全档), HubSpot(CSV 导入导出 Free、AI 查重合并 Pro+), GoHighLevel(CSV 导入,$97 起)
- **是什么**: 把老板手机通讯录、Excel 名单、旧系统的存量客户批量搬进来,录入时提示"这个人已经有了"。没有导入,冷启动第一天就死;没有查重,名单越用越脏。
- **SMB 度**: 高——每个 SMB 都有一份乱糟糟的 Excel/手机名单,这是第一次使用的必经动作。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做了新用户第一天就能把生意搬进来;本身成本不大,但查重做成规则引擎(Salesforce 式匹配规则)属过度工程,保存时提示级即够。
- **双模注**: 人工面 = 上传 CSV+字段映射向导;Otto 代劳 = 丢一份乱格式名单给 Otto,它清洗、映射、去重后入库。

### R-06 【分群名单(Lists & Segmentation)】
- **谁有**: HubSpot(静态+动态 Lists,Free 起), GoHighLevel(Smart Lists,$97 起), Klaviyo(实时分群引擎 + 自然语言 Segments AI,全档基础), Salesforce(List Views,全档)
- **是什么**: 按条件把客户切成组——"三个月没回购的""吉隆坡的""买过 A 的"——条件满足自动进出组。它同时是 CRM 的筛选器和 campaign 的受众来源,是"名单变钱"的开关。
- **SMB 度**: 高——"给老客户发个促销"全靠它;Klaviyo 证明分群+自动化是 SMB 最直接的回款机器。
- **FIKIRTIVE 现状**: 零(Campaign 区做受众也要用它;归属一处、两区引用是候选)。
- **利弊**: 做了 CRM 区和 Campaign 区有共同语言,复用度极高;成本是动态分群(实时进出)比静态标签工程量大一档。
- **双模注**: 人工面 = 条件构建器拼分群;Otto 代劳 = 一句"找出半年没来的熟客"直接生成分群。

### R-07 【预约排期(Meeting Scheduler / Booking)】
- **谁有**: HubSpot(Meeting Links,Free 1 条带水印、Starter 起去水印+轮流接单), GoHighLevel(Booking Calendars + 付费预约 + 提醒降 no-show,$97 起), Salesforce(Scheduler 为附加产品)
- **是什么**: Calendly 式"挑个时间"链接:客户自选空档,自动进日历、自动发提醒。对预约制生意(诊所/美容/补习/顾问)这就是接单方式本身;GHL 还支持预约先收订金。
- **SMB 度**: 中偏高——对马来西亚预约制服务业是刚需且天然长在 WhatsApp 对话里;对零售/餐饮无用,行业分化明显。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做了预约类 SMB 的成单闭环在站内完成,提醒自动化直接降 no-show;成本是日历同步与时区/班次逻辑琐碎,且 Calendly 免费档已是成熟替代。
- **双模注**: 人工面 = 设置可约时段+预约日历视图;Otto 代劳 = 在 WhatsApp 对话里直接帮客户敲定时间写入日历。

### R-08 【报价·发票·收款链接(Quotes / Invoices / Payment Links)】
- **谁有**: GoHighLevel(报价/提案/合同电子签 + 签署自动开票 + Text-2-Pay,$97 起), HubSpot(Quotes Pro 档、Payment Links/Invoices Free 起,原生收单仅美国 USD), Salesforce(Products/Price Books/Quotes,Professional+;Starter 有 pay-now link;完整 CPQ 属企业级且已停售转 Revenue Cloud)
- **是什么**: 从"聊得差不多"到"钱到账"的最后一公里:生成报价单/发票,发个链接对方点开就付,签了字自动开票。马来西亚 SMB 的真实动作是"WhatsApp 里发个报价和收款链接";CPQ 那种产品捆绑/折扣审批是企业虚胖。
- **SMB 度**: 高——服务型 SMB 成单闭环的最后一步;HubSpot 原生收款不支持 MYR 是明确市场真空。
- **FIKIRTIVE 现状**: 零(自家收 credits 有 Stripe MYR 经验,但"帮商家向他的客户收款"为零)。
- **利弊**: 做了 CRM 从"记录生意"升级为"收到钱",粘性与差异化都强;成本是 money path——网关、对账、退款、本地支付(Billplz/iPay88 类)接入是合规与工程双重负担。
- **双模注**: 人工面 = 选产品→生成报价 PDF/收款链接→发出;Otto 代劳 = 对话里一句"给他报 RM1,500"即生成发送,到账自动挪管道阶段。

### R-09 【跟进序列(Follow-up Sequences / Cadences)】
- **谁有**: HubSpot(Sequences,Starter 起、回复即退出,A/B 与自动登记 Pro+), Salesforce(Sales Engagement Cadences,UE 内含/EE 加购), GoHighLevel(Workflow 多步跟进 + Database Reactivation 老客唤醒模板,$97 起), Klaviyo(Flows 为生命周期版,60+ 配方)
- **是什么**: 预设的多步跟进剧本:第 1 天发消息、第 3 天再跟、第 7 天打电话,对方一回复自动停。解决"忘了跟进"这个销售第一死因。竞品全是 email-first;SEA 主战场是 WhatsApp,要碰模板消息合规。
- **SMB 度**: 中偏高——SMB 很想要(HubSpot 把好用版锁在 $100/席的 Pro 档挡掉一批人),但自己设计序列有门槛。
- **FIKIRTIVE 现状**: 部分有(自动回复区做 inbound 应答;有计划的 outbound 多步序列为零)。
- **利弊**: 做了就是"名单自动变钱"的发动机且与回复楼共用渠道;成本是 WhatsApp 模板消息审核/封号风险,以及"显式序列 vs Otto 自主跟进"的形态要先想清楚。
- **双模注**: 人工面 = 可见可停的序列编辑器+每人所处步骤;Otto 代劳 = Otto 本身就是序列——判断跟谁、写个性化跟进、对方回复即接管。

### R-10 【任务与今日工作台(Tasks & Today Workspace)】
- **谁有**: Salesforce(Tasks + To-Do List + Seller Home,全档), HubSpot(Tasks Free;Task Queues 与 Prospecting Workspace 需 Pro+ 加 Sales seat), GoHighLevel(任务+内部通知,$97 起)
- **是什么**: 待办清单加"今天该干嘛"的一屏工作台:该跟进谁、哪些单卡住、几点有会。HubSpot 把它做成付费招牌,本质是把 CRM 数据翻译成当日行动。
- **SMB 度**: 中——单老板要的是"今天别漏事";独立任务系统容易变成没人填的形式主义。
- **FIKIRTIVE 现状**: 部分有(Otto 主界面/任务流在概念上就是这个;差别是竞品让人执行建议,Otto 可直接代执行)。
- **利弊**: 做了 CRM 数据每天有出口,是留存习惯的抓手;风险是与 Otto 首页重复建设,同一个"今天该干嘛"做出两张脸。
- **双模注**: 人工面 = 今日待办可勾可拖;Otto 代劳 = 早上汇报"今天 5 件事,3 件我直接办了,2 件要你点头"。

### R-11 【邮件/消息集成与追踪(Email/Message Sync & Tracking)】
- **谁有**: HubSpot(Gmail/Outlook 双向同步 Free;打开/点击追踪 Free 限 200 通知/月;Templates/Snippets 话术库), Salesforce(邮箱集成全档;自动抓取 EAC 完整版 UE/加购), GoHighLevel(Email/SMS 双向 + Text Snippets,$97 起按量)
- **是什么**: 邮箱和 CRM 打通:收发件自动记到客户档案,发出的邮件看得到"打开没、点了没",配话术模板和快捷片段。这是欧美 CRM 的核心肌肉。
- **SMB 度**: 中偏低——马来西亚 SMB 的实战渠道是 WhatsApp/IG DM,email 只是 B2B 报价和正式往来的辅助;"已读未回"心智 WhatsApp 里天然就有。
- **FIKIRTIVE 现状**: 部分有(自动回复区已收发 WhatsApp/社媒消息;email 双向同步为零)。
- **利弊**: 做了 B2B 型客户和正式往来有落点,模板/片段概念可平移到 WhatsApp;成本是邮箱双向同步是另一档工程量,本地优先级排在 WhatsApp 之后。
- **双模注**: 人工面 = 连邮箱、看追踪状态、插模板;Otto 代劳 = 往来自动归档进时间线、代写代发跟进信。

### R-12 【线索评分(Lead Scoring)】
- **谁有**: HubSpot(手动规则分 Starter 5 个/Pro 10 个;Predictive 仅 Enterprise), Salesforce(Einstein Lead/Opportunity Scoring,加购或 UE), GoHighLevel(基础 Lead Scoring,$97 起)
- **是什么**: 给每条线索打"热度分"——按行为(点开、回复)和属性(预算、来源)加减分,或用机器学习按历史成交概率排序,让人先跟最热的。
- **SMB 度**: 低偏中——SMB 名单量小,统计模型学不出来;手动规则分对老板太抽象,多数配了也不看。
- **FIKIRTIVE 现状**: 零(Otto 的 LLM 判断是天然替代形态)。
- **利弊**: 做了"先跟谁"有客观依据、界面上有抓手;但传统分数形态对 SMB 价值存疑,Otto 读完时间线直接说"这 5 个最热、原因是 X"零训练成本——留不留一个量化分数是形态选择题。
- **双模注**: 人工面 = 分数列+按分排序;Otto 代劳 = 直接给出热度排序和理由。

### R-13 【CDP 画像与预测字段(Unified Profile & Predictive Fields)】
- **谁有**: Klaviyo(内建 CDP,predicted CLV/流失风险/下次购买日直接当分群条件,付费档), Salesforce(Data Cloud,按量计费), HubSpot(Breeze Intelligence 数据补全,靠收购 Clearbit 的 2 亿画像库)
- **是什么**: 把一个客户在所有渠道的行为汇成单一档案,AI 在档案上算出预测值——这人值多少钱、快流失了吗、大概几号再买——且预测值能直接拿来筛人和触发自动化,不是躺在报表里(Klaviyo 最聪明的机关)。
- **SMB 度**: 中——"CDP"这词对 SMB 太重,但"知道谁快流失"这个结果人人想要;预测模型需要订单数据量,冷启动难。
- **FIKIRTIVE 现状**: 部分有(brand memory 是品牌侧记忆;客户侧统一档案为零,SEA 关键数据源 Shopee/Lazada/TikTok Shop 接入为零——这也是四家竞品都没有的空位)。
- **利弊**: 做了是"数据变钱"的深层机关且预测字段当筛选条件有市场验证;成本是要先有订单/行为数据源,marketplace API 是前置工程,冷启动要设计降级方案。
- **双模注**: 人工面 = 档案页显示画像与预测标签、可当筛选条件;Otto 代劳 = 每次对话/成交自动写回档案,主动提醒"这 8 个熟客快流失"。

### R-14 【自定义对象与字段(Custom Objects & Fields)】
- **谁有**: Salesforce(自定义字段全档 25–500 个/对象;Custom Objects Pro Suite 50 个起), HubSpot(自定义属性付费档 1,000/对象;Custom Objects 仅 Enterprise), GoHighLevel(custom fields + tags,$97 起), Klaviyo(自定义属性全档;custom objects 锁在 $500/月 Advanced KDP)
- **是什么**: 让每家生意往客户档案加自己的字段——补习中心加"年级",诊所加"疗程";更进一步是整张自建表(自定义对象)。字段是刚需,对象是企业级。
- **SMB 度**: 字段高、对象低——四家全把 custom objects 锁在最高档,说明 SMB 用不到;但没有自定义字段,垂直行业没法用。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 自定义字段做了才吃得下不同行业且成本可控;自定义对象是工程黑洞、SMB 无感,行业需求多半可用"字段+标签"低配覆盖。
- **双模注**: 人工面 = 设置页加字段、档案页填写;Otto 代劳 = 从对话自动抽取字段值填档("客户说小孩上三年级")。

### R-15 【销售预测(Forecasting)】
- **谁有**: Salesforce(Collaborative Forecasts + Quotas 配额 + 逐级调整,Pro Suite 基础/EE+ 完整), HubSpot(Forecast 工具 Pro+;团队层级 rollup 仅 Enterprise)
- **是什么**: 按人/团队/期间把管道金额卷积成"这季度大概收多少",经理逐级调数、给每人下配额。配套的是 pipeline 纪律和层级汇报,是销售团队管理工具。
- **SMB 度**: 低——SMB 老板只要"这个月大概能收多少"一个数;逐级调整/配额/多口径预测是 10 人以上销售团队的东西,属企业虚胖。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 完整预测体系对 1–5 人团队客户过重;最小替代是"管道总额×阶段概率"一行数字,前提是 R-02 卡片上有金额和结单日字段。
- **双模注**: 人工面 = 若做只是一张数字卡;Otto 代劳 = 口头汇报"按现在管道,这个月大概收 RM42k,关键看那 3 单"。

## R 区遗漏检查
1. **报表/仪表板引擎**(SF Reports & Dashboards、HubSpot Custom Report Builder、GHL Custom Dashboards)——CRM 漏斗指标(进线→回复→成交)候选并入已规划的分析区,不在 R 区重建自助报表引擎,整簇移出本区。
2. **电话系统全家桶**(GHL LC Phone/call tracking/ringless voicemail、HubSpot Calling/IVR、SF Dialer 及通话转写)——美国本地商户逻辑;SEA 获客与成交在 WhatsApp,SMS 贵没人看,电信合规(A2P 类)重,整块排除。
3. **团队级管理装备**(SF Territory Management/审批流/Opportunity Splits/多币种价格手册、HubSpot Deal Splits/Pipeline Approvals/Field-level permissions)——服务于有层级的销售组织,FIKIRTIVE 目标客户多为 1–5 人团队,划为企业虚胖不立簇;Klaviyo 的生命周期 Flows 全套(弃购/购后/唤醒)则因与 Campaign 管理区归属重叠,R 区只保留销售跟进序列(R-09),其余留给 Campaign 区 worksheet。

---

# P 区 —— Campaign 管理

# P 区:Campaign 管理区(编号前缀 P)

> 综合来源:campaign-management-cross(SF Campaign object × HubSpot Campaigns)、hubspot-marketing、salesforce-marketing、adobe-genstudio 四份研究。按 SMB 价值排序,共 16 簇。FIKIRTIVE 现状参照:project=campaign 雏形 + Meta ad-build(G6/G7)。

### P-01 【Campaign 容器与资产归组(Campaign Object & Asset Grouping)】
- **谁有**: HubSpot(Campaigns tool,可挂 30+ 种资产,Marketing Hub Pro+ 起,Pro 上限约 5,000 个·数字未核实), Salesforce(Campaign record/object,Professional+ 各档), Adobe GS4PM(Campaigns,按战役组织所有 experiences,企业档)
- **是什么**: 一个 campaign = 一把伞,把这档活动的所有东西(帖子、广告、视频、链接、名单)挂在一起,统一看、统一报。HubSpot 的关键约束:多数资产默认只归一个 campaign,这个约束大幅简化了归因。
- **SMB 度**: 高 — "这个促销季的所有东西放一把伞下"是 SMB 最自然的心智,不用教。
- **FIKIRTIVE 现状**: 部分有 — project=campaign 雏形已在,但目前只装 canvas 生成物,排程帖/Meta 广告还没挂进同一把伞。
- **利弊**: 做的价值=整个 P 区的地基,预算/日历/报表全建其上;成本=资产模型(什么能挂、归一还是归多)一旦定错,后面迁移贵。
- **双模注**: 人工=campaign 详情页手动"添加资产";Otto=生成/发布/投放时自动把产物挂进对应 campaign。

### P-02 【预算与花费追踪(Budget & Spend Tracking)】
- **谁有**: HubSpot(Budget items/Spend items 逐项记 + 关联广告花费自动同步进表,Pro+), Salesforce(Budgeted Cost/Actual Cost 标准字段 + 层级自动上卷,Professional+,支持多币种)
- **是什么**: 每档活动记"打算花多少、实际花了多少、还剩多少";关联的 Meta 广告花费自动进表,不用手抄 Ads Manager。
- **SMB 度**: 高 — SMB 记账心智就是"这档活动花了多少、赚回多少";广告花费自动同步是刚需级。
- **FIKIRTIVE 现状**: 部分有 — Meta ads 读(G6)已通,spend 数据可取;campaign 级预算表零。独有机会:自家 credit 消耗可作"内容制作成本"列——两家都没有这个。
- **利弊**: 做的价值=已有连接器的自然延伸,直接回答老板最关心的问题;成本=币种/口径展示要做对(纯展示,不碰 spend-path)。
- **双模注**: 人工=逐项填预算/花费行;Otto=投放后自动把 ad spend 与生成成本记进账,汇报"这档已花 RM X、剩 RM Y"。

### P-03 【营销日历(Marketing Calendar)】
- **谁有**: HubSpot(Marketing Calendar:campaigns+社媒+邮件+任务同屏,月/周/日/列表视图,Pro+;Marketing Studio 日历可拖动改期), Salesforce(Campaign Calendar 对象日历,Professional+;MC Growth 的 Campaign Planning 日历)
- **是什么**: 把所有活动和内容按日期摆上一张日历,哪个档期有什么一目了然,拖一下就改期。可按 campaign/类型过滤。
- **SMB 度**: 高 — SEA SMB 围着 Raya/11.11/CNY/双旦档期跑,可能是全域打开频率最高的界面。
- **FIKIRTIVE 现状**: 部分有(规划中)— Schedule 页(Buffer-like,3 视图)已在路线上;决策点=Schedule 只排"帖子",还是升级为 campaign+帖子+任务同屏的 marketing calendar(P 区与 Schedule 楼的划界)。
- **利弊**: 做的价值=高频入口+档期规划感;成本=与 Schedule 页边界不清会做重,两处日历互相打架。
- **双模注**: 人工=拖拽卡片改期、按 campaign 过滤;Otto=排期时直接往日历上放,并提醒"Raya 档期还空着"。

### P-04 【Campaign 模板与克隆(Templates & Clone)】
- **谁有**: HubSpot(官方模板库+现有 campaign 存为自定义模板;clone 连草稿资产/任务/tracking URL 一起复制,Pro+), Salesforce(Deep Clone 连相关记录复制,Professional+)
- **是什么**: "上次 Raya 活动照搬一次"——把一档活动连结构带资产存成模板或直接克隆,改改日期和素材就能再跑。
- **SMB 度**: 高 — 节庆复用对 SEA SMB 是极高频动作,且实现薄。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=高频、便宜(克隆记录+资产引用),且两家模板都是静态清单,Otto 模板可以是可执行 playbook(活的);成本=克隆语义(哪些跟走、哪些不跟)要想清楚。
- **双模注**: 人工=点"克隆/存为模板";Otto=听到"照去年 Raya 再来一档"就从模板实例化整档活动并替换素材。

### P-05 【Campaign 目标追踪(Goals Tracker)】
- **谁有**: HubSpot(Goals tracker:对 sessions/新联系人/influenced revenue 等设目标值,活动页实时显示达成百分比,Pro+), Salesforce(Expected Revenue/Expected Response% 规划字段,Professional+;Journey 的 Goal 节点)
- **是什么**: 每档活动设 1–3 个目标数(询盘/单量/花费上限),活动页实时显示"现在到哪了"。
- **SMB 度**: 高 — "目标 X 单,现在到哪"是 SMB 用得动的最简 KPI 形态;再复杂的 KPI 树用不动。
- **FIKIRTIVE 现状**: 零(与规划中的 Analytics 页有重叠,归属待定)。
- **利弊**: 做的价值=给每档活动一条"及格线",Otto 汇报有锚点;成本=目标指标的数据源(询盘数由谁来数)要先接通,否则是空表。
- **双模注**: 人工=建 campaign 时填目标值、看进度条;Otto=每日对照目标汇报进度,落后时提出方案。

### P-06 【Campaign ROI 一条式报表(Single-formula ROI Report)】
- **谁有**: HubSpot(ROI report:(revenue − spend)/spend × 100,Pro+;另有 lifecycle cost 每阶段获客成本), Salesforce(Campaign ROI Analysis Report 标准报表,Professional+)
- **是什么**: 每 campaign 一行:花了多少(广告+制作)vs 归回多少 vs ROI 百分比,一条公式讲完这档活动值不值。
- **SMB 度**: 高 — 简单 ROI 是 SMB 真会看的报表;多触点模型他们不看。
- **FIKIRTIVE 现状**: 零 — Analytics 页(ads+organic+history)在路线上;放 Analytics(全局)还是 campaign 详情页(单档)或两处都放,是 IA 决策。
- **利弊**: 做的价值=直接回答"值不值",P-02 数据就绪后增量小;成本=「收入」侧数据从哪来(Meta 转化?手记单量?)决定这张表的可信度。
- **双模注**: 人工=打开 campaign 看 ROI 卡片;Otto=活动收官自动出"这档赚没赚"复盘小结。

### P-07 【Campaign Brief + AI 整活动生成(Brief & AI Campaign Generation)】
- **谁有**: HubSpot(Marketing Studio:Campaign Brief 作"单一事实来源"+ Breeze 从 brief 生成整套 campaign,Pro+ public beta), Salesforce(Agentforce Campaign Creation 全 MC 档标配:prompt→brief→segment→文案→journey 草稿;Campaign Designer 仅 Advanced beta), Adobe(Content Production Agent beta:brief→成套多渠道内容)
- **是什么**: 先有一页 brief(目标/受众/要点/品牌),AI 从这一页生成整档活动的草稿(受众+文案+素材+排期),人审后发。三家全押注这个形态。
- **SMB 度**: 高 — "说一句话生成 campaign"是 SMB 极度想要的;三家同押=方向被市场验证,但也意味着窗口期有限。
- **FIKIRTIVE 现状**: 部分有 — canvas+Otto 已是"生产车间"(单素材到视频流水线已通);缺的是 campaign brief 这个锚点对象(Otto 生成整档活动的起点与依据)。
- **利弊**: 做的价值=把 Otto 从"单素材生成"提级到"整档活动",正面对标三家且 Otto 能真执行(他们只到草稿);成本=brief 对象+多资产编排是新的产品面。
- **双模注**: 人工=填 brief 表单、逐项审草稿;Otto=对话问齐 brief 要素→一次产出整档活动草稿待批。

### P-08 【创意疲劳检测与换血(Ad Refresh / Next Best Creative)】
- **谁有**: Adobe GS4PM(Ad Refresh:表现数据+创意属性标签,几次点击换掉疲劳素材;Next Best Creative 在 roadmap), Salesforce(Einstein Messaging/Campaign Insights 表现异常报警,Corporate+/Pardot Advanced+,弱对应)
- **是什么**: 系统盯着投放中的素材,发现"这条大家看腻了、点击掉了"就提示换上新变体,甚至按历史有效属性组装下一条。
- **SMB 度**: 高 — "哪条疲劳了该换"是 SMB 问 agency 最多的问题;FIKIRTIVE 自带素材生成=换血的"新弹药"是原生的。
- **FIKIRTIVE 现状**: 部分有原料 — Meta insights 读 + canvas 变体生成都在;检测→换血的闭环逻辑零。
- **利弊**: 做的价值=创作区↔分析区↔P 区三楼联动的强差异化候选,天然是 Otto 技能形状;成本=依赖创意属性归因先建(分析区),且换素材动投放=涉 spend-path,须走既有 money-gate。
- **双模注**: 人工=看疲劳提醒、点"换这条";Otto=检测→生成新变体→出 PAUSED 草稿待批(沿 G7 模式)。

### P-09 【Campaign 对比(Campaign Comparison)】
- **谁有**: HubSpot(campaign comparison,一次最多比 10 个,Pro+;Marketing Studio Analyze tab 跨 campaign 预置报表,不可自定义), Salesforce(标准报表类型 + dashboards 拼装,Professional+)
- **是什么**: 把几档活动摆一张表:花费/询盘/ROI 并排,看哪档打法值得再来一次。
- **SMB 度**: 中 — 有复盘价值但打开频率低于日历/ROI;轻量表格即够,上限 10 之类的设计无必要照抄。
- **FIKIRTIVE 现状**: 零(可作规划中 Analytics 页的一个 tab)。
- **利弊**: 做的价值=复盘与"下次照哪档抄"的依据;成本=低(P-02/P-06 数据就绪后几乎是免费视图)。
- **双模注**: 人工=勾选 N 档活动出对比表;Otto=复盘时自动拉"上一档同类活动"做参照并讲结论。

### P-10 【审批流(Approvals)】
- **谁有**: HubSpot(content approvals:emails/blog/pages/social "请求审批→放行才能发"+提醒,Enterprise), Salesforce(Approval Processes 对 campaign 记录设审批门,如"预算超 X 需批",Enterprise+), Adobe(内建 Reviews & Approvals base 就有;多级审批+批注走 Workfront Proof 另购)
- **是什么**: 内容或活动出门前要指定的人点头才放行。可以是老板过一眼,也可以是"客户批了 agency 才能发"。
- **SMB 度**: 中 — 1–5 人团队自发自批用不上;但 SEA 常见的代运营/agency-客户关系里"客户点头才发"是真实需求,且三家全锁企业档=价格伞。
- **FIKIRTIVE 现状**: 部分有 — Otto plan-approval(G7 SoD:build=PAUSED 草稿、launch 需 gate)是"人批 agent";"人批人"零。
- **利弊**: 做的价值=把同一"计划→批准→执行"机制复用即可打开 agency 场景;成本=多角色权限+审批状态机,复杂度上一台阶。
- **双模注**: 人工=审批人收到待批清单,点通过/驳回;Otto=一切出手默认走同一审批门,与人类提交同一个队列。

### P-11 【视觉化规划视图(Canvas / Board / Table Views)】
- **谁有**: HubSpot(Marketing Studio:画布拖卡片+connection lines+sticky notes+批注@、Kanban 看板 Draft→Scheduled→Published、表格批量操作,Pro+ beta), Adobe(Create Canvas 协作实时编辑,企业档)
- **是什么**: 除了日历,还能用画布(自由摆卡片连线做规划)、看板(按状态列)、表格(批量改)三种方式看同一档活动的资产。
- **SMB 度**: 中 — 画布对规划型用户加分,但 SMB 最高频的还是日历+列表;属锦上添花。
- **FIKIRTIVE 现状**: 部分有 — canvas 已是核心界面,但定位是"生产车间"而非"规划视图";看板/表格视图零。
- **利弊**: 做的价值=把生产 canvas 复用为规划面=一鱼两吃,正面对齐 Marketing Studio;成本=同一数据多种投影的联动维护面。
- **双模注**: 人工=拖卡片、连线、贴便签;Otto=把整档活动计划直接铺成画布/看板供人调整。

### P-12 【UTM 自动生成与追踪链接(Auto UTM & Tracking URLs)】
- **谁有**: HubSpot(建 campaign 自动生成唯一 utm_campaign、tracking URL builder、改 UTM 旧值转 secondary 不断档,Pro+), Salesforce/Pardot(Custom Redirects 可追踪链接,Pardot 全档)
- **是什么**: 活动发出的每条链接自动带"我来自哪档活动"的标记,点进来的流量自动归到对应活动头上,报表有据。
- **SMB 度**: 中 — UTM 概念对 SMB 偏 geek,但"自动生成、用户无感"是好设计;手动 UTM 管理界面在 SEA 很少被用。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=流量归因的地基,发出的帖/广告自动带标;成本=价值兑现依赖客户网站装追踪(GA 或自建),FIKIRTIVE 目前无 web tracking 能力,不做则归因只能靠平台侧数据(Meta insights)。
- **双模注**: 人工=在 campaign 内生成并 copy 追踪链接;Otto=发布时自动给所有外链挂 UTM,全程无感。

### P-13 【受众指派与回应追踪(Campaign Members / Audience Assignment)】
- **谁有**: Salesforce(Campaign Members:Leads/Contacts 挂进 campaign + 自定义成员状态如 Sent/Responded 驱动漏斗,Professional+;Campaign History 反查), HubSpot(lists 关联 campaign + influenced contacts 判定,Pro+)
- **是什么**: "这档活动打了谁、谁回应了"的名册——联系人和活动之间的关联表,是漏斗统计的原料。
- **SMB 度**: 中 — SMB 的"受众"是 WhatsApp 名单/IG 粉丝而非 CRM 成员表;但最小版(打过谁、谁回了)有真价值。
- **FIKIRTIVE 现状**: 零(前置依赖 CRM 区;是 P 区与 CRM 区、自动回复区的联动点)。
- **利弊**: 做的价值="回复者自动标 Responded"与自动回复区联动是两家都没有的 WhatsApp 原生玩法;成本=CRM 联系人对象要先立起来,完整 member-status 体系偏重。
- **双模注**: 人工=把名单挂进 campaign、手动改状态;Otto=群发后自动记名册,收到回复自动标记回应。

### P-14 【多触点归因模型(Multi-touch Attribution)】
- **谁有**: HubSpot(Pro 仅 first/last touch 口径;Enterprise 才有 linear/U/W/full-path/time-decay 全模型库), Salesforce(Primary Campaign Source 单触点 Professional+;首触/末触/均分三模型需同时持有 Pardot;Einstein Attribution AI 归因需 Pardot Advanced+ 且 ≥50–100 个带角色商机)
- **是什么**: 一单成交前客户碰过 5 个触点,功劳怎么分:first/last 是"算头还是算尾"的口径切换,多触点模型是按比例给各触点分账。
- **SMB 度**: 低 — 两家都锁企业档;SMB 数据量撑不起模型,能理解且够用的只到 first/last 切换。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=first/last 轻量层好解释、够 SMB 用;成本=多触点需要干净的商机+触点数据(SEA SMB 不具备),做了没人用得动;且依赖 P-12 的追踪底座。
- **双模注**: 人工=报表里切换 first/last 口径;Otto=汇报时用约定口径讲人话("这单算给那条 Raya 广告")。

### P-15 【Campaign 状态与组织(Status, Folders & Hierarchy)】
- **谁有**: Salesforce(Status 字段 Planned→Completed + Path 推进条、父子层级最多 5 层 + In-Hierarchy rollup 字段,Professional+), HubSpot(saved views/folders/批量编辑、删除后 3 个月恢复窗,Pro+)
- **是什么**: 活动有生命周期状态(计划中/进行中/已结束),多了以后要能进文件夹、按状态筛、归档;大组织还要父子层级向上汇总指标。
- **SMB 度**: 低 — 状态+文件夹是卫生设施;5 层层级纯企业结构,SMB 最多"年度主题→单档活动"两层,tag 即可替代。
- **FIKIRTIVE 现状**: 部分有 — project 雏形有基本组织;状态机/归档/恢复零。
- **利弊**: 做的价值=活动多了不乱、报表可按状态过滤,成本低;风险=照抄层级/record types 会把 SMB 界面搞重。
- **双模注**: 人工=改状态、拖文件夹;Otto=按执行进度自动推状态、收官自动归档。

### P-16 【协作:评论与任务(Comments & Tasks)】
- **谁有**: HubSpot(campaign 页评论 @ 队友;campaign tasks 建任务/指派/上日历,Pro+), Salesforce(Chatter 评论串+@,全档), Adobe(画布 annotations/@/资产 deep links)
- **是什么**: 在活动页上 @ 同事讨论、派"周三前交素材"的任务,活动相关沟通不散落在 WhatsApp 群里。
- **SMB 度**: 低 — 单人操作者用不上;多席位/agency 场景才成立。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=多人/agency 场景的粘性;成本=通知+权限+任务三件套是标准但不小的工程,过早做是负担。
- **双模注**: 人工=评论、指派任务;Otto=被 @ 时应答,并把自己的执行步骤登记成可见任务。

## P 区遗漏检查

1. **多渠道 journey/flow 编排(Journey Builder / Workflows / Engagement Studio)** — 三份研究一致把它映射到自动回复区或"存疑/v1 不做"(全画布是重资产,SMB 用不到 95% 的节点);P 区只保留其与 brief 生成(P-07)、日历排期(P-03)的交界,编排引擎本体不列入本区。
2. **Connected Campaigns / Engagement History / B2B Marketing Analytics 等 Salesforce B2B 增强** — 前置依赖整套 Pardot+商机+contact roles 数据底座,研究已标企业级,SEA SMB 场景缺失,不构成 founder 在 P 区的决策项。
3. **管理员级配置面(Record Types、Custom Report Types、Campaigns API、数量上限/permissions 细粒度)** — 属平台管理面而非功能簇,SMB 无 admin 角色;campaign 级权限(HubSpot Enterprise)已并入 P-10 审批的 agency 场景一并考虑,不单列。


---

# M 区 —— 自动回复/客服

# M 区|自动回复/客服区(WHAT-pass 功能簇)

> 综合 respond.io / ManyChat / Salesforce Service Cloud / HubSpot Service+Data Hub / GoHighLevel 五份研究,按功能簇合并去重,SMB 价值高的在前。**respond.io 为 KL 同城对手,每簇内加粗单独标注其完整打法**。FIKIRTIVE 本区现状为零(个别簇借力已有楼)。

### M-01 【全渠道团队收件箱(Omnichannel Team Inbox)】
- **谁有**: **respond.io(产品本体:12+ 渠道 WhatsApp/IG/Messenger/TikTok DM/Telegram/LINE/Viber/WeChat/SMS/Email/网站 widget 收进一个收件箱,$79 起;自定义收件箱视图、内部评论协作、不活跃会话 Auto-close+AI 分类摘要、移动 App)**, GoHighLevel(Unified Conversations,每联系人一条跨渠道线程,$97 全含), HubSpot(Conversations Inbox+Help Desk Workspace,Free 起), ManyChat(Inbox,营销侧附属), Salesforce(Digital Engagement add-on $75/user/月,官方渠道甚至不含 IG DM)
- **是什么**: 把 WhatsApp、IG、FB 等所有渠道的客户消息收进一个团队共用的收件箱,几个人一起回,谁在跟谁、回没回一目了然。等于把"五个店员各拿一台手机"变成"一张共同的柜台"。
- **SMB 度**: 高——多人共用一个 WhatsApp 号、IG 私信没人认领,是大马 SMB 第一痛点;这是整个 M 区的地板。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做了才有自动回复/AI/群发的落脚点,且 respond.io $79 起步价对微型企业偏贵、留有定价空档;成本是多渠道 API 接入+实时消息基建,是本区最重的一笔工程。
- **双模注**: 人工面=收件箱列表+会话窗+分配按钮(老板手机上也能回);Otto 坐同一个收件箱先答,答不了才冒泡给人。

### M-02 【WhatsApp Business API 接入与模板消息(WhatsApp API & Templates)】
- **谁有**: **respond.io(官方 WhatsApp BSP:Meta 会话费零加价直通、平台内管 WABA 余额充值、模板同步/送审——"透明不赚差价"是其信任卖点)**, GoHighLevel($10/月/sub-account 接入费+Meta 会话费), HubSpot(按模板消息条数计费,超额约 $70/千条), ManyChat(Pro 档才解锁), Salesforce(锁在 $75 add-on 后)
- **是什么**: 正式接 Meta 的 WhatsApp Business API(不是个人版 app),才能多人共用、机器人接管、用预审模板突破 24 小时窗口主动发消息。模板要送 Meta 审核,会话按 Meta 费率计费。
- **SMB 度**: 高——马来西亚就是 WhatsApp 国家,客服/订单/催款全在上面;没有这条,M 区等于不存在。
- **FIKIRTIVE 现状**: 零(Meta App/connector 基建在 Campaign 侧已有,WhatsApp 产品线未开)。
- **利弊**: 所有对手的必经门槛,respond.io 的"零加价+平台内余额"设计可直接对齐;成本是 BSP 选型/Meta 审核/模板审核流的持续运营负担,且会话费是钱路,需隔离纪律。
- **双模注**: 人工面=模板库页面(建模板、看审核状态、看 WABA 余额);Otto 起草模板文案、盯审核结果、按余额提醒充值。

### M-03 【关键词与规则自动回复(Keyword & Rule-based Auto-replies)】
- **谁有**: ManyChat(Keywords 多种匹配模式+Quick Automations"评论→发链接"3 步预设,Free 起), **respond.io(欢迎语/离线回复/营业时间分流藏在 Workflows 里,$159 档起才给——入门档刻意不含,评测称"诱饵档"设计)**, HubSpot(chatflows 规则 bot:qualify/约会/建单,Free), Salesforce(Auto-Response Rules/Einstein Bots), GoHighLevel(workflow 内配置)
- **是什么**: 最朴素的自动化:客户发"价钱"就回价目表、非营业时间自动说明天回、新客先收欢迎语。不用 AI、不会出错,小店主第一天就会设的东西。
- **SMB 度**: 高——所有对手里 SMB 最先用的功能;ManyChat 免费送、respond.io 锁 $159,分水岭明显。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 工程小、确定性强、还是 AI 答错时的兜底;单独做价值有限,容易被"要不要连 flow builder 一起做"拖大范围。
- **双模注**: 人工面=一张"触发词→回复"的规则表(文件系统式、可读可改);用户说"有人问价就发这个",Otto 写进规则表。

### M-04 【Comment-to-DM 增长钩(Comment-to-DM Growth Triggers)】
- **谁有**: ManyChat(绝对霸主:IG 帖子/Reel 评论触发、Story 回复/@提及、直播评论、Follow-to-DM、Share-to-DM、DM 内发 PDF,Free 起;TikTok 评论触发官方"coming soon"), GoHighLevel(TikTok 评论进收件箱,未核实), **respond.io(空白——它只接"已进私信"的对话,评论→私信的公域增长钩它没有)**
- **是什么**: 有人在你的 IG 帖子下留言指定关键词,系统自动公开回一句+私信发链接/优惠码;直播评论、Story 互动、新关注同理。把公开流量转成私聊名单的抓手。
- **SMB 度**: 高——"留言 LINK 拿链接"是 SEA 社交电商的呼吸方式,微商/直播卖货每天在用。
- **FIKIRTIVE 现状**: 零(IG/FB 内容侧 connector 已有,评论/DM 权限与自动化未做)。
- **利弊**: 是 respond.io 打不到的差异化位,且与内容/排期区天然联动(发帖顺手挂钩子);需要 Meta 额外权限过 App Review,触发器要跟着平台新玩法持续维护。
- **双模注**: 人工面=在某个帖子上"挂钩子"(选关键词+私信内容);Otto 排期发帖时顺手配好钩子,事后报告抓了多少人。

### M-05 【AI 客服 Agent(AI Customer Service Agent)】
- **谁有**: **respond.io(AI Agents,$159 档起且 AI 用量 fair-use 近乎免费当获客钩子:RAG 知识挂载持续同步、多模态输入、答 FAQ/筛资格/约预约/更新字段、低置信度自动转人工、护栏+测试环境;另有 AI Assist/AI Prompts 从 $79 档起)**, HubSpot(Breeze Customer Agent:9 渠道、$0.50/次解决、72h 无转人工才算"解决"), Salesforce(Agentforce Service Agent:pay-per-resolution、自报 70% 自主解决率、Topics+Actions+Guardrails), ManyChat(AI Replies/AI Goals 仅 IG,$29/月 add-on;AI Playground 上线前测试+来源归因+知识缺口检测), GoHighLevel(Conversation AI,按量或 $50–97/月/sub-account)
- **是什么**: 让 AI 端到端接管对话:按你的资料答 FAQ、筛选客户、约时间,答不上或客户点名要人就转人工。行业正从"剧本机器人"转向"生成式 agent+按解决收费"。
- **SMB 度**: 高——SMB 没有客服部,只有老板和 WhatsApp;"晚上有人替我回"是最能讲清的价值。
- **FIKIRTIVE 现状**: 部分有(Otto 本体+skill 框架+brand memory 就是这个 agent 的骨架;缺收件箱载体、客服动作面、转人工、护栏)。
- **利弊**: 对手全把它当 add-on/高档位卖,FIKIRTIVE 可当默认体验,是 Otto 叙事在 M 区的本命位置;风险是 AI 直接对客户说话,幻觉/合规是新的安全面——对手的护栏/playground/低置信度转人工是必修课。
- **双模注**: 人工面=开关+知识源清单+转人工规则+"AI 答了什么"审计流;这一层本来就是 Otto,人工面只是 Otto 的缰绳。

### M-06 【Broadcast 群发与滴灌(Broadcast & Drip Sequences)】
- **谁有**: **respond.io(Broadcasts,$159 档起:分群定向、排程、失败重发、无对话历史号码冷启动导入群发、群发带多选题回流流程;群发不算 MAC、回复才计费——计费设计鼓励多发)**, ManyChat(Broadcasts+Sequences 定时滴灌+WhatsApp 模板群发、IG DM Lists beta), GoHighLevel(email/SMS/WhatsApp broadcast+Database Reactivation 老客唤醒模板), HubSpot/Salesforce(群发在营销侧产品,客服 hub 不含)
- **是什么**: 挑一群客户(标签/分群),一次性或按序列发促销/通知/唤醒消息;WhatsApp 走预审模板突破 24 小时窗口。
- **SMB 度**: 高——大马小店"促销=WhatsApp 轰一轮"心智已成型;老客唤醒是最便宜的现金玩法。
- **FIKIRTIVE 现状**: 零(排期区有排程心智可复用;楼层归属存疑:群发既像 campaign 又像消息,待 founder 划界)。
- **利弊**: 直接产钱,和 CRM 分群/广告闭环相互喂养;风险是骚扰/封号(Meta 对营销消息管控趋严),频控和 opt-out 得一起做。
- **双模注**: 人工面=选人群→选模板→定时间→看送达报表;对 Otto 说"给三个月没回购的客户发 Raya 促销",Otto 分群、起草、排发、汇报。

### M-07 【聊天入口套件:QR/链接/网站 widget(Chat Entry Points & Growth Widgets)】
- **谁有**: **respond.io(Growth Widgets,$79 档就给:多渠道网站 widget、QR 生成器、click-to-chat 链接,2026-06 起入口来源归因进报表和自动化)**, ManyChat(Ref URL/QR/网站 overlay widget/landing page), GoHighLevel(chat widget+QR 进漏斗), HubSpot(live chat 挂件,Free 带水印), Salesforce(MIAW 网页/App 内消息)
- **是什么**: 让客户"一扫/一点就进聊天"的入口:贴在门店/菜单/名片的 QR 码、放在 IG bio 的链接、官网角落的聊天按钮,并记录客户从哪个入口来。
- **SMB 度**: 高——大马门店/餐饮/服务业极高频,工程量小、演示效果好,性价比最高的一簇。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 便宜、快、给收件箱导流(先有入口才有对话);单独存在价值薄,要配着收件箱一起出。
- **双模注**: 人工面=生成器页面(选渠道→出 QR/链接→下载);Otto 顺手生成带归因的入口,并告诉你哪个入口进线最多。

### M-08 【Click-to-Chat 广告闭环(CTWA Loop:进线归因+事件回传+受众回流)】
- **谁有**: **respond.io(最强也最聪明的一块:Meta CTWA/TikTok Messaging Ads 进线自动捕获广告来源、CTWA click ID 自动带进 CAPI;聊天内"资格达标/预约/成交"经 Send Conversions API Event / TikTok Lower Funnel Event 回传投放算法,客户案例新客 +40%;报表按广告来源看对话量。但他们只握对话端)**, ManyChat(Ads CTM/FB Ads JSON 进 bot;IG 互动人群实时同步成 Meta 自定义受众做 retargeting)
- **是什么**: 客户点"Click-to-WhatsApp"广告进来,系统记住他来自哪条广告;聊成了就把"成交"信号喂回 Meta/TikTok,让广告平台专门去找会买的人;聊过的热人群还能回流成广告受众。
- **SMB 度**: 高——大马 SMB"投 Meta 广告→WhatsApp 成交"是主流打法,这条闭环直接决定广告钱花得值不值。
- **FIKIRTIVE 现状**: 部分有(投放端 G7 ad-write/ad-build 已在 Campaign 区;对话端为零——两端都握是所有对手做不到的结构位)。
- **利弊**: 全区最独特的战略卡位(respond.io 只有对话端,我们可做投放↔对话双向闭环);前提是收件箱+进线归因先立起来,回传事件定义还有数据合规面。
- **双模注**: 人工面=广告来源标签+回传事件开关+"哪条广告带来多少对话"报表;Otto 看见某条广告进线聊不成,直接建议改投放——两端联动是 Otto 独有动线。

### M-09 【坐席辅助:快捷话术/宏/AI 起草(Agent Assist)】
- **谁有**: **respond.io(Snippets 话术库可同时喂给 AI 当知识源;AI Assist 一键起草回复、AI Prompts 改语气/翻译/纠错——$79 档就给,是它入门档少数的甜头)**, Salesforce(Quick Text+Macros 一键多步+Einstein Reply Recommendations), HubSpot(snippets/邮件模板/宏/AI 回复建议+AI 会话摘要), GoHighLevel(Text Snippets), ManyChat(Inbox 基础)
- **是什么**: 人工回复的省力三件套:预制话术一键插入、一键执行多步操作(回复+打标+关单)、AI 按上下文起草让你改改就发。
- **SMB 度**: 高——不改变任何流程就省时间,五分钟学会;也是"人工→辅助→全自动"三档里的中间档。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 工程小,话术库天然是 AI 知识源的雏形、是 M-05 的前哨;价值上限低,单靠它撑不起本区。
- **双模注**: 人工面=话术库管理+消息框里"AI 帮我写"按钮;Otto 从历史回复自动沉淀话术库、起草待发回复给人过目。

### M-10 【会话分配与人工接管(Assignment & Human Takeover)】
- **谁有**: **respond.io(手动+自动分配、轮询/负载分配;Shortcut trigger 坐席一键把会话交给自动化流程——"人机同席"的最小交互原型;移动 App 随手回)**, ManyChat(bot→人工接管+Pause Automation 暂停机器人插话+auto-assignment+移动 App), HubSpot(会话轮转 Starter 起,skill-based routing 档位存疑), Salesforce(整套 Omni-Channel 路由引擎:技能/容量/主管监控——企业级样板), GoHighLevel(收件箱内分配)
- **是什么**: 谁来回这条消息:新会话自动派给某人、同事间转手、AI 接管中途人要插话得先"暂停机器人"。SMB 版本就是一个 assign 按钮+手机 App,不是路由引擎。
- **SMB 度**: 中——3-5 人小团队"别漏、别撞车"就够,但没有它多人协作会乱。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 轻量版(认领+转手+暂停 Otto)成本小、是收件箱可用性的一部分;别抄 Salesforce 技能路由——SMB 没有"路由"问题,只有"谁看到了谁回"问题。
- **双模注**: 人工面=会话上的"分给我/转给他/暂停 Otto"按钮;Otto 按在线状态自动派单,感知"人插话了就闭嘴"。

### M-11 【聊天内卖货与收款(Chat Commerce:Catalog + Payment Link)】
- **谁有**: **respond.io(Meta Product Catalog 集成:消息/流程/群发里发商品卡,客户 Add-to-Cart 后订单进收件箱;无内建支付,靠 payment link;弃购挽回自动消息)**, ManyChat(WhatsApp catalog/选品助手/cart/订单确认;Shopify 集成状态混乱), GoHighLevel(Text-2-Pay 收款链接+发票+电子签), HubSpot(payment links,自营支付仅美英加,MY 走 Stripe)
- **是什么**: 在聊天里完成"看货→下单→付钱":发商品目录卡片、客户选了直接生成订单、丢一条收款链接完成支付。
- **SMB 度**: 中偏高——大马聊天电商真实存在(WhatsApp 报价→转账截图是日常),但支付本地化(FPX/DuitNow/本地网关)是另一摊。
- **FIKIRTIVE 现状**: 零(平台自身收 Stripe,替商家向其客户收款是全新钱路)。
- **利弊**: 把"对话"变"营收"的最后一公里,对手都没做好本地支付、差异化空间大;钱路+本地网关合规是重工程,须走 money-path 隔离纪律。
- **双模注**: 人工面=商品目录管理+聊天里"发商品/发收款链接"按钮;客户问"有什么颜色",Otto 发对应商品卡并附收款链接。

### M-12 【跨渠道联系人合并(Cross-channel Contact Merge)】
- **谁有**: **respond.io(Contact Merge 是核心卖点:同一个人的 WhatsApp+IG+email 身份合并成单一客户档案,全渠道单一视图)**, ManyChat(按 email/手机号合并 IG+WhatsApp+Messenger), HubSpot/Salesforce(CRM 本体天生支持), GoHighLevel(每联系人一条跨渠道线程)
- **是什么**: 认出"IG 上问价的和 WhatsApp 下单的是同一个人",把他的所有对话和资料并成一份档案;不然客户换个渠道,你就失忆。
- **SMB 度**: 中——用户不会主动要,但多渠道一并行,没有它体验立刻降级;是体验分水岭。
- **FIKIRTIVE 现状**: 零(归属跨区:这是 CRM 区的联系人底座,M 区是它最大的消费者)。
- **利弊**: 做了才有单一客户视图和精准分群/归因;身份匹配工程量大、误合并有客诉风险,可先靠手机号硬匹配起步。
- **双模注**: 人工面=联系人档案页+"合并/拆开"确认按钮;Otto 发现疑似同人先给建议,人点头才合并。

### M-13 【知识库/AI 知识源(Knowledge Base as AI Grounding)】
- **谁有**: **respond.io(AI 知识源:PDF/URL/Snippets 挂给 AI Agent,RAG 持续同步——知识改了 AI 立刻跟上)**, ManyChat(Knowledge v2 可审核知识源+Playground 知识缺口检测), HubSpot(完整 KB 站点 Pro+;KB Agent 从工单自动起草 FAQ 文章), Salesforce(Lightning Knowledge 全家桶:版本/审批/分类,Pro/Ent 另收费)
- **是什么**: 商家的 FAQ/价目表/政策放一处,喂给 AI 当回答依据;高级形态是对客户公开的 help center 站点——两种形态是两个量级的工程。
- **SMB 度**: 中——SMB 不会主动建知识库,是"AI 要答对"逼着他们整理;公开 help center 在 MY 基本没人看,IG highlight 就是他们的 FAQ。
- **FIKIRTIVE 现状**: 部分有(brand memory+文件系统哲学正好承接"商家可读可改的知识文件";面向客户的 KB 站为零)。
- **利弊**: 知识文件形态成本低、直接决定 M-05 的答复质量、贴 founder 的 file-system 偏好;公开站点/版本审批全家桶属企业需求,可后置。
- **双模注**: 人工面=一个知识文件夹(markdown 般可读、可直接改);Otto 从历史对话发现"答不上的问题",自动起草补进知识文件。

### M-14 【Flow Builder 可视化自动化(Visual Flow Builder)】
- **谁有**: ManyChat(最成熟:拖拽画布、条件分支、12 路 A/B 分流、延时、多渠道节点混排、逐块分析), **respond.io(Workflows:11 种触发器+19 种步骤,$159 起;不支持定时触发是官方明说的洞;评测抱怨上手要 2-3 小时+反复试错)**, GoHighLevel(workflow builder——学习曲线是全平台最大怨点,很多人没发出第一条自动化就放弃), HubSpot(workflow 引擎 Pro+,来件进 workflow 路由), Salesforce(Flow/Omni-Channel Flow,管理员工程)
- **是什么**: 用拖拽流程图定义"客户说 A 走这条、超时走那条"的多步自动化。是所有对手的"专业感"担当,也是所有对手学习曲线差评的共同来源。
- **SMB 度**: 中——SMB 要的是结果不是画布;对手的差评正是证据。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 不做画布省下本区最重的一笔前端工程,且"Otto 替你搭"叙事成立(对手的痛=我们的论点);但完全没有可视面用户会不安,至少要"Otto 生成的流程人能看懂、能一键关掉"的审阅态。
- **双模注**: 人工面=两条候选路线:极简 trigger→action 规则表,或只读流程审阅图;Otto 自然语言进、规则/流程出——Otto 本身就是 builder。

### M-15 【轻量工单与超时提醒(Lightweight Ticketing & SLA)】
- **谁有**: Salesforce(Case 全家桶:队列/分派/升级规则/Entitlements/Milestones——企业样板), HubSpot(Ticketing Free 起+SLA 目标+临期超时告警), **respond.io(刻意不做"工单"概念:用 Open/Close 会话+Auto-close+AI 分类摘要替代——轻量路线的样板)**, GoHighLevel/ManyChat(无工单概念)
- **是什么**: 把"这个客户的问题处理完没有"变成看得见的状态:打开/待跟进/已解决,超时没人回就冒泡提醒老板。SMB 版本不叫工单,叫"别忘了这个客户"。
- **SMB 度**: 中——"X 分钟没回就提醒"一条规则吃掉 90% 价值;完整 case 体系是企业才需要的。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 轻量三态+超时冒泡成本小,直接兜住"漏单"焦虑(GHL 的 Missed Call Text-Back 被公认"最粘"证明这类小钩子的力量);做成完整工单系统则掉进企业级泥潭。
- **双模注**: 人工面=会话上的状态标签+一条"超时提醒"设置;超时没人回,Otto 先顶上或提醒老板——SEA 版 Missed-Call-Text-Back。

### M-16 【会话后满意度 CSAT(Post-conversation CSAT)】
- **谁有**: HubSpot(CSAT/NPS/CES 问卷+低分自动开工单,Pro+), Salesforce(Surveys 按份收费;Feedback Management $13.5k/月起,纯企业玩具), **respond.io(无独立 CSAT 模块见于研究——用响应率/解决率等运营报表替代)**, ManyChat/GoHighLevel(无正式 CSAT)
- **是什么**: 会话结束自动发一条"满意吗?"(emoji/1-5 分),结果挂在客户档案和报表上;同时它是 AI 客服"解决/未解决"判定的原料。
- **SMB 度**: 中——MY SMB 不做正式 NPS,但一条 WhatsApp 满意度小问有价值;更大价值是给 Otto 的解决率攒证据。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 轻量版几乎零成本(一条自动消息+一个统计),还是行业"按解决计费"(HubSpot $0.50/解决、Salesforce pay-per-resolution)定价演进的判定地基;做成问卷系统就是企业虚胖。
- **双模注**: 人工面=一个开关+一个满意度汇总数字;Otto 会话收尾顺手问,差评自动升级给人。

### M-17 【客服与 AI 绩效报表(Service & AI Performance Analytics)】
- **谁有**: **respond.io(11 类报表:响应率/首响时长/解决率/坐席 Leaderboard/Lifecycle 漏斗/Calls+主管实时 Dashboard——企业级排场,SMB 用不完)**, HubSpot(service analytics+Customer Agent 专属报表:解决率/转人工率/内容缺口), Salesforce(标准客服报表+Service Intelligence BI), ManyChat(流程/节点级漏斗+Home 绩效总览四线指标), GoHighLevel(自定义 dashboard;坐席报表锁 $497 档)
- **是什么**: 多少人来聊、多快回、解决几单、AI 替你答了多少/答不上什么。SMB 只需要少数几个数字,不是 11 类报表。
- **SMB 度**: 中——老板要"今天生意如何"一眼看完;"Otto 答了多少"是让人敢放手的信任面板。
- **FIKIRTIVE 现状**: 部分有(Analytics 页已规划 ads+organic+history,可加一节客服指标,与现有楼合并优于新楼)。
- **利弊**: 并进现有 Analytics 成本低,AI 解决率面板契合"安全"北极星;照抄 11 类报表+Leaderboard 是企业虚胖(SMB 没有坐席团队可考核)。
- **双模注**: 人工面=Analytics 页里几个数字+"答不上的问题"清单;Otto 周报口述"这周我答了 83%,这三类问题答不了"。

### M-18 【语音渠道与 Voice AI(Voice Channel & Voice AI)】
- **谁有**: **respond.io(WhatsApp Business Calling API+Messenger Calls+VoIP 进收件箱、录音+转写、Voice AI 32 语言可实时转人工;2025-07 才 GA、国家开放度未明——他们也在早期)**, GoHighLevel(Voice AI 接线员 52 语言,~$0.163/分钟;Missed Call Text-Back), Salesforce(Service Cloud Voice,企业级成本结构), HubSpot(呼入呼出+IVR+录音转写按档给分钟数)
- **是什么**: 电话也进收件箱:客户从 WhatsApp 打来、AI 接听答疑约时间、录音自动转文字存档进会话线程。
- **SMB 度**: 低(现阶段)——大马 SMB 的电话就是老板手机,WhatsApp 语音条比 call center 场景真实;需求未证实。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 若 WhatsApp Calling 在 MY 市场跑通会是新入口,GHL 证明 Voice AI 可以后补不吃亏;现在做等于在未证实需求上押重基建。
- **双模注**: 人工面=通话记录+转写文本躺在会话线程里;Otto 读转写、写摘要、把口头承诺变成待办。

---

## M 区遗漏检查

以下内容五份研究里都有,但刻意没设簇——给 founder 看切线在哪:

1. **企业级客服机器全家桶**(Salesforce 技能路由/Omni Supervisor 监控台/Entitlements-Milestones 合同型 SLA/Workforce 排班预测/Slack Swarming;HubSpot conditional SLA/task queues/customer success workspace 健康分)——全部以"有客服部/是 B2B SaaS"为前提,大马 SMB 是老板+手机;其轻量对应物已并入 M-10 与 M-15,全家桶本身不进单子。
2. **登录制自助门户与公开 Help Center**(Salesforce Experience Cloud 按 login 收费、HubSpot Customer Portal)——SEA SMB 客户不会为提单注册账号,他们的"门户"就是 WhatsApp/IG;知识库只保留"喂 AI 的知识文件"形态(M-13),对客门户整块剔除。
3. **美国式电话/SMS 全家桶**(GHL LC Phone/call tracking/ringless voicemail/A2P 合规、ManyChat SMS 仅限美国、HubSpot IVR)——渠道错配:MY 主战场是 WhatsApp,SMS 贵且没人看;只保留 WhatsApp 语音一个观察位(M-18),传统电信栈剔除。

---

# L 区 —— 生命周期自动化(email/SMS flows)

# L 区 生命周期自动化(email/SMS flows)

来源:Klaviyo / HubSpot Marketing / Salesforce Marketing / GoHighLevel 四份研究,按功能簇合并去重。FIKIRTIVE 本区现状:零(部分簇依赖 CRM 区联系人库为前置)。排序按马来西�亚 SMB 价值从高到低。

### L-01 【预建生命周期配方库(Pre-built Flow Recipes)】
- **谁有**: Klaviyo(Flows,60+ 一键配方:弃购/欢迎/购后/挽回/到货/降价,默认文案自带), GoHighLevel(Database Reactivation 唤醒/生日/预约提醒预置模板 + Snapshots 行业包), Salesforce(Personalization 内 5 用户触发+5 目录触发,锁在 $108k/年产品里), HubSpot(workflow 模板,较弱)
- **是什么**: 不给空白画布,给"装了就能跑"的成品自动化——触发器、等待、分支、默认文案全配好,商家点开关就上线。Klaviyo 靠这个把"数据→自动收入"变成一键动作,是它最强的激活路径。
- **SMB 度**: 高——MY SMB 没人手搭流程,配方=当天见钱;老客唤醒/生日券在 SEA 同样成立。
- **FIKIRTIVE 现状**: 零(但与 Otto skill 文件体系天然同构,skill 框架 + brand memory 是现成骨架)。
- **利弊**: 做的价值=激活最短路径,且可长成"可读配方文件+开关"的 file-system 形态;成本=每个配方背后要有真实触发数据(L-07)和出站通道(L-04/L-13),先于引擎做就是空壳。
- **双模注**: 人工=配方列表页,点开看触发/文案/开关;Otto=按行业挑配方、改成品牌口吻、征得同意后启用。

### L-02 【Campaign 一次性群发(Broadcast Campaigns)】
- **谁有**: Klaviyo(Campaigns,A/B+逐人发送时刻), HubSpot(email campaigns,Free 2,000 封/月起、automation 锁 Pro), Salesforce(Email Studio;MC Growth 含 180k 封/年), GoHighLevel(Email/SMS/WhatsApp broadcast,邮件 $0.675/千封)
- **是什么**: 上新、促销、节日的一次性推送:选分群、写内容、排时间、看结果。与常驻 flow 相对,是"手动扣扳机"的发送,四家都把它和 flow 共用同一套分群与内容资产。
- **SMB 度**: 高——SMB 第一个能听懂的功能,Raya/11.11 促销群发就是它;SEA 版本主渠道应是 WhatsApp 而非 email。
- **FIKIRTIVE 现状**: 零(Campaign 管理区已有 Meta 广告一侧,消息群发未建)。
- **利弊**: 做的价值=最易理解、复用分群和创作区资产、是 L 区的门面;成本=每个通道各有计费与合规,群发失误是炸名单最快的方式。
- **双模注**: 人工=建 campaign→选人群→定时发送;Otto=一句"给三个月没来的客户发 Raya 优惠"生成草稿,发送前过 founder gate(涉真金白银)。

### L-03 【分群引擎(Segmentation Engine)】
- **谁有**: Klaviyo(实时 segments + Segments AI 自然语言生成), HubSpot(Active/Static Lists,AI 生成 filter,Free 限 50 个), Salesforce(拖拽 + 自然语言分群,建在 Data Cloud 上), GoHighLevel(Smart Lists)
- **是什么**: 按属性/行为/购买历史自动进出的动态名单,例如"30 天没回购的老客"。它是 flows、群发、广告受众同步共用的地基;2025–26 四家全部加上了"说一句话生成分群条件"。
- **SMB 度**: 高——但 SMB 实际只用得动"标签+简单条件"级别,复杂查询语言是负担。
- **FIKIRTIVE 现状**: 零(依赖 CRM 区联系人库,该区仍在愿景中)。
- **利弊**: 做的价值=整个 L 区加广告受众的共同地基,建一次多处复用;成本=没有联系人数据源之前空转,且要克制在"保存的筛选条件"刻度上。
- **双模注**: 人工=筛选条件编辑器+名单实时预览;Otto=自然语言→分群条件并直接拿去用(四家的 NL 分群只到"生成条件"为止)。

### L-04 【WhatsApp 出站通道(WhatsApp Broadcast & Flow Sends)】
- **谁有**: GoHighLevel($10/月/子账号 + Meta 会话费,双向+模板+broadcast), Salesforce(MC Growth 出站、双向对话锁 Advanced $3,250/月), Klaviyo(paid private beta,按西方 credits 计费), HubSpot(无原生 WhatsApp 营销通道——它在本区域的最大空洞)
- **是什么**: 经 WhatsApp Business API(WABA)发模板消息:群发、flow 内触达、收回复。WhatsApp 是马来西亚事实上的商业沟通渠道,而四家在这条通道上不是没有、就是贵或还在 beta。
- **SMB 度**: 高——WhatsApp 就是 MY 的 email,本区在 SEA 成立与否系于此。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=打进四家价格伞/空洞最大的一块,弃购、唤回、群发全靠它落地;成本=BSP 接入、模板审核、按会话计费是实打实的运营负担,且与 respond.io/Wati 等本地成熟玩家正面竞争。
- **双模注**: 人工=连接 WABA、管模板、看发送记录;Otto=起草模板送审、在 flow/campaign 里自动发送(每条会话费=真金白银,走 spend 确认惯例)。

### L-05 【一句话生成整套 Campaign/Flow(NL-to-Campaign Composer)】
- **谁有**: Klaviyo(Composer,private beta:prompt→分群+多渠道文案+排期), HubSpot(Marketing Studio:brief→落地页+表单+邮件), Salesforce(Agentforce Campaign Creation / Campaign Designer Beta:自然语言→brief→受众→文案→journey), GoHighLevel(Funnel AI/Email AI,浅)
- **是什么**: 用户说一句"给流失客户做个春季唤回",系统生成完整的受众+内容+流程草稿,人审核后发布。这是 2025–26 四家共同押注的方向,但全部停在"生成建议+人工组装/审批"。
- **SMB 度**: 高——SF 研究原话:SMB 极度想要这个形态,只是不想付企业价。
- **FIKIRTIVE 现状**: 部分有——Otto 本身就是这个形态(Meta 广告已走通自然语言→PAUSED 草稿),缺的是 lifecycle 工具面给它操作。
- **利弊**: 做的价值=正中 FIKIRTIVE 主叙事,且 Otto 输出可读文件、可比四家的黑盒更透明;成本=前提是分群/通道/flow 引擎先存在,否则无物可生成。
- **双模注**: 人工=审核 Otto 生成的草稿再放行;Otto=这簇就是 Otto 的原生工作方式,参考 SF 的 brief→segment→content→flow 四段式产物结构。

### L-06 【流程编排引擎(Visual Flow Builder)】
- **谁有**: Klaviyo(Flows:触发/条件分支/多渠道/webhook), HubSpot(Workflows,锁 Pro $800/月), Salesforce(Journey Builder $4,200 档起 / 新代 Flow-based Journeys), GoHighLevel(Workflow Builder,$97 全含——也是其学习曲线的主要来源)
- **是什么**: "触发→等待→条件分支→发消息"的底层执行引擎,四家都做成画布式编辑器。所有配方和自动化最终都跑在它上面。
- **SMB 度**: 中——SMB 需要它在底下跑,但不想亲手画流程图(GHL 评测:上手 2–4 周,很多人没发出第一条自动化就放弃)。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=L 区一切的执行底座;成本=完整画布是重资产且 SMB 用不到 95% 的节点——极简 trigger→action 规则表(Otto 可读写的规则文件)与完整画布之间量级差约 10 倍,形态是本区最大的单个决定。
- **双模注**: 人工=打开规则查看/修改(表格或画布,形态待定);Otto=自然语言接需求→写成可读规则文件,人随时可检查。

### L-07 【触发数据源:订单/行为事件接入(Trigger Data Sources)】
- **谁有**: Klaviyo(Shopify/Woo 目录+订单+弃购+站上行为,350+ 集成), Salesforce(entry sources / API events / Engagement Signals), HubSpot(表单/页面/邮件行为 + 500 个自定义事件), GoHighLevel(平台内事件:表单/预约/付款/管道阶段/签署)
- **是什么**: 弃购、复购、到货提醒这些高价值 flow 的"眼睛"——没有订单和行为数据流进来,生命周期自动化只剩生日和欢迎两招。四家的数据源全绑欧美电商栈(Shopify/Woo/BigCommerce)。
- **SMB 度**: 高——但 SEA 的订单长在 Shopee/Lazada/TikTok Shop/WhatsApp 里,四家都接不到:既是空位也是难点。
- **FIKIRTIVE 现状**: 零(Meta lead ads 一侧已有连接器基础可延伸)。
- **利弊**: 做的价值=决定弃购/复购类 flow 是否成立,marketplace 数据是四家覆盖不了的差异位;成本=每个平台一个连接器工程,Shopee/TikTok Shop 的事件级 API 可用性未核实。
- **双模注**: 人工=连接店铺、看事件流水;Otto=把事件当触发器,并主动提示"你的弃购数据够了,可以开这条 flow"。

### L-08 【表单弹窗获客(Forms & Pop-ups)】
- **谁有**: Klaviyo(pop-up/fly-out/embedded + AI 弹出时机 + 优惠券自动挂进购物车), HubSpot(forms + CTA 六型:banner/pop-up/slide-in,exit intent/滚动/停留触发), Salesforce(Smart Capture/CloudPages,提交直接进 journey), GoHighLevel(Forms/Surveys/Quizzes,多步+条件逻辑)
- **是什么**: 网站上的名单收集器:弹窗、嵌入表单、退出挽留,提交自动进名单并触发欢迎 flow。Klaviyo 的聪明闭环:填完表单,优惠券自动挂进结账。
- **SMB 度**: 中——前提是客户有自己的网站;MY SMB 很多只有 IG bio + marketplace 店,Meta Lead Ads 回传可能比自建表单更贴地。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=名单增长的标准入口,与欢迎 flow 天然成对;成本=依赖客户站点有嵌入位,SEA 覆盖面存疑。
- **双模注**: 人工=表单编辑器+嵌入代码+转化报表;Otto=生成表单和文案、按数据自动调弹出时机(对齐 Klaviyo Forms Display AI)。

### L-09 【客户打分:规则式(Rule-based Lead Scoring)】
- **谁有**: HubSpot(手动 score,Free 起;预测版锁 Enterprise), Salesforce(Pardot Scoring/Grading、Next 代 People Scoring), GoHighLevel(Lead Scoring,$97 档), Klaviyo(无显式 scoring,用预测字段替代)
- **是什么**: 按行为加减分(打开/点击/回复/下单),把名单分成热/温/冷。规则透明、无需模型,SFMC 研究结论:SMB 要的就是这个刻度,不是 AI 打分。
- **SMB 度**: 中——有感但常可简化成"最近互动时间"一个字段。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=便宜、可解释、直接喂给分群和 flow 当条件;成本=规则要人维护,不调就失真。
- **双模注**: 人工=规则表(行为→分值);Otto=代管规则,并把"变热了"直接转成动作(提醒跟进/进挽回 flow)。

### L-10 【发送时刻与频率优化(Send Time & Frequency Optimization)】
- **谁有**: Klaviyo(Personalized Send Time,官方称点击 +35%;Channel Affinity 渠道偏好;quiet hours), Salesforce(Einstein STO / Engagement Frequency,Corporate+ 档), HubSpot(Send Time Optimization,Enterprise Beta)
- **是什么**: AI 学每个人的活跃时段逐人投递,并判断最优频率防疲劳退订。规则版=静默时段+每人每周上限,AI 版需要大量互动数据。
- **SMB 度**: 中——"几点发最好"老板有感,但 AI 形态是企业级,规则版对 SMB 通常够用。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=规则版(频控/静默时段)成本低且保护名单资产;成本=AI 版需要单店不具备的数据量,跨租户先验可补但涉数据边界。
- **双模注**: 人工=频控与静默时段设置项;Otto=自动择时发送并解释选这个时刻的理由。

### L-11 【A/B 测试与路径实验(A/B Testing & Path Experiments)】
- **谁有**: Klaviyo(campaign/flow 内 A/B), HubSpot(邮件/页面 A/B 锁 Pro;Adaptive 多臂老虎机锁 Enterprise), Salesforce(Email A/B 全档;Path Optimizer / Path Experiments 最多 10 变体自动选赢家), GoHighLevel(基础 split)
- **是什么**: 同一消息发两个版本、系统自动选赢家发剩余人群;进阶版在 flow 路径层做 A/B/n 实验并自动把流量倒向赢家。
- **SMB 度**: 中——SMB 名单小,统计显著性常撑不起来;"自动采用赢家"比"给我一份报表"实用得多。
- **FIKIRTIVE 现状**: 零(Meta 广告侧可透传平台原生 A/B 能力)。
- **利弊**: 做的价值=消息 A/B 是群发的标准配件,浅版便宜;成本=自建完整实验引擎不划算,小样本下结论噪音大。
- **双模注**: 人工=两版内容+自动判胜开关;Otto=自动起两版、跑完直接采用赢家并把结论写进 brand memory。

### L-12 【预测分析字段:CLV/流失/下次购买日(Predictive Profile Fields)】
- **谁有**: Klaviyo(predicted CLV / churn risk / next order date / gender,全是 profile 一等字段,可直接当分群条件和触发器), Salesforce(Einstein Engagement Scoring,四类 persona,Corporate+), HubSpot(predictive lead scoring,Enterprise)
- **是什么**: 数据科学产品化:预测值直接长在客户档案上,当筛选条件和触发器用("预测下次购买日到了→自动发提醒")。这是 Klaviyo 全案里最值得学的形态——预测是字段,不是报表。
- **SMB 度**: 中——老板爱听 CLV/流失预警,但模型需要订单数据量,单店冷启动难。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=Klaviyo 验证过的"data→automated revenue"核心机关,差异化叙事强;成本=需要数据量与冷启动降级方案,跨租户聚合是远期可能(数据边界待议)。
- **双模注**: 人工=档案上多几个可筛选字段;Otto=用预测字段主动建议动作("这 37 个客户流失风险高,要发挽回吗?")。

### L-13 【邮件通道基建(Email Channel Infrastructure)】
- **谁有**: 四家全有——Klaviyo/HubSpot(拖拽编辑器+模板+AI 写信), Salesforce(Email Studio+送达率全家桶:SAP/专用 IP/渲染测试), GoHighLevel(LC Email,$0.675/千封转售制)
- **是什么**: 拖拽编辑器、模板库、个性化令牌、退订处理,以及看不见的大头:送达率基建(发信域名、warm-up、投诉率管理)。是西方 lifecycle 工具的默认主渠道。
- **SMB 度**: 中低——SEA 邮件文化弱、打开率生态低,但 campaign 编排里完全没有 email 会显得残缺(B2B/服务型 SMB 仍要)。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=补全渠道矩阵;成本=deliverability 是无底洞,自建发送不如接第三方 API(Resend/SES 类)只做编排层——做多深是刻度决定。
- **双模注**: 人工=编辑器+模板库;Otto=生成邮件内容、复用创作区资产与品牌口吻。

### L-14 【Consent/退订/偏好管理(Consent & Preference Management)】
- **谁有**: Klaviyo(suppression 名单/GDPR 排除/SMS consent 过滤), Salesforce(Next 代集中 consent 管理 + Preference Center), HubSpot(订阅类型/退订), GoHighLevel(opt-in/opt-out)
- **是什么**: 谁能被发、谁说过别发、在哪个渠道说的——集中记录并在所有出站渠道强制尊重。PDPA 合规和名单健康的底线件。
- **SMB 度**: 中——SMB 不会主动要,但被投诉/封号的后果直接落在它头上(WABA 尤其)。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=合规底线+送达率保护,最小版(退订/勿扰字段+发送前过滤)成本低;成本=做成独立偏好中心页面就过度了(SFMC 研究:SMB 只要一键退订)。
- **双模注**: 人工=联系人档案上的 consent 字段;Otto=发送前自动过滤,并 fail-closed 拒绝违规发送请求。

### L-15 【产品推荐(Product Recommendations / Next Best Product)】
- **谁有**: Klaviyo(推荐引擎 + Next Best Product,已扩到 email/SMS/push/WhatsApp), Salesforce(Einstein Recipes / Recommendations,多锁在 $108k/年 Personalization 内), HubSpot(无电商推荐引擎), GoHighLevel(无)
- **是什么**: 按购买/浏览历史在消息里逐人插入"你可能想要"的商品块,主要用在购后/复购 flow 里抬客单价。
- **SMB 度**: 低中——需要商品目录+订单数据;主营 marketplace 的 MY SMB 目录数据难拿。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=复购 flow 的客单价放大器;成本=完全依赖 L-07 数据源先成立,冷启动阶段无意义。
- **双模注**: 人工=消息模板里插推荐块;Otto=挑品并解释推荐理由。

### L-16 【流程健康监控与异常检测(Flow Health & Anomaly Detection)】
- **谁有**: Klaviyo(Flow Anomaly Detection + flow 内嵌指标), HubSpot(workflow health monitoring,Enterprise), Salesforce(Einstein Messaging Insights 异常报警)
- **是什么**: 常驻自动化坏了没人看见——监控每条 flow 的表现,转化骤降、发送失败等异常自动报警。
- **SMB 度**: 低——SMB 不会主动要,但"装了就忘"的配方模式(L-01)恰恰最需要它兜底。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值=配方库模式的安全网,与 Otto"主动巡检汇报"天然同构;成本=有 flow 在跑之前无意义,纯后置项。
- **双模注**: 人工=报警通知+指标面板;Otto=主动巡检,带着修复建议来报告。

## L 区遗漏检查

1. **SMS/电话系统全家桶**(GHL LC Phone、call tracking、ringless voicemail、A2P 注册;Klaviyo SMS 仅美加英澳新爱、HubSpot SMS 仅 +1 号码)——刻意不设簇:美国本地商户逻辑,马来西亚发不了或没人看;SEA 的对应物是 WhatsApp,已由 L-04 承载。
2. **企业级 CDP/身份合并/网站实时个性化**(Klaviyo Advanced KDP $500/月、Salesforce Data Cloud identity resolution、Personalization $108k/年、web 实时内容替换)——刻意不设簇:四份研究一致判为企业泥潭,SMB 的"CDP"就是一张干净的客户表,属 CRM 区的讨论范围而非本区。
3. **自有 App 渠道**(Mobile Push / In-App / Inbox / LINE GroupConnect)——刻意不设簇:前提是客户有自己的 App,MY SMB 基本没有;LINE 在马来西亚渗透低(泰/台/日市场议题)。

---

# B 区 —— 资产/品牌治理

# B 区 资产区/品牌治理 — 功能簇清单(按 SMB 价值排序)

### B-01 【品牌资料包与用法说明(Brand Kit + Guidelines)】
- **谁有**: Canva(Brand Kit,Pro 1–5 个/Business 100 个/Enterprise 无限;Brand Guidelines 给每个资产附"怎么用"说明), Adobe GenStudio(Brands 一等记录,base 含 5 个品牌,含 tone/logo/色板/channel 级准则), Higgsfield(基本没有,仅 chat Memory 记项目偏好)
- **是什么**: 把 logo、色板、字体、语气集中存成一份"品牌身份证",做设计或生成时随手调用。进阶版给每个资产附使用说明(logo 留白、什么场合用哪个色)。它是 B 区所有其他功能的地基。
- **SMB 度**: 高 — MY 老板最怕 AI 产出"不像我的店",一次设置长期受益。
- **FIKIRTIVE 现状**: 部分有 — Brand memory 存品牌信息喂 Otto,但没有结构化的 logo/色/字体管理面,用户看不到也改不了"我的品牌长什么样"。
- **利弊**: 做的价值 = 约束生成、校验、模板等后续功能全依赖它,且给用户"被理解"的可见感;成本 = 输入面容易变成填表作业,要靠 B-02 这类机制解,UI 养护是持续投入。
- **双模注**: 人工面 = 一页品牌设置(上传 logo、挑色、选字、写语气备注,file-system 式可读可改);Otto 生成时自动引用整个 kit,对话一句"换新 logo"即可更新。

### B-02 【URL 一键建档(Brand/Product Ingest from URL)】
- **谁有**: Adobe GenStudio(Add from URL,2026.05:贴已发布网页自动抽出 Brand/Product/Persona), Higgsfield(Marketing Studio 贴商品链接自动抓名称/描述/图), Canva(无直接等价;Enterprise Team Context 从公司文件学品牌,算间接)
- **是什么**: 贴官网/IG/Shopee 链接,系统自动爬取并生成品牌或产品档案草稿,老板确认即可。把最重的 onboarding 填表作业变成 30 秒。
- **SMB 度**: 高 — MY SMB 没耐心手填品牌手册,冷启动摩擦是弃用的第一杀手。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值 = 建置成本低(爬页+LLM 抽取)、对"5 分钟开箱"体验杠杆极大;风险 = 抽取质量参差(非标准网页/纯 IG 店),草稿必须经人确认否则污染 brand memory。
- **双模注**: 人工面 = 贴链接→预览抽取结果→逐项确认;Otto 在 onboarding 对话里自己去爬,回来交一份 brand kit 草稿给老板过目。

### B-03 【品牌约束生成与校验打分(Brand-constrained Generation + Validation)】
- **谁有**: Adobe GenStudio(核心卖点:生成时注入 Brand 护栏 + brand validation/brand score 实时校验,且校验免费不耗 credits), Canva(Brand Kit 编辑器内直调 + Enterprise Team Context/Grow 的 brand-aware 生成), Higgsfield(无品牌校验概念)
- **是什么**: 生成时把品牌资料当约束注入,产出后自动检查"像不像这个品牌"并给分,不合规就提示或重生成。GenStudio 把"校验免费、生成收费"设计成计费边界,鼓励用户放心反复检查。
- **SMB 度**: 高 — AI 出图跑偏是 SMB 对 AI 工具失望的最大单点,"生成的就是我的牌子"是付费理由。
- **FIKIRTIVE 现状**: 部分有 — Otto 生成时会用 Brand memory,但没有显式校验/打分/不合格重试环节。
- **利弊**: 做的价值 = 与 credits 心理学契合(校验免费),直接提升产出可用率、减少废片浪费;成本 = 打分标准要定义并持续维护,分数不准反而伤信任。
- **双模注**: 人工面 = 生成结果旁显示品牌契合提示 + 一键"更像我的品牌";Otto 生成前自注入约束、生成后自检,低分自动重 roll 再交付。

### B-04 【品牌记忆持续学习(Brand Intelligence / Living Memory)】
- **谁有**: Adobe GenStudio(Brand Intelligence,2026.04:吃审批反馈、批注、拒稿/通过记录,动态更新品牌理解,并开放给 agents 调用), Canva(AI 2.0 Living Memory:持久记忆用户风格与品牌)
- **是什么**: 品牌理解不靠老板维护手册,而是从日常行为里学——每次拒稿、改稿、通过都变成训练信号,品牌准则从死文档变活的。两大对手同时押注这个方向。
- **SMB 度**: 中 — 用户不会主动要求,但"越用越懂我"是留存和差异化的隐形来源,且老板零维护成本。
- **FIKIRTIVE 现状**: 部分有 — Brand memory 存在且 rebuild 已在 backlog,但"批改行为=训练信号"的回路还没建。
- **利弊**: 做的价值 = 与已规划的 Brand-memory rebuild 天然重叠、顺路可得,方向已被两家背书;成本 = 数据管道 + "学错了怎么纠"的可见性/可删除设计。
- **双模注**: 人工面 = 一页"Otto 学到的品牌偏好"(条目可读、可改、可删);Otto 自动把每次批改吃进记忆,下次生成先应用。

### B-05 【品牌人设/角色资产(Cast / Soul ID)】
- **谁有**: Higgsfield(Soul ID:≥20 张照片约 3 分钟训练数字分身,跨风格/姿势/光线锁同一张脸,训后生成不限量;Character Locking 跨镜头一致), Canva/GenStudio(无同类角色资产)
- **是什么**: 把老板、店员或吉祥物训练/登记成可复用的"角色资产",之后所有图和视频都保持同一张脸出镜,支撑长期人设经营和 AI 口播带货。
- **SMB 度**: 高 — SEA 靠"人设"卖货(老板亲自出镜、店员 IP),不请 KOL 也能量产出镜内容。
- **FIKIRTIVE 现状**: 已有对应楼 — My Stuff 的 Cast 实体 + reference vision(#84)走参考图路线;与 Soul ID 的差距是"训练型分身"(一致性更稳 + 训后不限量)。
- **利弊**: 做深的价值 = 强化 FIKIRTIVE 已领先的一块,人设资产迁移成本高、粘性强;成本 = 训练型路线有算力/存储开销和真人肖像授权风险。
- **双模注**: 人工面 = My Stuff 里建 Cast、传照片、命名管理;Otto 出片时自动带上指定 Cast,跨帖保持同脸同气质。

### B-06 【资产库与自动打标(Content Library + AI Tagging)】
- **谁有**: Adobe GenStudio(Content library:存/搜/复用已审批资产,AI 自动属性打标免费不耗 actions、色彩标签筛选、metadata 编辑,base 2TB), Canva(文件夹 + 5GB/1TB 云盘式存储), Higgsfield(生成物进 Projects,无打标)
- **是什么**: 所有生成物和上传素材的"仓库 + 搜索":AI 自动打标签(内容、颜色、用途),让"找回上次那张图"从翻页变搜索,旧素材可直接复用。
- **SMB 度**: 高 — 生成型产品素材量涨得飞快,三个月后找不到旧图是必然的痛,复用还直接省 credits。
- **FIKIRTIVE 现状**: 部分有 — Library 存在但"没门牌"(无正式入口/导航),无自动打标、无搜索。
- **利弊**: 做的价值 = 给已存在的 Library 补门牌 + 自动 tag,属中量级增强,GenStudio 证明"打标免费"不伤计费模型;成本 = 搜索/筛选 UI 与打标质量的长尾维护。
- **双模注**: 人工面 = Library 门牌页,按标签/颜色/时间筛选;Otto 自动打标 + 语义找图("上个月那张 raya 促销图")。

### B-07 【产品与受众档案(Products / Personas)】
- **谁有**: Adobe GenStudio(Products/Personas 与 Brand 并列的一等记录,生成时一并作护栏注入), Higgsfield(Marketing Studio 临时抓产品信息,不成档案), Canva(无一等公民等价物)
- **是什么**: 品牌之外再立两类档案:卖什么(产品卖点/价格/图)和卖给谁(目标人群)。生成广告时自动带上,不用每次重新描述一遍产品。
- **SMB 度**: 中 — 多 SKU 电商/餐饮价值明显,单品小店感知弱;但一次建档长期省 prompt。
- **FIKIRTIVE 现状**: 零 — Cast 是角色实体,没有产品/人群档案。
- **利弊**: 做的价值 = 数据结构简单、与 B-02 URL 抓取天然配对,还是批量创建(B-08)的前置;风险 = 档案多了产生维护疲劳,要防"填表感"。
- **双模注**: 人工面 = 产品/客群卡片(名称、卖点、价格、图);Otto 从商品链接自动建档,生成时按不同 persona 自动出不同版本。

### B-08 【批量创建(Bulk Create / Data-driven Variants)】
- **谁有**: Canva(Bulk Create:CSV/Sheets 最多 300 行×150 字段套模板批量出图,Auto-match 自动映射字段;Data Autofill 外部数据连接器), Adobe GenStudio(Variants 引擎:一次生成多变体、多比例导出), Higgsfield(Scheduled Tasks 每日广告变体,偏定时非数据驱动)
- **是什么**: 一张表(商品/价格/门店)驱动一个版式,逐行批量产出成品图——多 SKU 促销图、餐牌、价格卡一次出全,不用一张张做。
- **SMB 度**: 中 — 电商/餐饮/多分店 SMB 有真实高频需求;单品服务型商家用不上。
- **FIKIRTIVE 现状**: 部分有 — canvas 4-variant 是"一稿多创意变体",不是数据表驱动的批量,两者形状不同。
- **利弊**: 做的价值 = 对电商类客户是清晰付费理由,且 FIKIRTIVE 版可跳过 CSV 映射 UI 直接让 Otto 读表(Auto-match 的 agent 化);成本 = 批量生成 = 批量烧 credits,失败重试和部分失败的工程细节多。
- **双模注**: 人工面 = 传表→挑版式→预览整批→确认生成;Otto 一句"读我的商品表,每个 SKU 出一张促销图"跑完,先报价再执行。

### B-09 【品牌锁定模板(Brand Templates)】
- **谁有**: Canva(Brand Templates:团队从锁定版式的模板起稿,Business+;支持锁元素), Adobe GenStudio(Templates:HTML5 zip/email 模板上传、starter templates、logo swap 多品牌换标、模板代码编辑器)
- **是什么**: 把打磨好的成稿存成"只许换文字图片、版式动不了"的内部模板。店员或新手起稿不会跑版,老板不用每张都盯。
- **SMB 度**: 中 — 单老板用不上,一旦雇人或交给 agency 就立刻需要;是个人工具到小团队的分水岭。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值 = 与 B-12 硬管控、B-10 审批组成"放心交出去"三件套,支撑团队席位收费;成本 = 需要可锁定的版式系统,而 FIKIRTIVE 是生成优先不是编辑器优先,形状冲突要先想清。
- **双模注**: 人工面 = "存为品牌模板"+ 锁定标记,队友只能改文案图片;Otto 按模板批量填充新内容,版式保证不跑。

### B-10 【内容审批流(Review & Approval)】
- **谁有**: Canva(Design Approvals:发布前须提交审批,Business 基础/Enterprise 多级审批组), Adobe GenStudio(Reviews & Approvals 内建 base 档;Workfront Proof 加购多级审批+批注), Higgsfield(只有花钱前 approve 报价,无内容审批)
- **是什么**: 内容发出去之前先送人过目:批注、驳回、通过;企业版可设多级规则。对 SMB 的合理形状是"老板过一眼再发"的轻量版。
- **SMB 度**: 中 — 单老板自产自发不需要;有员工或接 agency 单立即变刚需,MY 老板"我要先看过"的习惯很强。
- **FIKIRTIVE 现状**: 部分有 — Otto 侧已有 plan-approval/SoD + 花钱 cost-confirm(动作审批),但没有"内容发布前人审"的资产级审批流。
- **利弊**: 做的价值 = 与既有 approval 模式同构,且是 Otto 自动发内容的信任前提(先审后发);成本 = 通知/状态机/驳回重做的流程 UI,做重了就变 Workfront。
- **双模注**: 人工面 = 待审队列 + 批注 + 通过/驳回;Otto 产完自动排进待审,老板手机点头即发,拒稿理由自动喂回 B-04 的品牌记忆。

### B-11 【公共模板生态(Template Marketplace / UGC 模板工厂)】
- **谁有**: Canva(25 万+ 免费模板 + Creators royalty 供稿市场,十年 UGC 飞轮), Higgsfield(UGC Factory 40+ 成片模板 + Apps 41 个一键小工具 + hook 开场模板 + 热梗模板), Adobe GenStudio(starter templates,弱)
- **是什么**: 平台提供的现成起稿模板库——不是你自己的品牌模板,而是"别人做好的版式/片型",挑一个换内容就能用。Canva 的模板供给靠外部创作者分成生态,不是自建。
- **SMB 度**: 中 — MY SMB 在 Canva 已重度依赖模板起稿;但对生成优先的产品,模板是起点选项不是地基。
- **FIKIRTIVE 现状**: 零 — 路线不同:Otto 按 brand memory 直接生成"等效于模板"的成稿。
- **利弊**: 做薄层的价值 = MY 本地垂直模板(raya 促销/mamak 菜单/双十一)是 Canva 全球库覆盖不到的差异化,且模板=可读文件符合 file-system 管理哲学;风险 = 正面追 Canva 的 UGC 飞轮不现实,养库是无止境的运营成本。
- **双模注**: 人工面 = 逛库挑模板、换字换图;Otto 不逛库,把模板当内部菜谱,按场景自动选型直接出成稿。

### B-12 【品牌硬管控(Brand Controls / Enforcement)】
- **谁有**: Canva(Brand Controls:强制只许用品牌色/字体/模板、可锁元素,Business/Enterprise), Adobe GenStudio(Data governance 有害内容硬挡 + Brand/平台规范/ADA 三重 compliance checks)
- **是什么**: 从"提醒"升级到"禁止":员工只能用品牌色和字体,锁定的元素动不了,越界直接拦下。比 B-03 的软校验更硬一层。
- **SMB 度**: 低 — 单老板即品牌本人,自己管自己没意义;只在有员工/多人协作时才产生价值。
- **FIKIRTIVE 现状**: 零。
- **利弊**: 做的价值 = 补齐 Canva 式"资产→说明→硬约束→审批"四层递进的第三层,每层独立开关与 toggle 管理哲学同构;成本 = 生成式产品做"硬约束"比编辑器难(要拦生成结果,不是锁调色板)。
- **双模注**: 人工面 = 管理页勾选"只许品牌色/字体";Otto 生成时视为不可违反的硬规则,违规产物不交付。

### B-13 【多品牌与 Agency 治理(Multi-brand / Agency Governance)】
- **谁有**: Canva(Brand Kit 数量阶梯 1–5/100/无限,直接按品牌数收钱), Adobe GenStudio(base 5 brands + 扩容;Agency System of Record:代理操作留痕、品牌方保治理;logo swap 一键换标), Higgsfield(Business 席位 2–15 席 + 共享 credit 池)
- **是什么**: 一个账号管多个品牌:每个客户一套隔离的品牌资料,切换不串味;agency 场景再加"谁动了什么"的留痕和客户只审批的角色分工。
- **SMB 度**: 低 — 对单一 SMB 无感;但 MY 遍地小 agency/freelancer 代运营商家,他们是天然的批量获客渠道。
- **FIKIRTIVE 现状**: 零 — 单 org 单品牌;Agency 楼层还在规划概念。
- **利弊**: 做的价值 = 三家都验证了"品牌数量=收费轴",且是 Agency 楼层的地基;成本 = 数据隔离与权限模型是结构性改动,晚做迁移贵、早做拖速度。
- **双模注**: 人工面 = 品牌切换器 + 每品牌独立 kit/Library;Otto 按当前客户上下文自动切换品牌资料,绝不串用。

### B-14 【内容合规与溯源(Compliance / Provenance / IP Check)】
- **谁有**: Adobe GenStudio(Content Credentials 嵌 C2PA 溯源元数据 beta、平台规范+ADA 无障碍检查、受监管行业 claims 合规 add-on), Higgsfield(Similarity Score:发布前查 IP 相似度/侵权风险), Canva(弱,主要靠素材授权体系)
- **是什么**: 发布前的"法务体检":给生成内容嵌可验证的来源标记、查与现有 IP 撞脸的风险、检查平台内容规范。
- **SMB 度**: 低 — MY SMB 不会问 C2PA;侵权自查对蹭梗内容有一点保险价值,但不构成付费理由。
- **FIKIRTIVE 现状**: 零(生成侧有模型级安全拦截,但无产品化的检查功能)。
- **利弊**: 做的价值 = 平台自保大于用户价值(广告被拒、被投诉时有交代);成本 = 检查准确率难保证,误报会打断出片节奏。
- **双模注**: 人工面 = 发布前一键体检报告;Otto 后台自动跑检查,只在高风险时冒头提醒。

### B-15 【品牌专属风格模型(Custom Brand Style Models)】
- **谁有**: Adobe GenStudio(Firefly Custom Models 在 FIM4 上训自有品牌风格 / Firefly Foundry 用整个 IP 库调优专属模型(天价级)/ StyleIDs 把设计系统训成可生成模型), Canva(Dream Lab Style Transfer:参考图匹配风格,轻量), Higgsfield(Soul 是自家审美模型,非按品牌训练)
- **是什么**: 用你的历史素材把生成模型"调教"成你的视觉风格,之后所有产出天然带品牌 DNA,不用靠 prompt 一遍遍描述。
- **SMB 度**: 低 — 企业级价格与素材量门槛,MY SMB 的素材库撑不起训练;参考图路线已覆盖八成需求。
- **FIKIRTIVE 现状**: 零(训练型);reference vision 参考图路线部分替代。
- **利弊**: 做的价值 = 长期差异化天花板高,迁移成本极高、粘性极强;成本 = 训练算力+存储+每品牌一个模型的运维,现阶段 ROI 差。
- **双模注**: 人工面 = 上传素材包→训练→之后默认走品牌模型;Otto 判断素材量何时够了,主动提议训练并管理模型版本。

## B 区遗漏检查
1. **一稿多尺寸 / 多语言批量翻译**(Canva Magic Resize/Translate、GenStudio GenExpand/40+ 语翻译)— 刻意划出:它们是生成/改稿动作,归创作区,虽然常和"批量创建"(B-08)相邻出现,但决策点在创作管线不在资产治理。
2. **素材图库授权**(Canva 1 亿+ stock 图/视频/音频)— 刻意划出:这是内容供给的采购/授权谈判问题,不是可建的功能楼层;FIKIRTIVE 走生成路线,stock 依赖天然弱。
3. **Campaigns 组织与项目管理**(GenStudio Campaigns/Workfront、Canva Docs 审批 brief)— 刻意划出:"按战役组织资产"归 Campaign 管理区;项目管理工具本身两份报告都标为企业级虚胖,背离 SMB 简单性。

---

# 附加节 —— 市政厅 v2 阶级制度(只有 founder 能答的题)

### X-01 阶级层数与命名:现有五级(viewer/ops/finance/moderator/super-admin)够吗?第一批团队几个人、什么分工?
### X-02 钱的阶级:finance 角色授信的单笔上限、日累计上限各多少?超限审批只到你,还是允许 super-admin 代批?
### X-03 冒充权:除你之外,哪个阶级可以冒充租户?冒充时能否发起任何写操作(现为全禁)?
### X-04 危险动作审批链:封租户、删内容、改模型开关 —— 哪些要双人确认?
### X-05 团队可见边界:ops/moderator 能看租户的对话与生成内容到什么深度(全文/摘要/仅元数据)?
