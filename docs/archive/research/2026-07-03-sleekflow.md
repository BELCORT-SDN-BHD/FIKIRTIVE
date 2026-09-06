> **性质**:feature 深研(按 founder 五大支柱,feature-mining)。FIKIRTIVE 候选映射 = WHAT-pass 候选,非决定。2026-07-03。

# SleekFlow Feature 深研报告

_研究对象:SleekFlow(WhatsApp-first omnichannel 收件箱 + CRM + AI agent + commerce)。对应 FIKIRTIVE「回复管理」支柱,是最直接对手。所有 feature 名保留英文,附中文注释。核实来源见文末。不确定处已标「未核实」。_

---

## 1. 产品定位一句话 + 定价模型

**定位**:SleekFlow 是「revenue-driving conversations 的 AI suite」—— 把 WhatsApp / IG / FB / TikTok / LINE / SMS / email / call 全渠道收进一个 unified inbox,再叠一层 no-code 自动化(Flow Builder)+ 自主 AI agent 团队(AgentFlow)+ 轻 CRM + WhatsApp 内嵌 catalog/收款。香港起家、Meta Business Partner,主打 SEA / 大中华市场,自称覆盖 70+ 国家、2000+ 企业。

**定价模型**(2025-2026,per-user/月 × MAC 用量;来源:官方 pricing 页,HKD 计价):
- **Free** — HK$0 / 50 MAC / 3 用户 / 3 渠道。含 unlimited Flow Builder、unlimited contact storage、Inbox(web+mobile)、ticketing、AI 试用额度。
- **Pro AI** — HK$399/用户/月(**最少 3 用户 = HK$1,199/月**;第 4+ 用户 HK$199/月);500 MAC 起(add-on 到 2,000)。加:broadcast、**AI Agent unlimited usage**、custom catalog、Shopify/Google Sheets/Zapier/Make 集成。
- **Premium AI** — HK$579/用户/月(**最少 5 用户 = HK$2,859/月**;第 6+ 用户 HK$199/月);1,000 MAC 起(add-on 到 12,000)。加:analytics dashboards、webhook & API、RBAC、advanced AI agents、10 渠道、premium 集成(Salesforce/HubSpot/Zoho)。
- **Enterprise AI** — custom。加:PII masking、unlimited channels、SLA、专属 CSM、自定义集成。

**关键计价机制 —— MAC(Monthly Active Contacts)**:一个 contact 只要在计费月内「发消息给你,或你通过 Inbox / Flow Builder / AI Agent / WhatsApp Co-existence / API 发消息给他」就算 1 个 active。这是 SleekFlow 定价的核心杠杆 —— 你为「真正互动的人」付费,不是为存储的联系人付费(contact storage unlimited)。

**「Unlimited AI」打法**(值得注意的营销钩子):年付 plan 的价格 = 月付 plan 不含 AI 的价格 —— 即「年付就白送 unlimited AI + 锁年度折扣」。把 AI 从 add-on 变成引流器。(来源:官方 blog + pricing;USD 端历史价约 Pro $149 / Premium $349-399,币种/数字随市场浮动,以官方页为准。)

> **SEA 注**:马来西亚等市场,SleekFlow 本身订阅之外,WhatsApp 每条对话另按 Meta 费率计(马来西亚约 business-initiated $0.014–$0.086/对话,service window 内免费)。对 SMB 而言真实成本 = 订阅 + 用量,双层。

---

## 2. 功能总清单(按子领域,穷举)

