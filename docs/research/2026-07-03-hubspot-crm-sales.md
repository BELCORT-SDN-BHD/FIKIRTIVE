> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# HubSpot Smart CRM + Sales Hub 竞品功能基线(2025–2026 现状)

研究对象:HubSpot Smart CRM 核心 + Sales Hub(含 Breeze AI、Revenue Hub 报价/收款相关部分)。
主要来源:官方定价页 https://www.hubspot.com/pricing/sales 、产品页 https://www.hubspot.com/products/sales 、https://www.hubspot.com/products/crm 、https://www.hubspot.com/products/artificial-intelligence 、https://www.hubspot.com/products/commerce 、knowledge.hubspot.com 各条目,以及 2026 年第三方定价综述(docket.io、featurebase、blog.hubspot.com)。

**价位档速览**(2026,USD,年付价):Free(最多 2 席)→ Sales Hub Starter ~$9–15/席/月(官方页当前促销价 $7)→ Professional $90–100/席/月 + $1,500 一次性 onboarding → Enterprise $150/席/月 + $3,500 onboarding。Starter 含 500 HubSpot Credits/月、Pro 3,000、Enterprise 5,000(AI agent 按结果计费用)。
来源:https://www.hubspot.com/pricing/sales 、https://docket.io/resources/research/hubspot-sales-hub-pricing

---

## 1. 功能总清单

### A. Smart CRM 对象模型(数据底座)

| 功能 | 一句话说明 | 价位档 |
|---|---|---|
| Contacts(联系人) | 人的记录:属性、沟通历史、活动日志 | Free(免费档上限 1,000 联系人;付费档最高 1,500 万) |
| Companies(公司) | 公司记录,与联系人自动关联(按 email 域名) | Free |
| Deals(交易/商机) | 商机记录,挂在 pipeline 上推进 | Free |
| Tickets(工单) | 客户问题记录,可分派、排优先级、追踪 | Free |
| Leads(线索对象) | 独立于 contact 的"待打线索"对象,驱动 Prospecting Workspace | Sales Hub Pro+ |
| Custom Objects(自定义对象) | 自建对象类型,带属性/pipeline/关联/报表 | **仅 Enterprise**(来源:knowledge.hubspot.com/object-settings/create-custom-objects) |
| Properties(属性) | 每对象最多 1,000 个自定义属性;免费档仅 10 个 | Free 10 个;付费 1,000/对象 |
| Calculated Properties(计算属性) | 属性间做公式计算 | Pro+ |
| Associations & Association Labels | 对象间关联 + 关系标签(如"决策人") | Free(labels 付费档) |
| Lists(名单/分群) | 静态 + 动态(active)名单分群 | Free(数量随档位升) |
| Tasks & Activities(任务) | 待办、跟进任务、任务队列 | Free;Task Queues 批量执行 Pro+ |
| Notes / 手动 log(邮件、通话、会议) | 手动记录活动到 timeline | Free |
| CRM Import / Export | 批量导入导出、字段映射 | Free |
| Duplicate Management(查重合并) | AI 辅助识别重复 contact/company | Pro+ |
| Permission Sets / Teams | 权限组、团队层级(Starter 10 团队 / Pro+ 300) | Starter+;Field-level permissions 仅 Enterprise |
| Record Customization(记录页自定义) | 自定义记录页布局、条件显示 | 高级布局 Pro/Ent |

### B. Pipeline 管理

| 功能 | 说明 | 价位档 |
|---|---|---|
| Deal Pipelines | 看板式销售管道,自定义阶段+概率 | Free 1 条;Starter 2;Pro 15;Ent 100 |
| Pipeline Automation(阶段触发动作) | 进入某阶段自动建任务/发通知 | Starter 起(简单);复杂 workflow Pro+ |
| Required Fields per Stage | 进阶段强制填字段 | Starter+ |
| Deal Splits(业绩拆分) | 一笔 deal 多人分业绩 | Pro+ |
| Pipeline Approvals for Deals | 交易审批流 | Pro+ |
| Smart Deal Progression (Beta) | AI 读通话记录后建议更新 deal 阶段/下一步 | Pro+ |
| Deal Summaries | AI 生成交易摘要 | Free 起(Breeze 功能) |
| Sales Automation Workflows | 通用自动化工作流(轮转分配线索、改属性、发内部通知) | Starter 300 条;Pro/Ent 1,000 条;免费档无 workflow |
| Workflow Health Monitoring | 工作流健康监测 | Pro+ |

