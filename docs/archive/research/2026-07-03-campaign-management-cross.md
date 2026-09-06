> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# 竞品域研究:Campaign Management 端到端(Salesforce Campaign object × HubSpot Campaigns tool)

研究时点:2026-07(以 2025–2026 官方文档与可靠综述为准)。凡不确定存在与否的条目均标 **(未核实)**。

---

## 1. 功能总清单

### A. Salesforce — Campaign object 生态

**版本档位背景**:Campaign object 本体在 Professional、Enterprise、Performance、Unlimited、Developer 各 edition 可用([Salesforce Help: Get to Know Campaigns](https://help.salesforce.com/s/articleView?id=sales.campaigns_def.htm&language=en_US&type=5));小微向的 Starter Suite / Pro Suite 走的是简化版营销(email campaigns + segments + flows),不是完整 Campaign object 体验([Set Up Marketing in Starter and Pro Suite](https://help.salesforce.com/s/articleView?id=xcloud.starter_prosuite_set_up_marketing.htm&language=en_US&type=5))。

#### A1. Campaign 基础对象与规划
| 功能 | 一句话 | 档位 |
|---|---|---|
| Campaign record(campaign 记录)| 一个营销活动 = 一条 CRM 记录,承载所有字段/关联 | Professional+ |
| Status field(状态:Planned / In Progress / Completed / Aborted)| 跟踪 campaign 生命周期阶段 | 同上 |
| Active checkbox(激活勾选)| 控制该 campaign 是否参与 influence 归因、是否可被搜索选中 | 同上 |
| Type / Record Types(类型与记录类型)| 按 campaign 类型(email、event、webinar…)分配不同页面布局和字段值 | Record Types 需 Enterprise+ |
| Custom fields + formula fields(自定义/公式字段)| 扩展任意 KPI、筛选条件 | Professional+(数量随档位) |
| Path on Campaign(状态路径条)| 沿 Status 字段的可视化推进条 + 阶段指引 | Professional+(未核实精确档位) |
| Deep Clone(深度克隆)| 复制 campaign 连同相关记录 | Professional+ |
| Multi-currency(多币种)| campaign 金额字段支持多币种 | 需开启 Multiple Currencies |
| 来源:[Salesforce Ben: Salesforce Campaigns 20+ Things](https://www.salesforceben.com/salesforce-campaigns/) |

#### A2. Campaign Hierarchy(层级)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Parent/Child campaigns(父子层级)| 最多 **5 层**,按年度/区域/业务线组织 campaign | Professional+ |
| "In Hierarchy" rollup fields(层级汇总字段)| 子 campaign 指标自动向上汇总:Responses / Leads / Converted Leads / Opportunities / Won Opportunities / Value Opportunities / Budgeted Cost / Actual Cost / Contacts / Num Sent in Hierarchy 等 | 同上 |
| Campaign Hierarchy view(层级视图)| 在记录页直接看整棵树 | 同上 |
| 来源:[Salesforce Help: Understand Campaign Hierarchy](https://help.salesforce.com/s/articleView?id=sales.campaigns_hierarchy.htm&language=en_US&type=5)、[DESelect 综述](https://deselect.com/blog/salesforce-campaign-hierarchy-structure-reporting-best-practices/) |

#### A3. Campaign Members(成员 = 受众指派)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Campaign Members(成员对象)| 把 Leads / Contacts / Person Accounts / Accounts 挂进 campaign,作为受众容器 | Professional+ |
| Campaign Member Status(成员状态)| 每个 campaign 可自定义状态集(默认 Sent / Responded),含 "Responded" 布尔驱动漏斗统计 | 同上 |
| 添加方式全家桶 | 手动、列表视图批量、**从报表直接 Add to Campaign**、Data Import Wizard、Flow 自动化、Account Engagement completion actions | 同上 |
| Campaign History related list(campaign 历史)| 在 Lead/Contact 记录上反查其所属 campaigns | 同上 |
| 来源:[Salesforce Ben](https://www.salesforceben.com/salesforce-campaigns/)、[Forcery guide](https://forcery.com/learning-salesforce-campaigns/) |

#### A4. 预算与 ROI
| 功能 | 一句话 | 档位 |
|---|---|---|
| Budgeted Cost / Actual Cost(预算成本/实际成本)| campaign 上的标准金额字段,手填 | Professional+ |
| Expected Revenue / Expected Response %(预期收入/回应率)| 规划字段 | 同上 |
| ROI 自动计算 | ROI = ((Won Opportunities Value − Actual Cost) / Actual Cost) × 100 | 同上 |
| Campaign ROI Analysis Report(ROI 分析标准报表)| 一张标准报表直接出每个 campaign 的 ROI | 同上 |
| 预算层级汇总 | Budgeted/Actual Cost in Hierarchy 自动上卷 | 同上 |
| 来源:[MassMailer: Salesforce Campaign Management](https://massmailer.io/glossary/salesforce-campaign-management/)、[Capture ROI with Campaigns](https://help.salesforce.com/s/articleView?id=sales.sales_core_bring_in_leads.htm&language=en_US&type=5) |

#### A5. Campaign Influence(归因:spend→revenue 的核心机制)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Primary Campaign Source(Campaign Influence 1.0)| Opportunity 上一个 lookup 字段,单一 campaign 拿 100% 功劳 | Professional+ |
| Auto-association(自动关联)| 按时间窗 + 规则(如按 Type 过滤)自动把 campaign 挂到新 opportunity | 同上 |
| Customizable Campaign Influence(可定制多触点归因)| junction object 存每个 campaign 对每个 opportunity 的影响百分比,金额按比例分账;依赖 Opportunity Contact Roles | Salesforce 本体可建**自定义模型**;开箱三模型见下 |
| First-Touch / Last-Touch / Even Distribution models(首触/末触/均分模型)| 开箱三个多触点模型;首触按 Campaign Member Created Date、末触按 Last Modified Date 判定 | **需同时持有 Salesforce + Account Engagement (Pardot) license** |
| Custom attribution models(自定义模型)| 自建权重模型,可设默认展示模型 | Customizable CI 开启后 |
| Influenced Opportunities / Campaign Influence related lists | campaign 侧看影响的商机、商机侧看被哪些 campaign 影响 | 同上 |
| Einstein Attribution("Data-Driven Model" AI 归因)| 用真实成交数据学习各触点贡献,替代规则式分配;需 ≥50–100 个带 Contact Roles 的 Opportunities,回看窗 3 个月–2 年 | Account Engagement **Advanced/Premium** 档 | 
| 来源:[Salesforce Ben: Campaign Influence 完整指南](https://www.salesforceben.com/salesforce-campaign-influence-marketers-guide/)、[How Customizable Campaign Influence Works](https://help.salesforce.com/s/articleView?id=sales.campaigns_influence_customizable_understanding.htm&language=en_US&type=5)、[Einstein Attribution](https://help.salesforce.com/s/articleView?id=mktg.pardot_einstein_attribution_parent.htm&language=en_US&type=5)、[Salesforce Ben: Einstein Attribution](https://www.salesforceben.com/pardot-einstein-attribution-a-deeper-dive/) |

#### A6. 报表
| 功能 | 一句话 | 档位 |
|---|---|---|
| 标准报表类型 | Campaigns / Campaigns with Campaign Members / Campaigns with Influenced Opportunities / Opportunities with Campaign History | Professional+ |
| Custom Report Types(自定义报表类型)| 任意扩展 campaign 维度报表 | Enterprise+(Professional 受限,未核实) |
| Dashboards(仪表盘)| campaign 漏斗/ROI 拼装看板 | Professional+ |
| Engagement History reporting | Account Engagement 资产(email/form/landing page)表现回写 Salesforce 报表 | 需 Account Engagement |
| B2B Marketing Analytics(BI 套件,含 Multi-Touch Attribution Dashboard)| CRM Analytics 上的预置多触点归因/管道看板 | Account Engagement Plus+ |
| 来源:[Salesforce Ben](https://www.salesforceben.com/salesforce-campaigns/)、[The Spot: Campaign Reporting with Einstein](https://thespotforpardot.com/2022/05/03/campaign-reporting-with-einstein-for-marketing-cloud-account-engagement/) |

#### A7. 日历、协作、审批
| 功能 | 一句话 | 档位 |
|---|---|---|
| Campaign Calendar(对象日历)| 用 Lightning object calendar 按 Start/End Date 把 campaigns 摆上日历 | Professional+ |
| Chatter collaboration | campaign 记录上的评论串、@mention、跟踪动态 | 全档 |
| Approval Processes(审批流)| 对 campaign 记录配置提交-审批门(如"预算超 X 需审批") | **Enterprise+**(Flow Approval Processes 明确为 Enterprise/Performance/Unlimited/Developer;Professional 受限,未核实细节)|
| 来源:[Salesforce Ben](https://www.salesforceben.com/salesforce-campaigns/)、[Salesforce Ben: Flow Approval Processes](https://www.salesforceben.com/salesforce-spring-25-release-new-flow-approval-process-capabilities/) |

#### A8. Connected Campaigns + Account Engagement 增强(企业 B2B 侧)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Connected Campaigns | Salesforce campaign 与 Pardot campaign 一体化同步 | 需 Account Engagement |
| Engagement Metrics component | campaign 页上直接看邮件/表单/落地页表现,可含层级汇总 | 同上 |
| Einstein Campaign Insights(AI campaign 洞察)| AI 找出表现异常/受众亮点 | Account Engagement Advanced+ |
| 来源:[Salesforce Ben](https://www.salesforceben.com/salesforce-campaigns/)、[Pardot Einstein Implementation Guide](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/pardot_einstein_implementation_guide.pdf) |

#### A9. Marketing Cloud Growth / Advanced("Marketing Cloud Next",2025–26 SMB 现役产品)
这是 Salesforce 现在卖给 SMB/成长型客户的 campaign 体验(建在核心平台 + Agentforce 上),与老 Campaign object 同一数据底座:
| 功能 | 一句话 | 档位 |
|---|---|---|
| Flow-based journeys(Flow 编排)| wait steps、decision splits、email/SMS/WhatsApp 发送、记录创建/更新 = 多渠道 orchestration | MC Growth+ |
| Agentforce Campaign Creation(AI 建 campaign)| 一个 prompt → campaign brief → 受众 segment → 邮件/SMS 内容 → journey 草稿 | **所有 Marketing Cloud edition 均含** |
| Agentforce Campaign Designer | Campaign Creation 的进阶版(更复杂的多资产设计,Summer '25 beta) | 仅 MC **Advanced** |
| Segments(AI 辅助分群)| 自然语言生成受众段 | MC Growth+ |
| 来源:[Salesforce Marketing Cloud Editions](https://www.salesforce.com/marketing/marketing-cloud-editions/)、[SFMC Tips #117/#118](https://medium.com/@marketingcloudtips/marketing-cloud-on-core-agentforce-campaign-creation-697c992adbe6)、[The Agentic Marketer: Growth vs Advanced](https://the-agentic-marketer.com/marketing-cloud-next-tips-from-the-trenches/salesforce-marketing-cloud-growth-vs-advanced-key-differences-and-field-insights-2025/)、[Salesforce Ben: Marketing Cloud Next](https://www.salesforceben.com/salesforce-reveal-marketing-cloud-next-agentic-marketing-to-help-engage-at-scale/) |

---

### B. HubSpot — Campaigns tool

**档位背景**:Campaigns tool 整体需要 **Marketing Hub Professional 或 Enterprise**(Starter/Free 没有)([Create campaigns](https://knowledge.hubspot.com/campaigns/create-campaigns))。数量上限:近期资料称 Professional 5,000 / Enterprise 10,000 个 campaigns;旧资料为 1,000/portal——**具体上限数字未核实(来源相互矛盾)**([docket 2026 pricing 研究](https://docket.io/resources/research/hubspot-marketing-hub-pricing)、[HubSpot Community](https://community.hubspot.com/t5/Reporting-Analytics/How-can-I-increase-my-HubSpot-Campaign-limit-from-1-000/m-p/922562))。

#### B1. Campaign 创建与属性
| 功能 | 一句话 | 档位 |
|---|---|---|
| Create from scratch / from template | 从零或从模板建 campaign,首次有引导式 onboarding | Pro+ |
| Campaign properties | Name(唯一)、Color(视觉分组)、Owner、Start/End date、Goal、Audience(描述性)、Currency code、Notes | Pro+ |
| Custom campaign properties(自定义属性)| campaign 对象可加自定义字段 | Pro+ |
| Brand selection | campaign 绑定品牌 | 需 Brands add-on |
| Campaign Templates(模板)| 模板含步骤(step 描述+类型)、资产占位、预填属性(预算/受众/目标);官方模板库(drip、re-engagement、线下活动等)+ 把现有 campaign 存为自定义模板 | Pro+ |
| Campaigns API | 程序化建/管 campaign | Pro+ |
| 来源:[Create campaigns](https://knowledge.hubspot.com/campaigns/create-campaigns)、[Campaign templates](https://knowledge.hubspot.com/campaigns/campaign-templates) |

#### B2. Asset grouping(资产关联)— HubSpot 的核心模型
一个 campaign = 一组跨渠道资产的伞。可关联 **30+ 种资产**([Associate assets](https://knowledge.hubspot.com/campaigns/associate-assets-and-content-with-a-campaign)):

- **可多 campaign 共用**:Ad campaigns(预算/花费自动同步)、Blog posts、Lists(contact-based)、Case studies、External website pages、Files、Knowledge base articles(需 Service Hub Pro+)、Podcast episodes、已发布 HubSpot social posts、Sent marketing emails、Scheduling pages、SMS(仅限美国机构)、Videos、Website pages、Workflows
- **仅单 campaign**:Calls、CTAs(新旧两代)、CRM records(contacts/companies/deals/tickets/custom objects)、Documents、Feedback surveys、Forms、Landing pages、Marketing events(集成或手建)、Meetings、One-to-one emails、Playbooks、Sequences、草稿/排程 social posts、外部 social posts
- 关联入口:campaign 详情页 Add assets / 各资产编辑器内 / CRM index 页与 Campaigns CRM cards / workflows 自动挂
- 限制:单 campaign 资产换 campaign 会从原 campaign 移除(仅 workflows/lists 可多挂);social posts 单 campaign 上限 10,000;已判定的 influenced contact 不可撤销;tracking URL 不能换 campaign([Campaigns FAQ](https://knowledge.hubspot.com/campaigns/campaigns-faq))

#### B3. Budget tracking(预算)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Budget items / Spend items(预算项/花费项)| 逐项记名称、描述、单价;Budget total / Spend total / Remaining budget 自动算 | Pro+ |
| Ad spend auto-sync(广告花费自动同步)| 关联的 ad campaigns 的预算与实际花费自动进表,行描述为 "Ad campaign" | Pro+ |
| Budget in custom report builder | 'Campaign total budget' / 'Campaign total spend' 可进自定义报表 | Pro+ |
| 来源:[Manage your campaign budget](https://knowledge.hubspot.com/campaigns/manage-your-campaign-budget)、[Report on campaigns using custom report builder](https://knowledge.hubspot.com/campaigns/report-on-campaigns-using-the-custom-report-builder) |

#### B4. UTM / Tracking URLs
| 功能 | 一句话 | 档位 |
|---|---|---|
| Auto-generated campaign UTM(自动生成 UTM)| 建 campaign 即自动生成唯一 utm_campaign 值(可在 UTM settings 关掉)| Pro+ |
| Editable UTM + secondary values(可改 + 历史值保留)| 改 UTM 后旧值转为 secondary 继续归集流量,报表不断档;防重复校验 | Pro+ |
| Tracking URL builder(跟踪链接生成器)| 在 campaign 内生成带一致 UTM 的链接;凡带该 utm_campaign 的流量都归到此 campaign | Pro+ |
| UTM history | 查看/删除历史 UTM 值(必须保留一个默认值)| Pro+ |
| 来源:[Manage your campaign UTM values](https://knowledge.hubspot.com/campaigns/manage-your-campaign-utm-values) |

#### B5. Campaign Goals(目标)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Goals tracker | 对 Sessions / New contacts / Influenced contacts / Closed deals / Influenced revenue 设目标值,campaign 页实时显示达成百分比 | Pro+ |
| 来源:[Analyze individual campaign performance](https://knowledge.hubspot.com/campaigns/analyze-campaigns)、[INSIDEA goals tracker](https://insidea.com/blog/hubspot/kb/how-to-use-the-campaign-goals-tracker-in-hubspot/) |

#### B6. 报表与归因(spend→revenue)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Performance tab 核心指标 | Sessions、New contacts(可选 **First touch / Last touch** 口径)、Influenced contacts(接触过任一资产的去重联系人)、Closed deals、Influenced revenue | Pro+ |
| Influenced contacts by lifecycle(生命周期分布)+ Contact lifecycle cost | 各阶段影响人数,以及 spend÷人数 = 每阶段获客成本 | Pro+ |
| ROI report | ((revenue 或 attributed revenue 或 deal value − campaign spend) / spend) × 100 | Pro+ |
| Revenue report(线性分摊)| 收入在成交前所有触点间均匀分摊 | Pro+ |
| **Revenue Attribution(多触点收入归因)** | 完整模型库:First / Last interaction、Linear、U-shaped(40/40/20)、W-shaped(30/30/30/10)、Full-path(22.5×4+10)、Time-decay(7 天半衰)、J-shaped / Inverse J-shaped;可定制计入的 interaction types | **Enterprise** |
| Campaign comparison(比较)| 一次比较最多 **10 个** campaigns | Pro+ |
| Asset-level reports + traffic source 细分 | 每类资产各自表现表 + 渠道来源拆分 | Pro+ |
| Export | CSV / XLS / XLSX / PDF | Pro+(需导出权限) |
| Custom report builder with Campaigns object | campaign 作为报表数据源自由拼 | Pro+ |
| 来源:[Analyze campaigns](https://knowledge.hubspot.com/campaigns/analyze-campaigns)、[Analyze overall campaigns](https://knowledge.hubspot.com/campaigns/analyze-overall-campaigns)、[Understand attribution reporting](https://knowledge.hubspot.com/reports/understand-attribution-reporting)、[Campaigns FAQ](https://knowledge.hubspot.com/campaigns/campaigns-faq) |

#### B7. 日历与任务
| 功能 | 一句话 | 档位 |
|---|---|---|
| Marketing Calendar(营销日历)| 跨渠道统一日历:campaigns、社媒、marketing email、tasks;Month/Week/Day/List 视图;按 campaign、事件类型过滤;tabs(All events / My tasks / My campaigns / Marketing email)| Pro+ |
| Campaign tasks(任务)| 从 campaigns tool 建任务、指派、看板;任务上日历(需 Campaigns Publish 权限)| Pro+ |
| Social calendar(社媒日历)| 已发布+排程社媒帖的日历,按账号/campaign/作者/类型过滤 | 独立于 campaigns |
| 来源:[Plan your campaigns with the marketing calendar](https://knowledge.hubspot.com/campaigns/use-your-marketing-calendar)、[Create tasks from campaigns tool](https://knowledge.hubspot.com/campaigns/create-marketing-tasks-with-the-campaigns-tool) |

#### B8. 管理、协作、权限、审批
| 功能 | 一句话 | 档位 |
|---|---|---|
| Clone campaign | 连同草稿资产、sticky notes、connection lines、tasks、tracking URLs 一起克隆 | Pro+ |
| Delete + 3 个月恢复窗 | 删 campaign 不删资产,3 个月内可恢复 | Pro+ |
| Bulk edit / views / folders | 表格批量改属性、保存视图、文件夹归档 | Pro+ |
| Comments(协作评论)| campaign 上 @ 队友讨论 | Pro+ |
| Campaign permissions(按用户/团队限访问)| 只有授权用户可编辑指定 campaign | **Enterprise** |
| Content approvals(内容审批)| marketing emails(最多选 10 个审批人)、blog、pages、social 的"请求审批→审批人放行才能发"流程 + 审批提醒 | **Enterprise**(对应 Hub) |
| Breeze Assistant in campaigns | campaign 页内 AI 洞察/问答 | Pro+(AI 功能) |
| 来源:[Manage campaigns](https://knowledge.hubspot.com/campaigns/manage-campaigns)、[Require approvals to send marketing emails](https://knowledge.hubspot.com/marketing-email/request-approval-to-send-a-marketing-email)、[Overview of approvals](https://knowledge.hubspot.com/account-management/overview-of-approvals-in-hubspot) |

#### B9. Marketing Studio(2025–26 campaigns tool 的进化,public beta)
| 功能 | 一句话 | 档位 |
|---|---|---|
| Canvas view(画布)| 拖拽卡片(任意资产类型)+ connection lines + sticky notes 做视觉化 campaign 规划 | Pro+(beta) |
| Campaign Brief(campaign 简报)| 目标/受众/要点集中一处,接品牌 kit,是 AI 生成的起点与"单一事实来源" | 同上 |
| Calendar / Board / Table views | 日历自动铺排资产可拖动改期;Kanban(Draft→Scheduled→Published→Sent→Archived);表格批量操作 | 同上 |
| Breeze 全 campaign 生成 | 自然语言 prompt → 整个 campaign 草稿(资产生成、remix 变体、品牌一致样式);目前免费,官方已预告将耗 AI credits | 同上 |
| Annotations / deep links / comment tagging | 画布内标注、@、直达资产链接 | 同上 |
| Analyze tab | 跨 campaign 预置报表(revenue attribution、goals、资产类型表现、lifecycle、流量、influenced contacts over time),**不可自定义** | 同上 |
| 兼容性 | 保留旧 campaigns 的 performance/attribution/budget/tasks/UTM 数据;开启 beta 后所有既有 campaigns 自动进入新界面 | 同上 |
| 来源:[Process Pro: Marketing Studio](https://www.processproconsulting.com/resources/marketing-studio-the-evolution-of-hubspot-campaigns)、[Analyze campaign performance in Marketing Studio](https://knowledge.hubspot.com/campaigns/analyze-campaign-performance) |

---

## 2. SMB 视角(马来西亚/SEA SMB 营销者实际用什么)

| 功能簇 | 标注 | 说明 |
|---|---|---|
| Campaign 容器 + 资产归组(HubSpot 模型)| **SMB 常用** | "这个促销季的所有帖子/邮件/广告放一个伞下"是 SMB 最自然的心智;HubSpot 的资产伞比 Salesforce 的记录字段更贴 SMB |
| 简单预算/花费记录 + 广告花费自动同步 | **SMB 常用** | SMB 记的是"这档活动花了多少、赚回多少";逐项 budget items + Meta 广告 spend 自动进表是刚需级;但复杂预算审批表是企业级 |
| Campaign calendar / marketing calendar | **SMB 常用** | SEA SMB 围着节庆档期跑(Raya、11.11、CNY、双旦);日历视图可能是整个域里 SMB 打开频率最高的界面 |
| Campaign goals(目标 vs 实际)| **SMB 常用** | 简单的"目标 X 单/X 询盘,现在到哪"即可;SMB 不会配 KPI 树 |
| 简单 ROI 报表(spend vs revenue 一条公式)| **SMB 常用** | HubSpot 的 ROI report、Salesforce 的 ROI Analysis Report 的简化版 |
| First-touch / Last-touch 口径切换 | **SMB 常用(轻量版)** | SMB 能理解"新客算给第一个还是最后一个触点";再多就用不动 |
| UTM 自动生成 + tracking URL builder | **存疑** | 概念对 SMB 偏 geek,但**自动**生成(用户无感)是好设计;手动 UTM 管理界面本身在 SEA SMB 很少被用 |
| Campaign members / 受众指派(Salesforce 模型)| **存疑** | SMB 的"受众"更多是 WhatsApp 名单/IG 粉丝/广告 audience,不是 CRM 成员表;但"这次活动打了谁、谁回应了"的最小版本有价值 |
| Campaign Hierarchy(5 层父子)| **企业级** | 多 BU/多区域组织才需要;SMB 一层就够,最多"年度主题→单档活动"两层 |
| Customizable Campaign Influence / 多触点收入归因(W/U/full-path/time-decay)| **企业级** | 需要大量干净的 opportunity + contact role 数据;HubSpot 也把它锁在 Enterprise;SMB 数据量撑不起模型 |
| Einstein Attribution(数据驱动归因)| **企业级** | 要 ≥100 个带角色的商机才能启动 |
| Approval processes / content approvals | **存疑** | 1–5 人团队自己发自己批,用不上;但**代运营/agency-客户**关系里"客户点头才发"是 SEA 常见场景,轻量单步审批有真实需求 |
| Record types / custom report types / B2BMA 仪表盘 | **企业级** | 管理员级配置,SMB 无 admin |
| Campaign templates(可复用模板)| **SMB 常用(轻量版)** | "上次 Raya 活动照搬一次"= 克隆/模板,对 SMB 极高频 |
| Marketing Studio 画布 + AI 全活动生成 | **SMB 常用(方向)** | HubSpot 明确在往"AI 从 brief 生成整个 campaign"走——这正是 SMB 想要的形态,也与 FIKIRTIVE 的 canvas+Otto 撞方向 |
| 多渠道 journey 编排(Flow/Workflows)| **存疑** | 邮件 drip 在 SEA SMB 渗透低;WhatsApp/社媒序列才是本地形态;Salesforce Growth 的 Flow 支持 WhatsApp 值得注意 |

---

## 3. FIKIRTIVE 候选映射(WHAT-pass 候选,均待 founder 定夺)

| # | 功能簇 | 候选去向 | 取舍说明(中性呈现) |
|---|---|---|---|
| 1 | **Campaign 容器 + 资产归组**(HubSpot 伞模型:一个活动挂帖子/广告/视频/邮件)| 该进 Campaign 管理区 | 这是本域的地基。选项 A:学 HubSpot"资产伞"(canvas 生成物、排程帖、Meta 广告都可挂进 campaign);选项 B:学 Salesforce"记录+字段"。A 与 FIKIRTIVE 已有 canvas/内容资产天然契合;B 实现更薄。两家单资产默认只归一个 campaign——这个约束简化了归因,值得沿用 |
| 2 | **预算/花费追踪 + 广告花费自动同步** | 该进 Campaign 管理区 | FIKIRTIVE 已有 Meta ads 读(G6),ad spend 自动进 campaign 表 = 已有连接器的自然延伸;另 FIKIRTIVE 自身的 credit 消耗(生成成本)可作为独有的"内容制作成本"列——两家都没有这个。注意:涉及金额展示但不碰 spend-path |
| 3 | **Campaign calendar** | 已有对应楼(规划中的 Schedule 页)| founder 已规划 Buffer-like Schedule 页(3 视图);HubSpot 的做法提示一个决策点:Schedule 页只排"帖子",还是升级为 marketing calendar(campaigns + 帖子 + 任务同屏)?后者= Campaign 管理区与 Schedule 楼的交界,需 founder 划界 |
| 4 | **Campaign goals(目标 vs 实际)** | 该进 Campaign 管理区 | 轻量:每档活动设 1–3 个目标数(询盘/单量/花费上限),实时百分比。与 Analytics 页有重叠,归属待定 |
| 5 | **ROI / spend→revenue 报表** | 该进 Campaign 管理区 或 已有对应楼(规划中的 Analytics 页)| 最小版 = 每 campaign 一行:花费(广告+制作)vs 归因收入 vs ROI。放 Analytics(全局视角)还是 campaign 详情页(单活动视角)或两处都放,是信息架构决策 |
| 6 | **归因模型** | 存疑待 founder | 选项 A:只做 first/last touch 切换(HubSpot Pro 档水平,SMB 够用);选项 B:加 UTM 自动生成做流量归因底座;选项 C:多触点模型(两家都锁企业档,且 SMB 数据量撑不起)。C 明显超纲;A/B 的成本差在于 FIKIRTIVE 是否有站点侧追踪(目前没有 web tracking 能力,B 依赖它)|
| 7 | **UTM 自动生成 + tracking URL** | 存疑待 founder | 若 FIKIRTIVE 发出的每条链接(帖子/广告)自动带 campaign UTM,用户无感、归因有据——但价值兑现依赖客户网站装追踪或至少 GA;不做则归因只能靠平台侧数据(Meta insights) |
| 8 | **Campaign members / 受众指派** | 该进 CRM 区(与 Campaign 管理区联动)| Salesforce 的"谁被打了、谁回应了"最小版 = CRM 联系人可标记"参与过某 campaign";与自动回复区联动(回复者自动标 Responded)是两家都没有的 WhatsApp 原生玩法。完整 member-status 体系则偏重 |
| 9 | **Campaign hierarchy(5 层)** | 建议不要(如需,最多 2 层)| SMB 场景下 5 层是纯企业结构;若做,"年度主题→活动"两层封顶。也可用 tag/folder 替代层级 |
| 10 | **审批流** | 存疑待 founder | FIKIRTIVE 已有 Otto plan-approval(G7 广告 SoD)。选项 A:把同一"计划→批准→执行"机制复用为 campaign 级内容审批(agency-客户场景);选项 B:不做人-人审批,只保留人-agent 审批。A 打开代运营市场但加复杂度 |
| 11 | **Campaign templates / clone** | 该进 Campaign 管理区 | "复制上次节庆活动"对 SEA SMB 极高频、实现薄(克隆记录+资产引用);与 Otto skills 天然结合(模板可以是 Otto 可执行的 playbook——两家的模板都只是静态清单,Otto 模板可以是活的) |
| 12 | **多渠道 journey 编排(Flow/Workflows)** | 该进自动回复区 或 建议不要(v1)| 完整 journey builder 是巨型工程;FIKIRTIVE 自动回复区已覆盖"收到消息→回",若加"campaign 发布后 N 天跟进"类轻序列即触及 journey 的 SMB 子集。Salesforce Growth 用 Flow 撑 WhatsApp 值得研究但不必对标 |
| 13 | **Marketing Studio 画布(brief→AI 生成整活动)** | 已有对应楼(canvas + Otto)| HubSpot 的 Canvas+Brief+Breeze 结构 ≈ FIKIRTIVE canvas + Otto 的现有方向,等于给 founder 的路线做了市场验证;差异点:HubSpot 画布是"规划视图",FIKIRTIVE canvas 是"生产车间"。是否补 campaign brief(作为 Otto 生成的锚点)是候选 |
| 14 | **Campaign comparison(比较 N 档活动)** | 该进 Campaign 管理区 或 Analytics 页 | 轻量表格对比(花费/询盘/ROI)即可,上限 10 学 HubSpot 无必要 |
| 15 | **协作(评论/任务/@)** | 存疑待 founder | 单人操作者场景下优先级低;等多席位/agency 场景再议 |

---

## 4. 两家的 Agent/AI 打法 vs Otto

### Salesforce — Agentforce
- **形态**:Agentforce Campaign Creation(所有 MC edition 标配):一个 prompt → brief → segment → 邮件/SMS 文案 → journey 草稿;Agentforce Campaign Designer(仅 Advanced,Summer '25 beta)做更复杂的多资产设计([SFMC Tips #117/#118](https://medium.com/@marketingcloudtips/marketing-cloud-on-core-agentforce-campaign-creation-697c992adbe6)、[Salesforce Ben](https://www.salesforceben.com/salesforce-reveal-marketing-cloud-next-agentic-marketing-to-help-engage-at-scale/))。
- **叙事**:"agentic marketing"、人机协作,agent 嵌在各工具里当加速器。
- **他们做不到 / Otto 能做**:Agentforce 生成的是**草稿与配置**,执行仍靠人穿针引线;它只在 Salesforce 围墙内动作(不会替你去发 IG 帖、回 WhatsApp);依赖干净的 CRM/数据底座与重实施(SMB 通常没有);定价与配置复杂度天然企业向。Otto 的赌注是**同一个 agent 横穿全部楼层**(内容生产→排程→广告→回复→CRM→campaign 记账),100% 工具可被 agent 操作、100% 也可手动操作。
- **他们能 / 我们不能(现状)**:数据驱动归因(Einstein Attribution)背后是海量成交数据;深度 B2B 管道体系;生态与合规背书。

### HubSpot — Breeze
- **形态**:Breeze Assistant(角色感知的全局副驾)+ 核心 agents(Customer / Prospecting / Data)+ Breeze Marketplace 专项 agents;campaign 域的重点是 **Marketing Studio 里 Breeze 从 brief 生成整个 campaign**(资产草稿、remix 变体、品牌一致);2026-04 起 Customer/Prospecting agent 转**按结果计费**($0.50/解决一次会话、$1/推荐一个 lead)([HubSpot Breeze](https://www.hubspot.com/products/artificial-intelligence)、[Breeze AI Agents](https://www.hubspot.com/products/artificial-intelligence/breeze-ai-agents)、[onthefuze 2026 guide](https://www.onthefuze.com/hubspot-insights-blog/hubspot-breeze-ai-agents-2026)、[Spring 2026 Spotlight](https://www.hubspot.com/spotlight))。
- **叙事**:"Loop Marketing"——AI 生成 + 人审;agents 各管一个切片。
- **他们做不到 / Otto 能做**:Breeze 的 agents 是**竖井式**的(客服 agent 管客服、prospecting agent 管外联),没有一个横向 operator 能端到端跑完"策划→生成→投放→回复→复盘";Marketing Studio 的 AI 生成止步于 HubSpot 自有资产(不会替你操作 Meta 广告结构);campaigns tool 锁 Pro+(≈USD 800/月起的档位),SEA 微型 SMB 够不着;SMS 仅美国、WhatsApp 弱——SEA 主渠道恰是 WhatsApp。
- **他们能 / 我们不能(现状)**:企业档多触点归因模型库、成熟的 web tracking 底座(UTM/session/lifecycle 全链)、模板与集成生态、按结果计费的定价工程。
- **值得警惕的信号**:Marketing Studio(canvas + brief + AI 全活动生成)与 FIKIRTIVE 的 canvas+Otto 是同一方向,HubSpot 正把它推向 public beta——方向被验证,但也意味着窗口期不是无限的。

### 对 FIKIRTIVE 的差异化落点(供 founder 参考,非结论)
1. 两家的 campaign AI 都是"**生成器**"(生成草稿),Otto 的定位可以是"**操作员**"(生成 + 真的去执行 + 记账回写 campaign)。
2. 两家的归因都假设"网站+邮件"为中心;SEA SMB 的中心是 **WhatsApp+社媒+广告**,campaign→回复者→成交的归因线是两家都没铺的。
3. 两家把 campaign 管理锁在高价档(HubSpot Pro+、Salesforce Professional+/MC Growth+);"SMB 价位就给全量 campaign 管理"本身即定位。