### A. Omnichannel Inbox(收件箱 —— 核心)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Unified inbox** 统一收件箱 | WhatsApp / IG(DM+评论+story reply)/ FB Messenger / TikTok(视频+广告 DM)/ LINE / Viber / Telegram / WeChat / SMS / live chat / email / VoIP call 全进一个界面 | Free 3 渠道 / Premium 10 / Enterprise unlimited |
| **WhatsApp Shared Inbox** 共享号 | 单个 WhatsApp 号多人登录、分派会话、追踪团队表现 | Free+ |
| **Conversation assignment** 会话分派 | 首条消息即分派给对的 agent/team;分派可见性 | Free+ |
| **Collaborators / @mention** 协作 | 拉同事进线程共处理复杂 case、@mention、留 handover note、标 urgent | Free+ |
| **Internal notes / labels** 内部备注+标签 | 线程内注释、给 contact 打 label 供筛选/触发 | Free+ |
| **Quick replies / FAQ templates** 快捷回复 | 预置 snippet / FAQ 模板保持一致口径 | Free+ |
| **Scheduled messages** 定时发送 | 排程消息 | Free+ |
| **VoIP calls + AI 通话转录/摘要** | 收件箱内打电话、通话记录、AI 转录与总结 | 未核实具体档位(inbox 页明示有此能力) |
| **Mobile app** 移动端 | iOS/Android 管收件箱+broadcast | Free+ |
| **AI Smart Reply / AI Writing Assistant** | 生成 2-3 条建议回复(1 credit/条)、把草稿润色成专业回复(1 credit/条) | 按 credit 计 |

### B. Flow Builder(可视化自动化 —— no-code chatbot/workflow)
| 节点类型 | 做什么 | 价位档 |
|---|---|---|
| **Trigger nodes** 触发 | 事件发生时把 contact enroll 进流程(interaction 触发、contact 触发、webhook data 触发、form submission、broadcast keyword 检测等) | Free unlimited |
| **Condition nodes** 条件 | 按 criteria 分支 | Free+ |
| **Action nodes** 动作 | 系统执行任务:发消息/模板、更新 contact 字段、加 label、加 list、分派、HTTP/webhook 外部调用 | Free+ |
| **Time delay nodes** 延时 | 流程中插入暂停(drip 用) | Free+ |
| **Flow end / Jump-to nodes** | 结束或跳转到其他节点 | Free+ |
| **Drip campaigns** 滴灌 | 按自定义间隔自动连发培育消息 | Free+ |
| **Advanced Flow Builder** 高级版 | 更复杂的多步编排(独立文档线) | 未核实具体档位 |

> 已知痛点:复杂多步自动化时 canvas 偶发卡顿/拖拽节点 glitch(多篇评测提及)。

### C. Broadcast(群发营销)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Broadcast campaigns** 群发 | 分段受众、发视觉化模板消息、跑 retention 活动 | Pro+ |
| **Post-broadcast follow-up** 群发后跟进 | 检测群发回复里的 keyword,自动触发个性化跟进 | Pro+ |
| **Segmented / retention campaigns** | 按 label/list/segment 定向重定向 | Pro+ |

### D. AgentFlow(自主 AI agent 团队 —— 最重投入的模块)
| Agent / 能力 | 做什么 | 价位档 |
|---|---|---|
| **Inbound Agent** | 端到端处理销售咨询+支持:qualify lead、订约、解决问题、可无人工交接 | Pro AI(unlimited usage) |
| **Outbound Agent** | 主动 chat+email 触达:挽回流失 lead、促复购、跑 retention | Pro+ |
| **Data Analyst Agent** | 监控全渠道会话、检测话题模式、追团队表现、产出市场洞察 | Premium(analytics) |
| **Copilot Agent** | 陪人类 agent:推荐回复、提供信息、指导难 case | Pro+ |
| **Knowledge Generation** | 爬官网、扫内部文档 → 自动结构化成 knowledge article | Pro+ |
| **Knowledge Transparency** | 每条 AI 回复都显示来源(引用了哪篇 article / 走了哪步 playbook) | Pro+ |
| **Self-healing / Self-improving KB** 自愈知识库 | 分析每场会话找 gap+pattern,一键推改进给人审批 | Pro+ |
| **Human feedback loop** | 人标 gap、贡献优秀人类回复 → 扩 AI 能力 | Pro+ |
| **Playbook orchestration** | 单场会话内链式串多个 API 调用走完客户旅程 | Pro+/Premium |
| **"Vibe code your API integration"** | 用自然语言描述集成需求,AI 帮你搭定制 API 连接 | Premium+ |
| **Native actions** | 连 Shopify/HubSpot/Salesforce 拉实时数据推荐产品/订约/解单 | Premium |

