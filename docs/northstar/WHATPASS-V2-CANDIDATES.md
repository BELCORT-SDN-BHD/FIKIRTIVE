# WHAT-pass v2 扩容候选总表

> **文件性质 —— 先读这个**
> 本文件是 **WHAT-pass v2 扩容候选总表**(华语,宪法 9)—— founder 2026-07-09 定调新方针:**原型层默认全做,闸门搬到点亮(后台)**。候选入表 ≠ 批准;真正的判决方式 = **founder 走城用脚投票**(逐页体验北极星原型后 keep/cut),本表只负责把该拍板的东西摆齐,不代 founder 做产品决定。
> **来源**:8 支扫描队对行业龙头全量功能图谱的重扫(每区扫描队读的具体龙头见各章开头说明),含新增本地对标 **SleekFlow / Mekari Qontak**(SEA 本地 WhatsApp CRM 直接对手,原研究底稿未纳入,本次补充抓取了它们独有的、可原型化的机制)。
> **硬排除项永不复活**:凡撞到 `docs/BLUEPRINT.md` 宪法第 8 条(明确不盖的楼)或此前已封卷的原则性"不要",一律留在各区排除表(收进折叠区),不重新拿出来议。
> 标注**"太深奥"**的候选:不做完整实现,做**最轻原型**(占位 UI / 最小闭环),交 founder 走城时再判是否值得深化。
> 本表**不制造任何新产品决定** —— 使用方式见文末「使用规则」。

## 候选条数一览

| 区 | 候选条数 | 排除条数 |
|---|---|---|
| 一、crm | 31 | 8 |
| 二、inbox-lifecycle | 63 | 12 |
| 三、create-factory | 26 | 12 |
| 四、schedule-social | 14 | 9 |
| 五、campaign-ads | 27 | 14 |
| 六、analytics-reporting | 18 | 11 |
| 七、brand-assets | 14 | 8 |
| 八、team-agency-platform | 21 | 14 |
| **合计** | **214** | **88** |

---

## 一、crm — Salesforce Sales Cloud + HubSpot Smart CRM + respond.io + Klaviyo CDP 全量扫描

### 候选(31 条)

> 扫描依据:`docs/research/2026-07-03-salesforce-crm-core.md`、`2026-07-03-hubspot-crm-sales.md`、`2026-07-03-respond-io.md`、`2026-07-03-klaviyo.md` 四份全量对标 + `GRILL-VERDICTS-2026-07-03.md`(N-19/N-21/N-22/N-23/N-26 四项 CRM 相关判决)+ `2026-07-03-northstar-feature-capture-audit.md`(salesforce/respond-io 两节)+ `docs/design/2026-07-03-harmony-01-data-model.md`(确认 Contact/ContactIdentity/Deal/PipelineConfig/Segment/Company 目前只是**图纸**,代码库 `packages/db/prisma/schema.prisma` 里一张表都还没建 —— CRM 区是真空地)。
>
> 说明:MagicPath(画布手感)与 origami/plane/arcads/Kalodata 是创作区/团队协作区的对标参考,与 CRM 区功能面无直接交集,已确认排查过研究目录,未发现遗漏点,故不列入本表。

#### A. 客户档案与联系人管理(地基,respond.io/SF/HS 均以此为核心)

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 客户唯一档案 + 多渠道身份合并(WhatsApp/IG/旧 Excel 是同一个人) | SF(Contacts)/HS(Contacts+Companies)/respond.io(Contact Merge) | 同一个客人不管从哪个渠道进来,老板看到的是同一张脸,不会把老客户当新客户重复开发 | Contact + ContactIdentity 已在数据模型规划(P2);原型层给一个"客户名单"页 + 手动合并按钮 | 已判要(P2/P3 计划中),未落地 |
| 查重去重(Duplicate Management) | SF(查重规则)/HS(AI 辅助识别重复) | 批量导入旧客户名单时,自动挡掉"张三"和"Tan San"其实是同一人重复建档 | 保存/导入时提示"可能重复" + 一键合并 | 新增 |
| CSV 批量导入/导出 | SF(Data Import Wizard)/HS(CRM Import/Export) | 开店多年攒的 Excel 客户表一次倒进来,不用一个个手打 | 上传 CSV → 字段映射向导 → 预览 → 确认导入 | 新增 |
| 自定义字段/属性 | HS(Properties)/SF(Custom Fields) | 卖保险的想记"保单到期日",卖美容的想记"上次疗程日期"——每个行业要的客户字段不一样 | 客户档案页"加字段"按钮,类型选文本/数字/日期/下拉 | 新增 |
| 字段/记录变更历史(只读时间线) | SF(Field History Tracking) | 发现某客户的成交金额被改了,能看到谁、什么时候改的,团队多人时不背锅 | 复用现有 ActionEvent 管道,详情页显示"最近改动" | 曾判可纳入(N-23,2026-07-03),未落地 |
| Consent/勿扰字段 + 群发/Otto 主动消息运行时硬拦截 | SF(Service 报告 consent)/respond.io(WABA opt-in)/Klaviyo(SMS/WhatsApp consent 排除) | 客户说过"别再发促销",系统自动记住,以后所有群发/Otto 主动联系都自动跳过,不会因骚扰被平台封号或惹恼客户 | 联系人档案"勿扰"开关;群发/Otto 发送前必过这道闸(fail-closed) | 已判要(N-22 2026-07-03 + 7-9 2026-07-07 已升级为"运行时硬约束"),未落地 |
| B2B 公司档案(轻量版:一家公司挂多个联系人) | SF(Accounts)/HS(Companies) | 做批发/代理生意的老板,一家公司底下有好几个对接人,要看"这家公司"整体往来记录而不是散在各联系人里 | 轻量 Company 对象(名称+联系人列表),暂不做母子公司层级 | 曾判留 P4 深化(非拒绝,只是时序);v2 默认全做下建议提前到原型层轻量版 |
| 自定义对象(自建表挂客户,如"设备档案""课程档案") | SF/HS(仅 Enterprise) | 极特殊行业(租赁要"设备"、教育要"课程")可能要,但绝大多数 SEA 中小商家用不到 | 若做,是通用建表器(自定义类型+关联到客户),工程量大 | 太深奥(全新候选,研究建议不做,标注由 founder 再判) |

#### B. 交易与管道(Deal/Pipeline)

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 交易记录 + 看板拖拽(Kanban) | SF(Opportunity)/HS(Deals)/respond.io(轻量) | 老板一眼看到"现在手上几单在谈、卡在哪一步、总共值多少钱",不用翻聊天记录心算 | Deal+PipelineConfig 已规划(P3);原型层做看板+列表双视图,阶段可拖拽 | 已判要(P3 计划中),未落地 |
| 管道阶段可自定义 | SF/HS | 卖房产的流程(看房→议价→签约)跟卖美容套餐(咨询→体验→购买)不一样,老板要能自己改阶段名字 | 阶段是 org 级可编辑列表,非硬编码 | 已判要(P3 计划中),未落地 |
| 多条管道(如"新客开发"vs"老客复购"分开看) | SF(多管道 Professional+)/HS(Deal Pipelines) | 同时做两条不同节奏的生意,不想混在一张看板里 | 交易记录挂"管道类型"字段,UI 可切换看板 | 新增 |
| 简版预测(管道总额×概率,一行数字) | SF(Forecasting 的 SMB 化版本) | 不需要复杂销售预测表,只想知道"这个月大概能进账多少" | 看板页顶部一行"预计本月成交额" | 已有候选("轻量替代"),未落地 |
| 大单提醒 | SF(Big Deal Alerts) | 金额超过老板自己设的门槛(比如 RM5000)的单子,系统主动提醒别漏跟进 | 交易记录金额字段 + 阈值设置 + 提醒卡片 | 新增,低成本高实用 |
| 商机团队协作/业绩拆分 | SF(Opportunity Splits/Teams) | 多人一起谈成一单要分业绩;对 1-5 人微型团队价值存疑,通常是老板一人成交 | 若做,是交易记录挂多个"参与者+占比"字段 | 太深奥(全新候选,标注) |

#### C. 活动记录与待办

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 客户活动时间线 | SF/HS(Activity Timeline) | 点开一个客户,看到"上次什么时候聊过、聊了什么、Otto 帮着做了什么",不用自己回忆 | 复用消息/Otto 动作事件流,渲染成时间线卡片 | 已判要(该进 CRM 区),未落地 |
| 待办任务 | SF/HS(Tasks) | "明天记得跟进这个客户"设个提醒,别忘了 | 客户/交易记录挂任务列表,到期提醒 | 已判要,未落地 |
| 会议预约链接 | HS(Meeting Links)/SF(Scheduler) | 美容院、补习班这类要预约的生意,给客户一个链接自己选时间,不用来回问档期 | 存疑:可能接现成第三方或让 Otto 代订,而非自建完整日历系统 | 存疑候选 |