### C. Activity Timeline + 邮件跟踪(Email Tracking)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Activity Timeline | 每条记录上的统一时间线:邮件、通话、会议、页面浏览、表单提交 | Free |
| Gmail / Outlook / Office 365 集成 | 插件双向同步,收发件自动 log 进 CRM | Free |
| Email Open/Click Tracking | 打开、点击实时通知(桌面/浏览器/Activity Feed) | Free 限 **200 次通知/月**;Starter 起无限(来源:blog.hubspot.com/sales/hubspot-sales-hub-pricing) |
| Activity Feed | 全部互动信号的时间流 | Free |
| Email Scheduling(定时发送) | Gmail/Outlook 里定时发 | Free |
| Email Forwarding 检测、设备数据 | 转发/设备维度的互动信息 | 付费档 |
| Sales Email Frequency Controls | 发送频控 | 全档 |

### D. Templates / Snippets / Documents(销售内容)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Email Templates(邮件模板) | 可个性化 token 的销售邮件模板 | Free 3 个;付费档 5,000 |
| Snippets(话术片段) | 快捷短语,# 触发插入邮件/聊天/记录 | Free 3 个;付费档 5,000 |
| Documents(文档追踪) | 销售资料库,发出后追踪谁看了哪页多久 | Free 5 份;付费档解锁 |
| 1:1 Video Messaging | 一对一录屏视频 | 全档 |

### E. Sequences(自动化外联序列)—— Sales Hub 招牌功能

| 功能 | 说明 | 价位档 |
|---|---|---|
| Sequences | 定时多步邮件+任务序列,回复即自动退出 | **Starter 起**(2024 年下放;Starter 500 邮件/用户/天,Pro/Ent 1,000/天;账户 5,000 条序列) |
| Sequence A/B Testing | 序列邮件 A/B 测 | Pro+ |
| 自动登记(基于意向信号/lead score 触发 enroll) | workflow 自动把人塞进序列 | Pro+ |
| Dynamic/adaptive sequences | 按互动情况调整节奏(AI timing) | Pro+ |
| Deal outcome reports(序列→收入归因) | 衡量序列带来多少 deal | Pro+ |
| LinkedIn Sales Navigator Integration | 在 CRM 里看 LinkedIn 数据、发 InMail 任务 | Starter+(需自购 Sales Navigator) |

来源:https://www.hubspot.com/products/sales/sales-automation

### F. Meeting Scheduler(会议预约)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Meeting Links(个人预约页) | Calendly 式预约链接,实时日历同步(Google/O365) | Free 1 条(带 HubSpot 水印);Starter 起 1,000 条+去水印 |
| Round-robin / Group booking | 团队轮流接单 / 多人会议 | Starter+ |
| 网站嵌入 widget | 预约日历嵌自家网站 | Free |
| Book on behalf of others | 替同事约 | 付费档 |
| Meeting Prep (Beta) | AI 会前准备(汇总客户上下文) | Pro+ |
| AI Meeting Notetaker (Beta) | AI 入会记录+摘要写回 CRM | Pro+ |
| 会后自动跟进 | 预约后自动触发序列/跟进邮件 | Pro+ |

来源:https://www.hubspot.com/products/sales/schedule-meeting

### G. Calling(呼叫)

| 功能 | 说明 | 价位档 |
|---|---|---|
| 浏览器内呼出 + 通话记录 log | VoIP 呼出,自动挂 timeline | Free 500 分钟/月(官方定价页);Starter 3,000;Pro/Ent 12,000(注:有第三方综述称免费档呼叫已收紧,存在口径冲突,标 **未核实**) |
| HubSpot Phone Numbers | 官方号码 | Free 1 个;Starter 3;Pro/Ent 5 |
| Call Recording & Transcription | 录音+转写(Free 档也给额度,750 小时/月起) | 全档,转写深度功能 Pro+ |
| Conversation Intelligence | 通话转写挖掘:tracked terms、话题、辅导 | Pro+ |
| AI Call Transcript Enrichment (Beta) | 从转写自动回填 CRM 属性 | Pro+ |
| Coaching Playlists | 通话集锦用于培训 | Starter+ |
| IVR(语音菜单) | 呼入分流 | Pro+ |
| Power dialer / voicemail drop | 连拨、语音留言一键投 | 付费档(产品页提及) |