### E. CRM(social CRM —— 轻量,非 pipeline 型)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Customer profiles / 360 view** | 每场会话旁建全量 contact 档;跨渠道历史 | Free+ |
| **Custom fields** 自定义字段 | 存 industry/company size/plan/budget 等属性 | Free+ |
| **Labels** 标签 | 分类+优先级+触发 workflow+定向发消息 | Free+ |
| **Lists** 名单 | 分段归类定向 | Free+ |
| **Segmentation** 分群 | 按人口/行为/偏好建 segment 供自动化 | Free+ |
| **Lifecycle stages** 生命周期阶段 | 定义 contact 在 pipeline 里手动+自动的推进顺序;有 default stage | Free+ |
| **Custom objects** 自定义对象 | 建业务专属数据记录(social-crm 页明示) | 未核实具体档位 |
| **Contact metadata** | owner、notes、reminders,及关联 orders/memberships/tickets | Free+ |
| **两向 CRM sync** | 与 Salesforce(两向 contact + opportunity)/HubSpot/Zoho 同步 | Premium |

> ⚠️ **注意 gap**:SleekFlow **没有原生 deal/opportunity 销售 pipeline 管理**(social-crm 页未提;deal 追踪靠接 Salesforce)。它是「会话型 CRM」不是「销售型 CRM」。tasks/reminders 在 contact metadata 层存在,但非独立任务系统。

### F. Commerce / Catalog(WhatsApp 内嵌电商)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Custom Catalog** 自建目录 | 无 Shopify 也能建目录在社交上卖 | Pro+ |
| **Shopify catalog 自动同步** | 全库存同步进 SleekFlow,agent 秒查 | Pro(Shopify 集成) |
| **In-chat cart** 聊天内购物车 | 聊天室里 add-to-cart、调数量、多品加购 | Pro+ |
| **Product carousel / list message / CTA button** | WhatsApp 里的产品轮播卡、列表消息、CTA 按钮 | Pro+ |
| **Payment links / in-chat payment** | 聊天里发付款链导向 Shopify checkout 或 Stripe;自动 captures payment + 建 Shopify 订单 | Pro+(Stripe) |
| **One-click checkout / close case** | 拟完订单一键结账+关 case | Pro+ |
| **Abandoned cart recovery** 弃购挽回 | 加购未结账 → 规则触发提醒(如 24h 后自动发限时 promo code) | Pro+(Shopify) |
| **Order tracking automation** | 自动化订单追踪 | Pro+ |

### G. WhatsApp-specific(WhatsApp 原生能力封装)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **WhatsApp Flow** | 用 WhatsApp 原生交互表单替代外部 form 做 lead qualification/收资料 | Pro+ |
| **Official Cloud API + Blue Tick** | Meta 官方 Cloud API 直连、蓝勾认证 | Free+(需 API) |
| **WhatsApp Co-existence** | 个人 App 与 API 并存模式(算 MAC 用量之一) | 未核实档位 |
| **Template message 管理** | 管理+发 WhatsApp 模板 | Free+ |

### H. Analytics / Data(相对薄弱)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Analytics dashboards** | 团队/会话表现看板 | **Premium+** |
| **Data insights** | 「把每场会话变市场洞察」(Data Analyst Agent 驱动) | Premium |
| **Webhook & API** | 数据外送/程序化接入 | Premium+ |

> 已知痛点(多篇评测一致):analytics 深度有限、日期区间不能自定义太多、够简单追踪但不够高级分析。

### I. 集成 & Admin
- **CRM/电商**:Shopify(原生)、Salesforce、HubSpot、Zoho CRM
- **自动化中间件**:Zapier(5000+ app)、Make.com、Google Sheets/Docs(也可喂 AI KB)
- **支付**:Stripe(PCI 合规)、Shopify checkout;SMS 走 Twilio
- **Admin**:RBAC 角色权限(Premium)、PII masking(Enterprise)、SLA(Enterprise)、ticketing(Free 起)

---