#### D. 生命周期与分群

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 客户生命周期阶段 + 流失阶段(Lost Stages) | **respond.io(直接对标,KL 同城对手,值得偷设计 #4)** | 客户不只是"有交易/没交易"二分,而是"新进线→在聊→冷淡了→流失了";流失客户自动进"唤回名单"而不是从视线消失 | Contact 挂 lifecycleStage 字段 + "流失→自动进再营销分群"规则 | 曾判"归 P3 再议"(N-26,2026-07-03),现正是 P3 窗口,应决 |
| 分群(自然语言 → 确定性规则编译) | HS(Lists)/Klaviyo(Segmentation)/respond.io | 老板说"给上个月买过但这个月没回购的人发条消息",系统自动圈出这批人 | 已规划(P3);NL 描述→规则 JSON(宪法第 10 条:确定性编译,不靠模型现场判断) | 已判要(P3 计划中),未落地 |
| 预测字段作为可筛选属性(预测流失风险/预测下次购买/预测终身价值) | **Klaviyo(值得偷设计 #2)** | 老板能直接筛"最可能快要流失的 10 个客户",而不是看一堆报表数字自己猜 | 冷启动数据不够时先用规则近似值,显示为客户档案上的标签而非报表 | 全新候选(Klaviyo 研究"值得偷"点名) |
| Otto 热度标签替代传统 Lead Scoring | SF(Einstein Scoring)/HS(Predictive Scoring) | 不用看懂"这个客户 82 分"是什么意思,Otto 直接说"这 5 个客户最热,因为最近问了价格" | 客户列表页 Otto 生成热/温/冷标签 + 一句理由,而非数字打分系统 | 已有部分对应(Otto 侧),候选是把它做成 CRM 列表页一等展示位 |

#### E. 进线捕获与来源追踪

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 表单/广告进线自动建档 + 团队自动分配 | SF(Web-to-Lead+Assignment Rules)/HS(Lead Form Routing) | 客户点了 FB 广告或填了官网表单,自动变成一条客户记录;团队多人时能自动轮流分派,不会有人漏接 | 进线来源已有(Meta CTWA/表单),补"自动建 Contact + 按规则分配"落点 | 该进 CRM 区,未落地(与团队协作 G-11 同期) |
| 进线来源标注(这个客户是被哪个广告带来的) | SF(Campaign Influence)/respond.io(CTWA 来源捕获) | 老板能看到"这个客户是被哪个广告吸引来的",知道该多投哪个 | 轻量版单触点 sourceCampaignId 字段(不做多触点归因) | 曾判不要(太深奥,N-21,2026-07-03),成本性,标注入候选 |
| Lead→Deal 转化事件埋点 | SF(Lead Conversion) | 老板能看到"这个月进线 40 个、成交 8 个",一眼知道转化率好不好 | Contact 从"新进线"挪到"已成交"时记一个转化事件,喂周报/分析页 | 曾判不要(太深奥,N-19,2026-07-03),成本性,标注入候选 |
| 电商/marketplace 订单数据接入客户档案 | **Klaviyo(Shopify 集成的 SEA 空缺等价物)** | 客户在虾皮买了什么、买过几次,自动同步进客户档案,不用老板自己去后台查 | 新渠道走 ChannelConnection 缝,拉取订单数据挂上 Contact/Deal | 全新候选,SEA 差异化机会点(Klaviyo 在 SEA 的真空点) |
| 拉新表单/弹窗(前提是客户有自己的网站) | Klaviyo(Forms/Pop-ups) | 有自建网站的商家(少数)可以放个弹窗收邮箱/号码 | 前提依赖有自有站,marketplace 店/纯社媒商家用不上 | 存疑候选(低优先) |

#### F. 生命周期自动化(规则文件,非拖拽画布)

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 预建生命周期自动化配方库(欢迎新客/N 天未回复跟进/复购提醒/生日祝福) | **Klaviyo(60+ flow templates,值得偷设计 #1)** | 老板不用自己想"要不要发欢迎语",装一个现成配方,开关一开就在跑 | Otto 写"人看得懂、改得动"的规则文件(宪法 O-09,非拖拽画布),CRM 区提供开关列表 | 全新候选,跨 CRM×自动回复区 |
| 简版折扣/交易审批 | SF(Approval Processes)/HS(Pipeline Approvals) | 员工要给客户打折,得先过老板一句话批准,免得乱降价 | 复用已规划的 ApprovalRequest(P3),交易记录挂"申请折扣"按钮 | 已有对应基建(ApprovalRequest 通用原语),候选是 CRM 侧具体触发点 |

#### G. 报价与收款(轻量,非 CPQ)

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 极简报价单 + 收款链接(资金不经 FIKIRTIVE) | SF(Starter pay-now link)/HS(Payment Links/Invoices) | 老板在客户档案里一键生成报价单或收款链接发到 WhatsApp,客户点了直接付钱到老板自己账户 | Product(已规划 P1)+ 简单模板拼报价/链接,接商家自己的收款渠道 | 曾判以后(红旗四:商家收款=以后,先不过我们;起步形态正是"链接跳商家自己账户");现可原型层试做 |
| CPQ 复杂配置报价(产品捆绑规则/多级折扣/订阅计费) | SF(CPQ→Revenue Cloud)/HS(Revenue Hub CPQ) | 绝大多数 SEA 中小商家的简单商品/服务用不上,只有复杂 B2B 合约生意才需要 | 若做是独立报价引擎,工程量巨大 | 太深奥(全新候选,标注) |

#### H. 通话与语音(存疑,基建重)

| 功能 | 来自哪家龙头 | 对用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 通话记录 + AI 转写摘要 | SF(Einstein Conversation Insights)/respond.io(Voice AI) | 老板打完电话,系统自动记一笔"聊了什么、下一步要做什么",不用手打备忘 | 先做"手动记通话备忘"轻量版;AI 转写(尤其马来语/华语/rojak 混语)留到后面 | 曾判"建议不要现阶段"(成本性:基建重+多语转写难),标注入候选 |

<details>
<summary>排除清单 —— 8 项(点开展开)</summary>

| 功能 | 排除理由 |
|---|---|
| Slack 内部协作 / Chatter(记录内动态流+@人) | O-13 已判"Slack/Notion 类工作工具 connectors 不要"(founder 拍板:SEA SMB 主场在 WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具)+ 宪法第 8 条同条列名 |
| Developer API / 对外开放 Webhooks(供第三方系统读写 FIKIRTIVE CRM 数据) | 违宪第 8 条:"操作这座城的 agent 永远只有 Otto",对外 API = 给外人操作面,founder 定案永久不做;respond.io/HubSpot 靠这层是因为它们只做单一环节,FIKIRTIVE 全屋自有不需要这条逃生口 |
| Zapier/Make 等中间件连接器 | 与上条同一精神(对外操作面/connector 生态),宪法第 8 条 |
| AppExchange / 第三方 App 市场(开放插件生态) | 违宪第 8 条(对外 MCP/API 精神延伸)+ O-11(skill 永久 BELCORT 内部编写,不开放第三方生态) |
| 原生同步 Salesforce/HubSpot 等外部 CRM(respond.io 的"CRM 集成"层) | 对 ICP 明显无用:目标用户(SEA 中小老板)基本没有并行使用 Salesforce/HubSpot;且与自身定位重叠——FIKIRTIVE 自家 CRM 区本身就是答案 |
| Data Enrichment 第三方公司/买家画像库(HubSpot Breeze Intelligence/Clearbit 式 2 亿+ 画像)+ Einstein Relationship Insights(挖网络人脉关系图) | PDPA/个人数据爬取风险——未经客户同意批量购买/挖掘第三方个人与商业身份数据,合规风险高,且数据源对马来西亚本地市场覆盖差 |
| Sandbox / Apex 代码扩展 / 开发者控制台 | 对 ICP 明显无用(非技术 SEA 中小老板不写代码);且非"原型层可体验"的用户功能,纯开发基建,不算此扫描范围 |
| Territory Management / Territory Planning / Salesforce Maps(地域规划+路线优化+外勤打卡) | 对 ICP 明显无用:目标客户多为 1-5 人单店/线上生意,没有需要按地域切分的外勤销售团队 |

**范围说明(非排除,仅标注不重复候选)**:
- Multiple Workspaces / Mask Phone-Email(防飞单)/ SSO —— 属 Agency 楼层候选范畴(多客户/多坐席场景),不在 CRM 区重复列出。
- CRM Analytics / Revenue Intelligence 自助 BI 报表引擎 —— 已有对应楼(分析区),遵循"重叠即砍"决策原则(GRILL-VERDICTS 已提炼的 founder 决策原则④),漏斗指标并入现有 Analytics 页而非另建报表构建器。
- Growth Widgets(QR code/多渠道 widget)、Broadcasts(群发)、Reviews(评价管理)、Helpdesk/Customer Agent(AI 客服工作台)、Portfolio(跨账号克隆)—— 分别归属自动回复/客服区、Campaign 管理区、Agency 楼层,非 CRM 区自身候选,已在各自竞品研究的候选映射表中有落点,此处不重复扫描以免与其他分区 agent 产出重叠。

</details>

---

## 二、inbox-lifecycle —— 收件箱客服 + 生命周期自动化区(对应 harmony 设计里的 M 区「自动回复/客服」+ L 区「生命周期自动化」)

**扫描来源**:respond.io / ManyChat / HubSpot Service+Data Hub / Salesforce Service Cloud / Klaviyo(四家指定龙头全读)+ 补充读了 SleekFlow、Mekari Qontak(SEA 本地 WhatsApp CRM 直接对手,原 M/L 区研究底稿未纳入这两家,本次补充抓取了它们独有的、可原型化的机制)。GRILL-VERDICTS-2026-07-03.md + BLUEPRINT.md 第八条已通读。

**关键背景**:M-01~M-18(自动回复/客服)与 L-01~L-16(生命周期自动化)这 34 个功能簇已在 2026-07-03「七区默认判决全数通过」里被批准为"要"(cluster 粒度),但当时是粗粒度批准 + 部分子项因"企业级/成本"被隐性排除在候选之外。本表按 founder 2026-07-09 新方针"原型层默认全做、闸门搬到点亮"重新展开:①把已批准 cluster 拆到具体功能点(不写"客服增强"这种粗话);②把当年因成本/复杂度被"建议不要"的子项转正为候选,交 founder 复核;③补 SleekFlow/Qontak 独有、原研究未拆出的具体机制;④只有撞到宪法硬排除条款或对 ICP 明显无用的,才维持在排除表。

Contact Lifecycle 阶段(New/Cold Lead/Lost Stage 这类销售漏斗阶段追踪)founder 已于 2026-07-03 明确归 **CRM 区(P3)**,不是本区("生命周期自动化"指 Klaviyo 式的 email/WhatsApp 行为触发 flow,不是销售阶段管理),故未列入本表,避免越区。已核对 MagicPath/origami/plane/arcads/Kalodata 相关研究结论,均属创作画布/内容表现对标,与收件箱客服/生命周期自动化区无直接交集,故未强行拉入。

### 候选(63 条)

#### A. 收件箱基础设施(respond.io / SleekFlow / Qontak / HubSpot)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| WhatsApp+IG+Messenger 统一收件箱(先三件套) | respond.io/SleekFlow/Qontak/HubSpot | 老板不用五台手机来回切,一个屏幕看完所有平台客人消息 | Conversation/CustomerMessage 列表页+会话窗,渠道先接 WhatsApp Cloud API+Meta Graph | 曾批准(M-01,2026-07-03 七区默认判决已过) |
| 跨渠道联系人合并(同一人 WA+IG+email 认成一人) | respond.io/ManyChat/SleekFlow | 客户换个平台问话,老板不用重新自我介绍一遍 | 走 ContactIdentity 表按手机号/邮箱硬匹配,疑似同人先建议、人点头才合并 | 曾批准(M-12) |
| 会话分配/认领 + "转给他/暂停 Otto" | respond.io/ManyChat/Qontak | 几个店员共用一个号,不会两人同时回同一个客人 | 会话上加 assign 按钮+"暂停 Otto"开关 | 曾批准(M-10) |
| 内部协作(@提及队友、私密备注、交接说明) | SleekFlow/HubSpot | 复杂客诉能拉同事一起看,不必转手机截图讲半天 | Conversation 加内部备注字段+@提及通知 | 曾批准(M-01,本次细化) |
| 不活跃会话自动关闭 + AI 摘要 | respond.io | 老板不用手动清空积压旧对话,系统自动归档并总结"这单聊了什么" | 定时任务扫超时会话+LLM 一句话摘要 | 新增(respond.io 2026-06 changelog 细节,未拆入 M-01 原文) |
| Shortcut Trigger(坐席一键把会话交给自动化) | respond.io | 遇到"退款"这类套路化请求,店员点一下按钮剩下全交给 Otto | 会话窗内"交给 Otto 处理"按钮,映射预定义规则 | 新增(respond.io §6 值得偷设计,未拆入任何簇) |
| WABA 余额管理页(充值/剩余额度可视化) | respond.io | 老板知道 WhatsApp 消息额度还剩多少,不会突然发不出去才发现没钱 | 余额卡片+充值按钮,通道费透传显示 | 曾批准(M-02 细化,红旗五已定调"通道费独立账道") |

#### B. WhatsApp / 渠道基建

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| WhatsApp Business API 接入 + 模板消息库 | respond.io/Qontak/SleekFlow | 能用预审模板在 24 小时窗口外主动联系客人(发货通知、催付款) | 模板管理页(建模板/送审状态/WABA 余额) | 曾批准(M-02) |
| WhatsApp Flow(原生互动表单,聊天内收集资料) | SleekFlow/Qontak | 客人在 WhatsApp 里直接填资料选套餐,不用跳出去填 Google 表单 | 用 WhatsApp 官方 Flow JSON 模板渲染表单节点 | 新增(SleekFlow+Qontak 双源,不在 respond.io/ManyChat 原始 M 区里) |
| Template Pacing / 号码质量自动监控防封号 | Qontak | 老板不懂 Meta 规则也不会因为发太多促销被封号 | 群发前系统自动查质量分,超阈值预警/拦截 | 新增(Qontak §5 值得偷设计,respond.io/ManyChat 未提) |
| WhatsApp Co-existence(个人号转 API 号过渡期双写) | SleekFlow | 老板从个人 WhatsApp 转正式 API 号,过渡期两边消息都不丢 | 收件箱双写,标注消息来源 | 新增(SleekFlow 独有机制) |
| 语音渠道(WhatsApp Calling + 通话转写摘要) | respond.io/Qontak | 客人打 WhatsApp 电话进来自动留底转文字,不怕忘记口头承诺 | 通话记录进 Conversation 线程,转写文本+摘要 | 曾判以后(M-18,"需求未证实,现在做等于押重基建") |

#### C. 自动回复 / AI 客服

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 关键词/规则自动回复(触发词→回复) | ManyChat/respond.io/HubSpot chatflows | 客人问"多少钱"自动发价目表,不用店主半夜爬起来打字 | 一张可读的"触发词→回复"规则表(file-system 风格,非画布) | 曾批准(M-03) |
| 营业时间自动分流("现在打烊,明早 X 点回你") | respond.io/HubSpot/Salesforce | 深夜留言不会石沉大海,客人知道何时有人理他 | 一条时间规则+默认回复模板 | 曾批准(GRILL-VERDICTS"可直接纳入 12 项"已列) |
| AI 客服 Agent 端到端接管(答 FAQ/筛资格/约预约/转人工) | respond.io/HubSpot Breeze/Salesforce Agentforce/Qontak Agentic AI | 晚上没人顶着也有"人"在回,店主早上看已处理好的对话 | Otto 在 Conversation 里读 CustomerMessage 自动作答+写回联系人字段 | 曾批准(M-05,Otto 本体方向已部分具备) |
| 连续轮次+置信度双闸自动转人工(Message Threshold) | Qontak | AI 答不上就老实交给人,不硬撑装懂乱答 | 计数器+置信度双闸,超限直接冒泡通知店主 | 新增(Qontak §2.8/§5,比 respond.io 笼统的"低置信度转人工"更具体可原型化) |
| 三类人在环升级信号(负面情绪/能力边界/高授权请求) | Qontak Agentic AI | 客人明显生气或要求退款这种"大事",第一时间转真人不让 AI 瞎处理 | 情绪/关键词/动作类型三条规则,任一命中立即转人工+高亮通知 | 新增(Qontak §5) |
| AI 回复带出处/可溯源("这条引用了哪篇知识") | SleekFlow | 老板能一眼看出 AI 是不是瞎编的,放心让它继续答 | 每条 AI 回复旁附"依据:知识文件 X"标签 | 新增(SleekFlow §5 知识透明,respond.io/ManyChat/HubSpot 均未做到这层细度) |
| AI 客服上线前模拟对话沙盒(AI Playground) | ManyChat | 店主开 AI 客服前能先自己聊几句看它答得好不好,不是直接上线赌一把 | "和你的 AI 客服试聊"沙盒页,标注引用来源+知识缺口检测 | 新增(ManyChat §6,respond.io/HubSpot 均无此环节) |
| AI 客服护栏配置面(话题白名单+动作范围声明+审计日志) | Salesforce Agentforce Guardrails/Topics+Actions | 老板能限定"AI 只能聊订单/FAQ,不能乱承诺打折",出事还能查 AI 说了什么 | 一页"Otto 在客服里能做什么/不能做什么"开关列表+对话审计 log | 新增(Salesforce 机制,呼应 M-05 双模注但原稿未单独列成 UI 面) |

#### D. 坐席辅助(人工→辅助→全自动三档中间层)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 快捷话术库/宏(一键插入常用回复) | respond.io Snippets/Salesforce Macros/HubSpot | 重复问题一键发送,不用每次重打 | 话术库管理页+消息框插入按钮 | 曾批准(M-09) |
| AI 起草回复("帮我写")+ 一键改语气/翻译/纠错 | respond.io AI Prompts/Qontak Airene | 英马华混着讲的客人,店员不用自己现翻现改语气 | 消息框加"AI 帮我写/翻译/改语气"按钮,套用品牌语气 | 曾批准(M-09,细化) |
| 三档语气切换(随和/半正式/正式) | Qontak Airene | 同一句话面对熟客和陌生客人可换个口气,不用自己斟酌措辞 | 语气下拉选择器,套用到 AI 起草的回复上 | 新增(Qontak 独有具体机制) |
| 自动语言检测 + 理解口语/非正式表达(印尼语/马来语/Manglish) | Qontak Airene | 客人打字随意("bole x","dh siap ke")AI 也听得懂,不用只支持标准语法 | LLM prompt 层加 SEA 混语理解指令,设置页显示"支持语言" | 新增(Qontak 本地化亮点,直接对齐 SEA 定位) |
| 未答问题清单(Unanswered Questions List) | Qontak/ManyChat Knowledge gap | 店主一眼看到"AI 这周答不出的问题",点一下补进知识库,不用自己猜漏了什么 | "AI 答不上的问题"列表页,逐条"补进知识"按钮 | 新增(Qontak+ManyChat 双源印证,respond.io/HubSpot 未做成独立清单) |
| 自愈知识库/一键审批补丁(Self-healing KB) | SleekFlow | Otto 自己发现"这类问题我答得不好",打包成待审批建议,店主只需是非判断 | 每周产出知识库 diff,店主点 approve/reject | 新增(SleekFlow §5 核心机制,极符合"易管理"偏好) |

#### E. 增长钩子(Comment-to-DM)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| IG 评论/Reel 评论触发自动私信+公开回复 | ManyChat | "留言 LINK 拿链接"是直播/带货最常见玩法,自动把评论区的人接进私信卖货 | 挂在 ScheduledPost 上的"评论钩子"配置(关键词→私信内容) | 曾批准(M-04) |
| Story 回复/Story@提及/直播评论触发 DM | ManyChat | 粉丝在 Story 回应或直播刷评论,自动收到感谢/优惠券,不用店主盯直播打字 | 同上触发器扩展到 Story/直播事件类型 | 曾批准(M-04,细化) |
| Follow-to-DM / Share-to-DM(新关注/转发自动欢迎) | ManyChat | 新粉丝一关注就收到欢迎语+第一条优惠,拉新当天就能转化 | 关注/分享事件监听+自动 DM | 曾批准(M-04,细化) |
| Quick Automations(3 步预设,不进画布) | ManyChat | 90% 店主只要"评论关键词→发链接",不用学复杂流程搭建器 | 预设卡片(选帖子→选关键词→选回复),跳过完整 flow builder | 曾批准(M-04,原型做法采用 ManyChat"值得偷的设计"#1) |

#### F. 广告闭环(CTWA)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| Click-to-WhatsApp 广告进线自动打标来源 | respond.io/Qontak | 老板能看出"这单生意是哪条广告带来的",不用客人自己说 | Meta click ID 随进线消息一起存进 Conversation | 曾批准(M-08) |
| 聊天成交事件回传广告平台(CAPI/TikTok Lower Funnel) | respond.io/ManyChat | 广告平台学会"哪些对话最后真的成交",自动帮你多找像这些的客人 | Conversation 状态变"成交"时触发一次 CAPI 事件 | 曾批准(M-08,FIKIRTIVE 独有优势=投放端已握在手) |
| 互动人群回流成广告自定义受众(Retargeting 同步) | ManyChat Instagram Custom Audiences | 聊过天没买的人自动变成广告的"回头客"投放名单,不用手动导出导入 | Conversation 参与者按条件同步进 Meta Custom Audience | 曾批准(M-08 细化) |

#### G. 群发 / Broadcast

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 分群群发 + 失败重发 + 送达报表 | respond.io/ManyChat/Qontak/SleekFlow | 节日促销一次发给指定的一群客人,发不出去的自动重试 | Segment 选人→模板→排程→送达统计 | 曾批准(M-06) |
| 冷启动号码导入直接群发(无对话历史) | respond.io Import to Broadcast | 新号码手头有一批老客户名单,不用先等他们主动来聊才能群发 | 号码上传界面+直接进群发对象池 | 新增(respond.io 细节功能,未拆入 M-06 原文) |
| 群发后关键词跟进(Post-broadcast follow-up) | SleekFlow | 群发促销后客人回"要"就自动接上个性化跟进,不是发完就断头 | 群发回复关键词匹配→自动触发对应 flow | 新增(SleekFlow §5,respond.io/ManyChat/Qontak 均未做出这层联动) |
| 老客唤醒预置模板(沉睡客户自动提示) | Klaviyo Winback/respond.io | 三个月没回购的客人,系统自动提示"要不要发一条唤回消息" | 预置"沉睡客户"分群条件+唤回消息模板 | 曾批准(M-06/L-01 交界,细化) |

#### H. 会话状态 / 工单 / 满意度 / 绩效

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 轻量三态工单("处理中/待跟进/已解决")+ 超时冒泡提醒 | HubSpot/respond.io(Open/Close 替代) | 不会有客人的问题被忘记,超时没回自动提醒老板 | Conversation 加 status 字段+定时扫超时 | 曾批准(M-15) |
| 会话后满意度小问(emoji/1-5 分) | HubSpot CSAT | 老板知道客人对这次服务满不满意,不用猜 | 会话关闭时自动发一条满意度消息,结果挂联系人档案 | 曾批准(M-16) |
| 客服/AI 绩效小面板(响应率、解决率、Otto 答对多少) | respond.io/HubSpot/ManyChat | 老板一眼看"这个月 Otto 帮我挡了多少客人、答不上的有哪几类" | 并入现有 Analytics 页新增一节 | 曾批准(M-17) |
| 完整工单系统(队列/分派规则/升级规则/Case 对象) | Salesforce Case Management | 只有专职客服团队的商家才用得上"队列",普通老板不需要 | 若做,轻量 Conversation.status 升级为独立 Case 对象 | 曾判不要-成本性(M 遗漏检查#1:"以有客服部为前提",转正候选交 founder 复核) |
| SLA 目标+营业时间感知倒计时+条件化 SLA | HubSpot/Salesforce | 承诺过"多快回复"服务合同的商家才用得上正式 SLA | 若做,原型层=一条"X 分钟未回提醒"规则(已含 M-15 轻量版) | 曾判不要-成本性(与 M-15 价值重叠,完整版留候选) |
| 员工看不到客户真实号码(Mask Phone/Email 防飞单) | respond.io | 怕店员离职带走客户的老板,可以让店员只看到马赛克号码 | 会话窗对客户联系方式做遮罩显示 | 曾判不要-成本性(respond.io 原研究"现阶段 SMB 用不上",可转正候选留 Agency 楼层) |

#### I. 知识库 / AI 知识源

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 商家知识文件(FAQ/价目表当 AI 答复依据) | respond.io AI 知识源/Qontak 多源训练/HubSpot KB | 老板整理一次价目表/退换货政策,AI 永远照着答,不用每个新客服重新培训 | markdown 可读可改的知识文件夹,挂给 Otto 当 RAG 来源 | 曾批准(M-13) |
| 从历史对话自动起草知识库文章(KB Agent 反向回路) | HubSpot Breeze KB Agent | Otto 自己把答得好的对话整理成 FAQ,不用店主手写文档 | 定期扫描高频问答→生成待审批知识条目草稿 | 曾批准(N-24 已纳入,并入 M-13/O-04) |

#### J. 聊天内商务

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 商品目录卡片+聊天内加购物车 | respond.io Meta Catalog/SleekFlow/Qontak(Tokopedia/Shopee) | 客人问"有什么颜色"直接发商品卡,不用切出去发照片一张张介绍 | Conversation 消息类型扩展"商品卡",接 Meta Product Catalog | 曾批准(M-11) |
| 聊天内收款链接(不经 FIKIRTIVE 账户) | respond.io/GoHighLevel Text-2-Pay | 谈完价直接甩一条付款链接,客人点一下转账完成 | 消息里插入 Stripe/本地网关收款链接按钮 | 曾批准(M-11,红旗四已定调"跳商家自己账户") |
| 弃购挽回自动消息(加购未结账→提醒) | SleekFlow/Klaviyo Abandoned Cart | 客人问完价没下文,系统自动提醒一句,不用店主一个个追 | 加购事件+延时触发器→提醒消息 | 曾批准(M-11/L-01 交界,细化) |

#### K. 生命周期自动化(Klaviyo flows —— 本区核心)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性 | 原型层做法 | 旧判决状态 |
|---|---|---|---|---|
| 预建生命周期配方库(欢迎/弃购/购后/挽回/到货/降价) | Klaviyo Flows | 不用从零设计自动化,选"欢迎新客"配方点开关就上线,默认文案配好了 | 配方列表页(可读文件+开关),按行业预填触发条件与文案 | 曾批准(L-01) |
| 分群引擎(标签+简单条件组合) | Klaviyo Segmentation/HubSpot Lists | "找出 3 个月没回购的老客"这种需求变成可复用的名单 | 筛选条件编辑器+名单实时预览,存成 Segment 对象 | 曾批准(L-03) |
| 自然语言生成分群/一句话生成整套 campaign | Klaviyo Segments AI/Composer | 老板说"给流失客户做春节唤回",系统直接生成受众+文案+排期草稿 | Otto 读懂需求→生成分群条件+文案+排期,人审核后发布 | 曾批准(L-05,Otto 本体已具雏形) |
| 触发数据源接入(订单/行为事件) | Klaviyo(Shopify 等)/SEA 对应 Shopee-Lazada-TikTok Shop | 没有订单数据,"弃购提醒"这类最值钱的自动化就是空话 | 各平台连接器,把下单/加购/弃购写成触发事件 | 曾批准(L-07,SEA marketplace 是四家对手都吃不到的空位) |
| 客户打分:规则式加减分(热/温/冷) | HubSpot/GoHighLevel Lead Scoring | 不用猜哪个客人该优先跟进,行为一多分数自动涨 | 一张"行为→分值"规则表,分数变化触发提醒 | 曾批准(L-09) |
| 发送时刻/频率优化(静默时段+每周上限) | Klaviyo Personalized Send Time | 促销消息不会半夜轰炸客人,也不会一天发三次惹人反感 | 规则版:一个"安静时段"+"每周最多几条"设置项 | 曾批准(L-10,AI 个性化择时版留后续,规则版先行) |
| A/B 测试+自动放量给赢家 | Klaviyo/Salesforce Path Optimizer | 两版文案哪个更多人回,系统自动把剩下名单都发赢的那版 | 群发/Flow 节点支持两版本+自动判胜开关 | 曾批准(L-11) |
| 预测字段:CLV/流失风险/下次购买日 | Klaviyo predictive fields | 系统主动提醒"这 37 个客人快流失了,要不要发挽回" | 预测值写成联系人可筛选字段,达标触发建议动作 | 曾批准(L-12,需订单数据量,可先降级为简单 RFM 规则) |
| Consent/退订/勿扰字段(发送前强制过滤) | Klaviyo suppression | 客人说过"别再发促销给我",系统永远记得,不会惹恼客人被举报封号 | 联系人加 consent 字段,发送前 fail-closed 过滤 | 曾批准(L-14,已列入 GRILL-VERDICTS"可直接纳入 12 项") |
| 流程健康监控/异常报警(Flow Anomaly Detection) | Klaviyo | 装好的自动化"坏了"没人知道最亏,系统自己发现转化骤降/发送失败并报告 | Otto 巡检各 flow 表现,异常主动推送 | 曾批准(L-16) |
| 邮件通道(拖拽编辑器+模板,轻量) | Klaviyo/HubSpot | SEA 邮件文化弱但 B2B/服务型商家仍需要,渠道矩阵不留缺口 | 编辑器+模板库,发送走 Resend/SES 类 API 而非自建 deliverability | 曾批准(L-13,做多深留刻度决定) |
| 同行对标 Benchmark(匿名同行群组比较) | Klaviyo Peer Benchmarks | 老板最爱看"我跟同行比怎么样",一眼知道自己做得好不好 | 需跨租户数据池达到量,早期可用行业公开基准替代 | 新增(未拆入 L-01~16 任何簇,Klaviyo 研究§6 单独点名"值得偷") |
| 产品推荐/Next Best Product(购后 flow 插荐购) | Klaviyo | 客人买完 A,下一条消息自动被推荐"你可能也想要 B",客单价自然被抬高 | 消息模板里插商品推荐块,依赖商品目录+订单数据 | 曾批准(L-15,依赖 L-07 数据源先成立) |
| 客户自助门户(登录查订单/退货/订阅管理) | Klaviyo Customer Hub/Salesforce Portal/HubSpot Portal | SEA 客户习惯直接 WhatsApp 问"我的单到哪了",不习惯注册账号登录查询 | 若做,原型层=WhatsApp 内查询快捷指令,不建独立登录站 | 曾判不要-成本性(M/L 遗漏检查均已排除,ICP 行为特征驱动,维持排除但转正候选供复核) |
| Reviews 轻量版(自动请求评价+AI 回复评价) | Klaviyo Reviews | 好评能提升信任度,但完整套件(站内 widget+按订单量计费)对 SMB 过重 | 先做"下单后自动请评+AI 起草评价回复",不做完整站内展示套件 | 曾判不要-成本性(完整套件排除,轻量子集转正候选) |

<details>
<summary>排除清单 —— 12 项(点开展开)</summary>

| 功能 | 排除理由(违宪条款/原则性不要判决/对 ICP 明显无用) |
|---|---|
| Case Swarming with Slack(Salesforce:从个案一键开 Slack 频道拉专家协作) | 违宪条款——Blueprint 第八条 + O-13 判决:"Slack/Notion 类工作工具 connectors 不要"(SEA SMB 主场在 WhatsApp/Meta,不在欧美知识工作者工具),这是把 Slack 焊进核心客服协作流,直接撞线 |
| ManyChat 第三方 App Store / 认证 Experts 合作伙伴卖 white-label 模板包 | 违宪条款——G-14 判决:"白标永久不要"(founder:"平台不白标,Otto 永不改名换脸")+ 第八条"开放第三方 skill 生态永久不做" |
| Developer API / Webhooks 开放给外部系统程序化触发 workflow、写入数据(respond.io/HubSpot/SleekFlow 均有此产品线) | 违宪条款——O-14 判决:"对外 MCP/API 永久不做"(founder:"操作这座城的 agent 永远只有 Otto")。注:纯 inbound webhook(收 Meta/Stripe 事件)属蓝图第七条例外,继续做;本条排除的是"给外部系统一把能操作 FIKIRTIVE 的钥匙"那一类 |
| Breeze Intelligence 数据补全 / buyer intent 全网公司画像抓取(HubSpot Data Hub) | PDPA/爬取风险——未经同意抓取第三方个人/公司数据画像,直接撞"个人数据爬取"红线,且企业级投入巨大 |
| Sales GPS Tracking(Qontak 外勤地推实时定位) | 对 ICP 明显无用——FIKIRTIVE 是营销/客服 OS,用户不是有外勤地推团队的公司;这是另一个产品品类(销售运营/物流) |
| Customer Success Workspace / Health Scores / 续约管道(HubSpot,B2B SaaS 订阅续约专属) | 对 ICP 明显无用——面向"有 CSM 岗位、按年续约"的 B2B SaaS,SEA 零售/餐饮/服务 SMB 场景不存在 |
| Field Service 现场服务(Salesforce:work orders/派工甘特图/技师 App) | 对 ICP 明显无用——与营销/客服 OS 完全无关的独立产品线(现场维修/安装服务管理) |
| Entitlements / Service Contracts / Milestones 全套 B2B 合同型 SLA(Salesforce/HubSpot) | 对 ICP 明显无用——需要正式支持合同关系(账户/资产级权益),SMB 老板 + WhatsApp 没有这个概念;轻量对应物已作为候选保留(见候选表"SLA 目标"一行) |
| Omni-Channel 技能路由 / Omni Supervisor 监控台 / Workforce 排班预测(Salesforce/HubSpot 企业呼叫中心) | 对 ICP 明显无用——需要"客服部"编制才有意义,M 区遗漏检查已明文排除,轻量对应物已并入 M-10/M-15 候选 |
| Advanced KDP/CDP 数据仓库同步(Snowflake/BigQuery)+ custom objects(Klaviyo/HubSpot) | 对 ICP 明显无用 + 纯后端基建非原型层可体验功能——企业数据栈,SMB 的"CDP"就是一张干净的客户表(已在 CRM 区候选覆盖) |
| Service Cloud Voice 呼叫中心(Amazon Connect 集成) | 对 ICP 明显无用——SEA SMB 电话客服多用手机/WhatsApp 语音条,企业呼叫中心成本结构完全不适配;WhatsApp 语音已作候选(M-18)保留观察位 |
| SMS 渠道(ManyChat/Klaviyo 仅限美加英澳新爱) | 对 ICP 明显无用——马来西亚/东南亚发不了或没人看,已有 WhatsApp 承载同等价值(L-04/M-02),不重复建 |

</details>

---

## 三、create-factory(创作+工厂):Grok Imagine / Higgsfield / LTX Studio / Canva / Adobe GenStudio / invideo / Jasper / Artlist / Arcads(仅 benchmark-gap-scan 摘要级,未全量深研)/ MagicPath(⚠️无正式深研文档,见候选表首行说明)

### 候选(26 条)

> **MagicPath 缺口说明(先读)**:`docs/research/` 下没有 MagicPath 的深研文档(搜索 `docs/` 全库无命中)。它在任务里被点名是"设计画布手感"参照,但没有可引用的一手研究支撑具体功能点,不能像其余八家一样给出有据可查的候选项——**建议 founder 先决定是否要补一份 MagicPath 深研**,本表暂不替它编功能(避免编造)。下表其余候选均逐条可溯源到已读的深研文档。
>
> 说明:凡北极星审计/GRILL 已判"要"的簇(canvas branch/A-B、多 clip 拼长片、Speed/Quality 双档、Ad Reference 逆向、多机位出图、换脸换角、卡点模板、AI 配乐音效等)已在建/已排 Wave,不重复入表。下表只列**新增未判决**,或**曾判"以后/推迟"值得 v2 重新走一遍**的项。

| 功能 | 来自哪家龙头 | 对我们用户(不懂营销的SEA中小老板)的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| Money Shot 级产品保真商业片(先把产品从背景锁定成"资产",再合成场景/运镜,logo 和文字不走样) | invideo | 老板最怕 AI 把自家包装/招牌字体画歪——这条直接保真,店主敢放心投广告 | 上传 4-8 张实拍产品图 → 选一个商业风格(奢华/美食/户外等)→ 出 25-30 秒多镜头成片,画面里的产品和 logo 与实拍一致 | 新增 |
| 局部/对话式改片(选中一段几秒重生成,或直接说"把开头剪短""换成咖啡馆场景",不用整条重出) | LTX Studio(Retake)+ invideo(Magic Box) | 价格改了/念错一句话,不用整条广告重花钱重录,只改坏的那几秒 | 时间轴上圈一段 2-16 秒说要改哪里,或打字下指令,系统只重跑这一小段并保持前后衔接 | 新增 |
| 编辑工具箱(局部内补/扩图/重打光/放大清晰度/去背景),独立于整图重新生成 | Higgsfield(Apps)+ Jasper(Image Suite) | 图基本满意只是背景乱/有杂物/暗了一点,不用花钱重生成整张 | 生成完的图上圈选要改的一小块,单独修,不动其余部分,通常比重生成便宜 | 新增 |
| 结构化镜头控制(机位/景别/运镜做成下拉预设可叠加,运镜库从现有几个扩到几十个) | LTX Studio + Higgsfield(Camera Controls 65 个) | 老板不懂"推轨镜头""无人机航拍"这些术语,点一下预设就能出"看起来很贵"的画面 | 每个镜头旁边加"运镜/景别"选择器,选完自动拼进生成 prompt,不用打字描述镜头语言 | 新增 |
| 剧本/文案文件导入 + 场景→镜头两层结构(上传已写好的文案/脚本自动拆场景拆镜头) | LTX Studio | 已经自己写好促销文案或朋友帮忙写了脚本的商家,不用从头跟 Otto 对话重新讲一遍 | 上传一个文本文件,Otto 自动拆成"第几场景、场景里几个镜头"给用户确认,再逐镜头出图 | 新增 |
| 动态分镜预览(先出低成本的运镜排布粗看,确认节奏对了再花钱出正式高清视频) | LTX Studio(animatics) | 省钱漏斗:便宜的粗览先看顺不顺,不满意改完再烧贵的视频 credits | 分镜卡先合成一段简易动态预览(不是最终画质),用户点头后才触发正式视频生成 | 新增 |
| 表格式批量生产(行 = 商品/输入,列 = 生成任务如"文案""图片""翻译",一次批量跑一批 SKU) | Jasper(Grid)+ Canva(Bulk Create) | Shopee/Lazada 上有几十个 SKU 的卖家,不用一个一个商品单独跟 Otto 讲一遍 | 贴商品表(或选多个已建档 Product)→ 勾选要跑哪些生成任务(描述/图片/多语翻译)→ 一次批量出,批量确认页显示总价 | 新增(与已批 A2"矩阵批量"是不同维度:A2 是单条 brief 出多平台多尺寸多钩子,这个是多商品/多行数据批量) |
| 品牌语气逆推(上传几篇店主自己写过的文字,AI 自动学语气,不用填表描述抽象风格) | Jasper(Brand Voice) | 老板说不清自己"语气"是什么,但能随手转发几条自己发过的朋友圈/客服回复当样本 | 上传最多几篇文本样本 → Otto 分析生成一个"品牌语气"档案,以后生成文案自动带上 | 新增 |
| 知识库引用防瞎编(上传价格单/产品规格文档,生成文案时引用真实数字,不让 AI 编价格/规格) | Jasper(Knowledge Base) | 防止 AI 生成的广告文案写错价格或规格,老板不用每次都自己校对数字 | 上传定价单/规格表当"事实来源",Otto 生成涉及价格/规格的文案时必须从这份文件取数,不凭空编 | 新增 |
| 受众画像一键改写(定义几类客群,同一条素材按客群自动换措辞) | Jasper(Audiences) | 同一个促销想同时打"学生党"和"上班族"两群人,不用分别从头讲两遍需求 | 定义几个客群标签(如"预算敏感/追新品"),对已生成的文案点"换成给这个客群看的版本" | 新增 |
| 生成前品牌校验(免费不耗 credits;检测颜色/语气/logo 是否跑偏,给出合规替换建议) | Adobe GenStudio(brand validation)+ Jasper(Style Guide) | 老板花钱生成前先免费看一眼"这个符不符合我的品牌",省下改稿重跑的钱 | 生成结果先跑一遍品牌规则检查(不耗 credits),不符合的地方标红并给"改成这样更合品牌"的一键建议 | 新增 |
| 网站/IG 主页一键建品牌档案(贴 URL 自动抓调性/色板/态度,不止抓产品信息) | Adobe GenStudio(Add from URL) | 已有 Product 建档 URL 抓取(名称/图/描述),但"品牌"档案(整体调性/常用色)还要老板从头填;贴自己官网/IG 主页就能起个草稿 | 贴一个已发布的网站或 IG 主页链接,自动抽取品牌信号(常用色/语气/视觉风格)生成品牌档案草稿,老板确认即可 | 新增 |
| 整版广告一体化产出(图 + 标题文案 + CTA 按钮 + logo 自动排版成一张能直接投放的成品,不是只出裸图) | Adobe GenStudio(Create Canvas) | 现在出的是素材图,老板还得自己在别的工具加文字排版才能投放;这个直接出"能投的广告" | 生成时同步产出图 + 文案 + CTA 按钮 + logo 的排版成品,一次出就是可投放的广告版式,不只是背景图 | 新增 |
| 项目资产板(一个 campaign 的所有素材聚一块,AI 提示"还缺什么",生成免账号分享链接收店员/朋友反馈) | Artlist(Artboards) | 一次促销活动的图/视频/文案散落在各处不好找;分享链接给店员看一眼不用他也开账号 | 把同一个 campaign 的产出自动归到一块"板"上,AI 提示"这个板还缺一张竖版图",生成一个免登录的分享链接给人看和留言 | 新增 |
| 发布前双重体检(爆款潜力评分预判 hook 好不好 + 相似度/侵权风险检测) | Higgsfield(Virality Predictor / Similarity Score) | 发之前先知道"这条大概率没人看"或"这张图撞了别人的设计",比发出去才发现好 | 生成后跑一次 LLM 打分:hook 强不强(预测互动潜力)+ 跟已知素材像不像(降低抄袭/侵权风险),给出提示 | 新增 |
| 拍法模式库扩容(教程风/测评风/虚拟试穿/广播级 TV Spot/AI 全权导演 Wild Card) | Higgsfield(Marketing Studio 10 模式) | 现在批的是 3+2 种拍法(展示/开箱/促销卡点 + 2 种口播),商家想要"教程演示怎么用"或"顾客测评风"这类更多花样 | 在已批的模式基础上扩充更多现成拍法,选一个模式 = 自动带一套运镜+节奏预设,不用自己描述 | 新增(在已批 Wave1 三模式 + Wave2 两 UGC 模式基础上扩充数量) |
| SEA 本地热梗/趋势模板(蹭 TikTok 本地流行梗的一键模板) | Higgsfield(Apps 热梗模板) | SEA 年轻客群刷 TikTok 认梗,蹭对梗的内容天然更容易被看到 | 定期上新几个当下本地流行的短视频梗模板,选一个 + 换成自己产品即可出片 | 新增(需持续养库,标注运营成本) |
| 本地场景启动模板(开斋节促销、mamak 菜单等马来西亚特定商业时刻的起手式) | Canva(建议的垂直薄模板层) | 每年固定几个大促节点(开斋节/双十一等),老板不想每次从零想创意,想要一个"往年这个节点大家都这么打"的起手式 | 按马来西亚商业日历预置几个应景的起手模板(节庆配色+常见促销话术骨架),选了就能改成自己的 | 新增(建议薄层,不追 Canva 数十万模板规模) |
| 视频级参考生成(上传一条参考视频控制运镜/节奏,不只是参考图) | Grok Imagine(reference-video conditioning) | 看到一条别人拍得好的广告,想要"照这个运镜节奏拍我的产品",而不是只能给参考图 | 上传一条参考视频,生成时参考它的镜头运动和节奏,而非只匹配画面风格 | 新增 |
| 完整流程模板(选一个模板 = 直接跑完 brief 到成片全流程,不只是给素材起点) | Grok Imagine(Workflow templates 如 UGC Product Stories/Brand Identity) | 老板不想一步步跟 Otto 对话,想选一个"帮我出条带货短片"直接从头跑到尾交成片 | 选一个"目标模板"(如"产品带货短片"),Otto 自动依次完成拆解需求→生成→拼接→交付,不用每步都人工确认 | 新增 |
| 交付授权/使用声明凭证(小代理/自由职业者给客户交付时,附一张"这是 AI 生成、可这样用"的 PDF 凭证) | Artlist(License Certificate) | SEA 接单帮别人做广告的小代理/自由职业者,交付时给客户一份"这个素材你能这样用"的凭证增加信任 | 生成资产可一键导出一张说明 PDF(生成方式/交付范围),作为交付附件 | 新增 |
| 用户自建 + 可分享创作模板(把自己调好的一套参数存成模板,分享给别人用) | Grok Imagine(Custom templates) | 老板把自己调顺的一套拍法存下来,下次直接用,或分享给同行/加盟店用 | 把一次成功的生成设置(prompt+参考图+风格)存成"我的模板",可复用也可生成分享链接 | 曾判以后(北极星 N-08,founder 2026-07-03 判"以后") |
| 音频驱动生成(上传一段配音/音乐,视频节奏/口型/运镜跟着音频走) | LTX Studio(Audio-to-Video) | 已经录好语音广告/有现成配乐的商家,直接变视频,不用重新对口型 | 上传音频文件,生成的视频画面运动和转场按音频节奏对齐 | 曾判以后(北极星 N-09,判"推迟,未来加模型时并入") |
| 视频硬字幕烧录(字幕直接烧进画面,不用二次用剪辑软件加字幕) | LTX Studio | 很多商家发布前还要另外找工具加字幕,这条省一步 | 生成时可选"字幕直接烧录进画面",出片即带字幕,不用再导出去別的软件加工 | 曾判以后(北极星 N-10,判"推迟,未来加模型时并入") |
| 免费/低门槛素材库与海量现成模板(降低起手门槛,建议轻量接第三方素材源而非自建) | invideo(Templates 10,000+ / Stock 库) | 完全没有素材、连产品图都没拍好的商家,能先用现成素材/模板顶上再逐步换成自己的 | 接入第三方免版权素材源(而非自建版权库),生成时可选"先用素材图占位" | 新增(研究文档本身建议谨慎——自建模板库是 invideo 的规模化打法,和 FIKIRTIVE"靠 Otto 生成而非模板库堆量"的既定差异化方向有张力,标注给 founder 权衡,非技术/成本硬卡点) |
| 多语言口播配音扩展到 175+ 语言(现有 Wave2 门槛是 EN/BM/中三语) | LTX Studio(AI Dubbing) | 已批的三语覆盖 SEA 主力市场;但接海外订单或少数语言客群的商家,可能需要更广语言覆盖 | 在 Wave2 已选定的口播供应商基础上,评估是否开放更多语言选项(不改变三语默认,只是可选范围更广) | 新增(与 Wave2 已批范围部分重叠,标注为"扩展候选"而非平行新功能) |

<details>
<summary>排除清单 —— 12 项(点开展开)</summary>

| 功能 | 排除理由(违宪条款/原则性不要判决/对ICP明显无用) |
|---|---|
| 对外开放 Cloud API / 自带 MCP 端点让外部 agent(Claude/Cursor/ChatGPT 等)直接操作生成能力(Grok 自带 MCP server + X hosted MCP;Higgsfield Cloud API + MCP + CLI;Jasper MCP) | 违宪条款:第八条"对外 MCP/API 让外部 agent 操作 FIKIRTIVE"永久不做 + O-14 已拍板"不要(永久)"("如果会用其他 LLM,代表我们的 Otto harness 不够好") |
| 工作工具 Connectors(Slack/Notion/Gmail/Drive/SharePoint/Figma 等,Higgsfield 30+ connectors、Jasper 16 个企业集成、Canva AI 2.0 六大工作流之一) | 违宪条款:第八条"Slack/Notion 类工作工具 connectors"+ O-13 已拍板不要(SEA SMB 主场在 WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具) |
| 开放第三方生态 / 用户 no-code 自建 agent(Jasper Studio 无代码 Agent Builder + App Library;Canva Apps Marketplace 300+ 第三方应用 + Connect API + $50M 开发者基金) | 违宪条款:第八条"开放第三方 skill 生态"永久不做 + O-11 已拍板"skill 永久 BELCORT 内部编写" |
| "AI Employees"预置多员工人设包装(Higgsfield 把 skill 集包装成 Cartoon Animator/Motion Designer 等独立"员工"形象) | 原则性不要(已有宪法依据):宪法第 3 条铁律⑤"One Otto——新能力永远=新 skill,不是新 app";FIKIRTIVE 是"一个雇员多技能",不做多个具名 agent 人设的产品叙事 |
| Unlimited 类无限生成钩子(Higgsfield Seedance Unlimited add-on / Ultra 年付 365 天 unlimited pass) | 违宪条款:第五条"永久禁止任何 unlimited 类报价"+ G-05b 已拍板"永久不要"(agent 自动化会把 unlimited 变成本敞口) |
| Grok Build(终端/IDE coding agent,含 Parallel Agents/Arena Mode) | 违宪条款:第八条"Build 终端 coding agent"永久不做;Grok 研究报告本身也标注"我们拍了不要" |
| Spicy/成人向生成模式(Grok Imagine Spicy mode,年龄验证限定) | 违宪条款:第八条"Spicy/18+ NSFW"永久不做 |
| Artlist 版权素材分销库本体(音乐/SFX/8K stock footage 授权曲库业务) | 业务模式不符,非成本原因:这是"授权别人版权素材再分销"的业务,和 FIKIRTIVE"生成用户自有产出"的产品定位根本不同;原研究文档已明确判"不要" |
| 专业剪辑软件插件与 NLE 时间线交接(Higgsfield Adobe Plugin 上 Premiere/After Effects;LTX Studio XML 导出对接专业剪辑软件;Jasper/Artlist 各类桌面编辑器扩展) | 对 ICP 明显无用:目标用户是不懂营销、更不会打开 Premiere 的 SEA 中小老板,专业后期工作流不在原型层体验范围内 |
| 物理印刷电商履约(Canva Print/Print Shop——名片/传单/请柬等实体印刷发货) | 对 ICP 明显无用:需要物流履约整合,超出"内容生成"原型层范围;原研究文档已判"建议不要自营" |
| 企业级 AI 搜索可见性监控(Jasper GEO Hub/GEO Agent,监控品牌在 ChatGPT 等 AI 平台的引用率/声量评分)+ 电影级专业摄影控制(Higgsfield Cinema Studio 的 ARRI/IMAX 机身、变形镜头、16-bit 色深) | 对 ICP 明显无用:SEA 中小商家没有"AI 搜索品牌声量"焦虑,也看不懂/用不到专业电影摄影参数,原研究均标注"企业级虚胖" |
| 企业级团队治理套装(SSO/SCIM/审计日志/Role-Based Permissions,在 Jasper/Canva/Artlist/LTX 的团队协作功能里反复出现) | 对 ICP 明显无用:企业 IT 合规需求,超出 create-factory 原型层体验范围(团队协作/审批流本身已由 G-11 走独立设计,不在本区重复评估) |

</details>

---

## 四、schedule-social(排期发布 + 社媒管理:Buffer / Metricool / Canva Content Planner 全量扫描)

**扫描范围**:docs/research/2026-07-03-buffer.md、2026-07-03-metricool.md、2026-07-03-canva.md 全文 + GRILL-VERDICTS-2026-07-03.md(S 区/N 项/12 项已纳入清单)+ GRILL-WORKSHEET S-01~S-15 工作表 + BLUEPRINT.md 城市宪法(尤其第 8 条)+ 排期区现状 spec(docs/superpowers/specs/2026-07-03-schedule-uifirst-slice-design.md,确认"UI-first slice 1"已建成什么)。

**关键发现(先说清楚,免得候选表看着像重新拍板)**:
1. S-01~S-15(排期发布区 15 个功能簇)在 2026-07-03「七区默认判决全数通过」里**已经整簇判过"要"**,不是待拍板项。但"簇级要"≠"已建":对照现状 spec,目前只上线了 slice 1 ——日历 3 视图骨架 + 单渠道 composer(账号/媒体/时区/首评)+ 数据模型,S-01/S-02/S-04/S-06/S-07/S-08/S-10/S-11/S-12/S-13/S-15 底下的具体子功能点(槽位配置、逐平台定制、hashtag组、提醒式发布、常青循环、九宫格预览、审批tab、批量导入、UTM标签……)**从未被单独列成候选行拍过板**,只活在簇描述的一句话里。本表把这些拆成具体功能点,交给 founder 走一遍决定原型层现在建多细——这才是 v2"原型层默认全做"要落地的东西。
2. 真正"从未有过判决、悬空待拍"的只有一项:**Link-in-bio 微站**(Buffer Start Page / Metricool SmartLinks)—— 两份研究都明确标"存疑",从未进过 GRILL 拍板,是本表唯一严格意义上的"新增"悬空候选。
3. 没有找到属于本区、且状态为"曾判以后"或"曾判不要-成本原因"的项——S 区遗漏检查里的排除全部是原则性/地域适配理由(Streaks、RSS博客分发),已归入排除清单,不重新拿出来议。
4. 已排除掉不属于本区的相邻区候选(Buffer公开评论收件箱→自动回复区、Metricool Campaign Dashboard/竞品对标/Hashtag Tracker/Reports→分析区或Campaign区、Ads报表→Campaign管理区、Inbox→CRM区)——这些各自的判决已封卷或归属别区,本表不重复列,避免越区抢答。
5. Buffer「Ideas 内容孵化管道」不在两张表里:已有明确判决(不建Buffer式独立产品,Otto做捕获+生成+一张极轻想法清单),是「已定案的缩小方案」,既非候选也非排除,故不重复出现。
6. 按提示核对了 MagicPath / origami / plane / arcads / Kalodata:均与创作画布手感或 TikTok Shop 数据相关,不落在 Buffer/Metricool/Canva 排期发布这个zone范围内,未强行塞入本表。

### 候选(14 条)

| 功能(具体点) | 来自哪家龙头 | 对SEA中小老板的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 队列槽位配置(Posting Slots:每渠道每周设几个固定发帖时段) | Buffer(Queue核心心智,20年不倒) | 老板一周设一次"周几几点发",以后素材往队列一丢自动对号入座,不用每条现挑时间 | Schedule页加"槽位设置"面板;队列视图新帖默认落进下一个空槽,可拖拽调整、可隐藏空槽 | 新增(S-02已批为簇,槽位这个具体机制从未单独候选化) |
| All Channels总览视图 + 队列拖拽重排序(move to top/bottom) | Buffer(2025新增) | 一眼看清所有渠道混排的发布计划,插队紧急促销帖不用删了重排 | 队列列表加拖拽排序按钮;日历/队列顶部加"全部渠道"聚合视图与多选过滤 | 新增(S-01/S-02已批为簇,细化未建) |
| 一稿多发 + 逐平台定制 + Channel Groups(常用频道组合一键选) | Buffer + Metricool(Free起) | 同一条促销要发FB+IG+TikTok,写一次稿,每个平台还能各自微调文案,不用重写三遍也不显得像机器人群发 | Composer支持多渠道勾选→每渠道一个tab可单独改文案/媒体;存"常用组合"一键复选 | 新增(S-04已批为簇,当前Composer仅单渠道,细化未建) |
| Hashtag组管理(存组、一键插入caption或首评) | Buffer(Hashtag Manager) | MY商家hashtag用量大,存好几组常用标签,发帖时一键插,不用每次现打现凑 | Composer加"Hashtag组"选择器(建组/存组/插入按钮) | 新增(S-06已批为簇;首评字段已建,hashtag组子功能未建) |
| 提醒式发布降级(Notification Publishing) | Buffer(独有) | IG个人号/还没过审的渠道也能先用起来——到点收手机/站内提醒,内容已备好一键复制贴上发,不是"完全不支持" | ScheduledPost的publishMode=REMINDER分支加到点提醒卡 +"标记已手动发布"按钮 | 新增(S-07已批为簇;当前正卡Meta App Review,是最直接的过渡方案) |
| 最佳发帖时间建议 + 冷启动行业默认时段表 | Metricool(Free起,叠加显示在日历上) | 店主最常问"几点发比较多人看";新账号没数据也能先给个靠谱的行业默认建议,不是空白 | 日历/composer里给推荐时段打光角标;后台维一张可配置的行业默认时段表(按行业/地区)兜底冷启动 | 新增(S-05已批为簇;"冷启动种子表"已在founder"可直接纳入12项"确认要做,具体子功能未建) |
| IG九宫格预览(Grid Preview) + Alt text(无障碍图片描述) | Buffer(2025全档位) + Metricool(Free起) | 做视觉生意(餐饮/美容/服饰)的老板在乎IG主页排面好不好看;发之前先看一眼九宫格效果,顺手加个图片描述 | Composer/日历加"IG网格预览"弹窗(待发帖插进最近9张已发帖模拟排列);媒体上传处加alt text输入框 | 新增(S-10已批为簇,细化未建) |
| 常青内容循环(Autolists/Evergreen Recycling) | Metricool(付费档) | SMB最大的痛不是"怎么排"而是"没东西发";把营业时间/招牌菜/客户好评这类常青内容放进循环清单,隔一段时间自动重发,3条素材撑一个月 | 新建"循环清单"对象,设循环节奏;排期时从清单自动挑一条填入空档,配合创作区变体生成防止机器人感 | 新增(S-08已批为簇,细化未建) |
| 草稿→请求审批 UI(Drafts & Approvals tab) | Buffer(Team档) + Metricool(Advanced档) | 请了兼职/代运营的店主,让员工只能建草稿、老板一键批准或打回留言,不用靠WhatsApp传图口头确认 | 补一个"审批"tab:列待批草稿+批准/打回按钮+留言;权限挂团队协作(G-11) | 新增(S-13已批为簇;Otto侧plan-approval理念已有,排期区人对人审批UI未建) |
| 批量导入排期(Bulk CSV Import) | Buffer(一次100帖) + Metricool(Autolists CSV/RSS) | 想一次性把整月促销表倒进排期(比如换季大促),不想一条条点;更适合请了agency或做月度计划的店主 | Schedule页加"批量导入"入口:上传CSV(日期/渠道/文案/媒体引用)→预览校验→批量转DRAFT;同时标注Otto对话式"帮我排30条"是替代路径 | 新增(S-15已批为簇,细化未建;宪法"每层楼可手动"下仍需决定手动版做多细) |
| 内容标签 + UTM追踪(轻量Tags,不建重型Campaign实体) | Buffer(Tags+Tag pulse) + Metricool(URL generator) | 想知道"这波促销发的帖到底有没有带来生意",不用建一个重的Campaign对象,先打个标签、链接自动带追踪参数就够用 | 发帖composer加Tag输入(自由文字/预设);排期链接自动生成UTM参数 | 新增(S-12已批为簇,细化未建;与Campaign管理区的重实体互补) |
| Link-in-bio微站(菜单/WhatsApp按钮/最新帖feed + 点击统计) | Buffer(Start Page,免费档) + Metricool(SmartLinks) | 大量MY商家没有官网,IG bio里那一条链接就是全部流量出口;一个免代码小落地页直接当"官网"用 | 独立轻量页面(品牌色+按钮列表+点击计数);Otto可按品牌记忆自动生成/更新(新品上架自动挂上) | **新增(真悬空)——两份研究均标"存疑",从未进入任何一轮GRILL拍板,不属于"以后"也不属于"成本不要"** |
| 排期流内素材裁剪/换尺寸 + 相邻帖网格连续性校验 | Metricool(内置图/视频编辑器) + Buffer(取图集成) | 排期时不用跳出app改图——简单裁剪配平台尺寸、看一眼这条帖跟前后帖搭不搭 | Composer媒体选择器旁加轻量裁剪/换尺寸操作(复用创作区一稿多尺寸能力),不做重型图片编辑器 | 新增(S-11已批为簇;FIKIRTIVE"素材自产"是结构性优势,细化未建) |
| 排期区内嵌轻量表现小结(已发帖卡片上直接叠加reach/互动小字) | Buffer(频道+帖子级分析) + Metricool(全网络Analytics) | 店主发完帖想马上知道"这条火不火",不想切换到另一个分析页面才看得到 | 已发布帖卡片加一行小字读同一份数据源展示,不重建管线;深度报表仍留在分析区 | 新增(轻量嵌入型,数据源分析区已有,排期区首次作为展示面提出) |

<details>
<summary>排除清单 —— 9 项(点开展开)</summary>

| 功能 | 排除理由(违宪条款/原则性不要判决/对ICP明显无用) |
|---|---|
| Streaks / Posting Goals(连更打卡 + 周目标进度环) | GM-01已明判"不要"(minimal gamification宪法卷,2026-07-03封卷);S区遗漏检查①"刻意排除"——与"Otto替你发"的叙事互相矛盾(打卡打给谁看) |
| RSS灵感流 / 博客→社媒自动分发(Buffer Feeds、类HubSpot blog auto-distribute) | S区遗漏检查②"刻意排除":前提是客户有内容型博客/网站,SEA SMB极少见,对ICP明显无用;RSS收集侧被判归创作区Ideas管道也未采纳(已判"不建Buffer式产品") |
| Mastodon / Bluesky等欧美长尾频道排期 | buffer.md候选映射明示"建议不要(SEA无需求)"——对ICP明显无用,渠道广度不如本地深度(WhatsApp/LINE/TikTok Shop才是真缺口) |
| 公开开发者API(Buffer GraphQL API全档开放、Metricool API/Zapier/Make/Looker Studio connector) | 违宪:第8条"对外MCP/API让外部agent操作FIKIRTIVE"永久不做 + O-14判决"不要(永久)"(founder:"如果会用其他LLM,代表我们的Otto harness不够好") |
| Metricool MCP server(排期/分析操作面交给Claude/Cursor/n8n) | 违宪:第8条 + O-14同上——操作这座城的agent永远只有Otto,不留任何"借来的agent"逃生口 |
| Canva AI 2.0 Connectors(Slack/Gmail/Drive/Notion/HubSpot/Atlassian/Linear) | 违宪:第8条明文排除"Slack/Notion类工作工具connectors" + O-13已判"不要"(SEA SMB主场在WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具) |
| 白标(White Label:Metricool Custom档 / Buffer旧Agency档隐含) | 违宪:第8条明文"白标永不做" + G-14判决"永久不要"(founder:"我要的就是FIKIRTIVE变成世界级别的平台"——Otto永不改名换脸) |
| Metricool Studio自然语言报告的"实时更新live-URL对外分享" | 已判"不要(重叠)"(北极星未捕获feature审计,GRILL-VERDICTS 2026-07-03)——与既有分享链接机制(A-06)重叠,非成本原因,维持排除 |
| Hashtag Tracker按天道具计费(€25/天/网络) | 已判"不要(重叠)"(同上审计);且本质是定价机制不是排期功能,G-08 Add-on轴另判"以后",不落在本zone候选范围 |

</details>

---

## 五、campaign-ads(Campaign+广告:SF Campaign 体系 + HubSpot campaigns/marketing + GoHighLevel + Meta 侧 meta-blueprint + Kalodata 结论)

已核对来源:docs/research/2026-07-03-salesforce-marketing.md、2026-07-03-hubspot-marketing.md、2026-07-03-gohighlevel.md、2026-07-03-campaign-management-cross.md、2026-07-03-meta-blueprint-expertise-sources.md、docs/research/GRILL-VERDICTS-2026-07-03.md、docs/research/2026-07-03-northstar-feature-capture-audit.md(N-21)、docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md(Kalodata/Virlo/Symphony 对标结论已在此spec)、docs/BLUEPRINT.md 宪法第8条。

已排查但与本区无关联/未发现命中:MagicPath(全库无文档提及)、origami/plane(全库仅见 origami 用于 Otto 对话计费原则讨论,与 campaign 功能无关)、arcads(仅见于创作区 UGC 广告生成对标,非本区)。

已建/已定调不再重复列为候选(供参照,不占候选表位置):Campaign 最薄容器对象(harmony-01 §三#11,P3完全体/最薄版可提前)、Otto Campaign 提案卡+日历工作台+TrendSnapshot(2026-07-08 spec 第一期在途)、Meta ads 读(insights/逐条ad表现+创意诊断,#128 已通电)、Meta ads 建/写(PAUSED campaign 草稿/预算调整,已建成断电等 App Review 钥匙)、Meta custom audience 写入工具面(已具备)、独立 Campaign 对象不升格 project(红旗六)。

### 候选(27 条)

| 功能 | 来自哪家龙头 | 对我们用户(不懂营销的SEA中小老板)的实用性一句话 | 原型层做法一句话 | 旧判决状态(新增/曾判以后/曾判不要但属成本原因) |
|---|---|---|---|---|
| 1. Campaign 资产伞(一个campaign挂帖子/广告/图/视频) | HubSpot Campaigns 对象模型 | "这次店庆做的所有图、帖子、广告放一个文件夹装着,不用东找西找" | Campaign 详情页"关联资产"区,勾选已生成内容/排期帖/Meta广告挂进当前campaign(可空外键,harmony-01已留缝) | 新增 |
| 2. Campaign 预算/花费追踪(生成成本+广告花费两列) | Salesforce Campaign / HubSpot Budget items | "这档活动我花了多少(做图+投广告),一个数字看懂" | Campaign页显示"预算上限/已花credits/已花广告费"三条数字 | 新增 |
| 3. Campaign ROI 一行结论(花费vs归因收入vsROI%) | Salesforce ROI Analysis Report / HubSpot ROI report | "这次活动到底赚不赚钱,一眼看懂" | Campaign卡片一行:"花了RM500,赚回RM1,200,ROI 140%"(只用平台自身insight,不做website tracking) | 新增 |
| 4. Campaign 目标进度条(询盘/单量/花费上限,设1-3个数字) | Salesforce/HubSpot Campaign Goals | "老板设个'这次要来50个询盘',进度条天天看得到" | Campaign卡片一条进度条+百分比 | 新增(呼应GM-03已判"要",原型层UI待建) |
| 5. Campaign 日历(campaign+排期帖+任务同屏) | HubSpot Marketing Calendar | "所有活动、发帖计划摆一个月历,不用切页面对时间" | 排期区月历view叠加campaign起止条 | 新增(需与既有排期3视图划界,存疑待founder) |
| 6. Campaign 模板/一键复制上次活动 | Salesforce Deep Clone / HubSpot Campaign Templates | "去年开斋节那档活动照抄一次,不用重新想" | "另存为模板"+"从模板新建campaign"两个按钮 | 新增(SMB高频、实现薄) |
| 7. SEA节庆日历预置Campaign模板(开斋节/CNY/双十一/双旦) | 综合GHL Snapshots+HubSpot模板+SEA本地洞察 | "系统提前提醒'开斋节要到了,要不要现在开始筹备'" | Campaign列表页"即将到来的节庆"卡片,一键套用模板建campaign | 新增(呼应GRILL-VERDICTS"冷启动时段种子表"可纳入项) |
| 8. Campaign 首触归因(客户是被哪档campaign带进来的) | Salesforce Campaign Influence(N-21) | "这个新客户是从哪次活动来的,一眼看到" | 联系人详情页显示"首次接触:XX活动"(单字段,不做多触点模型) | 曾判不要但属成本原因(2026-07-03判"太深奥",此为成本性/深度问题非原则性排除) |
| 9. Campaign 内容审批(小编做→老板批→才发布) | Salesforce Approval Processes / HubSpot Content approvals | "员工排的帖子/广告,老板一键批准才真的发出去" | Campaign页"待审批"标签+批准/打回,复用既有Otto计划审批机制 | 新增(呼应G-11/O-13已判"团队协作+审批要",campaign场景UI待建) |
| 10. Campaign 对比表(2-3档活动花费/询盘/ROI并排) | HubSpot Campaign Comparison | "这次跟上次哪个活动更划算,摆一起比" | 简单表格勾选2-3个campaign并排展示 | 新增 |
| 11. Campaign 层级(年度主题→单档活动,2层封顶) | Salesforce Campaign Hierarchy(简化) | "'2026全年促销计划'底下挂着'开斋节''双十一'几个子活动" | Campaign可选"归到哪个大主题"下拉,2层封顶 | 新增(研究文档倾向"最多2层",非正式founder判决,重列候选) |
| 12. 沉睡客户唤醒模板(Database Reactivation一键群发) | GoHighLevel | "好久没光顾的老客户,一键发条'我们想你了'消息" | Campaign模板库预置"沉睡客户唤醒",填个折扣一键套用 | 新增 |
| 13. UTM自动生成+追踪链接生成器 | HubSpot Tracking URLs | "分享出去的链接自动带标记,知道哪条广告/帖子带来多少人点" | 每条分享链接自动加utm_campaign参数,一键复制;先做"生成"不做"回传报表"(依赖客户网站/GA) | 新增(价值兑现依赖客户侧追踪,存疑待founder) |
| 14. Campaign参与/回应标记(联系人标"参与过某活动"+"是否回应") | Salesforce Campaign Members | "这次活动到底哪些客户被打动了、回了消息" | CRM联系人卡片小标签"参与:开斋节活动"(与CRM区联动) | 新增 |
| 15. Meta Lead Ads 实时回传CRM | Salesforce Lead Capture / HubSpot Ads lead sync | "广告表单一填,人马上进你的客户名单,不用手动导出Excel" | webhook接Lead Ads→自动建CRM联系人+标记来源campaign | 新增(获客闭环高价值) |
| 16. Advantage+ 预算自动分配开关 | Meta Ads Manager(meta-blueprint) | "不用自己猜每组广告该分多少钱,让Meta自动省着花" | 建campaign时一个开关"自动优化预算(推荐)" | 新增 |
| 17. Advantage+ 受众自动扩量开关 | Meta Ads Manager(meta-blueprint) | "不用自己选一堆兴趣标签,让Meta自动找像你客户的人" | 广告受众设置页一个开关"自动扩大受众(推荐)" | 新增 |
| 18. Lookalike 相似受众一键生成 | Meta Ads Manager / Salesforce Advertising Audiences | "拿你现有客户名单,一键找'很像他们'的新客户投广告" | "从我的客户名单建相似受众"按钮,接已有custom audience工具面 | 新增 |
| 19. 广告A/B测试(两版素材对照,自动判胜) | Meta/Salesforce/HubSpot A/B testing | "两张海报哪张卖得好,不用猜,系统帮你选" | 建广告时"加一个对照版本"复选框,结果自动标"赢家" | 新增 |
| 20. 创意疲劳提醒(广告投久了该换素材) | Meta Business Help creative fatigue(meta-blueprint) | "广告贴久了没人看了,系统主动提醒你该换新图了" | 广告卡片出现提醒"该换素材了"+一键用Otto重新生成 | 新增(诊断卡#128已部分覆盖,独立提醒UI属增量) |
| 21. 广告学习期状态标签("摸索中/已稳定") | Meta Business Help learning phase(meta-blueprint) | "广告刚上线几天先别手贱去改,不然又要重新摸索" | 广告卡片小标签"学习中/已稳定" | 新增(低成本高防呆价值) |
| 22. Conversions API 接入向导 | Meta Conversions API(meta-blueprint) | "让Meta知道谁真的在网站/WhatsApp下单了,广告才会越投越准" | 分步引导式接入(而非要求商家自己看开发文档),先做"是否已连接"状态展示 | 新增(技术门槛高,原型层可先做状态展示,存疑待founder) |
| 23. 邮件Campaign(轻量broadcast,非完整建站/deliverability基建) | HubSpot Email Studio / Salesforce Email Studio | "除了WhatsApp/IG,也能群发一封电邮给老客户名单" | 接第三方发送API(Resend/SES)由Otto编排,不建域名warm-up/专用IP整套基建 | 曾判以后(红旗七:email以后但必须建) |
| 24. 轻量落地页/表单(单页,非完整建站) | GoHighLevel Funnel Builder / HubSpot Landing Pages(缩小范围) | "活动要收线索,不用另外找建站工具,一个链接搞定" | 极简单页模板(图+文案+一个表单),生成分享链接 | 新增(投入vs优先级存疑待founder,SEA惯用FB/IG私域) |
| 25. 简单nurture序列(3-5步模板:欢迎/弃单提醒/生日券) | Salesforce Journey Builder(SMB子集) | "新客户进来自动发3条消息,不用你天天盯着发" | 预制3-5步规则模板(非拖拽画布,遵循O-09规则文件判决),一键开关 | 新增(遵循builder分域判决O-09) |
| 26. 发送频控规则(每人每周最多N条,防骚扰) | Salesforce Einstein Engagement Frequency(简化规则版) | "别把客户炸到取关,系统帮你控制发送频率" | Campaign/broadcast发送设置里一个数字"每人每周最多N条" | 新增(规则版,非AI模型版) |
| 27. 上期campaign真实表现反哺下期提案 | Kalodata结论反面(不抄爬虫,只用自家数据)+ O-10 | "上次活动哪条素材卖得最好,这次接着用" | 提案卡rationale栏加"上期表现"引用,读自家Meta insights不爬第三方 | 新增(呼应O-10已判"要",C线spec第三期,原型层UI待建) |

<details>
<summary>排除清单 —— 14 项(点开展开)</summary>

| 功能 | 排除理由(违宪条款/原则性不要判决/对ICP明显无用) |
|---|---|
| GHL App Marketplace + 第三方开发者API | 宪法第8条"开放第三方skill生态永久不要"+"对外MCP/API让外部agent操作FIKIRTIVE永久不要"(O-14同判) |
| GHL Agent Studio(用户自建agent,节点画布连LLM/MCP/API/知识库) | 宪法第8条+O-14"对外MCP永久不要"——本质是给用户造agent的工具箱,与Otto单一操作员定位相悖 |
| GHL SaaS Mode(平台整体贴牌转卖给客户,自动开户+自设定价) | 宪法第8条"白标永久不要" |
| GHL White-label(自有域名/logo/桌面App/白标手机App$497/月) | 宪法第8条"白标永久不要" |
| GHL AI Employee "Unlimited"套餐定价模式($97/月fair-use无限畅用) | 宪法第5条"永久禁止任何unlimited类报价"——作为定价结构被排除,不得复制此计费模式 |
| Kalodata/Virlo式第三方TikTok Shop/短视频GMV数据爬虫分析业务 | PDPA个人数据爬取合规风险;docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md §四已明文"不抄Kalodata的爬虫型第三方GMV数据业务"(原则性不要) |
| GHL/Salesforce/HubSpot式可视化拖拽Workflow/Journey节点画布(Automation Studio/Journey Builder/Workflow Builder) | 宪法第7条O-09"规则/自动化域用Otto写可读规则文件替代拖拽画布"——原则性不要,已定调 |
| Salesforce AMPscript/SSJS/自定义脚本语言编辑器 | 对ICP明显无用:需专职开发者/顾问才玩得动,SEA中小老板不写代码 |
| HubSpot原生SMS(仅美国号码发送/仅+1号码接收) | 对ICP明显无用:SEA完全不可用,WhatsApp才是对应渠道 |
| Salesforce Personalization/Interaction Studio(网页实时个性化推荐引擎) | 对ICP明显无用:$108k/年企业定价+依赖客户有高流量独立网站,多数SEA SMB无此条件 |
| Salesforce Multi-Business-Unit/Sandbox/专用IP/SAP等企业治理基建 | 对ICP明显无用:多品牌多子账号企业级治理,SEA SMB多为单店/单品牌 |
| GHL电话系统全家桶(call tracking/ringless voicemail/号码转售/A2P注册) | 对ICP明显无用:美国本地商户电信合规逻辑,SEA以WhatsApp为主渠道 |
| GHL HIPAA Compliance / Affiliate Manager / Webinar Funnels / Memberships-Courses-Communities | 对ICP明显无用:美国医疗合规/联盟营销/网课教练细分市场,偏离campaign-ads主线 |
| Salesforce Multi-touch Attribution全模型(W-shaped/Time-decay/Einstein Data-Driven归因) | 对ICP明显无用:需≥50-100个带角色成交商机的数据量,SEA SMB单店数据量撑不起,超纲 |

</details>

---

## 六、analytics-reporting(分析报表区)—— 对标 Metricool 分析引擎 + HubSpot Campaigns 归因/报表 + Salesforce Campaign 报表/归因 + Adobe GenStudio Insights + Klaviyo Benchmarks + Zoho Ask Zia + G-12 品牌化报告判决。

前提说明:
1. 「二A 报表引擎」已封卷判决为**要**("双模无例外"——founder 原话:"用户一定也要 100% 可以操作全平台的东西"),所以下表每条候选默认都要同时长出 UI 面板 + Otto 自然语言可操作两条腿,不是单纯 UI 报表。
2. G-12 品牌化报告已判**要(分析区后)**——WHAT-pass v2 拿掉"分析区先建成"这道顺序闸,所以 G-12 本体现在直接进候选表首位。
3. O-10 效果反哺闭环已判**要(升级为"也很重要")**——多条候选(Ad Refresh、属性级归因、Otto 主动播报)都是它的血肉,一并列出。
4. 本区候选不含 Campaign 容器本体、CRM 客户对象、排期发布动作本身——那些是 Campaign 管理区/CRM 区/排期区的候选,此处只收"看数据、算归因、出报告"这一层。

### 候选(18 条)

| # | 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|---|
| 1 | **Campaign Dashboard**(同一 campaign 的有机贴 + 付费广告同屏,≥N 帖自动出 AI 摘要) | Metricool | 老板不用分别开 FB/IG/广告后台再自己拼,一眼看清"这波活动到底值不值" | 按 campaign 聚合帖子+广告花费+ROI 一张卡片,Otto 写一段人话总结;卡片同时可被 Otto 对话引用("这次 Raya 活动赚了多少") | 新增(与 G-12"分析区后"判决同批次,首次单独提名) |
| 2 | **品牌化报告**(PDF/PPT 导出 + 绑定自己 Logo/配色的模板 + 定时自动寄送) | Metricool + Buffer(结构参照) | agency 老板或单人老板每月不用自己截图拼报告,Otto 自动出一份带自己招牌的月报,发给自己或转发客户 | 报告页一键"生成本月 PDF",模板绑 BrandKit;定时任务每月自动生成一份存好 | **曾判要(G-12,分析区后)**——本轮直接解闸 |
| 3 | **Otto 自然语言问数据**("这个月 IG 表现怎样""哪个渠道最赚")→ 自动出图表 + 人话摘要,不用配 dashboard | Zoho(Ask Zia)+ Metricool(Studio) | 不懂做图表、不会配 BI 工具的老板,打一句话就有答案,不用学操作 | Analytics 页加一个问答输入框(或直接走 Otto 对话),Otto 读账户内数据回答+配一张图 | 新增(呼应 founder 决策原则①"能让 Otto 做的别建手动工具";与 O-07 绩效面板精神同构) |
| 4 | **同行对标 Benchmark**(匿名找同行业/同规模的商家,4 项打 Excellent/Good/Fair/Poor 评级) | Klaviyo | SMB 老板最常问的问题就是"我跟同行比怎样",一眼知道自己是不是落后 | 早期租户量不够时先接一张"行业公开基准值"表打底,租户量够后再切真实同行匿名池 | 新增,附冷启动降级方案(研究文档原话:"早期租户量不够,先做行业公开基准替代") |
| 5 | **竞品对标**(合规版:抓公开的粉丝增长/发帖频率/互动率/内容主题) | Metricool | 不用手动盯着对手的 IG,系统自动告诉你"对手这个月发了什么、涨粉多快、什么类型帖最火" | 走官方 API(Meta Business Discovery),先做 FB/IG,数量从少量起步再逐步放开;**明确不走爬虫路线** | 新增(与 Kalodata 式爬虫方案是两回事,见排除表) |
| 6 | **属性级创意归因**(图/文哪种元素带动效果:CTA、真人出镜、限时优惠字眼、语气) | Adobe GenStudio | 系统告诉你"带真人出镜+限时优惠的图效果比其他高 40%",不用自己瞎猜下一条素材该长什么样 | 轻量版:LLM 给已发布素材打属性标签(不做 13 项视频质量特征那么重),再和表现数据做相关性统计,文案说服力(情绪/急迫感词汇)是同一机制的文字半边 | 新增;文案半边(N-29)在北极星审计已标"[·可纳入]"(founder 未反对) |
| 7 | **Ad Refresh / 疲劳检测 → 下一轮素材建议**(闭环) | Adobe GenStudio | 系统主动提醒"这条广告开始疲劳了,该换素材",还能一键生成替代版本,不用自己天天盯数字判断 | 检测 CTR/频率等指标滑坡阈值 → Otto 生成"建议换血"卡片 → 人确认后调创作区生成;涉及花钱走既有 money-gate | **曾判要(O-10 效果反哺闭环,已升级为"也很重要")**——本条是它最具体的落地形态 |
| 8 | **归因口径切换**(New/first-touch vs last-touch,一键切) | HubSpot | 老板能看懂"这个新客算头一次看到我们广告的功劳,还是最后点的那条广告的功劳",不用学漏斗模型 | 每个 campaign 一个开关,默认 last-touch(SMB 销售周期短更直观) | 与 Campaign 管理区候选#6 重叠(该文档标"存疑待 founder"),分析侧再次提名 |
| 9 | **每 campaign 一行 ROI 报表**(花费 vs 归因收入 vs ROI,自带"内容制作成本"列) | HubSpot + Salesforce | "这波活动到底赚不赚"一个数字讲完,不用自己拿计算器算;FIKIRTIVE 独有的是把生成花的 credits 也算进"制作成本" | Analytics 全局页 + campaign 详情页各出一版最小公式:(归因收入−广告花费−制作成本)/花费 | 与 Campaign 管理区候选#5 重叠(该文档标"待 founder"),分析侧再次提名 |
| 10 | **Campaign 首触归因到 Deal**(轻量单触点版,不是多触点分账) | Salesforce | 成交后能倒查"这单客户最早是被哪个活动带进来的",老板据此判断"CNY 活动值不值得年年做" | Deal 记录加一个 sourceCampaignId 单触点字段,客户建档时自动打上,不做复杂权重分账模型 | **曾判不要(太深奥)**——GRILL 原话"N (SF) Campaign 首触归因埋点 \| 不要(太深奥)"。这是**成本/复杂度性质的排除**,按规则重新入候选,标注"轻量单触点版是否仍算太深奥"需 founder 重判,与其多触点全模型(见排除表)分开评估 |
| 11 | **跨渠道广告 Insights 面板延伸**(Meta/TikTok/未来渠道汇总一处) | Adobe GenStudio + Metricool | 不用分别开好几个广告平台后台,一个页面看完所有渠道花了多少钱、换来多少结果 | 已有雏形(Meta ads 已接入);延伸接入新渠道(TikTok Ads 等)进同一视图 | 已有对应楼(Analytics 页规划中 ads+organic+history 之内),此处为延伸提名而非全新 |
| 12 | **Otto 主动异常播报**("上周互动掉了 30%,可能是这个原因") | Salesforce Einstein + Metricool Studio | 老板不用天天盯数字,系统自己发现问题主动来找你说"这里不对劲",而不是被动等你打开报表 | 周期性扫描关键指标环比,超阈值自动生成一条 Otto 周报卡片(复用现有周报载体) | 与 **O-07 Otto 绩效面板(简版)** 高度契合,O-07 已判"要(默认确认)" |
| 13 | **报表订阅/定时推送**(每周/每月自动发) | Salesforce + HubSpot | 报告自动到你手上,不用自己记得去点开看 | 复用#2 品牌化报告生成器,加一个定时任务触发 | 并入 G-12 范畴(已判要) |
| 14 | **Campaign 多档活动横向对比表**(不设 HubSpot 的 10 个上限) | HubSpot | "这次 CNY 活动 vs 上次 Raya 活动哪个更划算"一张表说清楚,不用自己整理 Excel | 轻量表格:花费/询盘/ROI 并排,campaign 数量不设人为上限 | 与 Campaign 管理区候选#14 重叠(该文档标"该进 Campaign 管理区或 Analytics 页"),分析侧再次提名 |
| 15 | **自动回复表现精简报表**(平均首响时长、解决率、Otto 自动解决占比) | respond.io | 老板想知道"客户消息我们回得快不快、解决了多少",不需要"坐席排行榜"这种对一人公司没用的东西 | Analytics 页加一小节,只留响应率/解决率/Otto 自动解决占比三个数字,**明确不做排行榜**(见排除表) | respond.io 研究文档标"分析区(合并进现有 Analytics 页)",新增细化 |
| 16 | **角色化预设 Dashboard**(老板视角 vs 创作者视角,而非自由拖拽 widget) | GoHighLevel | 不用自己配置面板要放哪些数字,系统按你的身份(老板只关心花了多少赚了多少;创作者关心哪条帖火)给你一套现成的 | 提供 2-3 套预设视角(而非 GHL 式自由拖拽,呼应宪法 UIUX 支柱的 minimal/Apple 质感) | 新增(GHL 映射表标"分析区已有对应楼",dashboard 拖拽本身未单独判决) |
| 17 | **历史趋势快照**(定期存快照,出周/月走势折线而非只看当下) | Salesforce(Reporting Snapshots) | 能看"半年前 vs 现在"的走势对比,判断生意是不是在变好,不只是盯着今天的单一数字 | 定期(周/月)把关键指标存成时间序列,叠加到 Campaign Dashboard / 跨渠道面板上出折线 | 新增 |
| 18 | **Web/blog 流量分析**(轻量自建 tracker,测网站访客来源) | Metricool | 如果客户有自己的网站,能看到"从 FB 来的人有多少真的点进网站",不用另开 Google Analytics | 存疑优先级最低:维护一个类 GA 的 tracker 是长期工程负担;原型层可先跳过或只做"接现成 GA 只读展示"的轻量替代 | Metricool 研究文档标"存疑"(维护负担重),本表列出交 founder 判定优先级 |

<details>
<summary>排除清单 —— 11 项(点开展开)</summary>

| # | 功能 | 排除理由 |
|---|---|---|
| 1 | Metricool 报告 **live-URL 对外分享**(免登录实时更新链接,全权/只读两级权限) | **原则性不要**——GRILL 判决原文"N (Metricool) 报告 live-URL 分享 \| 不要(重叠)"。北极星审计(N-16)已挑明这不是单纯功能重叠,而是与**宪法第 6 条"跨租户读一字节=事故"**、及蓝图"canvas-as-home"的租户铁幕架构存在真实张力——一个泄露的 live URL = 客户数据外露。维持排除。 |
| 2 | Metricool **Hashtag Tracker 按天道具计费**(€25/天/网络) | **原则性不要**——GRILL 判决原文"N (Metricool) 按天道具计费 \| 不要(重叠)"。且这是计费模式而非原型层可体验的 UI 功能(规则 4 排除范围);SEA SMB 需求弱 + 爬取成本高,双重不划算。 |
| 3 | Adobe GenStudio Foundation **全城概览页**(unified cross-district home/planning/assets/insights dashboard) | **原则性不要**——GRILL 判决原文"N (Adobe) 全城概览页 \| 不要(重叠)"。与蓝图明文承诺的"**创作区即家(canvas-as-home)**"架构直接冲突——蓝图只写了单区工作台当"家",没有第二个跨区指挥中心。维持排除。 |
| 4 | **Kalodata 式第三方 GMV 数据爬虫业务**(爬 TikTok Shop 卖家真实成交数据,出"最能卖的视频/达人/商品"排行) | **硬排除**——违平台 ToS(第三方数据爬虫业务模式);且 FIKIRTIVE 定位不是"分析情报工具"。`docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md` 已明确写"不抄 Kalodata 的爬虫型第三方 GMV 数据业务(合规敞口 + 我们不是分析工具)"。注:候选表第 5 条"竞品对标"走的是官方 API,与此为两回事。 |
| 5 | HubSpot Enterprise **多触点归因模型全家桶**(Linear / U-shaped / W-shaped / Time-decay / Full-path / J-shaped) | **原则性不要**——呼应 founder 决策原则②"太深奥/企业级不碰"。需要大量干净的 opportunity/contact-role 数据,HubSpot 与 Salesforce 都把它锁在各自 Enterprise 档,SMB 数据量本身撑不起模型准确度。候选表第 8 条"first/last touch 轻量切换"是它的可行子集,予以保留。 |
| 6 | Salesforce **Customizable Campaign Influence 自定义权重多触点 + Einstein Attribution**(需 ≥50–100 个带 Contact Roles 的 Opportunities 才能启动) | **原则性不要**——同上,门槛本身就把 SMB 挡在外面,不是"做小一点"能解决的成本问题,而是统计意义上无法启动。候选表第 10 条"轻量单触点 sourceCampaignId"是它的可行子集,予以保留。 |
| 7 | Metricool **Looker Studio Connector**(把数据导出接到外部 BI 工具自由拼仪表盘) | **原则性不要**——Metricool 自家研究文档已建议"现阶段不要"。方向上与"FIKIRTIVE 的数据出口 = Otto 对话"的既定精神冲突,呼应宪法第 8 条"不留逃生口、操作这座城的 agent 永远只有 Otto"的态度(虽非第 8 条字面禁止的对外 MCP,但同一价值取向)。 |
| 8 | HubSpot **AEO**(Answer Engine Optimization,追踪品牌在 ChatGPT/Gemini 等答案引擎中的可见度)add-on | **对 ICP 明显无用**——依赖客户有内容型网站 + SEO 战略;SEA SMB 主战场在社媒/WhatsApp,不在搜索/AEO。HubSpot 自己也把它归为"前沿观察项,SMB 付费意愿存疑"。 |
| 9 | **Twitch / Bluesky 渠道分析** | **对 ICP 明显无用**——研究文档标注"SEA SMB 基本无感 ⚠️";这两个渠道本身不在 FIKIRTIVE 已定的平台矩阵(TikTok/Shopee/Lazada 等)范围内,分析这两个渠道数据没有承载对象。 |
| 10 | respond.io / HubSpot / Salesforce 式 **坐席排行榜(Leaderboard)+ 坐席级绩效报表全家桶**(11 类企业报表、User/Agent Reporting) | **对 ICP 明显无用**——研究文档原话"SMB 没有'坐席团队'可考核"。FIKIRTIVE 首发 ICP 是 1-几人的单人/小团队老板,排行榜类功能无使用场景。候选表第 15 条已明确保留"精简版"(响应率/解决率两个数字),排行榜本身排除。 |
| 11 | GoHighLevel **号码级 Call Tracking 归因**(呼入呼出电话追踪 + 通话录音) | **对 ICP 明显无用**——SEA SMB 客服/销售的主场是 WhatsApp 文字对话,不是电话呼叫中心;电话号码级归因这套机制在本地商业习惯里没有承载场景。 |

</details>

---

## 七、**brand-assets(资产区/品牌治理)**——对标 Canva Brand Kit、Adobe GenStudio(Brands/Products/Personas + Brand Intelligence)、Higgsfield(Soul ID)。

已读:`docs/research/2026-07-03-canva.md`、`2026-07-03-adobe-genstudio.md`、`GRILL-VERDICTS-2026-07-03.md`、`GRILL-WORKSHEET-2026-07-03.md`(B 区 B-01~B-15 完整功能簇清单,已按 SMB 价值排序)、`docs/BLUEPRINT.md` 第八条、`docs/design/2026-07-03-harmony-01-data-model.md`(BrandKit/PersonaIdentity/Product 已是 P1 工厂三件套)。也核对了原型层代码现状:`apps/web/app/northstar(-immersive)/assets/{brand-kit,brand-memory,cast,library,my-stuff,templates,discover}` 七个 draft 页面均已存在(mock 数据,status="draft"),`packages/db/prisma/schema.prisma` 已有 `BrandKit`/`BrandRecord`/`BrandRule` 模型。

**关键发现**:B 区 15 个功能簇(B-01~B-15)在 2026-07-03 拍板时"七区默认判决全数通过"(候选层面全部过关),其中 B-01(Brand Kit)、B-02(URL 建档)、B-05(训练型人设)已经是 harmony-01 数据模型里明确的 P1"工厂三件套",原型页也已起草;B-04 与 O-04(品牌记忆自养)同一件事已判"要";B-10/B-13 与 G-11(团队协作+审批已判要)、G-09/G-10(多客户伞层已判要排第三)同构。**开放模板 gallery(B-11 的核心机制——用户自建+可跨商家分享的模板)在 North-Star 审计中被明确判"以后"**,`templates/page.tsx` 代码注释已引用此判决主动划出边界("本页不画任何 Create template 入口")——在 v2"原型层默认全做、闸门搬到点亮"的新定调下,这是本区最值得 founder 重新走一次城的项。B-14(内容合规/C2PA 溯源)此前已被 North-Star 判"不要(重叠)"予以排除。素材图库授权、Campaigns 项目管理、一稿多尺寸/多语言翻译三项,worksheot 的"B 区遗漏检查"已写明是刻意划出(分属采购决策/Campaign 管理区/创作区),不在本区范围。未发现 MagicPath/origami/arcads/Kalodata 专项研究文档存在于本仓库(这些是其它区并行研究的对标对象,与资产区无直接功能重叠);MagicPath"设计画布锁定版式仍可微调"的手感已作为 B-09 原型层做法的参考点带入。

### 候选(14 条)

| 功能 | 来自哪家龙头 | 对 SEA 中小老板的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| B-01 品牌资料包与用法说明(Brand Kit + Guidelines):logo/色板/字体/语气 + 每项资产"怎么用"的说明(留白规则、什么场合用哪色) | Canva Brand Kit + Brand Guidelines / Adobe GenStudio Brands 记录 | 老板最怕 AI 出的东西"不像我的店";一次设置,以后每张图每条文案自动"像自己" | brand-kit 页已有 draft(logo/色板/语气字段齐全),补"用法说明"字段(如"这个色只促销用") | 已定案在建(BrandKit 是 harmony-01 P1 工厂三件套之一,schema 与原型页已存在;"用法说明"为增量) |
| B-02 URL 一键建档:贴官网/IG/Shopee 链接自动抓取生成品牌/产品档案草稿,老板确认即可 | Adobe GenStudio Add from URL / Higgsfield 贴链接抓商品信息 | MY 老板没耐心手填品牌手册,30 秒开箱是留存的第一道关卡 | 设置页加"贴链接"入口→抽取预览→逐项确认落地;已有 founder 定范围的 spec | 已定案在建(spec `docs/superpowers/specs/2026-07-03-p1-01-product-url-ingest.md` 已获 founder 定范围,尚未落到原型页) |
| B-03 品牌约束生成+校验打分:生成时自动引用品牌资料做约束,产出后打"像不像这个品牌"的分,不合规可一键重生成;校验本身不耗 credits | Adobe GenStudio Brand validation(免费校验) | "AI 出图跑偏"是对 AI 工具失望的最大单点,这功能直接兜底"生成的就是我的牌子" | brand-kit 页已有"Check recent visuals"叙述条 demo(idle→checking→done),扩展为结果页内联提示+一键"更像我的品牌" | 已定案在建(C-08 判决;原型层已有校验流程雏形) |
| B-04 品牌记忆持续学习:不用维护手册,Otto 从每次拒稿/改稿/通过里自动学品牌偏好 | Adobe Brand Intelligence / Canva Living Memory | 老板零维护成本,用得越久 Otto 越懂自己的店,是隐形留存钩子 | brand-memory 页已较完整(467 行),加"这条记忆来自哪次批改"的溯源标注,让"越用越懂我"对老板可见 | 已判要(O-04 默认确认;"批改=训练信号"回路是增量) |
| B-05 品牌人设/角色资产(训练型):≥20 张照片训练出数字分身,跨风格/姿势/光线锁同一张脸,训后不限量出图 | Higgsfield Soul ID | SEA 靠"人设"卖货(老板/店员亲自出镜),不请 KOL 也能量产出镜内容 | cast 页已有 PersonaIdentity 列表+训练进度条 UI(mock),原型层先做完整"上传→假想训练进度→锁脸完成"交互流 | 已定案在建(PersonaIdentity 是 harmony-01 P1 工厂三件套;判决 7-6:选角库排 Wave 3,训练型人设本体已批;原型页已有 draft 骨架) |
| B-06 资产库与自动打标:生成物+上传素材统一仓库,AI 自动打内容/颜色/用途标签,旧图直接搜索复用省 credits | Adobe GenStudio Content Library(打标免费) | 素材涨得飞快,三个月后翻不到旧图是必然的痛,自动打标直接省钱省时间 | library 页已有历史网格+搜索框骨架,加"AI 自动标签"chip + 按标签筛选(mock 数据先演示) | 已定案在建(P0 live·revamp,已有 SearchField;自动打标为增量) |
| B-07 产品与受众档案:品牌之外立"卖什么"(产品卖点/价格/图)和"卖给谁"(目标客群)两类档案,生成时自动带入 | Adobe GenStudio Products/Personas 一等记录 | 多 SKU 电商/餐饮一次建档长期省重复打字,按客群自动出不同版本 | 品牌设置页旁加"产品卡片"列表(与 B-02 URL 建档打通);客群档案做成简单标签卡,生成时可选 | 混合(Product 已是 harmony-01 P1 实体;"受众 Persona 档案"半边为新增,worksheet 明确标现状"零") |
| B-08 批量创建(数据驱动批量变体):一张表(商品/价格/门店)驱动一个版式,逐行批量出成品图 | Canva Bulk Create(CSV/Sheets,Auto-match) | 电商/餐饮/多分店的高频真实需求,不用一张张手做促销图 | Otto 对话式版本——"读我的商品表,每个 SKU 出一张促销图",跳过 CSV 映射 UI,先出总价确认页再执行 | 已判要(7-3 批量变体矩阵已判要,附带"批量确认页显示总价"硬性要求;B-08 是资产区数据驱动延伸) |
| B-09 品牌锁定模板:打磨好的成稿存成"只许换文字图片、版式动不了"的内部模板,新手不会跑版 | Canva Brand Templates(锁元素)/ Adobe logo swap | 单老板用不上,一旦雇人或接 agency,新手不用每张都被盯版式 | "存为品牌模板"+锁定标记,编辑态只能改文案/图片位;可参考 MagicPath 式"锁定图层仍可微调内容区"的画布手感 | 新增(worksheet 已标形状张力:FIKIRTIVE 生成优先非编辑器优先,需先想清"锁版式"怎么做而不变成编辑器产品) |
| B-10 内容审批流:发布前送人过目——批注/驳回/通过,SMB 合理形状是"老板过一眼再发" | Canva Design Approvals / Adobe Reviews & Approvals | 单老板不需要,一旦有员工或接 agency 单,"我要先看过"是 MY 老板的强习惯 | 待审队列页(生成物自动排队→老板手机点头即发),拒稿理由自动喂回 B-04 品牌记忆 | 已判要(G-11 团队协作+审批已判要,且与既有 plan-approval/cost-confirm 动作审批同构;"内容发布前人审"具体落点尚未建) |
| B-11 开放模板 gallery(用户自建+可跨商家分享的模板库,区别于官方精选) | Canva 25 万+ 模板+Creators 分成生态 / Higgsfield UGC Factory | MY 本地垂直模板(raya 促销/mamak 菜单/双十一)若能商家互相分享,比官方库更贴地气 | templates 页当前明确不画"Create template"入口(代码已注明);可先做最小闭环——私有"存为我的模板"(不公开分享,不做分成经济),浏览 tab 仅限自己 | **曾判以后**(North-Star 判决:"用户自建+可分享模板 gallery\|以后\|目前不用";代码已引用此判决划边界)。v2 定调下建议区分:私有"存为模板"半边可候选重议;跨商家公开分享+创作者分成半边建议维持"以后" |
| B-12 品牌硬管控:从"提醒"升级"禁止"——只许用品牌色/字体,锁定元素动不了,越界拦下生成结果 | Canva Brand Controls(Business/Enterprise) | 单老板管自己没意义,只有雇人/多人协作时才有价值——"防止新员工乱来" | 品牌设置页加"强制模式"开关;违规生成结果原型层先做"标红提示+不放行"视觉态,不做真生成层拦截 | 新增(worksheet SMB 度标"低",团队协作/G-11 落地后价值才显现) |
| B-13 多品牌与 Agency 治理:一账号管多客户品牌,资料隔离不串味;agency 场景加操作留痕 | Canva Brand Kit 阶梯计价 / Adobe Agency System of Record | 单一 SMB 无感,但 MY 遍地小 agency/代运营商家,是天然批量获客渠道 | 品牌切换器(左上角下拉切品牌上下文)+ 每品牌独立 brand-kit/library;原型层先做 UI 切换态 | 已判要(关联 G-09 行业开店模板/G-10 多客户伞层已判要排第三、G-11 团队协作已判要;worksheet 现状标"零") |
| B-15 品牌专属风格模型(轻量版):用参考图匹配风格(非训练),之后生成默认贴近品牌视觉 | Canva Dream Lab Style Transfer(轻量)/ Adobe StyleIDs(重量,另案) | 长期差异化天花板高,但轻量版低成本就能覆盖大部分"风格一致"的需求 | 生成设置加"匹配参考风格"开关(用已有参考图机制,不训练新模型) | 新增/成本性暂缓(worksheet 原话"现阶段 ROI 差",属成本非原则性不要,按 v2 定调入候选由 founder 再判;训练型 Firefly Custom Models/Foundry 级另案见排除表) |

<details>
<summary>排除清单 —— 8 项(点开展开)</summary>

| 功能 | 排除理由 |
|---|---|
| 素材图库授权(Canva 1 亿+ stock 图/视频/音库) | worksheet「B 区遗漏检查」明确刻意划出:这是内容供给的采购/授权谈判问题,不是可建的功能楼层;FIKIRTIVE 走生成路线,stock 依赖天然弱——对 ICP 明显无用 |
| Creators royalty 供稿分成市场(外部创作者供模板赚分成的开放生态) | 与宪法第八条"开放第三方 skill 生态永不做"(O-11 skill 永久内部编写)、"对外 MCP 不留逃生口"(O-14)同一精神:平台不对外开放创作/分成生态;且不懂营销的 SEA 中小老板不会去当模板供稿人赚分成,对 ICP 明显无用 |
| Campaigns 组织与项目管理(GenStudio Campaigns/Workfront 式项目管理) | worksheet「B 区遗漏检查」刻意划出:按战役组织资产归 Campaign 管理区(P 区),非资产区范围;且两份研究(Canva/Adobe)均判企业级虚胖,背离 SMB 简单性 |
| 一稿多尺寸/多语言批量翻译(Magic Resize/Switch、Magic Translate、GenExpand、40+ 语翻译) | worksheet「B 区遗漏检查」刻意划出:是生成/改稿动作,决策点在创作管线,归创作区(C 区),非资产治理范畴 |
| 内容合规与溯源(B-14:Content Credentials/C2PA 溯源元数据、IP 相似度检查、平台规范体检) | North-Star 已判"不要(重叠)":生成侧已有隐性 model-level 安全拦截,产品化是重复劳动;worksheet 明确 SMB 度"低"(MY SMB 不会问 C2PA,不构成付费理由)——对 ICP 明显无用 |
| Firefly Foundry / StyleIDs 天价级 IP 专属模型调优、AEM Assets/Workfront/RT-CDP/CM360/Trade Desk/CTV/ChatGPT Ads 等企业 SKU 集成 | Canva/Adobe 两份研究候选映射均标"建议不要";起步门槛企业合同级,SEA SMB 定价维度上完全不可及,不构成原型层可体验功能 |
| 第三方 DAM/SDK 对外连接(Adobe extensibility framework 接第三方资产库) | 宪法第八条硬排除:"对外 MCP/API 让外部 agent 操作 FIKIRTIVE"永不做(O-14 定案:"如果会用其他 LLM,代表 Otto harness 不够好");且是纯后端集成,SMB 商家碰不到,非原型层功能 |
| Brand Kit/资产库接 Slack/Notion 等团队协作工具 connector | 宪法第八条明确列出的硬排除项(O-13 判决:Slack/Notion 类工作工具 connectors 不要);SEA SMB 主场在 WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具 |

</details>

---

## 八、team-agency-platform

### 候选(21 条)

> 范围说明:本区对标 GoHighLevel(sub-accounts/Snapshots)+ plane.so(审批状态机形状,参考挂靠于 `docs/MASTERPLAN.md` §五 P3,不需新判决)+ ManyChat(partner 生态)+ Zoho(seats+credits 双轨概念)+ onboarding/gamification(GM 卷)。已核对 `docs/BLUEPRINT.md` 第二章宪法第 8 条 + `docs/research/GRILL-VERDICTS-2026-07-03.md` 全卷 + `docs/research/GRILL-WORKSHEET-2026-07-03.md` G-01~G-16 详细双模注。
> 已核对但确认不属本区、未重复列入:MagicPath(设计画布手感,查无独立研究文档,核心是创作区画布直接操作手感,唯一沾边落点是"编辑我的模板"界面,已在下表体现,不单列);origami(客服区消息自动化原则,7-8/7-9 已判归 M 区);Arcads/Kalodata(UGC 广告生成品类,属 `2026-07-03-benchmark-gap-scan.md` 创作区/C 区范围)。
> 已核对现有代码:`apps/web/components/northstar/immersive/account-ops/{team-members,team-approvals}.tsx` 已有基础团队邀请 + 审批二元(approve/decline);`misc/onboarding-checklist.tsx` 已完整实现 GM-05 开店完成度环——两者均已建成,不再列入候选,下表只列**尚未覆盖的扩容缺口**。Agency 层(多客户伞层/开店模板/白标报告等)在 `_registry.ts` 与整个 immersive 目录中完全空白,是本区最大缺口。

#### Agency 楼层 —— 多客户伞层(G-10,已判"要,排第三")

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 客户切换器(agency 总控台顶部切不同客户 org) | GoHighLevel(Sub-Accounts)、ManyChat(多客户 workspaces)、Klaviyo(Portfolio) | 代运营多个客户的小 agency 老板不用为每个客户重新登录,一个入口切完所有客户店铺 | 顶栏加"客户"下拉,切换后整个工作台数据换成该客户 org 的(复用现有 mock org 结构换皮即可) | 曾判要(G-10) |
| Agency 总览仪表盘(全部客户一屏健康度) | GoHighLevel、Klaviyo(Portfolio 全局 dashboard) | 一眼看完手上所有客户的余额/待批/最近发布状态,不用逐个点进去排查 | 卡片墙,每张卡=一个客户 org 摘要(待批数/credit 余额/最近发布态)+ 点开跳转 | 新增(G-10 的自然延伸,未单独判决) |
| 一键开新客户 org(从 agency 视图新建) | GoHighLevel(自动开 sub-account) | agency 接了新客户,几分钟内建好一个全新工作台,不用手工从零配置 | "新增客户"按钮 → 走开店模板向导(见下表) | 曾判要(G-09+G-10) |

#### 行业开店模板 / Snapshots(G-09,已判"要")

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 行业开店模板一键导入 | GoHighLevel(Snapshots) | 选"马来西亚餐饮/美容/补习"包,自动预填品牌包骨架+campaign模板+自动回复规则+Otto技能开关,把"10小时人肉开荒"压成"10分钟导入" | 模板选择卡片墙 + 导入向导(进度条+完成后跳转品牌包页看结果) | 曾判要(G-09) |
| 导入前预览"会改动什么" | plane.so(两级模板参考)+ 宪法 FB5 影响清单原则 | 老板点导入前先看清会写哪些字段,不怕稀里糊涂盖掉自己已填的东西 | 导入向导加"预览"步骤,列出即将写入的字段清单 | 新增(呼应已拍板的透明原则,非新判决) |
| 两级模板:官方行业包 + 我自己存的模板 | plane.so(官方模板+org自建模板双层) | agency 服务多个同行业客户时,能把配好的一套存成"我的模板"复用,不用每次从头改官方模板;若要复用 MagicPath 式直接操作手感,落点正在此"编辑我的模板"界面 | 模板选择页加"我的模板"tab,允许把当前 org 配置另存为模板卡片 | 新增(`docs/MASTERPLAN.md` §五已列为实现形状参考,不需新判决) |

#### 团队协作 + 审批深化(G-11/O-13/P3-3,已判"要";plane.so 状态机参考)

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 审批加"退回并留言"(现只有批准/拒绝二元) | plane.so(状态/流转/审批人/退回态四概念) | 老板想让小编改一处再发,不用直接拒绝重来,退回时带一句话说明改哪 | `team-approvals.tsx` 加第三个动作"退回",带留言框,卡片状态显示"needs changes"并提示原提交人 | 曾判要(G-11 已判要,现有原型只做二元,状态机可加深,非新判决) |
| 审批卡片挂评论/交接线程 | 蓝图第六章明文"评论交接" | 小编和老板能在同一张审批卡上来回讨论,不用切去 WhatsApp 聊 | 每张审批卡加评论区(复用聊天气泡样式) | 曾判要(蓝图第六章团队协作明文点名) |
| 审批队列筛选(按类型/发起人/等待时长) | Buffer(三级权限+Approvals tab 同类精神) | 老板一天要批很多单,能先筛"超过24小时没批的"优先处理 | `team-approvals` 页顶加筛选 chip | 新增(宪法11丝滑体验延伸) |
| 创作席/审批席双档 + 邀请时选席位类型 | Zoho(seats+credits)、Adobe(创作贵审批便宜双层席位) | 老板加人时能选"这个人只需要看和批(便宜)还是要真的动手做内容(全功能)",价格一眼分清 | 团队设置页加席位类型徽章 + 邀请对话框加"席位类型"下拉(现有 `data.ts` 只有 Owner/Manager/Editor 角色,无 seatType 计费维度) | 曾判要(G-01 双档已判,现有原型未区分 seatType,可补) |
| 无席位链接式外审(复制预览链接给客户/老板看) | Buffer(已判要,North-Star N-14) | agency 想让最终客户看一眼稿子再发,客户不用注册账号 | 排期/审批卡加"复制外部预览链接"按钮 | 曾判要(北极星未捕获审计 12 项可直接纳入清单已含"单帖可分享预览URL") |

#### 市政厅 v2 团队阶级制度(P4-4,蓝图第六章点名,X 题已判)

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| 矩阵驱动角色权限表(section×role×读/写/审批) | 蓝图自身("SECTION_MATRIX 一张可读表") | 老板一眼看清"经理能不能改品牌包、能不能连渠道",不用猜权限 | 一张可读表格(行=功能区,列=角色,格子=✓/✗/需审批) | 曾判要(蓝图第六章"市政厅v2"点名,Otto 永久豁免此区,仅供人操作) |
| 按角色设花钱额度(单笔/日累计上限) | 蓝图"钱的阶级" + X-02 已拍具体数字 | 老板敢放心让员工用 Otto 干活,又不怕一次花超预算 | 角色设置加两个数字输入(单笔上限/日累计上限),超限提示"进老板审批队列" | 曾判要(X-02 数字已拍板:单笔≤1,000cr/日累计≤3,000cr) |
| 邀请/停用/审计留痕时间线 | 蓝图"邀请/停用/审计全留痕(ActionEvent)" | 老板能查"谁在什么时候被邀请/移除/改权限",出事能溯源 | 团队变更时间线(邀请/角色变更/停用事件列表) | 曾判要(蓝图第六章明文) |

#### 品牌化客户报告(G-12,已判"要,排分析区后")

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| Agency 品牌化客户月报(套客户logo导出PDF/定时寄送/live链接) | Metricool、Buffer、GHL(坐席报表) | agency 每月要给客户交差,系统自动生成一份看得懂的 RM 报告,不用自己手工做 PPT | 报告预览页 + "生成客户报告"按钮(logo占位)+ 复制 live 链接 | 曾判要(G-12,排在分析区数据就绪之后) |

#### Onboarding / Gamification(GM 卷,已封卷)

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| Agency 首个客户上线里程碑庆祝 | GM-02(里程碑时刻,已判要)套用到 Agency 场景 | agency 老板第一次用模板成功开出一个客户店铺,给个短暂正反馈,强化"这流程真顺畅"的第一印象 | 模板导入成功后加轻量 toast/彩带反馈(与创作区/排期区已有里程碑组件同款式样,不新造视觉语言) | 曾判要(GM-02 已拍板,应用到 Agency 场景是新落点,非新判决) |

> GM-05"开店完成度"onboarding checklist 已在 `misc/onboarding-checklist.tsx` 全量建成(渠道连接/建产品/发首帖/看数据四步,完成即消失),不再是候选,列出仅供确认覆盖完整。

#### Agency 获客/伙伴生态与转售层(旧判决多为"以后"非"不要",供 founder 走城再判是否提前到原型层)

| 功能 | 来自哪家龙头 | 对我们用户的实用性一句话 | 原型层做法一句话 | 旧判决状态 |
|---|---|---|---|---|
| Agency 获客体检报告(输入本地商户信息一键生成"营销体检报告") | GoHighLevel(Prospecting Tool) | agency 想拓展客户时,能对一个本地商户一键生成"你的Google评论/资料不完整"体检报告,当破冰话术 | "生成体检报告"按钮 + 报告卡片(占位数据) | 新增,GHL研究自评"存疑(Agency楼层远期)",无正式 founder 判决,优先级低 |
| 代理商分成/推荐追踪面板 | ManyChat(Partner Program 50–100% rev share)、GHL(Affiliate Manager) | agency 转介绍新客户能看到自己赚了多少分成,增加"多带客户"的动力 | "我的推荐"页:推荐客户列表 + 预估分成(占位数字) | 曾判"以后"(G-16),非"不要",原型层可先建 UI 供 founder 过目 |
| 转售加价(agency 给客户 org 的 credit 设 markup%) | GoHighLevel(rebilling with markup) | agency 想靠转卖 credit 赚差价,像转卖流量套餐一样 | "加价率"设置滑块(纯 UI 占位,不接真钱,页面须明确标注 demo) | 曾判"以后 + 严设计"(G-13),新 money-path,原型层务必仅 UI 占位,真接线需过 money-safety-review |
| SaaS Mode(客户自助订阅→自动开户+自动扣款+欠费自动锁) | GoHighLevel(SaaS Mode) | agency 想做到"客户自己上网刷卡开通,不用 agency 手动开户" | "自助注册流程"演示(选价位→模拟支付→自动生成客户org),明确标注 demo 不接真 Stripe | 曾判"以后"(G-15),涉及 money path,原型层需谨慎注明纯演示 |
| 审批席比例赠送(买 N 创作席送 M 免费审批席) | plane.so(比例定价)、G-01 已判双档 | 老板不用为"只看不批"的助理额外掏钱,鼓励全员都拉进来批 | 定价/席位页展示"3个创作席=送2个免费审批席"类比例文案(数字占位,标"示意,待 costing") | 曾判要但精确比例待 costing(G-01 已判要,原型层先做 UI 占位;`docs/MASTERPLAN.md` §五已挂靠"送N席具体档位由 founder 在 G 档位 spec 时选") |

<details>
<summary>排除清单 —— 14 项(点开展开)</summary>

| 功能 | 排除理由(违宪条款/原则性不要判决/对ICP明显无用) |
|---|---|
| Agent Studio / 节点画布式用户自建 agent(GHL Agent Studio、Zoho Agent Studio/Creator/Flow low-code) | 违反 O-09(builder 分域:自动化域不做节点画布,由 Otto 写可读规则文件替代拖拽画布)+ O-11(skill 永久 BELCORT 内部编写,不开放给用户自建)+ Otto 运营契约铁律⑤"One Otto,新能力永远=新 skill,不是新 app" |
| GHL 可视化 Workflow Builder(拖拽 if/else 完整流程图编辑器) | 同上,O-09 已判"分域";GHL 研究报告自身也点出这是与"超级员工"叙事冲突的核心分叉点(候选 A = Otto 自然语言+可读规则文件,已是判决方向) |
| Zoho MCP Server(外部 LLM/ChatGPT/Claude 接 Zoho 数据与 actions) | 宪法第 8 条硬排除"对外 MCP/API 让外部 agent 操作 FIKIRTIVE";O-14 已判"不要(永久)" |
| 白标平台/白标手机 App/自有域名换皮(GHL White-label、白标手机App $497/月、Branded Client Portal App) | 宪法第 8 条硬排除"白标"(Otto 永不改名换脸);G-14 已判"永久不要" |
| Zia Agent Store / 预建 Agent 市场(100+ 可自助部署的第三方风格 agent) | 与"One Otto"铁律⑤ + 宪法第 8 条"开放第三方 skill 生态永久不做"精神冲突,虽非严格意义第三方,但"多 agent 市场"模式与"一个 Otto"定位相反 |
| Unlimited 类 AI 套餐命名(GHL "AI Employee Growth/Unlimited"、$97 unlimited fair-use 话术) | 宪法第 8 条 + G-05b 硬排除"任何 unlimited 类报价永久不要"(founder:"Otto 自动化的时候我们就糟糕了") |
| Slack/Notion 类知识工作者 connector(ManyChat/Zoho 的 Zapier/Make/HubSpot/ActiveCampaign/Google Sheets 等第三方营销工具直连) | O-13 已判"Slack/Notion 类 connectors 不要"(原则性排除:SEA SMB 主场在 WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具) |
| GM-01 连续行动 streak(团队/agency 活跃度连续打卡) | GM 卷已判"不要"(founder 2026-07-03 拍板,三条边界之一) |
| 电话系统全家桶(GHL call tracking/ringless voicemail/A2P 注册/号码转售) | 对 ICP 明显无用(GHL 研究自评"对 FIKIRTIVE 是整块可跳过的领域";美国本地商户逻辑,SEA 通话获客弱、主战场是 WhatsApp) |
| Memberships/Courses/Communities(GHL 会员课程社区) | 对 ICP 明显无用(教练/网课细分市场,离营销 OS 主线远,GHL 研究自身建议不要) |
| SMS/Email 渠道自建(ManyChat 美国专属 SMS 走 Twilio;email 营销渠道) | 对 ICP 明显无用(SMS 仅美国;MY SMB 极少用 email 营销) |
| HIPAA Compliance/Dedicated Email IP/Premium Support/HighLevel Certification/WordPress Hosting 等企业向 add-on | 对 ICP 明显无用(美国合规/企业级细分,SEA 中小商家无感) |
| Zoho 50+ 周边 App 自建(Books会计/People HR/Payroll薪资/Vault密码/Backstage票务/Lens AR远程排障等) | 对 ICP 明显无用 + 偏离营销 OS 主线(蓝图第一章定位是 marketing power house,非全公司 ERP;Zoho 研究自身建议"聚焦五支柱,靠集成而非自建") |
| Zoho Blueprint(拖拽状态机)/Canvas(no-code 界面设计器)/Journey Builder/CommandCenter 跨部门编排 | 违反 O-09(不给用户 builder 工具,让 Otto 代劳)+ 宪法"易管理"第三优先级(给用户一套建造工具=复杂度炸弹,Zoho 研究自身也建议不要) |

</details>

---

## 使用规则

> ⚠️ **2026-07-14 加注**:下述第 1-2 条的入闸路径(北极星原型 → founder 走城 keep/cut → 排入 MASTERPLAN 施工)已改——新决策一律走 wayfinder 决策票制(GRILL-VERDICTS 2026-07-14「工作方法」判决;决策地图 = issue #287)。候选池内容照常有效;第 3-4 条(点亮过闸/排除永不复活)不变。

1. 本表是 **Wave B(扩容施工)** 的工单底稿:不是施工顺序本身,是"接下来可以拿去建原型页的候选清单"。
2. 每条候选建成进北极星原型(`docs/northstar/PROGRAM.md` 流程)之后,由 founder 走城逐页 **keep / cut**;走城判决记入 `docs/northstar/APPROVALS.md`,本表本身不做二次判决。
3. 候选被 founder keep 之后,**点亮(接后台、通电)时仍需完整过闸**:costing(定价终案毛利地板)、钱路(`money-safety-review`)、`lint:parity`(Otto 对等)—— 原型层"默认全做"不等于点亮层免检。
4. 排除清单里的项**永不复活**,除非 founder 亲自改宪法第 8 条或推翻既有判决;新扫描发现的排除理由须可查证(对应研究文档 / GRILL 判决 / 宪法条款)。
