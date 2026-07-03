> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# Salesforce Service Cloud 竞品功能基线(2025–2026)

研究范围:case management、omni-channel 路由、live chat + messaging(WhatsApp/FB Messenger/SMS)、email-to-case、知识库、自助门户、entitlements/SLA、field service(仅提及)、Einstein Bots + Agentforce Service Agent、CSAT。视角:SMB 客户消息/客服场景。

**价位档速览**(per user/month,年付,2026 价)[solutions4sf](https://solutions4sf.com/blog/salesforce-service-cloud-pricing/) / [atonementlicensing](https://atonementlicensing.com/blog/salesforce-service-cloud-pricing/) / [tech.co](https://tech.co/crm-software/salesforce-pricing-how-much-does-salesforce-cost):

| Edition | 价格 | 定位 |
|---|---|---|
| Starter Suite | $25 | 小团队,基础个案+单渠道 |
| Pro Suite | $100 | 成长团队,+omni-channel、电话集成 |
| Enterprise | $165 | 多数客服中心的工作档,+API、高级个案管理 |
| Unlimited | $330 | +Einstein Bots(25 会话/人/月)、Messaging for In-App & Web 无限、24/7 支持 |
| Agentforce 1 Service(前 Einstein 1)| $500 | +Data Cloud、生成式 AI、Slack、Service Intelligence 打包 |

注意:实际成本常翻倍——Digital Engagement($75/user/月)、Service Cloud Voice、Einstein for Service 都是另收费 add-on([atonementlicensing](https://atonementlicensing.com/blog/salesforce-service-cloud-pricing/))。2025 年底 Enterprise/Unlimited 普涨约 6%。

---

## 1. 功能总清单

### A. Case Management(个案管理)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Case object + Case Feed(个案对象+时间线) | 每个客户问题一条 case,feed 汇总所有邮件/聊天/内部备注 | 全档 |
| Case Assignment Rules(分派规则) | 按来源/类型/优先级自动把 case 派给人或 queue | Starter 起(基础)|
| Case Queues(个案队列) | 团队共享待办池,按队列认领 | 全档 |
| Auto-Response Rules(自动回执规则) | case 创建时按条件自动发确认邮件 | Pro 起 |
| Escalation Rules(升级规则) | case 超时未处理自动改派+通知([help.salesforce.com](https://help.salesforce.com/s/articleView?id=service.rules_escalation_create.htm&language=en_US&type=5)) | Pro 起 |
| Support Processes + Record Types(支持流程/记录类型) | 不同业务线走不同 case 阶段 | Enterprise 起 |
| Macros(宏) | 一键执行多步操作(改字段+发邮件+关单) | Pro 起 |
| Quick Text(快捷短语) | 带个性化变量的预制回复片段 | Pro 起 |
| Case Merge(个案合并) | 重复 case 合并(细节 未核实 具体档位) | Enterprise 起(未核实)|
| Case Swarming with Slack(Slack 群攻协作) | 从 case 一键开 Slack 频道拉专家协作,结束后对话自动回写 case feed;Expert Finder 按技能/空闲自动找人([salesforceben](https://www.salesforceben.com/ultimate-guide-to-case-swarming-in-salesforce-service-cloud/)) | 需 Slack,偏高档 |
| Service Console(客服工作台) | 分屏视图+多 tab/subtab+utility bar(宏、Omni-Channel、CTI 软电话)统一工作区([help.salesforce.com](https://help.salesforce.com/s/articleView?language=en_US&id=service.console_lex_service_intro.htm&type=5)) | Pro 起 |
| Reports & Dashboards(客服报表) | case 量、首响、解决时长等标准报表 | 全档(Starter 为基础版)|

### B. Omni-Channel Routing(全渠道路由)

来源:[Salesforce Ben Omni-Channel 指南](https://www.salesforceben.com/salesforce-omni-channel/)、[help.salesforce.com skills-based routing](https://help.salesforce.com/s/articleView?id=omnichannel_skills_based_routing.htm&language=en_US&type=5)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Queue-Based Routing(队列路由) | 工作项进队列,路由给队列成员中最空闲/最可用的坐席 | Pro 起 |
| Skills-Based Routing(技能路由) | 按语言/专长等技能+技能等级匹配坐席 | Enterprise 起 |
| Skills-Based Routing Rules + Dynamic Skills(动态技能规则) | 按条件给工作项动态加技能要求 | Enterprise 起 |
| Omni-Channel Flow(流程化路由) | 用 Flow 编排路由逻辑(含 email-to-case 进 flow 路由,失败落 fallback queue)([help.salesforce.com](https://help.salesforce.com/s/articleView?id=service.omnichannel_route_email_to_case.htm&language=en_US&type=5)) | Enterprise 起 |
| Agent Capacity / Presence(坐席容量/状态) | 每人并发工作量上限+在线状态管理 | Pro 起 |
| Omni Supervisor(主管监控台) | 实时看坐席状态、队列积压、会话监听/介入 | Enterprise 起 |
| External Routing API(外部路由) | 把路由决策交给第三方引擎 | Enterprise 起(未核实)|

### C. Live Chat + Messaging(Digital Engagement 数字渠道)

核心事实:多数消息渠道**不含在基础license里**,要买 **Digital Engagement add-on,$75/user/月**(UE 部分打包)([salesforce.com digital channels pricing](https://www.salesforce.com/service/digital-customer-engagement-platform/pricing/)、[Salesforce Ben](https://www.salesforceben.com/what-is-salesforce-digital-engagement/))。

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Messaging for In-App and Web (MIAW)(网页/App 内消息) | 新一代网页+移动 App 嵌入式异步消息,替代旧 Chat | UE 无限含;其余走 Digital Engagement |
| Live Chat (旧 Web Chat / Embedded Chat) | 传统同步在线聊天 — **2026 年 2 月退役**,官方推 MIAW 迁移 | (退役中)|
| WhatsApp channel | WhatsApp Business 双向会话,付费渠道(Meta 会话费另计);25 会话/人/月额度可用于 SMS 或 WhatsApp([release notes](https://help.salesforce.com/s/articleView?id=release-notes.rn_service_messaging_pricing_changes.htm&language=en_US&release=238&type=5)) | Digital Engagement |
| Facebook Messenger channel | FB 私讯进 Salesforce 统一收件 | Digital Engagement |
| SMS channel(短码/长码) | 双向短信,付费渠道,短码需 START 类关键词 opt-in | Digital Engagement |
| Apple Messages for Business | iMessage 商务通道 | Digital Engagement |
| LINE channel | 官方渠道列表提及;enhanced 版支持情况 未核实 | Digital Engagement(未核实)|
| Bring Your Own Channel (BYOC) | 自接任意消息渠道进 Salesforce 路由 | Digital Engagement/合作伙伴 |
| 异步会话模型 | SMS/WhatsApp/FBM 消息排队等坐席,不要求实时在线 | — |
| Messaging consent/opt-in 管理 | 按渠道配置 opt-in 要求 | — |
| Conversation transcript 回写 | 会话记录落 case/联系人 | — |
| Social Customer Service(X/Twitter 等社媒发帖转 case) | 旧的 Social Customer Service Starter Pack 已退役(未核实 具体日期);现依赖 AppExchange 第三方 | (已退役/第三方)|

### D. Email-to-Case

来源:[help.salesforce.com email threading](https://help.salesforce.com/s/articleView?id=service.support_email_to_case_threading.htm&language=en_US&type=5)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Email-to-Case(邮件转个案) | 支持邮箱来信自动建 case | Starter 起 |
| On-Demand Email-to-Case | 免装 agent 的云端邮件接入(与本地 agent 版并存) | Pro 起 |
| Lightning Threading(邮件线程归并) | token+header 双机制,把往返邮件归到同一 case(替代旧 Ref ID) | 全档 |
| 自动回复邮件入 feed | auto-response/Apex 发出的邮件也进 case feed,回信仍归原 case | — |
| Email-to-Case → Omni-Channel Flow 路由 | 来信 case 直接进 flow 智能分派 | Enterprise 起 |

### E. Knowledge(知识库)

来源:[Salesforce Ben Knowledge 指南](https://www.salesforceben.com/introduction-salesforce-knowledge/)、[help.salesforce.com](https://help.salesforce.com/s/articleView?id=service.knowledge_whatis.htm&language=en_US&type=5)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Lightning Knowledge(知识文章) | 单一 Knowledge 对象承载全部文章 | Essentials/Unlimited 免费;Pro/Enterprise **另收费 add-on** |
| Article Versioning(版本控制) | 草稿→发布→新版本,带版本历史 | 同上 |
| Approval Process(审批流) | 文章发布前走审批 | 同上 |
| Data Categories(数据分类) | 分类组织文章+按用户/渠道控制可见性 | 同上 |
| 多渠道发布 | 同一篇文章发到内部/门户/公开站点 | 同上 |
| Article 搜索 + 挂 case | 坐席在 case 内搜文章、附给客户 | 同上 |

### F. Self-Service(自助服务门户)

来源:[salesforce.com self-service pricing](https://www.salesforce.com/service/customer-self-service/pricing/)、[titandxp](https://titandxp.com/article/experience/cloud-pricing/)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Help Center(帮助中心模板) | 面向未登录访客的知识库站点 | Experience Cloud;入门档 |
| Customer Community / Self-Service Portal | 登录制门户:查 case、提 case、看文章、社区问答 | $2/login 或 $5/member/月 |
| Customer Community Plus | +角色/分享/报表等高级权限 | $6/login 或 $15/member/月 |
| Case Deflection(提单前推荐文章) | 客户打字提单时实时推荐知识文章降量 | 门户功能 |
| Experience Builder(建站器) | 拖拽搭门户页面、主题化 | 同上 |
| Agentforce Customer Service Portal | 新推出的带 AI agent 的客服门户(2026 年 7 月 GA)([salesforce.com news](https://www.salesforce.com/news/stories/agentforce-help-agent-announcement/)) | Agentforce 计费 |

### G. Entitlements & SLA(权益/服务合同)

来源:[Salesforce Ben entitlements 指南](https://www.salesforceben.com/complete-guide-to-salesforce-entitlements-and-milestones-in-service-cloud/)、[help.salesforce.com](https://help.salesforce.com/s/articleView?id=service.entitlements_overview.htm&language=en_US&type=5)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Entitlements(支持权益) | 定义客户按合同应得的支持级别,可挂 account/asset/contact | Enterprise 起(Starter 有简版 service contracts)|
| Entitlement Process(权益流程) | 可定制时间线,串起里程碑:何时起算/暂停/完成 | Enterprise 起 |
| Milestones(里程碑) | 首响、解决时限等时间目标;Success/Warning/Violation 三类触发动作 | Enterprise 起 |
| Service Contracts + Contract Line Items(服务合同/行项) | 合同化支持(含保修行项级) | Enterprise 起 |
| Business Hours + Holidays(工作时间/假日) | SLA 计时按营业时间算 | Pro 起 |
| Milestone Tracker(里程碑倒计时组件) | 坐席界面实时倒数 SLA | Enterprise 起 |

### H. Field Service(现场服务)— 仅提及

独立产品线(前 FSL):work orders、Dispatcher Console(甘特图派工)、AI 排程优化、技师移动 App(离线)、资产/预防性维护、Agentforce 自动改约。价格 Dispatcher/Technician $175、Contractor $55、Field Service Plus $230–380、Agentforce 1 档 $650/user/月;需至少 1 个 Service Cloud license([salesforce.com field service pricing](https://www.salesforce.com/service/field-service-management/pricing/)、[Salesforce Ben](https://www.salesforceben.com/salesforce-field-service/))。对 FIKIRTIVE 目标客群(营销/客服 SMB)基本无关,不展开。

### I. Einstein Bots + Agentforce Service Agent(自动回复/自主坐席)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Einstein Bots(规则+NLP 机器人) | 对话式 bot 处理 FAQ/查订单/转人工;模板加速搭建 | Unlimited 含 25 会话/人/月;Digital Engagement license 同含 25 会话/人/月 |
| Bot→人工转接 | bot 无法处理时带上下文转坐席 | 同上 |
| **Agentforce Service Agent**(生成式自主客服 agent) | 无需预写剧本,基于 LLM 自主处理咨询、查知识库+客户历史、自动结案;官方称常规类目 40–60% deflection([ekfrazo](https://ekfrazo.com/resources/blogs/salesforce-agentforce-what-it-does-what-it-costs-and-who-actually-needs-it/)) | Agentforce 计费(见下)|
| Agentforce Help Agent(预制快装版) | "几分钟部署",自动 ground 在你的 Knowledge 上,带动作库(管理 case、约时间、改订单),覆盖 voice/web/portal/messaging;2026 年 7 月 GA([salesforce.com news](https://www.salesforce.com/news/stories/agentforce-help-agent-announcement/)) | Pay-per-resolution |
| Topics + Actions(话题+动作) | 声明式定义 agent 能干什么:topic 圈范围,action 接 Flow/Apex/API([architect.salesforce.com](https://architect.salesforce.com/docs/architect/fundamentals/guide/agentic-patterns.html)) | — |
| Agentforce Guardrails(护栏) | 用户自定义+平台托管防护:锁话题、防跑偏/幻觉 | — |
| 知识 grounding(Data 360/RAG) | 向量库+RAG 检索让回答有据可依 | 需 Data Cloud credits |
| Escalation / 人工交接 | topic 级自动升级;客户点名要人立即转;Dynamic Escalation 支持 if-then 策略([salesforce.com blog](https://www.salesforce.com/blog/agent-handoff/)) | — |
| **计费模式(3 种并存)** | ① Flex Credits:标准动作 20 credits($0.10)、语音 30 credits;$500/10 万 credits;② $2/会话;③ Pay-per-resolution:只在 agent 自主解决才收费,转人工/客户不满意不收([Salesforce Ben](https://www.salesforceben.com/huge-agentforce-pricing-shift-salesforce-introduces-pay-per-resolution/)) | Enterprise+ 经 Foundations 送 20 万 Flex Credits + 1,000 免费会话 |

### J. Einstein for Service(坐席辅助 AI,add-on)

来源:[Synebo](https://www.synebo.io/blog/top-8-service-cloud-einstein-features/)、[Trailhead](https://trailhead.salesforce.com/content/learn/modules/einstein-for-service-rollout-strategies/use-artificial-intelligence-to-improve-service)

| 功能 | 一句话 |
|---|---|
| Einstein Case Classification(个案自动分类) | 按历史数据预测填充 Reason/Priority/Product 字段 |
| Einstein Case Routing | 分类后自动路由(未核实 当前打包方式) |
| Einstein Reply Recommendations / Service Replies(回复建议) | 从历史会话+知识库生成建议回复,坐席一键采用 |
| Einstein Article Recommendations(文章推荐) | 学习哪些文章解决过类似 case,自动推给坐席 |
| Einstein Work Summaries(会话小结) | 生成式 AI 总结聊天/case,供结案与交接 |
| Einstein Conversation Insights/Mining(会话洞察) | 挖掘高频联络原因,反哺 bot/知识库(未核实 档位) |
| Einstein Next Best Action | 在坐席界面推荐下一步动作(未核实 当前归属) |

### K. CSAT / Feedback Management

来源:[salesforce.com feedback management](https://www.salesforce.com/service/customer-service-operations/feedback-management/)、[jotform 分析](https://www.jotform.com/blog/salesforce-surveys-pricing/)、[savio](https://www.savio.io/blog/Salesforce-feedback-management-license-cost/)

| 功能 | 一句话 | 价位档 |
|---|---|---|
| Salesforce Surveys(问卷) | 拖拽建 CSAT/NPS 问卷 | 每 org 有少量免费 responses(数量 未核实);Response Pack $300/1,000 份 |
| 会话后自动发送 | 邮件/SMS/chat/社媒/App 交互后即时触发问卷 | Feedback Management |
| Customer Lifecycle Maps(旅程 CSAT/NPS) | 按旅程节点看满意度 | Feedback Management Starter(报价约 $13,500/月,企业级)|
| 数据回写 CRM + 自动化 | 回复写回 case/contact,可触发 flow(差评自动升级) | 同上 |
| Einstein 分析集成 | 情感/趋势分析 | Growth 档(约 $46,000/月)|

### L. Voice(电话)— 简提

Service Cloud Voice:控制台内置电话(默认 Amazon Connect,或 BYO 电话商),实时转写、Einstein 实时推荐;计费 = SCV license + 每分钟话费 + 语音 AI add-on 三层([salesforce.com voice pricing](https://www.salesforce.com/service/call-center-integration/voice-pricing/)、[redresscompliance](https://redresscompliance.com/salesforce-voice-licensing.html))。SMB 通常改用 CTI/第三方软电话。

### M. 运营/协作附件

- **Workforce Engagement**(排班/需求预测,独立 add-on,价格 未核实)— 企业级。
- **Service Intelligence**(客服 BI,基于 Data Cloud)— Agentforce 1 档打包,单独买 add-on。
- **Slack 集成**(swarming、Expert Finder)— 见 A 节。

---

## 2. SMB 视角(马来西亚/SEA SMB 实际用什么)

**SMB 常用(真实高频)**
- Case 基本盘:case + 队列 + 分派规则 + email-to-case + 邮件线程归并 — 任何有客服信箱的 SMB 都要。
- WhatsApp 双向消息 — **SEA/马来西亚客服第一渠道**;但在 Salesforce 里要 Enterprise($165)+ Digital Engagement($75)+ Meta 会话费,一个坐席月成本 RM1,000+ 量级,SMB 几乎不可能买。这是 Salesforce 在 SEA SMB 市场最大的空档。
- FB Messenger / IG DM 收件 — 同上,渠道刚需但定价劝退(注意:Salesforce 官方渠道列表甚至不含 Instagram DM,靠第三方)。
- Quick Text / Macros — 简单省时,SMB 一学就会。
- 简版知识库 + 提单前文章推荐(case deflection)— 有用但 SMB 常用 Notion/Google Doc 凑合。
- FAQ bot 自动回复(Einstein Bots 的 SMB 等价物)— 需求真实,但 Salesforce 把它锁在 Unlimited/Digital Engagement 后面。
- CSAT 简单问卷(聊天结束后一条"满意吗?")— 需求真实;Salesforce 的 Feedback Management 定价($13.5k/月起)完全是企业玩具,SMB 只需要 emoji 级轻量版。

**企业级 bloat(SMB 基本不碰)**
- Skills-based routing、Omni-Channel Flow、External Routing — SMB 3-5 人客服,一个共享收件箱+简单轮流就够。
- Entitlements/Service Contracts/Milestones 全家桶 — B2B 合同型支持才需要;SMB 顶多要一条"X 小时没回就提醒老板"。
- Omni Supervisor、Workforce Engagement 排班预测 — 企业呼叫中心专属。
- Service Cloud Voice(Amazon Connect)— 成本结构完全企业向。
- Experience Cloud 登录制门户 — SMB 客户不会为了提单注册账号,WhatsApp 就是他们的"门户"。
- Field Service — 与营销 SMB 无关。
- Slack Swarming — 依赖付费 Slack + 大团队。

**存疑(看行业)**
- Business hours + SLA 提醒的**轻量版**(非 entitlements 全家桶)— 电商/服务业 SMB 可能要"营业时间外自动回复"。
- Help Center 公开知识页 — 有些 SMB 想要,但更多用 IG highlight/网站 FAQ 页替代。
- Agentforce pay-per-resolution — 定价模式本身对 SMB 有吸引力(不解决不收钱),但前置门槛是 Enterprise license + Salesforce 数据体系,SMB 进不了场。

---

## 3. FIKIRTIVE 候选映射(WHAT-pass 候选,不替 founder 决定)

| Salesforce 功能簇 | 候选去向 | 说明/权衡 |
|---|---|---|
| WhatsApp/FBM/IG DM 统一收件 + 会话记录挂联系人 | **该进 CRM 区**(或独立"收件箱"楼,存疑待 founder) | SEA SMB 最痛的点,Salesforce 定价空档最大。权衡:做成 CRM 内 timeline(轻)vs 独立 omni-inbox 楼(重,但更像"客服工位")。WhatsApp Business API 接入成本/BSP 选型是前置问题 |
| Case management(问题工单:状态/负责人/超时提醒) | **该进 CRM 区**,但建议做"对话即工单"轻量版;完整 case 对象体系 → 存疑待 founder | Salesforce 的 case/queue/escalation 全家桶对 5 人团队过重;轻量版 = 每条对话有 打开/待跟进/已解决 三态 + 超时冒泡。要不要独立"工单"概念是产品观问题 |
| Omni-channel routing(技能路由/容量/监控台) | **建议不要** | SMB 没有"路由"问题,只有"谁看到了谁回"问题。一个 assign-to-teammate 按钮足够 |
| Email-to-case + 线程归并 | 存疑待 founder | SEA SMB 客服重心在 WhatsApp 不在邮件;但 email 收件归并到同一联系人时间线的能力,若 CRM 区做"全渠道联系人时间线"则顺手覆盖 |
| Quick Text / Macros(快捷回复) | **该进自动回复区**(半自动档) | 这是"自动回复"的人工档:预制话术库 + 变量。与 Otto 全自动档形成 人工→辅助→自动 三档,天然一层楼 |
| Einstein Bots(FAQ bot、菜单式) | **该进自动回复区** | 但注意方向选择:Salesforce 正在从"剧本 bot"迁到"生成式 agent";FIKIRTIVE 可以跳过剧本 bot 一代,直接 Otto 生成式 + 商家可读的规则文件(符合 founder 的 file-system 式管理偏好) |
| Agentforce Service Agent(自主回复+动作+护栏+人工转接) | **已有对应楼的方向 = Otto**;差异是 Otto 需要补"客服动作"面 | Otto 目前长在内容/投放;要对标就要加:知识 grounding(商家 FAQ 文件)、转人工、回复护栏、"解决/未解决"判定。护栏+审计与 founder 的"安全第一"契合 |
| Knowledge base(文章/版本/审批/分类) | 存疑待 founder | 完整 KB 产品对 SMB 过重;但"商家知识文件"(Otto 回复的依据,商家可直接编辑的 markdown)是自动回复区的地基——同一需求的两种做法:面向客户的 KB 站 vs 面向 Otto 的知识文件。后者更贴 file-system 哲学,前者可等 |
| Self-service portal / Help Center | **建议不要**(现阶段) | SEA SMB 的"门户"就是 WhatsApp/IG;登录制门户是 B2B 企业需求 |
| Entitlements/SLA/Milestones | **建议不要**(全家桶);轻量"超时未回提醒" → 该进 CRM 区 或 自动回复区,存疑 | 一条规则("客户消息 X 分钟没人回 → 提醒/Otto 兜底")能吃掉 SMB 场景 90% 价值 |
| CSAT(会话后满意度) | **该进自动回复区**(会话收尾自动发)或 CRM 区(结果挂联系人),存疑待 founder | 轻量 emoji/1-5 分即可;它同时是 Otto 的效果度量(自动回复解决率),与 Agentforce pay-per-resolution 的"resolution 判定"同源 |
| Feedback Management 全套(旅程 NPS/分析) | **建议不要** | $13.5k/月的企业产品,SMB 无感 |
| Field Service | **建议不要** | 超出 FIKIRTIVE 域 |
| Service Cloud Voice | **建议不要**(现阶段) | SEA SMB 电话客服多用手机/WhatsApp call;若未来做,WhatsApp 语音消息转写比 call center 更贴 |
| Service Intelligence(客服分析) | **已有对应楼候选 = Analytics 页** | 已规划的 Analytics(ads+organic+history)可加一小节:回复速度/解决量/Otto 自动解决率,与现有楼合并优于新楼 |
| Case Swarming / Slack 协作 | **建议不要** | 团队内 @提及 一个功能点即可覆盖,不需要 Slack 依赖 |

---

## 4. Salesforce 的 agent/AI 打法 vs Otto

**他们的叙事**:Agentforce = "digital labor 平台"。演进路径:剧本 bot(Einstein Bots)→ 生成式自主 agent(Service Agent)→ 预制即插 agent(Help Agent,"几分钟部署")→ **按结果收费**(pay-per-resolution:agent 自主解决才收钱,转人工不收)([Salesforce Ben](https://www.salesforceben.com/huge-agentforce-pricing-shift-salesforce-introduces-pay-per-resolution/))。自报数据:help.salesforce.com 上 430 万咨询、70% 自主解决率。架构上:Topics(圈范围)+ Actions(接 Flow/Apex)+ Guardrails(护栏)+ Data 360 RAG grounding + 自动/显式转人工([architect.salesforce.com](https://architect.salesforce.com/docs/architect/fundamentals/guide/agentic-patterns.html))。

**他们做不到、FIKIRTIVE 能做的**
1. **Agent 只覆盖"客服回复"这一个面**。Agentforce Service Agent 只在客服域内自主;跨域(回消息→顺手建内容→调投放)要另买 Sales/Marketing 的 agent SKU 且各自配置。Otto 的"operates 100% of the tools"是单一 agent 横跨 CRM/内容/投放/回复,这是结构性差异,不是功能差异。
2. **前置门槛重**:Agentforce 有意义的玩法要 Enterprise($165)+ Data Cloud + credits 体系;SMB 连门票都买不起。FIKIRTIVE 的 agent 是产品默认,不是 add-on 金字塔顶。
3. **配置模型是管理员工程**:Topics/Actions/Flow/Apex 由 Salesforce admin 或实施商搭。FIKIRTIVE 走 founder 的 file-system 哲学:商家自己读得懂、改得动的知识/规则文件。
4. **渠道-价格错配**:他们把 SEA 刚需的 WhatsApp 锁在 $75/user add-on + 会话费后面;FIKIRTIVE 可以把 WhatsApp 当第一公民。

**他们能做、FIKIRTIVE(暂)做不到的 — 需正视**
1. **深度动作面**:Help Agent 能真的改订单、约时间、动 case——因为背后有整套 CRM/订单数据模型。Otto 要"解决问题"而非"回答问题",也需要可调用的动作面(FIKIRTIVE 的 CRM 区就是这个地基)。
2. **护栏与信任体系成熟**:托管+自定义双层 guardrails、话题白名单、审计。Otto 对标时这是"安全第一"必修课。
3. **Pay-per-resolution 定价创新**:把风险从买家移到卖家,对"AI 到底行不行"的犹豫客户杀伤力大。FIKIRTIVE 的 credit 模型未来可参考"按解决计费"作为自动回复区的差异化定价(存疑待 founder,涉及 resolution 判定与 margin)。
4. **规模证据**:70% 自主解决率这类公开数字是销售武器;FIKIRTIVE 需要自己的解决率仪表(又回到 CSAT/Analytics 一节)。

**一句话定位**:Salesforce 卖的是"给你的客服部门加一个 AI 员工(每层都收费)";FIKIRTIVE 卖的是"Otto 就是你的客服部门(顺便还是你的营销部门)"——SEA SMB 没有客服部门,只有老板和 WhatsApp。

---

### 主要来源
- 定价/editions:[solutions4sf](https://solutions4sf.com/blog/salesforce-service-cloud-pricing/) · [atonementlicensing](https://atonementlicensing.com/blog/salesforce-service-cloud-pricing/) · [tech.co](https://tech.co/crm-software/salesforce-pricing-how-much-does-salesforce-cost) · [salesforce.com digital channels pricing](https://www.salesforce.com/service/digital-customer-engagement-platform/pricing/) · [self-service pricing](https://www.salesforce.com/service/customer-self-service/pricing/) · [voice pricing](https://www.salesforce.com/service/call-center-integration/voice-pricing/) · [field service pricing](https://www.salesforce.com/service/field-service-management/pricing/)
- Digital Engagement:[Salesforce Ben](https://www.salesforceben.com/what-is-salesforce-digital-engagement/) · [WhatsApp 计费变更 release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_service_messaging_pricing_changes.htm&language=en_US&release=238&type=5)
- Omni-Channel:[Salesforce Ben](https://www.salesforceben.com/salesforce-omni-channel/) · [help.salesforce.com skills-based routing](https://help.salesforce.com/s/articleView?id=omnichannel_skills_based_routing.htm&language=en_US&type=5)
- Email-to-Case:[threading](https://help.salesforce.com/s/articleView?id=service.support_email_to_case_threading.htm&language=en_US&type=5) · [omni flow 路由](https://help.salesforce.com/s/articleView?id=service.omnichannel_route_email_to_case.htm&language=en_US&type=5)
- Knowledge:[Salesforce Ben](https://www.salesforceben.com/introduction-salesforce-knowledge/) · [help.salesforce.com](https://help.salesforce.com/s/articleView?id=service.knowledge_whatis.htm&language=en_US&type=5)
- Entitlements:[Salesforce Ben](https://www.salesforceben.com/complete-guide-to-salesforce-entitlements-and-milestones-in-service-cloud/) · [kubaru](https://kubaru.io/blog/salesforce-entitlements-and-milestones/)
- Agentforce:[Salesforce Ben pay-per-resolution](https://www.salesforceben.com/huge-agentforce-pricing-shift-salesforce-introduces-pay-per-resolution/) · [salesforce.com Help Agent 发布](https://www.salesforce.com/news/stories/agentforce-help-agent-announcement/) · [architect.salesforce.com agentic patterns](https://architect.salesforce.com/docs/architect/fundamentals/guide/agentic-patterns.html) · [ekfrazo](https://ekfrazo.com/resources/blogs/salesforce-agentforce-what-it-does-what-it-costs-and-who-actually-needs-it/) · [handoff blog](https://www.salesforce.com/blog/agent-handoff/)
- Einstein for Service:[Synebo](https://www.synebo.io/blog/top-8-service-cloud-einstein-features/) · [Trailhead](https://trailhead.salesforce.com/content/learn/modules/einstein-for-service-rollout-strategies/use-artificial-intelligence-to-improve-service)
- CSAT:[jotform 分析](https://www.jotform.com/blog/salesforce-surveys-pricing/) · [savio](https://www.savio.io/blog/Salesforce-feedback-management-license-cost/) · [salesforce.com feedback management](https://www.salesforce.com/service/customer-service-operations/feedback-management/)
- Swarming/Console:[Salesforce Ben swarming 指南](https://www.salesforceben.com/ultimate-guide-to-case-swarming-in-salesforce-service-cloud/) · [help.salesforce.com console](https://help.salesforce.com/s/articleView?language=en_US&id=service.console_lex_service_intro.htm&type=5)
- Starter Suite(SMB):[salesforce.com small business](https://www.salesforce.com/small-business/customer-service-crm/)