### H. Playbooks(销售剧本)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Playbooks | 通话/会议时侧边弹出的互动卡片:话术脚本、问题清单 | Starter 5 本;Pro/Ent 5,000 本 |
| 结构化答案回写 CRM | 剧本里的选择题/填空直接映射到属性 | 同上 |
| Battle cards / 竞品卡 | 竞品应对话术 | 同上 |

来源:https://www.hubspot.com/products/sales/playbooks

### I. Quotes / Payments(Revenue Hub,原 Commerce Hub)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Quotes(报价单) | 拖拽/AI 生成报价页 | Pro 档为主(2026 Revenue Hub 重组后 Free 档口径有冲突,部分综述称"报价全档付费加购",标 **未核实**) |
| CPQ(配置-定价-报价) | 价格规则、折扣护栏 | Pro+ |
| E-signature(电子签) | 报价单上签字 | Pro+ |
| Contracts | 签了的报价自动转合同记录 | Pro+(新) |
| Payment Links(收款链接) | 独立收款链接 | Free 起 |
| Invoices(账单) | 品牌化账单 | Free 起 |
| Subscriptions(订阅扣款) | 周期性扣款、合同中途变更 | Free 起基础;高级 Pro+ |
| HubSpot Payments(原生收单) | 信用卡/ACH | **仅美国、USD**——对马来西亚不可用 |
| Stripe Processing 集成 | 用自己 Stripe 账号收单(多币种,MYR 可行) | 付费档 |
| Revenue Reporting | 已报价/已开票/已收款统一视图 | Pro+ |
| Revenue Agent (coming soon) | AI 自动催逾期账款 | 未上线 |

来源:https://www.hubspot.com/products/commerce

### J. Forecasting + Goals(预测与目标)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Forecast 工具 | 按月/季提交预测;类别:Pipeline / Best case / Commit / Closed won | **Pro+** |
| Forecast submissions + 提醒 | 手动提交预测,超时未更新提示经理 | Pro+ |
| Custom forecast(自定义口径) | 自定义预测周期/类别 | Pro+;**带团队层级 rollup 仅 Enterprise** |
| AI-powered projections(AI 预测) | 基于历史的预测辅助 | Pro+(产品页宣传语,细节 **未核实**) |
| Goals(目标) | 营收/活动目标下发到人 | Starter 有限;Pro 模板目标;Ent 自定义目标 |

来源:https://knowledge.hubspot.com/forecast/set-up-the-forecast-tool

### K. Lead Scoring(线索评分)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Manual Lead Scoring(score properties) | 自定义加减分规则(行为+属性),contact/company/deal 都可建分 | Pro 起(Starter 已给最多 5 个分数、Pro 10 个——官方定价页) |
| Predictive Lead Scoring | ML 自动按成交概率排序 | **仅 Enterprise** |

来源:https://knowledge.hubspot.com/scoring/understand-the-lead-scoring-tool

### L. Prospecting Workspace(销售工作台)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Sales Workspace | 单屏工作台:今日任务、日程、新分配线索、待回复、序列任务、活动 feed | **Pro+ 且需 Sales seat** |
| Guided Actions / Suggested Activities | 系统按互动信号自动生成"该做什么"建议 | Pro+ |
| Task Queues | 任务批量连打模式 | Pro+ |
| Lead Form Routing | 表单线索自动分配 | Pro+ |

来源:https://knowledge.hubspot.com/prospecting/use-the-prospecting-workspace

### M. Breeze AI(HubSpot 的 AI 体系)

| 功能 | 说明 | 计费/档位 |
|---|---|---|
| Breeze Assistant(原 Copilot) | 全站 AI 助手:问 CRM 数据、起草内容、摘要,桌面+移动 | 全档 |
| **Breeze Prospecting Agent** | 盯 buying signals(招聘、融资、技术栈),自动找账户+采购决策链、起草个性化外联,人审后发 | 全档可用,**$1.00/推荐线索**(HubSpot Credits 按结果计费) |
| Breeze Customer Agent | AI 客服/售前应答、约会议,7×24 | $0.50/解决一次(50 credits) |
| Breeze Data Agent | 问答式查客户情报(CRM+全网) | $0.10/答 |
| Custom Agents (Beta) | 自训练 agent 跑自定义流程 | Beta |
| Breeze Intelligence — Data Enrichment | 2 亿+公司/买家画像,40+ 属性一键/持续补全(Clearbit 收购而来) | 付费档不额外耗 credits(enrichment);按记录计 credit |
| Breeze Intelligence — Buyer Intent | 识别访问官网的高意向公司,反查入 CRM | 耗 HubSpot Credits |
| Breeze Intelligence — Form Shortening | 已知字段自动从表单里隐藏,缩短表单 | 同上 |
| AI Meeting Notetaker / Deal Summaries / Smart Deal Progression / Conversation Intelligence / AI Transcript Enrichment | 见上文各节 | 多数 Pro+ |
| HubSpot AEO (Beta) | 追踪品牌在 AI 搜索里的可见度 | Beta |