## 3. SMB/SEA 视角 —— 马来西亚/东南亚 SMB 真会用的 vs 企业虚胖

**SEA SMB 真会用(核心价值)**:
- **WhatsApp shared inbox + 分派**:马来西亚 SMB 生意几乎全在 WhatsApp 上跑;「一个号多人接、别漏单、能分派」是刚需第一位。这是 SleekFlow 最扎实、最被夸的部分。
- **In-chat catalog + payment link + 弃购挽回**:社媒电商小店(IG/WhatsApp 卖货)最直接的变现闭环,门槛低、见效快。
- **Broadcast + 简单 drip**:节日/促销群发是 SEA SMB 的高频动作。
- **Free 层 + LINE/Viber/WeChat 覆盖**:多语言多渠道对马来西亚/泰国/港台市场是真需求(不像纯西方工具只有 WhatsApp/IG)。
- **AI Smart Reply / Writing Assistant**:小团队缺人手,「秒出一条能发的回复」实用。

**企业虚胖(SMB 很可能用不上/嫌重)**:
- **AgentFlow 四种 agent + self-healing KB + playbook orchestration + 「vibe code API」**:概念极漂亮,但需要有文档/官网/结构化知识去喂;3 人夫妻店没内容也没时间训,更可能只用 Smart Reply。这是「卖 AI 叙事」重于「SMB 日常用」的部分。
- **两向 Salesforce/Zoho sync、custom objects、RBAC、PII masking、SLA**:纯企业配置,SEA SMB 基本不碰。
- **Data Analyst Agent / analytics dashboard**:锁在 Premium(HK$2,859/月 5 人起),SMB 够不着且评测说深度本就有限。
- **定价门槛本身**:Pro 最少 3 用户 HK$1,199/月、Premium 最少 5 用户 HK$2,859/月 —— 对真正的马来西亚微型 SMB(1-2 人)是硬门槛,Free 层(50 MAC)又太小,中间有明显断层。

---

## 4. FIKIRTIVE feature 候选映射(中立呈现,不替 founder 决定)

_标注:[已有] = FIKIRTIVE 大概率已具备/在建;[该进 X 支柱] = 建议归属;[建议不要] = 对 FIKIRTIVE 定位可能是坑;[存疑] = 需 founder 判断_

