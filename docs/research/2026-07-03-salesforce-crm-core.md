> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# Salesforce Sales Cloud + 核心 CRM 平台 — 功能基线调研 (2025–2026)

> 背景注:2025 年 10 月 Salesforce 把 Sales Cloud 品牌改名为 **Agentforce Sales**(功能不变,官方文档两个名字混用)。定价 2025 年 8 月起 Enterprise/Unlimited 官方涨价约 6%,下文价位以调研时多数来源为准。CPQ(Steelbrick)已于 **2025-03-31 停售(End of Sale)**,由 **Revenue Cloud Advanced** 接替。
> 主要来源:[Salesforce 官方 pricing](https://www.salesforce.com/pricing/) · [Salesforce Ben Sales Cloud 深度解析](https://www.salesforceben.com/salesforce-sales-cloud/) · [help.salesforce.com Suites 文档](https://help.salesforce.com/s/articleView?id=xcloud.easy_help.htm&language=en_US&type=5) · [Pro Suite 配额](https://help.salesforce.com/s/articleView?id=xcloud.overview_limits_pro_suite.htm&language=en_US&type=5) · [Starter 配额](https://help.salesforce.com/s/articleView?id=sf.overview_limits_starter.htm&language=en_US&type=5) · [Foundations 指南](https://www.salesforceben.com/the-ultimate-guide-to-salesforce-foundations/) · [Agentforce pricing](https://www.salesforce.com/agentforce/pricing/) · [CPQ EOS](https://www.cldpartners.com/salesforce-cpq-is-entering-an-end-of-sale-phase-whats-next/) · [Pipeline Inspection 文档](https://help.salesforce.com/s/articleView?id=sales.pipeline_inspection.htm&language=en_US) · [EAC 文档](https://help.salesforce.com/s/articleView?id=sales.einstein_sales_aac.htm&language=en_US&type=5) · [SMB Group Starter/Pro 分析](https://www.smb-gr.com/cloud-computing/salesforces-evolving-smb-strategy-from-starter-suite-to-pro-suite-and-beyond/) · [Free/Starter/Pro 对比](https://getoncrm.com/salesforce-free-vs-starter-vs-pro-suite-guide/) · [Einstein SDR/Sales Coach 官宣](https://www.salesforce.com/news/stories/einstein-sales-agents-announcement/) · [2025 价格更新官宣](https://www.salesforce.com/news/stories/pricing-update-2025/)

**价位档速览**(USD/user/月,年付):
| 档位 | 价格 | 定位 |
|---|---|---|
| Salesforce Free | $0(≤2 用户) | 2025 年推出的免费引流档 |
| Starter Suite | $25 | SMB 一体包(销售+服务+营销+电商) |
| Pro Suite | $100 | SMB 进阶(+定制对象、Flow、报价、预测) |
| Enterprise (EE) | $165(2025-08 后约 $175) | 完整 CRM,API、审批、地域管理 |
| Unlimited (UE) | $330(涨价后约 $350) | +Premier 支持、沙箱、AI 全家桶 |
| Agentforce 1 Sales | ~$550 | UE + 不限量 Agentforce + Flex Credits |
| Salesforce Foundations | $0 附加包(EE+) | 免费送 Agentforce 1,000 次对话、Data Cloud 等 |

---

## 1. 功能总清单

### A. 核心对象模型(Object Model)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Leads(潜在客户) | 未确认的潜客单独一张表,含来源/状态/评分,转化时拆成 Contact+Account+Opportunity | 全档(含 Starter) |
| Lead Conversion(潜客转化) | 一键把 Lead 转成联系人+公司+商机,保留历史 | 全档 |
| Contacts(联系人) | 人的档案:邮箱、电话、社交、所属公司、活动历史 | 全档 |
| Accounts(客户公司) | B2B 公司档案,层级结构(母子公司)、Account Teams(客户团队协作) | 全档;Account Teams 为 EE+ |
| Person Accounts(个人客户) | B2C 模式,把人当客户主体 | EE+(需开启,不可逆) |
| Opportunities(商机) | 交易记录:金额、阶段、结单日、概率、竞争对手 | 全档 |
| Opportunity Teams / Splits(商机团队/业绩拆分) | 多人协作一单、按比例拆业绩 | EE+ |
| Campaigns(市场活动) | 营销活动对象,追踪成员(Lead/Contact)与 ROI、Campaign Influence(多触点归因) | Professional/Pro Suite 起 |
| Activities(活动:Task/Event/Email/Call) | 所有互动统一挂到相关记录的活动时间线 | 全档 |
| Custom Objects(自定义对象) | 自建表 + 关系(lookup/master-detail) | Pro Suite 50 个;EE 200;Starter 0 |
| Custom Fields(自定义字段) | 每对象加字段 | Starter 25/对象;Pro 100;EE 500 |
| Notes & Files(笔记与文件) | 记录级笔记、附件、内容库 | 全档 |
| Duplicate Management(查重规则) | 匹配规则+重复规则,录入时提示/阻止 | 全档(Starter 内建简化版) |
| Data Import Wizard / Data Loader | CSV 导入向导(5 万条)/批量工具(百万级) | 全档 / API 档(EE+) |
| Record Types + Page Layouts + Dynamic Forms | 同对象多套字段布局与流程 | Professional 有限,EE+ 完整 |
| Field History Tracking(字段历史) | 每对象最多 20 字段改动留痕 | 全档 |

### B. Pipeline 与阶段管理
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Sales Stages / Sales Path(阶段+路径引导) | 自定义阶段,每阶段显示引导提示与关键字段 | 全档(Starter 有简化 Path) |
| Kanban View(看板视图) | 任意列表视图切成按阶段拖拽的看板 | 全档 |
| Pipeline Inspection(管道巡检) | 管道变化追踪:本周新增/推迟/流失/金额变动,叠加 AI 洞察 | EE+ 免费内含(2024 起);亦随 Revenue Intelligence |
| Opportunity Kanban 拖拽改阶段 | 看板上直接拖动更新阶段 | 全档 |
| Forecast Categories(预测分类) | 阶段映射到 Pipeline/Best Case/Commit/Closed | Professional+ |
| Big Deal Alerts(大单提醒) | 超过阈值的商机自动通知 | EE+(未核实具体档位) |
| Similar Opportunities(相似商机) | 找出历史相似赢单做参考 | EE+(未核实,老功能) |

### C. 活动时间线 / 任务 / 日历
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Activity Timeline(活动时间线) | 记录页上按时间倒序显示邮件/通话/会议/任务 | 全档 |
| Tasks(任务) | 待办:到期日、优先级、提醒、循环任务、任务队列 | 全档 |
| Calendar & Events(日历与会议) | 个人/共享日历、会议对象、与 Outlook/Google 日历双向同步 | 全档;同步需集成配置 |
| Salesforce Scheduler / 预约排期 | 对外放预约链接排会议 | 附加产品;Starter 内含简化 Meeting Scheduler(未核实细节) |
| To-Do List / Seller Home(卖家工作台) | 跨记录统一待办清单 + 每日销售仪表首页 | Sales Cloud 各档(近年新 UI) |
| Salesforce Cloud Everywhere(Chrome 插件) | 浏览网页/Gmail 时侧栏直接查/建 CRM 记录 | Sales Cloud 各档(未核实 Starter) |

### D. Email 集成与追踪
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Gmail/Outlook Integration(邮箱集成) | 邮箱侧栏看 CRM 上下文、一键归档邮件到记录 | 全档 |
| Einstein Activity Capture (EAC) | 自动抓取邮件+日历写入时间线,免手动记录 | 基础版随 Sales Cloud;完整版 Performance/UE 免费内含,EE 需加购 |
| Email Templates + Merge Fields(邮件模板) | 可视化模板+变量合并 | 全档 |
| List Email / Mass Email(批量邮件) | 从列表视图群发个性化邮件 | Professional+;Starter 走营销模块 2,000 封/月 |
| Email Tracking(打开/点击追踪) | 追踪邮件打开与链接点击 | 随 EAC/Sales Engagement |
| Einstein Send Time Optimization(最佳发送时间) | AI 挑发送时刻 | Starter 营销模块即有 |
| Salesforce Inbox | 移动端+邮箱端的销售邮件增强(模板、追踪、日程) | 加购或随 Sales Engagement(逐步并入 EAC,未核实现售状态) |

### E. Sales Engagement(销售触达序列,原 High Velocity Sales)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Cadences(节奏序列) | 多步触达剧本:邮件→电话→LinkedIn→等待,自动排队 | UE 内含;EE 加购(约 $75,未核实) |
| Work Queue(工作队列) | 按序列自动生成今天该打谁/发谁 | 同上 |
| Sales Dialer(内置拨号) | CRM 内点击拨号、通话记录、留言掉落 | 加购(按分钟) |
| Automated Actions in Cadence | 序列内自动发邮件步骤 | 同上 |
| LinkedIn InMail 步骤 | 序列里挂 LinkedIn 触达 | 同上 |

### F. Forecasting(销售预测)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Collaborative Forecasts(协作预测) | 按人/团队/期间卷积预测金额,经理可调整(judgments/adjustments) | Professional/Pro Suite 基础版;EE+ 完整 |
| Forecast Types(预测类型) | 按收入/数量/产品族/地域/自定义字段多套预测 | EE+ |
| Quotas(配额) | 给每人设目标,预测页显示达成率 | Performance/UE;EE 需 API(未核实) |
| Forecast Adjustments(逐级调整) | 经理逐级覆盖下属预测数字 | EE+ |
| Einstein Forecasting(AI 预测) | AI 基于历史给出预测区间与置信度 | Einstein for Sales 加购 / UE+ |

### G. Territory Management(地域管理)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Enterprise Territory Management (ETM) | 按地域/行业规则自动分配客户与商机、地域层级、地域预测 | EE+(Sales Cloud) |
| Territory Planning(地域规划,加购) | 地图上可视化切分、优化引擎平衡地域 | 加购;Agentforce 1 Sales 内含 |
| Salesforce Maps | 地图看客户、路线优化、外勤打卡定位 | 加购 |

### H. Products / Price Books / Quotes / CPQ(报价链)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Products(产品目录) | 产品主数据 + Opportunity Products(商机行项目) | Professional/Pro Suite+ |
| Price Books(价格手册) | 多套价格表(标准价/渠道价/币种价) | Professional+ |
| Quotes(报价单) | 从商机生成报价、多版本、PDF 输出、同步回商机 | Professional/Pro Suite+ |
| Orders & Contracts(订单与合同) | 报价转订单、合同期限管理 | Professional+ |
| Salesforce CPQ(复杂配置报价) | 产品捆绑、规则定价、折扣审批、订阅报价 — **2025-03-31 停售**,2027-03 落日 | 原加购;新客户被导向 Revenue Cloud |
| Revenue Cloud Advanced (RCA) | 新一代报价-合同-开票-收入全链(quote→cash),含 Billing、Subscription Management | 加购(EE+) |
| Multi-Currency(多币种) | 多币种记录与汇率 | EE+(需开启) |

### I. 自动化(Flow & 审批)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Salesforce Flow(流程自动化) | 可视化编排:记录触发/定时/屏幕向导流 | 全档,但 **Starter/Pro 仅 5 条 flow/org**;EE+ 数百条 |
| Flow Approval Processes(新版审批流) | 用 Flow 编排多级审批 | EE+ |
| Approval Processes(经典审批) | 折扣/报价/记录多级审批+邮件一键批 | EE+(Pro Suite 无) |
| Assignment Rules(分配规则) | Lead/Case 按规则自动派人或队列 | Professional+;Starter 有简化 lead routing |
| Auto-Response Rules(自动回复规则) | Web 来的 Lead/Case 自动回邮件 | Professional+ |
| Escalation Rules(升级规则) | 超时未处理自动升级 | Professional+(Service 侧) |
| Validation Rules(校验规则) | 保存时字段校验 | 全档(Starter 20 条/对象) |
| Web-to-Lead / Web-to-Case | 官网表单直接进 CRM | 全档(Starter 每日 500–55,000 上限) |
| Apex Triggers / API | 代码级扩展与集成 API | EE+(Pro Suite 有限 API,未核实额度) |
| AppExchange | 第三方应用市场 | Pro Suite+ |
| Sandbox(沙箱) | 隔离测试环境 | EE 1 个部分沙箱;UE 多个全量 |

### J. Reports & Dashboards(报表引擎)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Report Builder(拖拽报表) | 行/列/分组/过滤/公式字段,tabular/summary/matrix/joined 四种 | 全档(Starter 有内建报表) |
| Custom Report Types(自定义报表类型) | 自定义对象组合做报表数据源 | Professional 有限,EE+ 完整 |
| Dashboards(仪表板) | 多组件仪表板、动态仪表板(按查看人权限) | 全档;动态仪表板 EE+ |
| Scheduled Reports / Subscriptions(订阅推送) | 定时把报表/仪表板发邮件 | Professional+ |
| Row-Level Formulas、Bucketing、Cross Filters | 报表内轻量计算与分桶 | 全档(EE+ 完整) |
| Reporting Snapshots(快照) | 定期把报表结果存成历史数据做趋势 | EE+ |
| CRM Analytics(原 Tableau CRM/Einstein Analytics) | 大数据级 BI、预测建模 | 加购 |
| Revenue Intelligence | 开箱即用的销售 BI 仪表板 + Pipeline Inspection 增强 | 加购(EE/UE) |

### K. 列表视图 / 工作界面
| 功能 | 一句话 | 价位档 |
|---|---|---|
| List Views(列表视图) | 保存的过滤视图、行内编辑、批量操作 | 全档 |
| Kanban(看板) | 见 B 节 | 全档 |
| Split View / Console(分屏/控制台) | 列表+详情分屏,多 tab 控制台工作区 | Sales/Service Console:EE+(Foundations 也送) |
| Einstein Search(智能搜索) | 自然语言搜索、个性化结果 | 全档 |
| Chatter(内部动态流) | 记录上的内部讨论、@人、关注记录 | 全档 |
| Slack 集成 | 深度 Slack 工作流(deal room、审批进 Slack);Starter/Pro 2025 起默认送连接的 Slack 工作区 | 各档(深度功能 UE/加购) |

### L. Mobile(移动端)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Salesforce Mobile App | 全功能 iOS/Android app,记录、时间线、审批、仪表板 | 全档(含 Starter) |
| Offline / Briefcase(离线包) | 预选记录离线可用 | EE+(未核实) |
| Mobile Publisher | 把自家品牌套壳发布成自有 App | 加购 |

### M. Einstein / Agentforce AI(销售 AI)
| 功能 | 一句话 | 价位档 |
|---|---|---|
| Einstein Lead Scoring(潜客评分) | AI 按历史转化模式给 Lead 打分排序 | Einstein for Sales 加购(~$75/user/月)/ UE+ |
| Einstein Opportunity Scoring(商机评分) | 商机健康分 1–99,提示风险因素 | EE+ 免费开放(未核实是否仍免费) |
| Einstein Account/Opportunity Insights | 关键时刻提醒:客户新闻、久未联系、竞争提及 | Einstein for Sales 加购 |
| Einstein Relationship Insights | 从公开网络挖人脉关系图 | 加购 |
| Einstein Conversation Insights(通话智能) | 通话/视频会议转写、关键词、竞品提及、辅导时刻 | UE 内含;EE 加购 |
| Einstein Generative:Sales Emails(AI 写邮件) | 按 CRM 上下文生成个性化销售邮件 | Einstein for Sales / UE+ |
| Einstein Generative:Call Summaries / Sales Summaries | 自动会后纪要、商机摘要 | 同上 |
| Einstein Copilot → Agentforce Assistant(对话助手) | CRM 内自然语言问答+执行动作 | EE+(耗 Einstein Requests/credits) |
| **Agentforce SDR Agent** | 自主 AI SDR:7×24 给 Lead 发个性化开发邮件、处理回复异议、共享日历约会 | Agentforce 加购(按对话 ~$2 或 Flex Credits $0.10/动作);A1 Sales 不限量 |
| **Agentforce Sales Coach** | AI 陪练:按商机情境做角色扮演辅导,给反馈 | 同上 |
| Agent Builder / Prompt Builder / Model Builder | 自建 agent 主题与动作、自定义 prompt 模板、接自有模型 | EE+(Foundations 免费送入门额度) |
| Salesforce Foundations | EE+ 免费附加包:Agentforce 1,000 对话(现改 100k Flex Credits)、Data Cloud 1 万分段 credits、2,000 邮件/月、销售/服务 Console、D2C 店面(仅美国) | $0(EE+) |
| Data Cloud(数据平台) | 跨源客户数据统一档案,供 AI/分段用 | Foundations 入门;正式版按量计费 |

### N. Starter / Pro Suite(SMB 档实际拿到什么)
**Salesforce Free(2025 推出)**:≤2 用户,基础联系人/Lead 追踪、基础邮件、基础仪表板,无服务/电商模块。
**Starter Suite($25)**:
- 销售:Lead/Contact/Account/Opportunity 全对象、简化 Sales Path、看板式管道、任务、邮件同步、内建 lead routing 销售流
- 服务:email-to-case 基础工单
- 营销:2,000 封邮件/月(可 $10/1,000 加购)、拖拽邮件模板、表单、Einstein Send Time Optimization、活动分析
- 电商:pay-now 付款链接 + 简易店面(部分市场,马来西亚可用性未核实)
- AI:入门级 AI 提示/邮件辅助;仪表板可定制;移动 App;免费连接的 Slack 工作区
- 限制:**0 自定义对象、0 自定义 app**、25 自定义字段/对象、无 AppExchange、无 API(未核实)、5 条 flow

**Pro Suite($100)**:Starter 全部 +
- 销售:**Quoting(报价)+ Forecasting(预测)**、多管道
- 服务:实时聊天(chat/messaging)
- 定制:**50 个自定义对象、custom apps、Flow(仍只 5 条 active)、AppExchange、LWC**、与其他 Salesforce Cloud 互通
- 合规:HIPAA 责任自担(见 [help 文档](https://help.salesforce.com/s/articleView?id=xcloud.easy_help.htm&language=en_US&type=5))

---

## 2. SMB 视角(马来西亚/SEA SMB 营销人真正会用的)

**SMB 常用(真实高频)**
- Leads/Contacts 单一客户名单 + 状态推进(但 SEA SMB 心智里常常没有 Lead/Contact/Account 三分,只有"客户") — SMB 常用
- Kanban 管道拖拽 + 阶段 — SMB 常用(这是 Pipedrive 式心智,Salesforce 里也是 SMB 最爱的视图)
- 活动时间线(这个人聊过什么)+ 待办任务 — SMB 常用
- 简单查重、CSV 导入 — SMB 常用
- Web/表单进线自动建 Lead + 自动分配 — SMB 常用
- 批量个性化触达(在 SEA 是 **WhatsApp 为主、email 为辅**,Salesforce 的 email-first 在本地水土不服)— SMB 常用但渠道要换
- 简单报价/付款链接(Starter 的 pay-now link 方向对)— SMB 常用
- 基础仪表板:本月进线、成交、管道金额 — SMB 常用
- 移动端随手记 — SMB 常用

**企业级(SEA SMB 基本不碰)**
- Enterprise Territory Management、Territory Planning、Salesforce Maps — 企业级
- Collaborative Forecasts 逐级调整、Quotas、Forecast Types — 企业级(SMB 老板只要"这个月大概能收多少")
- Opportunity Splits/Teams、Person Accounts、Record Types 多布局 — 企业级
- CPQ/Revenue Cloud、Orders/Contracts、多币种价格手册 — 企业级
- 审批流(多级折扣审批)— 企业级(SMB 就是老板一句话)
- CRM Analytics、Revenue Intelligence、Reporting Snapshots、joined reports — 企业级
- Sandbox、API 集成、Apex — 企业级
- Sales Engagement 多步 cadence + Dialer — 存疑(SDR 团队才用;SEA 微型团队更可能让 agent 直接做,而不是自己排 cadence)
- Einstein Conversation Insights(通话转写)— 存疑(对 SEA 电话+WhatsApp 语音场景有价值,但成本高)
- Pipeline Inspection — 存疑(概念好:"这周管道变了什么",但 Salesforce 版本是给销售经理看团队的;单老板版可以极简化)
- Einstein Lead/Opportunity Scoring — 存疑(SMB 名单量小,统计模型不一定学得出来;LLM 式判断反而可行)
- Slack 深度集成 — 存疑(SEA SMB 用 WhatsApp 内部沟通远多于 Slack)

**Salesforce SMB 包本身的教训**:Starter/Pro 卖点就是"开箱即用、一个 app 装下销售+服务+营销+电商+AI"([SMB Group 分析](https://www.smb-gr.com/cloud-computing/salesforces-evolving-smb-strategy-from-starter-suite-to-pro-suite-and-beyond/))——这与 FIKIRTIVE"一个 Otto-operator app"方向撞车,但 Salesforce 的 SMB 档被刻意阉割(5 条 flow、无审批、AI 只给入门额度),留升级钩子;且在 SEA 无本地渠道心智(WhatsApp/TikTok/Shopee)。

---

## 3. FIKIRTIVE 候选映射(供 founder WHAT-pass,均为候选,非决定)

| # | Salesforce 功能簇 | 候选去向 | 权衡(两面都摆) |
|---|---|---|---|
| 1 | 客户对象模型(Leads/Contacts/Accounts) | **该进 CRM 区** | 选项 A:单一"客户"对象+标签(SEA SMB 心智简单,建表快);选项 B:保留 Lead→Customer 两段(能算转化率,Otto 好用漏斗语言)。三对象全套(含 Account 层级)偏企业级 |
| 2 | Opportunity + 阶段 + Kanban 管道 | **该进 CRM 区** | 看板拖拽是 SMB CRM 的核心心智;要不要"金额+预计结单日"字段决定了后面能不能做简版预测。做太少 = 只是名单;做太多 = 变 Salesforce |
| 3 | Activity Timeline + Tasks | **该进 CRM 区** | 时间线是 Otto 的记忆载体(Otto 每次代操作都该留痕在客户时间线上,这是 Salesforce 靠 EAC 收费才做好的事,FIKIRTIVE 天然自动);独立任务/日历系统则是范围膨胀风险 |
| 4 | Email/渠道消息同步与追踪(EAC、邮箱集成) | **该进自动回复区 / 存疑待 founder** | FIKIRTIVE 回复楼已在 WhatsApp/社媒收发;email 收发箱同步是另一档工程量。SEA 优先级:WhatsApp>>IG/FB DM>email。若做 email,Starter 式"2,000 封/月营销邮件"比"双向邮箱同步"便宜得多 |
| 5 | Campaigns 对象 + Campaign Influence(归因) | **该进 Campaign 管理区** | FIKIRTIVE 已有 Meta ads 读+写;把"campaign"升为一等对象、挂进线归因,能把 CRM 区和投放区缝起来。完整多触点归因是企业级坑,首触/末触简版即可 |
| 6 | Web-to-Lead / 表单进线 + 分配规则 | **该进 CRM 区或 Campaign 管理区** | 进线是 CRM 的入水口;SEA 场景等价物是 WhatsApp 点击广告(CTWA)进线、表单、留言。不做它 CRM 区就没水;做了就要有去重+自动分配 |
| 7 | Flow 自动化 + 审批流 | **已有对应楼(Otto skills)/ 存疑待 founder** | 选项 A:不做可视化规则引擎,一切自动化 = Otto skill(可读文件+开关,符合"非常容易管理");选项 B:补极简 if-then(如"新进线→自动打招呼"),给不想跟 agent 对话的用户。Salesforce 给 SMB 只放 5 条 flow,说明 SMB 用量本来就小 |
| 8 | 报价(Products/Price Books/Quotes)+ 付款链接 | **存疑待 founder** | SEA SMB 真实动作是"WhatsApp 里发个报价/收款链接"。极简版(产品表+一键生成报价 PDF/付款链接)贴近 Starter 的 pay-now link,能接 Stripe(FIKIRTIVE 已有 Stripe);完整 CPQ 建议不要 |
| 9 | Forecasting / Quotas / Territory | **建议不要(候选)** | 逐级预测、配额、地域管理是销售团队管理工具,FIKIRTIVE 目标客户多为 1–5 人团队。可保留的最小替代:管道总金额×概率的一行数字,由 Otto 口头汇报即可 |
| 10 | Reports & Dashboards 引擎 | **已有对应楼(Analytics 页)** | FIKIRTIVE 已规划 Analytics(ads+organic+history);候选是把 CRM 漏斗指标(进线→回复→成交)并进同一 Analytics 楼,而不是另建自助报表引擎。自定义拖拽报表引擎 = 巨坑,Otto 按需出数可替代 |
| 11 | Sales Engagement cadences(多步触达序列) | **该进自动回复区 / 存疑待 founder** | 选项 A:Otto 直接执行跟进(agent 本身就是 cadence);选项 B:显式"跟进序列"让用户可见可停(符合安全/可管理心智,也符合 Salesforce 把 cadence 做成可视剧本的原因)。做序列就要碰 WhatsApp 模板消息合规 |
| 12 | Einstein 评分/洞察(lead scoring、opp insights) | **已有对应楼(Otto)** | 统计式评分需要数据量,SMB 没有;LLM 式"Otto 看完时间线告诉你谁最热"零训练成本。风险:无量化分数时用户信任感建立方式不同 |
| 13 | Agentforce SDR(自动开发信 agent) | **已有对应楼(自动回复区/Otto)** | FIKIRTIVE 的回复楼 = inbound 版;outbound 主动触达(冷开发)是新范围且在 WhatsApp 上有封号/合规风险 — 值得单独讨论而非顺手做 |
| 14 | Mobile App | **存疑待 founder** | Salesforce 全档给 mobile;SEA 老板在手机上活。选项:PWA/响应式(便宜)vs 原生(贵);或先把"Otto 在 WhatsApp 里可被老板指挥"当成移动端替代 |
| 15 | 查重 + CSV 导入 | **该进 CRM 区** | 无导入 = 存量客户进不来,冷启动死;查重做保存时提示级即可,匹配规则引擎不必 |
| 16 | Console/Slack/Chatter 协作 | **建议不要(候选)** | 内部协作流是企业需求;FIKIRTIVE 单老板场景里,"协作对象"是 Otto 不是同事 |

---

## 4. Salesforce 的 agent/AI 打法 vs FIKIRTIVE "Otto operates 100%"

**他们的打法(Agentforce)**
- **AI 是叠加层,不是操作系统**:底座还是按席位卖的 CRM($25–$550/席),Agentforce 以加购形态叠上去:先按对话计费(~$2/次),2025 起改 **Flex Credits**($0.10/动作,20 credits/动作),A1 编制档不限量([Agentforce pricing](https://www.salesforce.com/agentforce/pricing/)、[定价拆解](https://www.zenml.io/blog/agentforce-pricing))。**Foundations 免费送入门额度**是获客钩子——先让 EE 客户白嫖 1,000 次对话,再收 credits([Foundations 指南](https://www.salesforceben.com/the-ultimate-guide-to-salesforce-foundations/))。
- **Agent 是"岗位"不是"操作员"**:SDR agent(发开发信约会)、Sales Coach(陪练)、Service agent(客服)各管一个 job([官宣](https://www.salesforce.com/news/stories/einstein-sales-agents-announcement/));每个 agent 被限制在预定义 topics/actions 内,由 Agent Builder 配置。Agent **不会**替用户去操作 Salesforce 的任意界面功能——它做的是"岗位任务",不是"驾驶产品"。
- **演进路径**:Einstein(预测打分)→ Einstein GPT/Copilot(生成+对话)→ Agentforce(自主执行),2025 年 10 月干脆把产品名改成 Agentforce Sales,叙事是"每个业务流程中心都有自主 agent"。
- **信任叙事**:Trust Layer、human-in-the-loop、Data Cloud 做数据地基——卖给的是有合规部门的企业。

**他们做不到、FIKIRTIVE 能做的(候选差异点)**
- **100% 可代操作**:Agentforce 的 agent 只覆盖被显式建模的 actions;Salesforce 上万个功能绝大多数 agent 碰不到。FIKIRTIVE 的设计承诺是每个楼层的每个手动功能 Otto 都能开——"agent 覆盖率 = 100%"是结构性差异,不是营销话术。
- **价格结构**:Salesforce 想用好 AI 的真实门槛 = EE 席位($165+)+ Einstein/Agentforce 加购 + Data Cloud credits,层层叠加(第三方测算 $125–650/user/月);FIKIRTIVE 可以把 agent 当默认能力而非加价项。
- **SEA 渠道原生**:Agentforce SDR 是 email-first;SEA SMB 的进线和成交都在 WhatsApp/IG/TikTok。Salesforce 的 WhatsApp 能力藏在 Marketing/Service Cloud 加购里,SMB 档基本摸不到。
- **配置成本**:Agent Builder/Prompt Builder/Data Cloud 都要 admin 技能;FIKIRTIVE 的 skill = 可读文件+开关,单老板可管。

**他们能做、FIKIRTIVE 短期做不了的(诚实面)**
- 深数据底座(Data Cloud 跨源统一档案)与企业级治理/审计/合规;
- 生态:AppExchange 数千个集成,任何长尾需求都有人做好了;
- 25 年沉淀的对象模型完备度(多币种、层级、拆分、审批……)对成长到中型的客户是刚需——FIKIRTIVE 客户长大后可能"毕业"去 Salesforce/HubSpot,这是天花板问题,候选对策是把 Otto 的不可迁移记忆做成留存护城河;
- 品牌信任与销售网络。

**一句话定位差**:Salesforce 是"给企业销售团队的系统,现在雇了几个 AI 岗位";FIKIRTIVE 的候选叙事是"给 SEA 单老板的整个营销部,Otto 是那个部门唯一的员工,而且他会开这栋楼里的每一台机器"。