来源:https://www.hubspot.com/products/artificial-intelligence 、https://www.hubspot.com/company-news/hubspots-customer-agent-and-prospecting-agent-now-you-pay-when-the-task-is-complete 、https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent

### N. Reporting(报表)

| 功能 | 说明 | 价位档 |
|---|---|---|
| Reporting Dashboards | 预制仪表盘 | Free 10 盘×50 报表;Starter 30;Pro 75;Ent 100 |
| Sales Analytics | 预制销售分析包(活动量、成交率、漏斗) | Starter+ |
| Custom Report Builder | 跨对象自定义报表 | Starter 100 张;Pro/Ent 500 张 |
| Deal Journey Analytics | 交易旅程分析(阶段×触点) | Pro+ |
| Sales rep productivity reports | 人效报表 | Pro+ |

### O. 周边(与 CRM 同送)

- Live Chat + Conversations Inbox(共享收件箱)— Free(带水印);Facebook Messenger 集成 — Free 起;Conversational Bots — 全档有限功能。
- HubSpot Mobile App — 全档。
- App Marketplace 1,500+ 集成(含 Xero、Shopify、WhatsApp 第三方等)。
- WhatsApp 官方集成(shared inbox 收发)— 需 Marketing/Service Hub Pro 档(**未核实**具体门槛,对 SEA 重要)。
- ABM Tools(目标账户管理)— Pro+。

---

## 2. SMB 视角(马来西亚/SEA 中小企业实际会用什么)

**SMB 常用(真实高频)**
- Contacts/Companies/Deals + 1–2 条 pipeline —— 这就是 SMB 的 CRM 全部日常。
- Activity timeline + Gmail/Outlook 自动 log —— "不用手抄记录"是最大卖点。
- Email tracking(开了没)、Templates/Snippets —— 单人销售最爱。
- Meeting scheduler —— 替代 Calendly,SEA 服务业(agency、教育、诊所)高频。
- Payment links / Invoices —— SMB 极需要,但 **HubSpot 原生收款美国限定**,SEA 用户只能接 Stripe,且 Stripe Malaysia 覆盖有限 —— 这是 HubSpot 在 SEA 的真空点。
- Tasks + 简单 workflow(线索分配、跟进提醒)。
- Lead capture 表单 + 自动建档。
- 基础报表(成交漏斗、本月业绩)。

**SMB 常用但被价格墙挡住(痛点区)**
- Sequences —— SMB 很想要,Starter 已开但真正好用(A/B、自动 enroll)在 Pro($100/席+$1,500 onboarding,对 MY SMB 是天价)。
- Lead scoring、Forecasting、Sales Workspace —— 全在 Pro+。
- 去水印 —— Free 档所有对客资产带 HubSpot 品牌。

**企业级(SEA SMB 基本不碰)**
- Custom Objects(仅 Ent)、Field-level permissions、Deal splits、Pipeline approvals、Predictive lead scoring、Forecast hierarchies、IVR、ABM tools、300 个团队层级、Deal Journey Analytics。
- Playbooks —— 设计给 10 人以上销售团队做话术管控;SEA 微型团队用不上(存疑:对有 SOP 意识的 agency 可能有小用)。

**存疑**
- Breeze Prospecting Agent —— 按结果计费对 SMB 友好,但信号源(美国招聘/融资数据)对马来西亚本地市场覆盖差,SEA 适用性 **存疑**。
- Conversation Intelligence / 通话转写 —— 对英语通话可用,马来语/华语/rojak 混语转写质量 **存疑**。
- Buyer Intent —— 依赖官网流量反查,SMB 官网流量太小,价值存疑。

**SEA 特有缺口(HubSpot 弱、FIKIRTIVE 机会)**:WhatsApp 是 MY SMB 的实际销售渠道(不是 email);HubSpot 的 WhatsApp 集成门槛高且以客服收件箱定位,不做 WhatsApp 原生外联序列;原生收款不支持 MYR。

---

## 3. FIKIRTIVE 候选映射(供 founder WHAT-pass 逐条决定,均为候选,非结论)