| SleekFlow feature 簇 | 映射判断 | 利 / 弊(中立) |
|---|---|---|
| **Unified omnichannel inbox** 统一收件箱 | **[该进「回复管理」支柱—核心]** | 利:这是回复管理支柱的地基,不建就没有支柱。弊:多渠道 API 各自维护(IG/FB/TikTok/LINE)工程量大;可先 WhatsApp-first。 |
| **WhatsApp shared inbox + 分派 + 协作/@mention/notes** | **[该进「回复管理」支柱—第一优先]** | 利:SEA 刚需 top-1,ROI 最高。弊:团队协作语义(分派/锁定/避免撞单)细节多,需扎实做。 |
| **Quick replies / FAQ templates / scheduled msg** | **[该进「回复管理」支柱—易做高频]** | 利:轻量高频,SMB 天天用。弊:无。低风险先建。 |
| **AI Smart Reply / Writing Assistant** | **[该进「回复管理」+ Otto 全操控]** | 利:与 Otto super-employee 定位天然契合(Otto 起草回复)。弊:SleekFlow 按 credit 计,FIKIRTIVE 需定 spend-path(与既有 credit ledger 对齐)。 |
| **AgentFlow 自主 AI agent(inbound/outbound/copilot)** | **[已有方向 → Otto 全操控]** | 利:Otto 本就是「全操控 super-employee」,回复 agent 是自然延伸,是 FIKIRTIVE 相对 SleekFlow 的主场。弊:别照抄「四种 agent」拆法,FIKIRTIVE 是「一个 Otto」哲学(见 memory),拆成四个 SKU 反而违背单门直觉。 |
| **Self-healing / self-improving knowledge base** | **[值得偷—存疑,见 §5]** | 利:极聪明、对齐「易管理」。弊:实现复杂,需会话量才有价值,早期空转。 |
| **Flow Builder(可视化 no-code 自动化)** | **[存疑—与 Otto 哲学张力]** | 利:强大、可控、SMB 熟悉。弊:FIKIRTIVE 走「Otto 全操控 + file-system 风格开关」,可视化 canvas 是另一条重产品线;founder 第 3 优先级(可读文件+简单开关)与拖拽 canvas 方向不同 —— **需 founder 明确取舍**。 |
| **Broadcast + drip + post-broadcast follow-up** | **[该进「内容创作」×「回复管理」交界]** | 利:变现+retention 高频。弊:群发合规(WhatsApp 模板审核)是运营负担。 |
| **In-chat catalog / cart / payment link / 弃购挽回** | **[存疑—跨到「commerce」新领域]** | 利:SEA 变现闭环强。弊:超出五大支柱当前范围,引入支付+库存是大工程;可标为「远期 commerce 支柱候选」。 |
| **Social CRM(profile/label/list/segment/lifecycle/custom field)** | **[该进「CRM」支柱—核心]** | 利:回复管理与 CRM 天然一体(会话即 CRM 数据源),labels/lifecycle 是分群基础。弊:轻 CRM 易做,别过早做重 pipeline。 |
| **Deal/opportunity 销售 pipeline** | **[建议不要(早期)]** | SleekFlow 自己都没做原生 pipeline(靠接 Salesforce)。对 marketing OS 而言,销售 pipeline 是另一个产品象限,早期不建反而更聚焦。 |
| **Analytics dashboard** | **[已有方向 → 效果营销支柱]** | 利:FIKIRTIVE 已有 Analytics 页规划(memory)。弊:SleekFlow 此处薄弱,是可超越点,别学它的浅。 |
| **多渠道(LINE/Viber/WeChat/TikTok)** | **[该进「回复管理」—分阶段]** | 利:SEA 差异化。弊:每渠道都是独立维护成本;建议 WhatsApp → IG/FB → 其余 分批。 |
| **MAC 计价模型** | **[存疑—商业模式借鉴,见 §5]** | 利:「为真互动付费」直觉好、与价值对齐。弊:与 FIKIRTIVE 现有 credit ledger(USD-peg)是两套逻辑,混用会乱;可作定价思路参考而非照搬。 |
| **RBAC / PII masking / SLA / custom objects** | **[建议不要(早期)]** | 纯企业配置,与 SMB-first + 单门直觉相悖,徒增管理复杂度(违 founder 第 3 优先级)。 |

---

## 5. 值得偷的 feature 机制(FIKIRTIVE 该借鉴的具体聪明做法)

1. **Self-healing knowledge base(自愈知识库)** —— AI 分析每场真实会话,自动发现「回答不了/答错/知识 gap」的地方,把改进建议**打包成一键给人审批**的补丁。极对齐 founder「易管理」优先级:非技术用户不用主动维护 KB,系统主动喂给你「要不要补这条」。**FIKIRTIVE 版:Otto 每周产出「本周我漏答/答不好的 N 条,点一下加进知识」。**

2. **Knowledge Transparency(回复溯源)** —— 每条 AI 回复都显示「我引用了哪篇文章、走了哪步 playbook」。让老板/客服信任 AI、也能快速纠错。对齐「安全 + 易管理」两个优先级。**FIKIRTIVE 版:Otto 每条自动回复附「依据」出处,一眼可查可改。**

3. **「Unlimited AI」年付钩子** —— 年付价 = 月付不含 AI 价,把 AI 从「贵 add-on」变成「白送引流器」同时锁年费。**借鉴价值:定价心理战 —— 用「AI 免费」拉转化,靠年付+用量(video/gen)赚钱**,与 FIKIRTIVE「image 2.5x margin / video near-cost / 靠 Otto 赚」的思路可对话。

4. **MAC「为真互动付费」计价** —— 存 contact 免费无限,只对当月真发生互动的人收费。直觉极顺、抗「僵尸联系人」反感。**借鉴:FIKIRTIVE 若做回复管理,用量维度选「真互动」而非「存储量」,对 SMB 更友好。**(注:需与现有 credit ledger 调和。)

