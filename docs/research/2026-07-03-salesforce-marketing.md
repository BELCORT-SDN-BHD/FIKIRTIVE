> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# Salesforce Marketing 竞品基线研究(domain: salesforce-marketing)

研究时间:2026-07。方法:官方 pricing/help 页(salesforce.com 主站屏蔽抓取,以搜索摘要 + help.salesforce.com + 权威第三方 SFMC 专业站交叉核实)。凡不确定处已标 (未核实)。

**2025-26 产品线大重组背景**(理解清单的前提):Salesforce 把 marketing 产品拆成两代:
- **旧代(仍在售)**:Marketing Cloud Engagement(B2C,原 ExactTarget)+ Account Engagement(B2B,原 Pardot)+ Personalization(原 Interaction Studio)+ Intelligence(原 Datorama)。
- **新代 "Marketing Cloud Next"**:Growth / Advanced editions,原生建在 Data Cloud + Agentforce 上,面向 SMB/中型市场的重新打包;老客户通过 "+" editions(Pro+/Corporate+/Enterprise+/Engagement+)混合过渡。来源:[Salesforce next-gen 官方博客](https://www.salesforce.com/blog/next-gen-marketing-cloud-details/)、[TTMS 2025 指南](https://ttms.com/the-guide-to-salesforce-marketing-platforms-editions-and-whats-new/)
- 已退役产品(不要映射):**Social Studio**(社媒发布/聆听,2024-11 退役)、**Audience Studio/DMP**(已退役)。

**价位速查**(全部 USD,org/月,年付):
| SKU | 价格 | 说明 |
|---|---|---|
| MC Engagement Professional | $1,250 | 邮件为主 |
| MC Engagement Corporate | $4,200 | + Journey Builder、Mobile、Einstein |
| MC Engagement Enterprise | 报价制 | + 多 Business Unit |
| MC Growth (Next) | $1,500 | 含 180k 邮件/年、10k unified profiles、10k Data Cloud 激活 credits |
| MC Advanced (Next) | $3,250 | + 预测 AI、Path Experiments、双向对话 |
| Engagement+ bundle | $2,000 | Growth/Advanced + email/mobile/journey 编排 + Digital Wallet |
| Account Engagement Growth | $1,250(10k prospects) | Plus $2,750 / Advanced $4,000–4,400(来源不一,未核实)/ Premium $15,000(75k) |
| Personalization Growth | $108,000/年 | Premium $300,000/年 |
| Intelligence (Datorama) | Starter/Growth/Plus 分层,按数据行数+用户数报价 | (具体价未核实) |

来源:[MC Engagement Pricing](https://www.salesforce.com/marketing/engagement/pricing/)、[MC Editions Pricing (SMB)](https://www.salesforce.com/marketing/marketing-cloud-editions/pricing/)、[Account Engagement Pricing](https://www.salesforce.com/marketing/b2b-automation/pricing/)、[Personalization Pricing](https://www.salesforce.com/marketing/personalization/pricing/)、[codleo pricing 汇总](https://www.codleo.com/blog/salesforce-marketing-cloud-pricing)、[tech.co Pardot pricing](https://tech.co/crm-software/salesforce-pardot-marketing-automation)、[Datorama pricing 指南](https://www.decisionfoundry.com/datorama/articles/datorama-pricing-a-buyers-guide-to-purchasing-datorama/)

---

## 1. 功能总清单

### A. Marketing Cloud Engagement — 平台基础层
| 功能 | 一句话 | 价位档 |
|---|---|---|
| **Data Extensions**(数据表)| 平台内的自定义关系表,一切受众/发送/行为数据的底座 | 全档 |
| **Contact Builder / Audience Builder**(联系人数据模型)| 把多张 Data Extension 关联成单一 contact 视图(attribute groups、populations) | 全档 |
| **Automation Studio**(批处理自动化)| 定时/文件触发的多步骤自动化:SQL Query、Import File、File Transfer、Data Extract、Filter、Wait、Verification、Script、Send Email 等 activity 串联 | 全档 |
| **AMPscript / SSJS / GTL**(专有脚本语言)| 在邮件/短信/落地页里写逐人动态内容逻辑 | 全档 |
| **Multi-Business-Unit**(多品牌/多子账号架构)| 品牌/地区隔离、权限、共享内容 | Enterprise |
| **Transactional Messaging API**(事务性消息 API)| 收据/密码重置类高优先级触发发送 | 全档(未核实) |
| **Sender Authentication Package (SAP)**(发信域名+专用 IP)| 品牌化发信域、专用 IP、信誉管理 | 付费 add-on |
| **Reply Mail Management**(回信管理)| 自动处理退订回复/OOO 等邮件回复 | Corporate+(未核实) |
| **Distributed Marketing**(总部做模板、门店/代理发送)| 让非 marketer 的一线人员用预审内容发 campaign | add-on |
| **Marketing Cloud Connect**(与 Sales/Service Cloud 打通)| CRM 数据同步、在 CRM 里触发 journey | 全档 |
| **REST/SOAP API、Event Notification、Journey Builder API** | 全平台开放 API | 全档 |

来源:[DESelect Automation Studio activities](https://deselect.com/automation-studio-activities-sfmc/)、[MarCloud Automation Studio breakdown](https://marcloudconsulting.com/support/marketing-cloud-automation-studio-activities/)

### B. Email Studio + Content Builder(邮件 + 内容库)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| **Drag-and-drop email builder**(拖拽邮件编辑器)| 非技术人员搭邮件 | 全档 |
| **Content Builder 内容块**:Text / Image / Button / HTML / Free Form / Dynamic Content / A/B Test block / Social Share / Social Follow / Layout / External Content / Reference / Image Carousel | 可复用跨渠道内容库,含引用块(改一处全更新) | 全档 |
| **Dynamic Content**(按属性变内容)| 一封邮件按 profile 字段渲染不同版块 | 全档 |
| **A/B Testing**(主题行/内容/CTA/发送时间测试)| 系统自动选赢家发剩余人群 | 全档 |
| **Send Classifications / Sender Profiles / Delivery Profiles**(发送身份与合规分类)| 商业 vs 事务性发送的合规封装 | 全档 |
| **List / Data Extension sends、Salesforce 数据发送** | 多种受众来源直发 | 全档 |
| **Segmentation: Filters + SQL**(过滤器分群 + SQL 分群)| 拖拽过滤或写 SQL 出受众 | 全档 |
| **Preference/Profile Center + 退订管理** | 订阅偏好中心,自动合规 | 全档 |
| **Email 预览、Litmus 式渲染测试、垃圾邮件测试(Email Validation)** | 发送前逐客户端预览 | 全档(部分 add-on 未核实) |
| **Tracking**(opens/clicks/bounces/转化/热图 Click Activity)| 发送级追踪报表 | 全档 |
| **Einstein Content Tagging**(AI 自动打图片标签)| Google Vision 自动标注素材库 | Corporate+ |

来源:[Trailhead Content Builder](https://trailhead.salesforce.com/content/learn/modules/email-creation-and-sending/build-emails-with-content-builder)、[amarketingautomation 内容块全解](https://amarketingautomation.com/blogs/salesforce-marketing-cloud-email-studio-full-guide-to-content-builder-blocks/)、[MarCloud Email Studio features](https://marcloudconsulting.com/campaign-management/salesforce-marketing-cloud-email-features/)

### C. Journey Builder(多渠道旅程编排)— Corporate 档起
| 功能 | 一句话 |
|---|---|
| **Entry Sources**(入口):Data Extension、API Event、Salesforce Data(CRM 记录变化)、Audience、CloudPages Smart Capture 表单、Event | 谁在什么条件下进旅程 |
| **消息 activities**:Email、SMS、Push、In-App、LINE、WhatsApp(经 chat messaging add-on)、Ad Audience(把人推进广告受众) | 旅程内跨渠道触达 |
| **Flow control**:Wait(定时/等到属性日期/等事件)、**Decision Split**(按属性分叉)、**Engagement Split**(按打开/点击分叉)、**Random Split**、**Frequency Split**、Join、Goal(目标即退出) | 编排逻辑 |
| **Einstein Splits**(AI 分叉:按 engagement 概率/persona 分路) | Corporate+ |
| **Path Optimizer**(旅程内 A/B/n 实验,自动选赢家路径) | Corporate+ |
| **Salesforce activities**:创建/更新 Lead、Contact、Task、Case、Opportunity 等 CRM 对象 | 旅程直接写 CRM |
| **Update Contact / Custom Activity SDK**(自定义节点) | 可扩展 |
| **版本管理、目标统计、旅程分析面板** | 运营 |

来源:[Salesforce Help: Split/Join activities](https://help.salesforce.com/s/articleView?id=mktg.mc_jb_split_join_activities.htm&language=en_US&type=5)、[Salesforce Ben: Path Optimizer](https://www.salesforceben.com/guide-to-path-optimizer-in-marketing-cloud-journey-builder/)、[DESelect JB flow activities](https://deselect.com/blog/flow-activities-integrations-sfmc-journey-builder/)

### D. Mobile Studio(移动渠道)— 多为 add-on/Corporate+
| 功能 | 一句话 |
|---|---|
| **MobileConnect**(SMS/MMS):群发、事务性短信、keyword 自动回复(双向)、短码/长码管理、opt-in/opt-out 合规 | 短信全套 |
| **MobilePush**(App 推送):推送通知、rich media push、**In-App Messages**、**Inbox 消息**、地理围栏/beacon 触发(Location Services) | 自有 App 触达 |
| **GroupConnect**(OTT 消息):LINE、Facebook Messenger 群发与旅程集成 | 东亚市场渠道 |
| 移动渠道 analytics(送达/打开/点击/转化) | 报表 |

来源:[Salesforce Help GroupConnect](https://help.salesforce.com/s/articleView?id=mktg.mc_gc_groupconnect.htm&language=en_US&type=5)、[astreait Mobile Studio](https://astreait.com/Salesforce-Mobile_studio/)、[martechnotes Mobile Studio](https://www.martechnotes.com/what-is-mobile-studio-in-salesforce-marketing-cloud-engagement/)

### E. Web Studio / CloudPages(落地页)
| 功能 | 一句话 |
|---|---|
| **Landing Pages / Microsites**(拖拽落地页/多页微站)| Salesforce 托管,品牌域名 |
| **Smart Capture Forms**(表单)| 提交直接写 Data Extension,可作 Journey 入口 |
| **Preference Center 页面、Code Resource(JS/CSS/JSON 托管)** | 配套页面基建 |
| **AMPscript 实时个性化渲染** | 打开页面那一刻逐人渲染 |
| 页面 analytics(90 天浏览) | 基础报表 |

来源:[Salesforce Help Smart Capture](https://help.salesforce.com/s/articleView?id=mktg.mc_cp_create_a_smart_capture_form_in_cloudpages.htm&language=en_US&type=5)、[MarCloud CloudPages](https://marcloudconsulting.com/marketing-cloud/cloudpages-marketing-cloud/)

### F. Marketing Cloud Advertising(原 Advertising Studio)— add-on
| 功能 | 一句话 |
|---|---|
| **Advertising Audiences**(CRM 受众同步广告平台)| 把 Data Extension/segment 推到 Facebook/Instagram、Google Ads(Customer Match)、LinkedIn、X、Pinterest、Snapchat 做定向/排除/lookalike |
| **Journey Builder Advertising**(旅程内广告)| 在 journey 节点把人加入/移出 FB campaign 受众,邮件+广告协同 |
| **Lead Capture**(FB/Google 线索表单实时回传)| Lead Ads 提交实时进 Data Extension / Sales Cloud Lead,并可触发 journey |

来源:[Salesforce Help MC Advertising](https://help.salesforce.com/s/articleView?id=mktg.mc_ads_advertising_studio.htm&language=en_US&type=5)、[uplers Advertising Studio](https://email.uplers.com/blog/salesforce-marketing-advertising-studio/)

### G. Marketing Cloud Personalization(原 Interaction Studio)— 独立 SKU,$108k/年起
| 功能 | 一句话 |
|---|---|
| **实时行为追踪**(web/app/邮件打开时)+ **Affinity Profiles**(兴趣亲和度画像) | 逐访客实时兴趣图谱 |
| **Web Campaigns**(网页个性化:弹窗/横幅/内容替换) | 按行为/位置/affinity 实时变站点内容 |
| **Triggered Campaigns**(5 种用户触发 + 5 种目录触发:弃购、浏览放弃、降价、回补库存等) | 行为触发跨渠道 |
| **Einstein Recipes**(可配置推荐算法:ingredients/exclusions/boosters/variations) | 零代码商品/内容推荐 |
| **Einstein Decisions**(下一最佳 offer 决策) | AI 决定谁看什么促销 |
| **Open-Time Email Content**(邮件打开时实时内容) | 与 Engagement 打通 |
| A/B 测试、目标与归因报表 | 实验 |
| 注:新一代 **Salesforce Personalization**(建于 Data Cloud/Agentforce)并行在售 | 过渡期双轨 |

来源:[Salesforce Ben Interaction Studio](https://www.salesforceben.com/what-is-salesforce-interaction-studio/)、[The Spot MCP 入门](https://thespotforpardot.com/2023/01/19/salesforce-marketing-cloud-personalization-interaction-studio-a-beginners-guide/)、[Personalization Editions help](https://help.salesforce.com/s/articleView?id=mktg.mc_pers_editions.htm&language=en_US&type=5)

### H. Marketing Cloud Intelligence(原 Datorama)— 独立 SKU
| 功能 | 一句话 |
|---|---|
| **150+ API Connectors**(Google/Meta/LinkedIn/TikTok/GA4/CRM/电商等数据接入) | 全渠道营销数据入仓 |
| **Data Harmonization**(字段映射到统一 taxonomy:channel/campaign/creative) + 19 个数据模型模板 | 跨平台口径统一 |
| **Dashboards & Reports**(拖拽仪表盘、pivot、定时邮件报表) | 营销 BI |
| **AI Insights / anomaly detection**(异常检测、优化建议) | 自动洞察 |
| **Marketing Cloud Intelligence Reports (Advanced)**(SFMC 发送数据的进阶报表,替代退役的 Discover reports) | Engagement 自带报表层 |
| 注:2025 起新推 **Marketing Intelligence**(建于 Data Cloud 的新一代,MCI 的换代) | 双轨过渡 |

来源:[Salesforce Ben MCI 指南](https://www.salesforceben.com/marketing-cloud-intelligence-datorama-complete-guide-to-data-ingestion/)、[The Spot 新 Marketing Intelligence](https://thespotforpardot.com/2025/03/18/salesforces-new-marketing-intelligence-as-seen-by-a-datorama-enthusiast/)

### I. Einstein AI 功能全家桶(散布在各档)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| **Einstein Engagement Scoring** | 预测每人打开/点击/转化/退订概率,分四类 persona(Loyalists/Window Shoppers/Selective/Winback) | Corporate+(Pro 可加购) |
| **Einstein Engagement Frequency** | 判断每人最优发送频率,防疲劳 | Corporate+ |
| **Einstein Send Time Optimization** | 逐人最佳发送时间 | Corporate+;Pardot Advanced+ |
| **Einstein Copy Insights** | NLP 分析主题行,给文案建议 | Corporate+ |
| **Einstein Content Selection** | 打开邮件那刻从素材池实时选最优内容 | Corporate+ |
| **Einstein Messaging Insights** | 发送表现异常自动报警 | Corporate+ |
| **Einstein Email/Web Recommendations** | 邮件/网页商品内容推荐 | Corporate+ |
| **Einstein Splits / Path Optimizer**(见 Journey Builder) | AI 分叉/实验 | Corporate+ |
| **Einstein Behavior Scoring**(Pardot) | 0-100 行为分,自动衰减 | Pardot Advanced+ |
| **Einstein Key Accounts Identification**(Pardot) | 账户级购买概率 | Pardot Advanced+ |
| **Einstein Campaign Insights**(Pardot) | 素材表现的人群洞察 | Pardot Advanced+ |
| **Einstein Attribution**(Pardot) | AI 多触点收入归因 | Pardot Advanced+ |

来源:[Salesforce Ben 15 Einstein features](https://www.salesforceben.com/marketing-cloud-einstein/)、[Salesforce Help Einstein overview](https://help.salesforce.com/s/articleView?id=mktg.mc_ees_einstein_feature_overview.htm&language=en_US&type=5)

### J. Account Engagement / Pardot(B2B 营销自动化)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| **Prospect 数据库**(带活动时间线的潜客库) | B2B 版联系人 | 全档(Growth 1 万人) |
| **Forms + Progressive Profiling**(表单+渐进式补全) | 表单逐次多问一点 | 全档 |
| **Form Handlers**(接第三方表单) | 已有表单回传 Pardot | 全档 |
| **Landing Pages + A/B 测试** | 落地页 | 全档 |
| **List Emails + Email Templates + Dynamic Content**(动态内容) | 邮件营销 | 全档(Dynamic Content Plus+,未核实) |
| **Engagement Studio**(可视化 nurture 旅程:action/trigger/rule 节点) | B2B 培育流 | 全档 |
| **Automation Rules / Completion Actions / Page Actions / Segmentation Rules** | 规则式自动化四件套 | 全档 |
| **Dynamic Lists**(条件自动进出名单) | 活名单 | 全档 |
| **Lead Scoring**(行为打分)+ **Lead Grading**(A-F 契合度评级)+ **Scoring Categories**(多产品线分开打分) | 分数=兴趣、等级=匹配 | 全档(Scoring Categories Plus+) |
| **Custom Redirects**(可追踪链接) | 线下/社媒链接归因 | 全档 |
| **Salesforce Campaign 同步 + Engagement History Dashboards** | CRM 里看营销触点 | 全档(dashboard 数量分档) |
| **B2B Marketing Analytics (CRM Analytics)**(多触点归因、pipeline 仪表盘) | B2B 营销 BI | Plus+(Growth 可加购);B2BMA Plus $3,000/月 add-on |
| **Multi-touch Attribution Models**(first/last/even) | 归因 | Plus+ |
| **Connectors**:Google Ads、Google Analytics、GoToWebinar、Zoom Webinar(未核实)、Eventbrite、Olark 等 | 第三方接入 | 全档 |
| **Salesforce Engage**(销售侧一对一模板发送+提醒) | 销售用营销素材 | add-on $50/user/月 |
| **Business Units**(品牌/地区隔离) | 多单元 | Advanced+(2 个)/Premium(5 个) |
| **Sandboxes、API 配额分档、专用 IP** | 基建 | Advanced+/Premium |
| **Einstein 四件**(Behavior Scoring/Key Accounts/Campaign Insights/Attribution) | 见上表 | Advanced+ |
| 注:Pardot 未列入退役,但 Salesforce 明确把新投入放在 Growth/Advanced;官方给 Pardot 客户出了 [迁移指引](https://thespotforpardot.com/2025/11/10/getting-started-with-marketing-cloud-growth-and-advanced-a-guide-for-account-engagement-users/) | 方向信号 | — |

来源:[Salesforce Ben Pardot editions](https://www.salesforceben.com/pardot-editions-features-pricing-account-engagement/)、[genesysgrowth 2026 指南](https://genesysgrowth.com/blog/salesforce-account-engagement-(pardot)-complete-guide)、[Engagement History 对比 help](https://help.salesforce.com/s/articleView?id=mktg.pardot_engagement_history_comparison.htm&language=en_US&type=5)

### K. Marketing Cloud Growth / Advanced("Next",SMB 重打包)— 对 FIKIRTIVE 最直接的对标
| 功能 | 一句话 | 档位 |
|---|---|---|
| **Agentforce Campaign Creation**(自然语言生成 campaign brief → 受众 → 文案草稿 → journey 草稿) | AI 建 campaign | Growth+ |
| **Campaign Designer (Beta)**(整条 campaign flow 自动组装好,含 email/SMS 触点与品牌文案,人只审核发布) | AI 组装完整旅程 | Advanced |
| **Flow-based Journeys**(用 Salesforce Flow 做旅程:wait/decision/channel send/记录操作) | 新一代 journey 引擎 | Growth+ |
| **Email + SMS + WhatsApp 出站**(统一 setup、集中 consent 管理) | 多渠道原生 | Growth+ |
| **Unified Conversations / 2-Way SMS & WhatsApp**(回复进同一线程,可路由给 Agentforce bot 或 Service 客服;营销发送避让进行中的客服会话) | 双向对话 | Advanced |
| **Forms & Landing Pages** | 原生表单落地页 | Growth+ |
| **Unified Individual**(Data Cloud 身份合并的个人档案) | 统一画像 | Growth+ |
| **Unified Account + Account Scoring**(账户级聚合与打分,ABM) | B2B 账户视角 | Advanced |
| **People Scoring**(Engagement + Fit 双维度打分) | 打分 | Growth+ |
| **Segmentation**(拖拽 + 自然语言生成 segment) | AI 分群 | Growth+ |
| **Path Experiments**(旅程内最多 10 变体实验,Winter'26 起自动选赢家) | 实验 | Advanced |
| **Einstein Engagement Scoring / Frequency**(接入 Flow 决策) | 预测层 | Advanced |
| **Send Time Optimization** | 最佳发送时间 | Growth+(来源有出入,未核实) |
| **Campaign Planning & Insights dashboards**(campaign 日历+内置报表) | 报表 | Growth+ |
| **Digital Wallet**(Email/SMS/WhatsApp 消息 credits 统一计量) | 用量钱包 | 全档 |
| **Engagement Signals**(CRM/行为事件触发 Flow) | 事件触发 | Growth+(需已有 Unified Individual) |
| **Cross-Journey Orchestration**(跨旅程按行为/目标衔接,2025-10 GA) | 旅程间编排 | Engagement+/未核实档位 |
| 计量:Growth 含 180k 邮件/年、10k unified profiles、10k segmentation/activation credits;超出买 Data Cloud credits($1,000/10 万 credits) | 消耗制 | — |

来源:[the-agentic-marketer Growth vs Advanced](https://the-agentic-marketer.com/marketing-cloud-next-tips-from-the-trenches/salesforce-marketing-cloud-growth-vs-advanced-key-differences-and-field-insights-2025/)、[concret.io MC Next](https://www.concret.io/blog/marketing-cloud-next-growth-and-advanced-editions)、[gettectonic Growth edition](https://gettectonic.com/marketing-cloud-growth-edition/)、[Salesforce Ben Digital Wallet](https://www.salesforceben.com/calculate-credit-consumption-with-digital-wallet-in-marketing-cloud-next/)、[Salesforce 全球扩容博客](https://www.salesforce.com/blog/expanded-marketing-cloud-growth-advanced/)

### L. Data Cloud(为营销供数的 CDP 底座)
| 功能 | 一句话 |
|---|---|
| **Data Streams / Connectors**(数据接入) | CRM、网站 SDK、文件、云仓接入 |
| **Identity Resolution**(身份合并:email/phone/姓名精确+模糊匹配出 Unified Profile/golden record) | 跨系统同人合并 |
| **Calculated Insights**(拖拽定义 LTV/RFM/CSAT 等指标) | 派生指标 |
| **Segmentation**(拖拽/自然语言分群,引用属性+insights) | 分群 |
| **Activation**(把 segment 推到 Marketing Cloud、广告平台、外部系统) | 受众出仓 |
| **Streaming/实时事件**、Zero-copy 数据共享(Snowflake/BigQuery) | 实时+免搬运 |
| 计费:全程消耗 credits(按处理行数),是隐性成本大头 | 消耗制 |

来源:[Salesforce Ben Data Cloud 分步](https://www.salesforceben.com/the-drip/unified-data-for-personalized-marketing-with-salesforce-data-cloud-and-marketing-cloud/)、[astreait identity resolution](https://astreait.com/data-segmentation-in-salesforce-data-cloud/)、[Gearset Data 360 概览](https://gearset.com/blog/salesforce-data-cloud/)

---

## 2. SMB 视角(马来西亚/东南亚)

先说硬事实:**Salesforce marketing 全家桶的地板价 $1,250-1,500 USD/月(≈ RM5,500-6,600/月,年付)**,而且是 org 计费 + 消耗 credits + 实施通常还要请 partner。这直接把 95%+ 的 MY/SEA SMB 挡在门外——所以下面的"SMB 常用"指的是**功能形态**(SMB 真的会用、在别家工具里也在用的东西),不是说他们在用 Salesforce。

**SMB 常用(功能形态上是 SMB 刚需)**
- Drag-and-drop email builder + 模板 + 简单 A/B(Mailchimp 级别的用法)
- Forms + Landing Pages(收线索)+ Lead Capture(FB Lead Ads 实时回传 —— SEA 投放以 Meta 为主,这条极常用)
- **SMS / WhatsApp 双向对话** —— 这是整个清单里对 MY 市场最要命的一条:WhatsApp 是马来西亚事实上的商业沟通渠道,而 Salesforce 把双向 WhatsApp 锁在 Advanced($3,250/月)。SMB 现实中用 WhatsApp Business App / respond.io / Wati 等
- 简单 nurture/欢迎序列(Journey Builder 的 5% 用法:进入 → 等待 → 发消息 → 按打开分叉)
- Advertising Audiences 的 SMB 版:把客户名单同步成 FB Custom Audience / lookalike
- 基础报表(发送表现、campaign 汇总、简单归因)
- 简单 lead scoring(热/温/冷即可,不需要 AI)
- Agentforce Campaign Creation 的形态("说一句话生成 campaign")——SMB 极度想要,但不想为此付 Salesforce 的价

**企业级 bloat(SEA SMB 基本不会碰)**
- Multi-Business-Unit、Sandboxes、专用 IP/SAP、Reply Mail Management
- AMPscript/SSJS/SQL 分群 —— 需要专职开发/顾问才玩得动(SFMC 生态一个庞大的顾问行业就靠这个吃饭)
- Personalization/Interaction Studio 整个产品($108k/年起)、Einstein Recipes、web 实时个性化
- Intelligence/Datorama 整个产品(150+ 连接器的营销 BI)
- Data Cloud identity resolution / calculated insights / zero-copy —— SMB 的"CDP"就是一张干净的客户表
- Pardot 的 grading、scoring categories、B2B Marketing Analytics、Einstein Attribution、ABM/Account Scoring
- Distributed Marketing、Path Experiments 10 变体实验、Cross-Journey Orchestration
- MobilePush/In-App(前提是自有 App —— MY SMB 大多没有)

**存疑(形态有用,深度未必)**
- Send Time Optimization / Engagement Frequency:概念对 SMB 有感("什么时候发最好"),但以 AI 模型形态出现是企业级;简单规则版可能就够
- GroupConnect LINE:泰国/台湾/日本重要,马来西亚不重要;Messenger 在 MY 有一定量
- Preference center:合规上有价值(PDPA),SMB 通常只要一键退订
- Engagement Studio 式多步 nurture:B2B SMB(如 agency、B2B 服务商)会用,B2C 零售基本只用 1-2 步自动化

---

## 3. FIKIRTIVE 候选映射(WHAT-pass 候选,均为中性陈述,由 founder 定夺)

FIKIRTIVE 现状参照:已有 Otto agent、素材生成(canvas 图/视频)、Meta ads 读+写(G7 v1/v2)、channel foundation、Account/Settings 页,已规划 Analytics 页与 Schedule 页;愿景含 CRM + 自动回复 + 内容 + 效果营销 + 资产。

| # | Salesforce 功能簇 | 候选归属 | 权衡(不替 founder 决定) |
|---|---|---|---|
| 1 | **Agentforce Campaign Creation / Campaign Designer**(NL→brief→受众→文案→旅程) | **已有对应楼**(Otto 就是这个,而且定位更激进) | 他们是"AI 起草、人组装"(Growth)或"AI 组装、人审核"(Advanced Beta);Otto 的差异化是直接操作全部工具。值得研究他们的 brief→segment→content→flow 四段式产物结构,作为 Otto campaign 输出的参照 |
| 2 | **Advertising Audiences + Lead Capture**(CRM 受众→Meta/Google;Lead Ads 回传) | **已有对应楼(部分)+ 该进 CRM 区** | Meta 受众写入 FIKIRTIVE 已具备工具面(custom audience 工具在 MCP 面已有);Lead Ads 实时回传→CRM 联系人→触发自动回复,是三个楼层的天然连接点,也是 SEA SMB 最常见的获客闭环。反面:Google/LinkedIn 面等于扩渠道承诺 |
| 3 | **2-Way SMS/WhatsApp Unified Conversations**(双向对话、回复路由给 bot/人、营销避让客服会话) | **该进自动回复区** | Salesforce 锁在 $3,250/月 的 Advanced 档;MY 市场 WhatsApp 是主渠道 → 这是价格伞最大的一块。反面:WhatsApp Business API 的 BSP 接入、模板审核、按会话计费是实打实的运营负担;与 respond.io/Wati 正面竞争 |
| 4 | **Journey/Flow 编排**(entry→wait→send→decision split→goal) | **存疑待 founder**(简化版进 Campaign 管理区 vs 全画布) | 全画布 journey builder 是重资产且 SMB 用不到 95% 的节点;但"欢迎序列/弃单提醒/生日券"这类 3-5 节点模板化 flow 是 SMB 真需求。选项 A:模板化预制 flow(Otto 可配);选项 B:通用画布。B 的维护成本高一个数量级 |
| 5 | **Email campaign**(builder、模板、A/B、退订合规) | **存疑待 founder** | Email 在 MY SMB 权重低于 WhatsApp/FB,且 deliverability 基建(域名、IP、投诉率)是无底洞;但"campaign = 多渠道一次编排"里缺 email 会显得残缺。可选:先接第三方发送(Resend/SES)只做编排层 |
| 6 | **Segmentation / Unified Profile**(分群、标签、统一画像) | **该进 CRM 区**(轻量版);identity resolution **建议不要** | SMB 版 = 联系人表 + 标签 + 保存的筛选条件(可自然语言生成,对齐他们的 NL segmentation);Data Cloud 式跨系统身份合并是企业级泥潭 |
| 7 | **Lead Scoring / Grading** | **该进 CRM 区**(简单分级);Einstein 预测打分 **建议不要**(现阶段) | 热/温/冷 + 最近互动时间对 SMB 够用且好解释;预测模型需要数据量 MY SMB 单店不具备。反面:如果 FIKIRTIVE 跨租户聚合信号,长期反而可能做出 SMB 级预测——存疑待远期 |
| 8 | **Forms + Landing Pages(含 Smart Capture 进旅程)** | **存疑待 founder**(Campaign 管理区 vs 建议不要) | 收线索表单是获客闭环的一环;但页面托管/编辑器是一整个产品面(与 Wix/Canva 型工具重叠)。轻选项:只做"表单链接 + FB Lead Ads 回传",不做页面 builder |
| 9 | **Campaign Planning & Insights / Intelligence 报表** | **已有对应楼(规划中的 Analytics 页)** | 已规划的 Analytics(ads+organic+history)覆盖 SMB 面;Datorama 式 150 连接器 BI **建议不要**。他们的"Digital Wallet 用量计量"形态与 FIKIRTIVE credits 体系天然同构,可参考其展示方式 |
| 10 | **Content Builder 素材库**(可复用 blocks、AI 标签) | **已有对应楼**(canvas/My Stuff/brand memory) | Einstein Content Tagging(自动打标)是 My Stuff 的低成本增强候选 |
| 11 | **Send Time Optimization / Engagement Frequency / 防疲劳** | **存疑待 founder** | 规则版(如"每人每周最多 N 条")成本低、价值明确,适合挂在自动回复/campaign 发送层;AI 版暂无数据基础 |
| 12 | **Personalization / Interaction Studio**(web 实时个性化、推荐引擎) | **建议不要** | $108k/年的企业玩具;MY SMB 没有流量量级,网站往往就是 IG bio 链接 |
| 13 | **Pardot Engagement Studio 式 B2B nurture + Salesforce Engage**(销售侧发营销模板) | **存疑待 founder**(与 #4 合并考虑) | 若 FIKIRTIVE 的 CRM 区面向 B2B 服务型 SMB(agency、顾问、B2B 供应商),多步 nurture + "销售一键发模板"有对应场景;若主打 B2C 零售/餐饮则优先级低 |
| 14 | **Multi-touch Attribution / Einstein Attribution** | **建议不要**(现阶段) | SMB 的归因诉求 = "这条广告带来几个询盘";已规划 Analytics 的 campaign 级汇总即可,模型化归因是企业需求 |
| 15 | **MobilePush / In-App / LINE** | **建议不要** | 依赖自有 App/LINE 渗透,MY SMB 场景缺失 |
| 16 | **Preference Center / consent 集中管理** | **该进 CRM 区**(最小版) | PDPA 合规角度值得有"退订/勿扰"字段与全渠道尊重;做成独立偏好中心页面则过度 |

---

## 4. 该产品的 agent/AI 打法 vs Otto

**他们的叙事**:2025 年起整个 marketing 产品线以 **Agentforce** 为中心重构("Marketing Cloud Next"),口号是 agentic marketing with human oversight——AI 负责起草与组装,人负责审核与发布。分层很清晰:
- **Growth 档**:Agentforce 生成 campaign brief、audience segment、content 草稿——然后**人手动把三者组装进 Flow**([the-agentic-marketer](https://the-agentic-marketer.com/marketing-cloud-next-tips-from-the-trenches/salesforce-marketing-cloud-growth-vs-advanced-key-differences-and-field-insights-2025/))
- **Advanced 档**:Campaign Designer (Beta) 直接生成**完整可发布的 campaign flow**(含 email/SMS 触点+品牌文案),人只审核;加 Einstein 预测层(engagement scoring/frequency)喂进 Flow 决策;Unified Conversations 里回复可路由给 Agentforce bot
- 旧产品线(Engagement/Pardot)的 AI 是十几个各自独立的 Einstein 点状功能(见 I 表),不是 agent

**他们做不到、FIKIRTIVE(Otto)能做的:**
1. **操作面覆盖率**:Agentforce 只在 Salesforce 自家围墙内起草/组装;它不会真的去 Meta 开 campaign、不生成图/视频素材、不跨进广告投放执行。Otto 的定位是"操作 100% 的真实工具"——Meta ads 从策略到建 PAUSED 草稿整条已通(G7 v2),素材生成是原生能力。Salesforce 的素材生成基本止于文案+库存内容选择。
2. **价格与复杂度地板**:他们的 agent 体验从 $1,500/月 + Data Cloud credits + 实施 partner 起步;"AI 生成 segment"的前提是你已经把数据建模进 Data Cloud。Otto 面向的是"没有数据团队、没有 partner"的 SMB。
3. **WhatsApp-first**:他们把双向对话锁 Advanced 档、按消息 credits 计费(Digital Wallet);SEA SMB 的主渠道在他们那里是最贵的附件,在 FIKIRTIVE 可以是入口。
4. **一个 app 一个员工**:他们是十几个产品/Studio 的联邦(连他们自己都在用 "+edition" 帮老客户过渡);Otto 是单一 operator 叙事。

**他们能做到、FIKIRTIVE 做不到(短中期)的:**
1. **数据底座深度**:Data Cloud 的 identity resolution、calculated insights、zero-copy、实时事件流——企业级画像与实时触发的天花板远高于一张 SQLite 级客户表。
2. **预测模型的量**:Einstein scoring/frequency/STO 建立在亿级发送数据上;FIKIRTIVE 单租户数据撑不起同类模型(跨租户聚合是远期可能)。
3. **企业治理**:multi-BU、SoD、审计、sandbox、合规发送基建(SAP/专用 IP/RMM)、150+ 数据连接器的 BI——这些是他们护城河,也恰是 SMB 不需要的。
4. **渠道广度存量**:email deliverability 基建、LINE/Messenger、push/in-app、7 家广告平台受众同步——FIKIRTIVE 只有 Meta 一条真通路。

**一句话定位差**:Salesforce 卖的是"给营销部门配 AI 助手的操作系统"(assistant inside a suite you still have to run);FIKIRTIVE 卖的是"雇一个会自己跑完整套营销的员工"(operator that runs the suite for you)。他们 2025 重组恰好验证了 SMB 方向(Growth edition、NL 分群、agent 建 campaign),但其价格地板和 Data Cloud 依赖使其 SMB 化只到中型市场为止——SEA 微型/小型企业带仍然空置。

**主要来源汇总**:[salesforce.com/marketing/engagement/pricing](https://www.salesforce.com/marketing/engagement/pricing/) · [salesforce.com/marketing/marketing-cloud-editions/pricing](https://www.salesforce.com/marketing/marketing-cloud-editions/pricing/) · [salesforce.com/marketing/b2b-automation/pricing](https://www.salesforce.com/marketing/b2b-automation/pricing/) · [Salesforce next-gen blog](https://www.salesforce.com/blog/next-gen-marketing-cloud-details/) · [Salesforce Growth/Advanced 扩容 blog](https://www.salesforce.com/blog/expanded-marketing-cloud-growth-advanced/) · [the-agentic-marketer Growth vs Advanced](https://the-agentic-marketer.com/marketing-cloud-next-tips-from-the-trenches/salesforce-marketing-cloud-growth-vs-advanced-key-differences-and-field-insights-2025/) · [concret.io MC Next](https://www.concret.io/blog/marketing-cloud-next-growth-and-advanced-editions) · [Salesforce Ben Einstein](https://www.salesforceben.com/marketing-cloud-einstein/) · [Salesforce Ben Pardot editions](https://www.salesforceben.com/pardot-editions-features-pricing-account-engagement/) · [Salesforce Ben Interaction Studio](https://www.salesforceben.com/what-is-salesforce-interaction-studio/) · [Salesforce Ben MCI](https://www.salesforceben.com/marketing-cloud-intelligence-datorama-complete-guide-to-data-ingestion/) · [Salesforce Ben Digital Wallet](https://www.salesforceben.com/calculate-credit-consumption-with-digital-wallet-in-marketing-cloud-next/) · [help.salesforce.com 各功能页](https://help.salesforce.com/) · [TTMS 2025 指南](https://ttms.com/the-guide-to-salesforce-marketing-platforms-editions-and-whats-new/) · [gettectonic Growth edition](https://gettectonic.com/marketing-cloud-growth-edition/) · [The Spot Pardot→Next 迁移](https://thespotforpardot.com/2025/11/10/getting-started-with-marketing-cloud-growth-and-advanced-a-guide-for-account-engagement-users/) · [tech.co Pardot pricing](https://tech.co/crm-software/salesforce-pardot-marketing-automation) · [DESelect JB/AS activities](https://deselect.com/automation-studio-activities-sfmc/)