| HubSpot 功能簇 | 候选归属 | 权衡说明 |
|---|---|---|
| Contacts/Companies 基础对象 + 属性 + timeline | **该进 CRM 区** | CRM 区的地基;不做等于没有 CRM。成本:对象模型+timeline 是长工期底座工程。 |
| Deals + pipeline 看板 | **该进 CRM 区** | SMB 认知里"CRM=看板";但 FIKIRTIVE 主打 marketing OS,deal 管理做多深(阶段自动化?拆分?)待 founder 定。 |
| Tickets/工单 | 存疑待 founder | 偏客服域;FIKIRTIVE 的"自动回复区"若吃掉客服对话,可能不需要独立工单对象,也可能需要轻量版。 |
| Custom Objects | 建议不要(候选) | 纯企业级;SEA SMB 用不到,且工程代价极大。反方论点:垂直行业(房产/保险)可能要,但可用"自定义属性"低配替代。 |
| Lists/分群 | **该进 CRM 区**(兼 Campaign 管理区共用) | 分群同时服务 CRM 筛选与 campaign 受众;归属一处、两区引用是一个选项。 |
| Email tracking + templates/snippets | 存疑待 founder | HubSpot 强在 email;MY SMB 实战渠道是 WhatsApp。选项 A:照搬 email 套件;选项 B:把"tracking+模板+片段"概念平移到 WhatsApp/DM,email 后置。 |
| **Sequences(自动外联)** | 该进自动回复区 或 CRM 区 | 高价值:HubSpot 把它锁在付费档,FIKIRTIVE 若做"WhatsApp/email 混合序列+回复即停"即差异化。归属张力:它既是"外联自动化"(近自动回复区)也是"销售跟进"(近 CRM)。 |
| Meeting scheduler | 存疑待 founder | 独立成熟品类(Calendly 免费档就够);自建性价比存疑。选项:集成而非自建 / Otto 代订。 |
| Calling/通话+转写 | 建议不要(候选) | 电信基础设施重、SEA 多语转写难;SMB 用手机+WhatsApp call。反方:通话记录手动 log 到 timeline 可以要。 |
| Playbooks | 建议不要(候选) | 团队管控工具,微型团队无感。反方:话术库概念可降维成"Otto 的回复话术资产",归 brand memory。 |
| Quotes/CPQ/E-sign | 存疑待 founder | SMB 有真实报价需求,但这是 Revenue/finance 域,超出 marketing OS 边界;做的话是新楼层。 |
| Payment links/Invoices | 存疑待 founder | HubSpot 在 SEA 的收款真空是机会(FIKIRTIVE 已有 Stripe MYR 经验);但 money-path 风险与 PCI/对账负担大,是战略级决定。 |
| Forecasting | 建议不要(候选) | 依赖成熟 pipeline 纪律,SEA SMB 阶段太早。轻量替代:CRM 区一张"pipeline 总额×概率"卡即可。 |
| Lead scoring | 该进 CRM 区(轻量)或 存疑 | 手动规则分对 SMB 太抽象;更 FIKIRTIVE 的做法是 Otto 直接说"这 5 个人最热,原因是 X"(agent 化替代评分系统)。 |
| Sales Workspace(今日该做什么) | **已有对应楼(部分)** | Otto 首页/任务流在概念上就是这个;差别是 HubSpot 让人执行建议,Otto 可直接代执行。可作为 Otto 主界面的参照系。 |
| Breeze Prospecting Agent | 已有对应楼(Otto)+ 存疑 | Otto 天然对位;但"外部 buying signals 数据源"FIKIRTIVE 没有,SEA 也缺同类数据供应商——做不做外联 prospecting 待 founder。 |
| Breeze Customer Agent | **已有对应楼**(自动回复区) | 与 FIKIRTIVE 自动回复区正面对位;差异化在 WhatsApp/IG DM 原生 + 华语/马来语。 |
| Data enrichment(Breeze Intelligence) | 建议不要(候选) | 靠 Clearbit 数据资产,自建不现实;若要,只能接第三方 API,SEA 覆盖差。 |
| Reporting/dashboards | 已有对应楼(Analytics 页在建) | FIKIRTIVE Analytics 页可吸收"销售漏斗报表"需求;自定义报表构建器则是企业级,建议不做(候选)。 |
| Workflows(线索轮转、属性自动化) | 存疑待 founder | 通用 workflow 引擎工程量巨大;替代选项:Otto 以技能形式覆盖 80% 场景(轮转、提醒),不做可视化流程编辑器。 |