5. **Post-broadcast keyword follow-up(群发后关键词跟进)** —— 群发不是发完就完,自动扫回复里的 keyword 触发个性化跟进,把「广播」变「对话」。**借鉴:内容创作×回复管理的缝合点 —— 发出去的内容自动接回复流,闭环而非断头。**

---

## 6. 易管理视角(对齐 founder 第 3 优先级:非技术用户管理复杂功能)

SleekFlow 让非技术 SMB 老板管复杂功能的聪明做法:

- **一键审批式维护**:self-healing KB 把「维护知识库」这件难事,降维成「系统推给你一条,你点 approve/reject」。不用理解结构,只做是非判断 —— 这正是 founder 想要的「简单开关」精神。
- **回复带出处**:transparency 让不懂 AI 的人也能「看依据、当场改」,把黑箱变可读。
- **可视化 Flow Builder** = 用拖拽让非技术者搭自动化(**但**:这与 FIKIRTIVE「file-system 风格、可读文件+简单开关」是两种不同的「易管理」哲学 —— canvas 是视觉直觉派,file-system 是文本可审计派;founder 已明确偏后者,所以这是「它这么做,但 FIKIRTIVE 未必学」)。
- **模板化一切**:FAQ 模板、broadcast 模板、playbook 步骤都模板化,新手照填即用。
- **Free 层试全功能**:Free 就给 unlimited Flow Builder + AI 试用,让人零成本上手再付费。

**给 FIKIRTIVE 的可迁移原则**:SleekFlow 证明了「一键审批 + 回复溯源 + 模板」这套「降复杂度为是非题」的做法在 SMB 有效 —— 而 FIKIRTIVE 可以把它落到 founder 偏好的 **file-system 载体**上(可读的 skill 文件 + 简单 toggle + Otto 每周产出待审批 diff),兼得「它的易管理」与「founder 的可审计」。

---

## 引用来源

- 官方 pricing:https://sleekflow.io/en-us/pricing
- 官方 inbox:https://sleekflow.io/inbox
- 官方 AgentFlow:https://sleekflow.io/agentflow
- 官方首页:https://sleekflow.io/
- 官方 social CRM:https://sleekflow.io/social-crm
- 官方 FAQ(渠道/集成/AI):https://sleekflow.io/faq
- MAC 计价说明:https://help.sleekflow.io/en_US/contact-management/monthly-active-contacts-overview
- Flow Builder fundamentals:https://help.sleekflow.io/en_US/flow-builder/flow-builder-fundamentals
- Broadcast 文档:https://help.sleekflow.io/broadcasts/running-broadcast-campaigns
- Contact/label/list 文档:https://help.sleekflow.io/label-management、https://help.sleekflow.io/en_US/contact-lists
- Shopify 集成:https://sleekflow.io/channels-integrations/shopify、https://help.sleekflow.io/en_US/integrations/shopify-integration
- Payment links:https://sleekflow.io/en-us/payment-links
- 「AI agent cost」/unlimited AI 打法:https://sleekflow.io/en-us/blog/ai-agent-cost
- 独立评测(2025 in-depth):https://skywork.ai/skypage/en/SleekFlow-in-2025-An-In-Depth-Review-for-the-AI-Powered-Business/1972877544031711232
- G2 评测(优缺点/complaints):https://www.g2.com/products/sleekflow/reviews
- 马来西亚 WhatsApp API 定价 case study:https://sleekflow.io/blog/malaysia-whatsapp-business-api-case-study
- 第三方对比(vs WATI/Respond.io):https://www.sendhub.ai/blog/sleekflow-vs-wati-vs-respondio/

_未核实项已在正文标注(部分 feature 的确切价位档、Advanced Flow Builder 归属、WhatsApp Co-existence 档位、VoIP 通话 AI 摘要档位)。数字币种以官方 pricing 页实时为准 —— HKD/USD 端均有历史报价,本报告以 fetch 到的 HKD 档为主、USD 端作参照。_