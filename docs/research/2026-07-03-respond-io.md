> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# respond.io 竞品研究报告(FIKIRTIVE 自动回复/客服区 直接对标)

> 特别提示:respond.io 是 **马来西亚公司**(2017 年以 Rocketbots 名义创立于香港,2019 年改名并把总部迁到吉隆坡;Rocketbots Malaysia Sdn Bhd),与 FIKIRTIVE 同一个主场。2025 年完成 **$62.5M Series B**,主攻 mid-market B2C,是"本地标杆、必须打赢"的对手。([about](https://respond.io/about) · [Crunchbase](https://www.crunchbase.com/organization/respondio) · [Series B 公告](https://respond.io/blog/respond-io-raises-62-million-series-b) · [SME100](https://sme100.asia/event/hall-of-fame-2023/malaysia-2023/rocketbots-malaysia-sdn-bhd-respond-io/))

---

## 1. 产品定位一句话 + 定价模型

**定位一句话:** "AI-Powered Customer Conversation Management Platform" —— 把 WhatsApp/IG/TikTok/Messenger 等所有聊天渠道 + 语音电话收进一个团队收件箱,用 Workflows 自动化 + AI Agents 帮 B2C 企业把"对话"变成"营收"。([respond.io](https://respond.io/) · [what-is-respondio](https://respond.io/help/quick-start/what-is-respondio))

**定价模型(重点——他们怎么收钱):**([pricing](https://respond.io/pricing) · [Chatarmin 拆解](https://chatarmin.com/en/blog/respond-io-pricing))

| 档位 | 年付月价(月付贵约 20%) | 席位 | MAC 额度 | 关键解锁 |
|---|---|---|---|---|
| **Starter** | $79/mo | 5 users(加人 $12/人) | 无限 MAC | 只有收件箱 + AI Prompt/AI Assist + Basic Reports + Growth Widgets;**没有 Broadcasts、没有 Workflows、没有 AI Agents** |
| **Growth**(主推) | $159/mo | 10 users(加人 $20/人) | 1,000 MAC 起 | + Broadcasts、Workflows、**AI Agents**、Advanced Reports、Zapier & Make、Developer API |
| **Advanced** | $279/mo | 10 users(加人 $24/人) | 自定 MAC | + Mask Phone/Email(防员工带走客户)、Multiple Workspaces、HTTP Request step、Webhooks、SSO、Custom Channels |
| **Enterprise** | 定制 | 无限 | 定制 | 更高 API 限额、专属成功经理 |

计费三根杠杆:
1. **MAC(Monthly Active Contacts)** = 当月**发过或收过消息的联系人**,**纯群发不算**——只有对方回复才变成计费 MAC;每月重置。超额走 "MAC On-Demand":Growth $12/100 MAC、Advanced $15/100 MAC。([billing-usage](https://respond.io/help/organization-settings/billing-usage))
2. **席位(Users)** —— 按档位 $12–24/人/月加购。
3. **AI Credits** = fair-use 内含("99% 客户永远用不到上限"),额度随 MAC 档位涨(如 Growth 5,000 MAC 含 50,000 AI Credits);Support 型 AI Agent 1 credit/条、Sales/Custom 型 2 credits/条。官方口径:"AI usage is included at no extra cost" on Growth+。([ai-credits](https://respond.io/help/organization-settings/ai-credits))
4. **WhatsApp API 费用零加价**:作为官方 WhatsApp BSP,Meta 会话费按成本直通(no markup),平台内有 WhatsApp Fees 模块管理 WABA 余额。([whatsapp-fees](https://respond.io/help/organization-settings/whatsapp-fees) · [BSP 公告](https://respond.canny.io/changelog/respondio-is-an-official-whatsapp-business-solution-provider))

7 天免费试用 = Growth 功能(5 users / 1,000 MAC),但**试用期不给 Broadcasts**。([pricing](https://respond.io/pricing))

> 定价哲学解读:入口便宜($79 无限 MAC 但阉割自动化)、真正能用的自动化从 $159 起跳、"防跳槽"级安全功能(masking/SSO)押在 $279。评测普遍称 Starter 是"诱饵档"。([Chatarmin](https://chatarmin.com/en/blog/respond-io-pricing) · [chatimize](https://chatimize.com/reviews/respond-io/))

---

## 2. 功能总清单(按子领域)

### 2.1 渠道(Channels)——12+ 原生渠道
([channels docs](https://respond.io/help/channels) · [integrations](https://respond.io/integrations))

| 功能 | 做什么 | 价位档 |
|---|---|---|
| WhatsApp Business API(官方 BSP) | 云 API 接入、模板同步/提交、WABA 余额管理、费用零加价 | 全档 |
| Facebook Messenger | 收发 DM;2026-05 起支持自建 Facebook Message Templates(变量/header/按钮,送 Meta 审核) | 全档 |
| Instagram DM | IG 私信 + story 回复 | 全档 |
| **TikTok Business Messaging**(2025 新) | TikTok 私信 + TikTok Messaging Ads 进线统一管理——先发优势渠道 | 全档 |
| Telegram / LINE / Viber | 东南亚常用 IM 全覆盖 | 全档 |
| WeChat | 微信公众号消息 | 全档 |
| SMS(Twilio/Vonage/MessageBird 等) | 短信收发 | 全档 |
| Email | 邮件线程进收件箱统一处理 | 全档 |
| Website Chat Widget | 官网在线聊天(可与其他 IM 合并成一个 widget) | 全档 |
| **Custom Channels(API/Webhook)** | 任何自有 App/未支持平台接入同一收件箱 | Advanced |
| **语音渠道**:WhatsApp Business Calling API + Messenger Calls + VoIP | 打进/打出电话与聊天同一收件箱;WhatsApp 模板可带 "Call on WhatsApp" 按钮(自动授予 7 天回拨权限,2026-04) | 部分国家逐步开放(未核实各档位差异) |

### 2.2 Omnichannel Inbox(全渠道收件箱)
([inbox docs](https://respond.io/help/inbox))

- **Team Inbox / Custom Inboxes** —— 按条件过滤保存的自定义收件箱视图(Starter 起)。
- **Contact Merge** —— 同一个人的 WhatsApp + IG + email 身份合并成单一 Contact(全渠道单一客户视图,他们的核心卖点)。
- Assignment(手动+自动分配)、Open/Close conversation、协作(内部 comment/提及)。
- **Snippets**(话术库/罐头回复),可同时喂给 AI 当知识源。
- 通话记录进收件箱:call details、**录音、转写文字**。
- **Auto-close + AI 分类摘要**(2026-06):不活跃会话自动关闭,附 AI 生成的类别和摘要。([changelog](https://respond.canny.io/changelog))
- Mobile App(iOS/Android,2026 大改版消息体验)。

### 2.3 Workflows(可视化自动化引擎)——Growth 起
([workflows docs](https://respond.io/help/workflows) · [triggers](https://respond.io/help/workflows/workflow-triggers))

**Triggers(11 种):** Conversation Opened / Conversation Closed / Contact Tag Updated / Contact Field Updated / **Shortcut**(坐席在收件箱手动一键触发)/ Incoming Webhook / **Meta Click-to-Chat Ads** / **TikTok Messaging Ads** / Manual Trigger / **Lifecycle Updated** / **Call Ended**。注意:**不支持定时/日程触发**(官方明说)——这是个洞。

**Steps(19 种):** Send a Message、Ask a Question(问答采集)、Assign To(轮询/负载分配)、Branch(条件分支)、Wait、Date & Time(营业时间分流)、Jump To、Open/Close Conversation、Add Comment、Update Contact Field / Contact Tag / **Update Lifecycle**、HTTP Request(Advanced)、**Add Google Sheets Row**、**Send Conversions API Event(Meta CAPI)**、**Send TikTok Lower Funnel Event**、Trigger Another Workflow、AI Objective(legacy,已被 AI Agents 取代)。

### 2.4 Respond AI(AI 能力栈)
([ai-agents](https://respond.io/ai-agents) · [AI Assist](https://respond.io/help/workspace-settings/workspace-setting-respond-ai) · [AI Prompts](https://respond.io/help/workspace-settings/ai-prompts))

| 功能 | 做什么 | 价位档 |
|---|---|---|
| **AI Agents** | 端到端接管对话:打招呼、答 FAQ、资格筛选、推荐产品、约预约、更新 CRM/Lifecycle 字段、分配/关闭会话、触发 Workflow、拦垃圾、低置信度自动转人工。多模态输入(文本/图片/PDF/DOCX/语音条)。RAG 知识挂载 + 持续同步;micro-agents + orchestrator 架构;售前/前台/客服三种预建模板 | Growth+ |
| **Voice AI Agents** | AI 接 WhatsApp/VoIP 电话,32 种语言,生成转写+摘要,**2026-05 起可实时转接人工** | 逐步开放(未核实档位) |
| **AI Assist** | 坐席侧"一键起草回复",基于知识源(PDF/URL/Snippets) | Starter 起 |
| **AI Prompts** | 消息框内四个内置提示:Change Tone / Translate / Fix Spelling & Grammar 等 | Starter 起 |
| **AI Summary** | 聊天/通话摘要 | 含在 AI Credits 内 |
| 模型层 | 2026-04 升级 GPT-5.4 + 多模型冗余,响应快 2-3 倍(据 changelog) | — |

### 2.5 Broadcasts(群发)——Growth 起
([broadcasts docs](https://respond.io/help/broadcasts))

- 支持渠道:WhatsApp(模板消息)、Messenger、Telegram、LINE、Viber、SMS、custom channels;**Instagram 不支持群发**(平台限制)。LINE/Viber/SMS 不支持动态变量。
- 按 Segment 定向、排程发送、失败重发(Failed Broadcast troubleshooting)、Broadcast Reports(送达率)。
- **Import to Broadcast via WhatsApp**:导入无对话历史的号码直接群发(冷启动)。
- Workflow-based broadcasts:群发带多选题、回复自动进流程处理。
- 群发本身**不消耗 MAC**(回复才算)——定价上鼓励你多群发。

### 2.6 Click-to-Chat Ads + 广告闭环(他们最聪明的一块)
([click-to-chat 指南](https://respond.io/blog/click-to-chat-ads) · [CAPI step](https://respond.io/help/workflows/step-send-conversions-api-event) · [TikTok Ads 集成](https://respond.io/help/integrations/tiktok-messaging-ads-integration))

- Meta Click-to-WhatsApp/Messenger/IG 广告进线自动**捕获广告来源**(无需手动打标),CTWA click ID 自动带进 CAPI payload。
- **Send Conversions API Event**:聊天内发生的"资格达标/预约/成交"事件回传 Meta,让 Meta 按"会变成营收的对话"优化投放(客户案例:新客 +40%)。
- **TikTok 同款闭环**:TikTok Messaging Ads 进线 + Send TikTok Lower Funnel Event 回传。
- Leads Ad 表单答案直接显示在联系人档案里。
- Reports 里按 "Conversation Opened Source" 分组看各广告带来多少对话 → 广告 ROI。

### 2.7 Contacts / Segments / Lifecycle(轻 CRM)
([contacts](https://respond.io/help/contacts) · [lifecycle](https://respond.io/help/workspace-settings/workspace-settings-lifecycle))

- Contacts Overview、Contact Details 面板、自定义字段、Tags、批量 Import、Activities 时间线。
- **Segments**:按条件/过滤器分群(供群发和自动化用)。
- **Lifecycle**(2024-25 新模块):自定义销售阶段(含预置 **Lost Stages** 如 Cold Lead 跟踪流失),收件箱/联系人模块直接按 stage 过滤,Workflow 可自动挪 stage,配套 **Lifecycle Reports**(转化、流失、各阶段耗时)——本质是把"漏斗 CRM"塞进收件箱。

### 2.8 Growth Widgets(获客入口)——Starter 起
([growth widgets](https://respond.io/help/workspace-settings/growth-widgets))

- 官网多渠道聊天 widget(访客选自己惯用的 IM)、**QR Code 生成器**(印在门店/餐厅/酒店,扫码进聊天)、click-to-chat 链接。
- 2026-06 起可**追踪联系人来自哪个 Growth Widget**(来源归因进报表+workflow)。

### 2.9 Reports & Analytics
([dashboard-reporting](https://respond.io/help/dashboard-reporting))

11 类报表:Conversations / Messages / Contacts / Assignments / **Responses**(响应率+首响时长)/ **Resolutions**(解决率+时长)/ **Leaderboard**(坐席/团队排行)/ Users / Broadcasts / **Lifecycle**(漏斗转化)/ **Calls**。外加主管 Dashboard 实时监控。Basic Reports(Starter)vs Advanced Reports(Growth+)。

### 2.10 Integrations(集成)
([integrations docs](https://respond.io/help/integrations))

- **原生**:HubSpot、Salesforce(联系人字段双向查看/同步;Salesforce 档位据评测在 Advanced,未核实)、Google Sheets、**Cal.com**(2026-06:聊天内看会议+发预约链接)、Meta Business Accounts。
- **中间件**:Zapier、Make(Growth+)。
- **Developer API**(Growth+):消息自动化、CRM 同步、触发 Workflows;**Webhooks**(Advanced):实时事件推送(2026 迁移到 webhook.respond.io)。
- 电商:Shopify/WooCommerce 走 Zapier/Make,**无原生电商深度集成**(相对 Wati/Zoko 的弱点,未核实最新状态)。

### 2.11 Commerce(聊天内卖货)
([Meta Product Catalog](https://respond.io/help/whatsapp/meta-product-catalog))

- **Meta Product Catalog 集成**:WhatsApp Catalog 商品可在 Messages、Workflows、Broadcasts、Mobile App、Zapier/Make 里分享;客户 Add to Cart 下单后订单详情直接进收件箱。
- 支付:**无内建支付**,靠聊天里发 payment link / 银行转账(WhatsApp Pay 只在巴西)。
- 弃购挽回:自动 abandoned cart 消息(retail 行业方案)。

### 2.12 平台 / 组织级
- **Multiple Workspaces**(多品牌/多分店隔离,Advanced)、**Mask Phone & Email**(坐席看不到客户真实号码——防飞单/带走客户,Advanced)、SSO(Advanced)、2FA(全档)、角色权限、GDPR + ISO 27001、宣称 99.999% uptime。([pricing](https://respond.io/pricing) · [ai-agents](https://respond.io/ai-agents))

---

## 3. SMB 视角(马来西亚/东南亚 SMB 真会用的 vs 企业级虚胖)

**SMB 真会用的(高频刚需):**
- WhatsApp API + 团队收件箱(多人共用一个 WhatsApp 号 = 大马 SMB 第一痛点)
- QR code / click-to-chat 链接(门店、菜单、名片)
- 群发促销(broadcast 不算 MAC 的设计对 SMB 友好)
- 简单欢迎语/营业时间自动回复、FAQ AI Agent
- Click-to-WhatsApp 广告进线管理(大马 SMB 投 Meta 广告 → WhatsApp 成交是主流打法)
- TikTok 私信管理(SEA 电商重镇)
- Meta Catalog 聊天卖货 + payment link

**企业级虚胖(SMB 基本用不到,标注):**
- SSO、Multiple Workspaces、Mask Phone/Email(→ 这是给 50+ 坐席呼叫中心/连锁防飞单的)
- Salesforce/HubSpot 双向同步、Developer API、Webhooks 基建
- 11 类坐席绩效报表 + Leaderboard(SMB 没有"坐席团队"可考核)
- Voice AI 呼叫中心化(SMB 老板自己接电话)
- 32 语言 AI、99.999% SLA 叙事

**SMB 的真实抱怨(机会点):**([G2](https://www.g2.com/products/respond-io/reviews) · [chatimize](https://chatimize.com/reviews/respond-io/) · [Chatarmin](https://chatarmin.com/en/blog/respond-io-pricing))
- **贵**:有意义的自动化 $159/mo(≈RM750/mo)起,大马微型企业吃不消;评测直言"月对话 <200 的小团队用它是杀鸡用牛刀"。
- **学习曲线**:Workflow builder 上手要 2-3 小时+反复试错;AI Agents 和 Workflows 的交互关系难懂。
- 有用户反馈聊天界面偶发卡顿。
- Starter 档是"诱饵":无限 MAC 但没自动化,一旦要 broadcast/workflow 就被迫翻倍付费。

---

## 4. FIKIRTIVE 候选映射(仅候选,决定权在创始人)

| respond.io 功能簇 | 候选去向 | 权衡 |
|---|---|---|
| Omnichannel Inbox(WhatsApp/IG/Messenger/TikTok DM 统一收件箱 + Contact Merge) | **自动回复区**(直接对标本体) | 这是该区的"地板"。要点:先做 WhatsApp+IG+Messenger 三件套即覆盖大马 90% 场景;Telegram/LINE/Viber 可后置。Contact Merge(跨渠道同人合并)是体验分水岭,但工程量大 |
| Workflows 自动化引擎(triggers+steps) | **自动回复区**;跨区 trigger 可考虑 → **Campaign 管理区** | 全可视化 flow builder 是重投入。替代思路:FIKIRTIVE 不做"用户拖 flow",而是 **Otto 替用户搭 flow**(他们的学习曲线抱怨 = 我们的切入点)。注意他们不支持定时触发——FIKIRTIVE 若做,排期区已有排程心智可复用 |
| AI Agents(端到端接管对话 + RAG 知识库) | **自动回复区**(核心)+ 知识源挂 **资产区/Brand memory** | 他们 AI Agent 是"挂在收件箱上的机器人";FIKIRTIVE 的差异化是 Otto 本来就是全屋员工(见 §5)。风险:对话 AI 的幻觉/合规是新的安全面 |
| Broadcasts(分群群发 + 模板管理) | **Campaign 管理区** 或 **自动回复区**(存疑——群发既是 campaign 又是消息) | WhatsApp 模板审核流 + Meta 会话费传导是隐藏工程量;"broadcast 不计费、回复才计费"的计费哲学值得研究 |
| Click-to-Chat Ads + CAPI 回传(聊天事件喂回 Meta 优化) | **Campaign 管理区**(FIKIRTIVE 已有 Meta ads G7 基建,天然衔接)+ **分析区**(ad→对话→成交归因) | 这是 respond.io 最强的营收叙事。FIKIRTIVE 独有优势:我们同时握着投放端(G7 ad-build/ad-write)和(未来)对话端,能做"投放↔对话"全闭环,他们只握对话端 |
| Lifecycle(漏斗阶段 + Lost Stages + 漏斗报表) | **CRM 区**(直接对标) | 轻量漏斗对 SMB 刚好;别抄成 Salesforce。Lost Stage 设计(流失也是阶段)小而美 |
| Contacts/Segments/自定义字段 | **CRM 区** | 分群是群发/自动化的地基,CRM 区必备 |
| Growth Widgets(QR code / 多渠道 widget / 来源追踪) | **自动回复区** 或 **资产区**(QR 码/链接算资产?存疑) | 对大马门店 SMB 极高频、工程量小、演示效果好——高性价比候选 |
| Reports(响应率/解决率/Leaderboard/Lifecycle/Calls) | **分析区**(合并进现有 Analytics 页) | SMB 只需要少数几个数字(多少人来聊、多快回、成交几单);11 类报表是企业虚胖,别照抄 |
| Voice(WhatsApp Calling API + Voice AI) | **建议不要**(现阶段)/ 长期存疑 | 2025-07 才 GA、国家限制多、SMB 需求未证实;等 WhatsApp Calling 在马来市场跑通再看 |
| Meta Product Catalog + cart + payment link | **存疑**(CRM 区 or 自动回复区 or 不做) | 大马聊天电商真实存在,但支付本地化(FPX/DuitNow/Stripe MY)是另一摊;可作后期差异化 |
| HubSpot/Salesforce/Zapier/API 集成层 | **建议不要**(FIKIRTIVE 定位 all-in-one,自家 CRM 区就是答案);Developer API 长期存疑 | 他们需要集成因为只做对话;FIKIRTIVE 全屋自有,集成需求弱得多 |
| Multiple Workspaces | **Agency 楼层**(天然对应多客户隔离) | 他们按 workspace 收 Advanced 档钱——Agency 楼层的收费锚点参考 |
| Mask Phone/Email、SSO | **建议不要**(现阶段 SMB 用不上;masking 可作 Agency 楼层远期项) | — |
| Custom Channels API | **建议不要**(长尾需求,维护贵) | — |

---

## 5. 他们的 AI/agent 打法 vs Otto-operates-100% 的差异化空间

**respond.io 的打法:**"AI Agent 是挂在收件箱上的一个高级功能"。
- AI Agent 只活在**对话域内**:接线、答 FAQ、筛资格、约预约、更新字段、转人工。出了对话域(投广告、做素材、排内容、看全局分析)它什么都做不了,靠 HTTP request 外呼别人的系统。
- 架构上是 micro-agents + orchestrator + RAG + guardrails + 低置信度转人工——工程很扎实,方向是"**替换一线客服人力**"。
- 人机关系:human agent 和 AI agent 平级坐在同一收件箱,人可随时接管。
- 商业化:AI 用量 fair-use 内含在订阅里,不按 resolution 单独收费(与 Intercom Fin 按 $0.99/resolution 相反)——用"AI 免费"当获客钩子,靠 MAC+席位赚钱。([ai-credits](https://respond.io/help/organization-settings/ai-credits))

**Otto 的差异化空间:**
1. **域宽差**:respond.io 的 AI 是"客服部门的 AI";Otto 是"整家公司的超级员工"——同一个 agent 既回消息、又建 campaign、又出素材、又读分析。他们的 AI 永远无法从对话里学到"该给这个客户投什么广告",因为投放不在它系统里;Otto 可以(FIKIRTIVE 已握 Meta ads 写入端)。
2. **操作面差**:他们的 AI 只能做产品预设的 native actions 清单;Otto 的宪法是"每个区 100% 可被 Otto 操作"——用户能点的,Otto 都能点。respond.io 的 Workflow builder 学习曲线抱怨(2-3 小时上手)恰好证明:**"Otto 替你搭自动化"比"给你更好的 builder"更是答案**。
3. **闭环差**:他们把聊天事件回传 Meta(CAPI)是单向信号;FIKIRTIVE 可做双向——对话质量差 → Otto 直接改投放;广告进线多 → Otto 直接扩客服 flow。
4. **可学的**:他们的 guardrails/低置信度转人工/测试环境/"AI 数据不出 workspace"话术,是对话 AI 落地的成熟安全模式,自动回复区应直接借鉴;RAG 持续同步(知识改了 AI 立刻跟上)也该是 Brand memory 的默认行为。

---

## 6. 值得偷的设计(2-5 个)

1. **"回复才计费"的 MAC 模型** —— 群发免费、回复才算钱:把计费和"客户真的在跟你对话(=价值时刻)"对齐,SMB 心理上极易接受,还顺手鼓励多群发(拉高粘性)。对照 FIKIRTIVE 的 credit 经济学,值得研究"按价值时刻计费"的变体。([billing-usage](https://respond.io/help/organization-settings/billing-usage))
2. **聊天事件回传广告平台(CAPI / TikTok Lower Funnel Event)** —— 把"聊天里发生的资格达标/成交"喂回 Meta/TikTok 让投放算法按营收优化,CTWA click ID 全自动携带。FIKIRTIVE 握着投放端,做这个闭环比他们更顺——这是整份研究里最该偷的一条。([CAPI step](https://respond.io/help/workflows/step-send-conversions-api-event))
3. **Shortcut trigger(坐席一键触发自动化)** —— 人在收件箱里点一个按钮就把复杂流程(退款、升级、约课)交给自动化跑。恰好是"人机同席"的最小交互原型,天然映射成"把这活交给 Otto"按钮。([triggers](https://respond.io/help/workflows/workflow-triggers))
4. **Lost Stages** —— 把"流失"本身建模成生命周期阶段(预置 Cold Lead),流失客户自动沉淀成再营销分群,而不是消失。CRM 区 + 再营销 broadcast 的联动就藏在这一个小设计里。([lifecycle](https://respond.io/help/workspace-settings/workspace-settings-lifecycle))
5. **WhatsApp 费用零加价 + 平台内 WABA 余额管理** —— 把"透明、不赚 Meta 差价"做成信任卖点,同时把充值/余额留在自己平台里(钱包粘性)。与 FIKIRTIVE"pricing never hardcoded、40-50% margin 藏在别处"的思路同构:**通道费透明、在智能上赚钱**。([whatsapp-fees](https://respond.io/help/organization-settings/whatsapp-fees))

---

### 主要来源
- 官方:[respond.io 首页](https://respond.io/) · [Pricing](https://respond.io/pricing) · [AI Agents](https://respond.io/ai-agents) · [Help Center(channels/inbox/workflows/broadcasts/contacts/lifecycle/reports/integrations/ai-credits/whatsapp-fees)](https://respond.io/help/quick-start/what-is-respondio) · [Changelog](https://respond.canny.io/changelog) · [About](https://respond.io/about)
- 第三方:[Chatarmin 定价拆解](https://chatarmin.com/en/blog/respond-io-pricing) · [chatimize 评测](https://chatimize.com/reviews/respond-io/) · [G2 reviews](https://www.g2.com/products/respond-io/reviews) · [Crunchbase](https://www.crunchbase.com/organization/respondio)
- 未核实项已在文中标注(Salesforce/HubSpot 档位归属、Voice AI 档位与国家开放度、AI Agent 数量上限、电商原生集成最新状态)。