---

## 4. HubSpot 的 Agent/AI 打法 vs FIKIRTIVE "Otto operates 100%"

**HubSpot 的姿态(Breeze 三层)**
1. **Breeze Assistant** — 侧边栏副驾:回答、起草、摘要,**不代执行**关键操作。
2. **Breeze Agents** — 四个窄域 agent(Prospecting/Customer/Data/Custom),各管一条流程,按结果计费($1/线索、$0.50/解决、$0.10/答)——2026 年从订阅改为 outcome-based,是其最激进的定价创新。来源:https://www.hubspot.com/company-news/hubspots-customer-agent-and-prospecting-agent-now-you-pay-when-the-task-is-complete
3. **Embedded AI(100+ 点状功能)** — 摘要、评分、转写、预测,散落在各工具里。

**结构性特征**:AI 是"绑在既有工具上的加速器"。人仍是操作者——Breeze 建议、人点按钮;Prospecting Agent 起草、人审核发送。Agent 之间不互通,没有一个 agent 能横跨"CRM→内容→投放→回复"全链。且最有用的 AI 大多锁在 Pro/Ent 档 + credits 双重收费,SMB 摸不到。

**他们做不到、FIKIRTIVE 能做的**
- **单一 agent 操作 100% 工具面**:Otto 的北极星是每个手动工具 Otto 都能操作(canvas 生成、Meta 投放建 campaign、回复);HubSpot 没有等价物——Breeze 无法替你建广告 campaign、生成创意素材、再据表现调整,FIKIRTIVE 三件都已有或在建。
- **SEA 原生**:WhatsApp 为第一渠道的 CRM+外联+自动回复、华语/马来语/rojak 对话、MYR 计价——HubSpot 全线薄弱。
- **SMB 价格结构**:HubSpot 的能力悬崖在 Free→Pro($100/席+$1,500 onboarding);FIKIRTIVE credits 制可以把"agent 干活"卖给微型团队。
- **创意资产生成**:HubSpot 无图像/视频生成;FIKIRTIVE canvas 是独有面。

**他们能做、FIKIRTIVE(暂)做不到的**
- **数据资产**:2 亿+ 公司/买家画像(Clearbit)、buying signals、buyer intent 反查——这是收购来的护城河,短期无法复制。
- **完整对象模型深度**:15 年打磨的属性/关联/权限/报表体系;FIKIRTIVE CRM 区从零起步。
- **生态**:1,500+ marketplace 集成、代理商网络(MY 也有 HubSpot partner agency)。
- **outcome-based 计费的信任背书**:大厂敢按结果收费,对 SMB 心理门槛低;FIKIRTIVE credits 目前是按用量,叙事上可参考(定价永不写死在代码里,依既有原则)。

**定位一句话(候选表述,供 founder 取舍)**:HubSpot 卖"一套你来开的工具,AI 帮你踩油门";FIKIRTIVE 卖"一个会自己开这套工具的员工"。前者 AI 依附于工具,后者工具依附于 agent。

---

### 主要来源
- https://www.hubspot.com/pricing/sales (官方各档功能表+限额)
- https://www.hubspot.com/products/sales · /products/crm · /products/commerce · /products/artificial-intelligence
- https://www.hubspot.com/products/sales/sales-automation · /schedule-meeting · /playbooks · /email-tracking · /ai-prospecting-agent
- https://knowledge.hubspot.com/forecast/set-up-the-forecast-tool · /prospecting/use-the-prospecting-workspace · /object-settings/create-custom-objects · /scoring/understand-the-lead-scoring-tool · /ai-tools/get-started-using-breeze-intelligence
- https://www.hubspot.com/company-news/hubspots-customer-agent-and-prospecting-agent-now-you-pay-when-the-task-is-complete
- 第三方 2026 综述:https://docket.io/resources/research/hubspot-sales-hub-pricing · https://blog.hubspot.com/sales/hubspot-sales-hub-pricing · https://claritysoft.com/hubspot-free-plan-limitations/ · https://www.onthefuze.com/hubspot-insights-blog/hubspot-breeze-ai-agents-2026

**未核实标注汇总**:免费档呼叫分钟数口径冲突(官方页 500 分钟 vs 第三方称已收紧);Quotes 在 Revenue Hub 重组后的免费档口径;AI forecasting 具体形态;WhatsApp 集成确切档位门槛;Prospecting Agent 信号数据的 SEA 覆盖度。