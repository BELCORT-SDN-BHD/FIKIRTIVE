# B8 · CRM 起步形态 —— 设计全图

> **性质**：路线乙 B8 块设计工位交付物（docs-only，非 spec、非 schema、非代码）。epoch `claude-20260712-03` 工单 L4a·试产。
> **基线**：main@`1b1414d9`（含 B0 发布契约 #240）。矩阵签署件为界：`docs/archive/route-b/matrix/08-B8.md`。
> **定位（蓝图第六章 CRM 行）**：respond.io 级 SMB-lite 起步 → 架构按 Salesforce 级终局设计；联系人主要从对话/广告自动进来，WhatsApp-first；帮商家收款 = 以后且起步不碰资金流。
> **本文档同时是后续设计工位的模板范本**：12 节铁律，宁写「无」不留空；术语带人话对照；不发明 feature（只来自对标 + 判决 + 矩阵行）。
> **不写已退役的本地 Route-B 台账**：状态与证据写入对应 current GitHub task/PR，不在本文件复制 current truth。

---

## 一、范围与矩阵行映射（含明示排除）

### 1.1 本设计覆盖的能力行（矩阵签署件 `08-B8.md`）

| 功能ID | 能力（人话） | 批准来源 | 本文档落点 |
|---|---|---|---|
| B0-59 | 联系人自动进来（跨渠道互动自动建档/更新） | 宪章「CRM 起步」；P2-2（Contact/ContactIdentity）；红旗三 | §3 联系人名册 + §6 身份解析规则 + 事件写入 |
| B0-60 | 联系人档案页 | A′ crm/contact-profile+contacts（切片7） | §3 档案页 + §4 六态 + §6 字段契约 |
| B0-61 | 联系人分群（含高价值/VIP 识别）〔NL→规则编译走宪法10（确定性）〕 | 宪章点名分群；P3-2 Segment（确定性规则编译）；A′ crm/segments | §3 分群页 + §5 双执行 + §6 Segment 契约 |

一句话总纲：**「联系人自动进来 → 看得懂每个人是谁 → 一句话把人分成群」** 三步闭环，是 L2（收件箱）/L4（唤回）的**对象载体**——没有 CRM 起步，唤回无人可唤、群发无群可发。

### 1.2 接口面（本设计只画边界，不建对方的楼）

| 邻块 | 接口行 | 边界（谁写谁读见 §6.4） |
|---|---|---|
| **B7** 唤回+生命周期 | B0-44（同意 opt-in/opt-out）、B0-45（抑制名单=运行时硬约束非字段）、B0-46（频控） | CRM **写+展示** consent 字段；B7 运行时**读** consent + 强制抑制/频控 |
| **B5** WhatsApp 收件箱 | B0-31（共享收件箱真对话）、B0-37（售前对话/订金链接）、B0-38（对话视图人+Otto 同台） | 收件箱**首次入信即建档**（写 Contact/Identity）；档案页**只读链回**对话；报价/收款链接归 B5 |
| **B2** 量测 L0 + 分析 | E5-06（六张量测原语表含 AttributionEvent/SourceTag）、B0-09（口碑效果衡量归 B2） | 联系人进线**写** AttributionEvent（首触归因）；效果**数值**在 B2 读，不在 CRM 自算 |

### 1.3 明示排除（范围外，写清出处）

| 排除项 | 出处 | 处置 |
|---|---|---|
| **Deal / PipelineConfig（销售管道）** | `matrix/OUT.md` OUT-DEAL；宪章「CRM 起步」范围仅联系人+分群+同意退订抑制 | 起步形态**不建**；A′ 档案页/名册页里的「Deals」卡、`crm/deals` 整页**不入本程**。P3-2 管道部分留 P3 远期。 |
| **Company B2B 档案** | `matrix/OUT.md` OUT-COMPANY；MASTERPLAN P4-2 远期 | **不建**；A′ 名册页底部「Companies」卡、档案页「B2B 公司」链**不入本程**（harmony-01 §三 #15：respond.io 级不需要，SF 级才要）。 |
| **市政厅 v2（团队阶级制度）** | `matrix/OUT.md` OUT-CITYHALL；宪章 §二 | **不建**；CRM 起步 = 单商家单席位可用，租户内 RBAC/审批席不阻断起步（宪法 7 债记宪章）。 |
| **报价单 + 收款链接**（A′ 档案页 Quotes & payment 卡） | 蓝图边界四层表「售前成交对话」归本体，落 B5 B0-37（售前订金/付款链接） | **归 B5**；档案页起步**不含**报价卡。此为「售前对话与成交促进」，属收件箱域，不属 CRM 起步。见 §11.4。 |
| **口碑/转介绍/忠诚效果的数值衡量** | B0-09（归 B2；状态与证据写对应 GitHub task/PR）；MISSING-CONTINENTS 第2名工作7 | 归 B2；CRM 只提供联系人这一**对象底座**，不自算 NPS/复购率。 |

> **模板注**：A′ 沉浸城原型是「CRM+口碑+忠诚」揉在一起的 endgame 全图；起步形态必须**做减法**——把 Deal/Company/报价/忠诚从档案页与名册页剥回各自的家。本节的「页内剥离」清单是本试产最容易被后续工位忽略的一处，特此显式列表。

---

## 二、对标锚清单（spec-ready 硬门 —— 无锚不开工，§六 水准判官格式）

> **锚的作用**：六级状态 `spec-ready` 的升级证据之一 = 锚清单（`B0-CONTRACT.md` §一第 1 级）。本节冻结**对标对象 + 版本 + 关键旅程 + 通过阈值 + 并排截图打分法**；效果过堂对锚评（平齐/超过/未及 → 未及项链待裁）。
> **诚实标注**：下表版本为本设计工位知识截止时的近似值，**spec 冻结当日必须实机复核版本号并抓真截图**（列入 §8 假设台账 A-07）。锚是活清单，新增走「深研 → WHAT-pass」。

### 2.1 锚一：respond.io（**起步形态基准** —— KL 同城直接对手，蓝图点名）

- **对象**：respond.io Contacts / Segments / Lifecycle（$79 起步档即含线索获客与联系人）。
- **版本**：Web 应用 2026 版（复核项 A-07）。
- **关键旅程（对锚评的三条）**：
  1. **联系人自动进来**：一条 WhatsApp 新会话 → 自动建 Contact + 打「首触渠道/来源」标签 → 出现在名册顶部「New」。
  2. **档案页全貌**：打开一个联系人 → 看到多渠道身份合一、consent 状态、会话历史、生命周期阶段，一屏读懂「这人是谁」。
  3. **分群**：把联系人按标签/渠道/是否可群发存成一个可复用筛选器，计数实时。
- **通过阈值（起步形态=平齐即可上市）**：三条旅程功能**齐**（不缺项）+ 零学习曲线（分群不需要学公式）+ **双 100%**（Otto 能替做同一件事）。respond.io 把这三条放最低价档 → 我们判定这是**获客基本盘**，起步必须平齐，不是高阶。
- **我们要赢在哪**：联系人从**对话/广告自动进来**（对手要手工或导入为主）；Otto 用**品牌记忆**替店主分群/起草唤回。

### 2.2 锚二：HubSpot Smart CRM（**联系人档案深度基准**）

- **对象**：HubSpot Smart CRM 的 Contact record（联系人记录页）+ 自定义属性 + 时间线（activity timeline）。
- **版本**：HubSpot 2026 Smart CRM（复核项 A-07）。
- **关键旅程**：
  1. **联系人记录页信息架构**：一屏内「概览属性 / 活动时间线 / 关联对象」三分，专业但不吓人。
  2. **自定义字段（custom properties）**：店主给联系人加一个自己的字段（文本/数字/日期/下拉）。
  3. **字段变更留痕**：谁在什么时候改了哪个字段，可审计（我们复用 ActionEvent，判决「可直接纳入 12 项」）。
- **通过阈值**：档案页信息**密度得当**（对齐蓝图 Analytics 屏 gold standard 的质感），时间线**汇流成一条**（来源/导入/回复/任务），自定义字段**双模等价**。
- **诚实分级**：档案深度（自定义字段/时间线全量）判为 **B 档（对标平齐）**，起步 A 档可先给**只读时间线 + consent + 身份合一**，自定义字段进 B 档（见 §9）。

### 2.3 锚三：Klaviyo（**CDP 画像/分群基准**）

- **对象**：Klaviyo 的 Profiles + Segments（行为事件驱动的动态分群）+ 预测分析（predicted CLV / churn risk）。
- **版本**：Klaviyo 2026（复核项 A-07）。
- **关键旅程**：
  1. **NL/条件建群**：用条件（消费额/活跃度/渠道）建一个**动态**分群，成员随数据自动进出。
  2. **画像信号**：档案上显示「热度/预计下次消费/流失风险」等派生信号。
  3. **可群发性（consent-aware）**：分群天然区分「可营销/勿扰」，群发只打可联系的人。
- **通过阈值**：分群规则**确定性可解释**（宪法 10：规则来自结构不来自模型天赋，店主存前能看见 chip 预览）；派生信号**有一句人话理由**（不是裸数字打分）；可群发性**默认合规**。
- **诚实分级**：Klaviyo 级行为事件 + 预测 CLV 判为 **C 档（超越）**；起步 A 档给**确定性规则编译**（消费门槛/渠道/N 天活跃/标签/可联系五类）+ 内建生命周期分群（Hot/Win-back）。VIP 识别 = 确定性规则（见 §6.3、§12-Q3）。

### 2.4 并排截图打分法（水准判官统一配方 —— 后续工位照此格）

> 目的：把「对标平齐」从口号变成可复跑的机器/人工闸。每块 spec-ready 与终验各跑一次。

1. **抓图规则**：同一视口（桌面 1280×800 + 移动 390）、同一旅程的**终态**（不是空态）、对手真账号真数据 vs 我方 staging 真数据。每条关键旅程一对图，命名 `anchor-<锚>-<旅程>-{them,us}.png`，作为 exact-head 附件/链接写入对应 GitHub task/PR。
2. **五维打分（每维 0/1/2，满分 10）**：
   - **功能完整度**（对手有的关键动作我方有无）
   - **信息密度得当**（不缺不挤，对齐 Analytics 屏 gold standard）
   - **零学习曲线**（术语带人话/无需学公式/一次会话见成果，宪法 11）
   - **视觉质感**（Apple 标杆 + coral 只属于 Otto，宪法 11）
   - **双模覆盖**（同一件事 Otto 能否 100% 代做，宪法 7）
3. **判级**：
   - **平齐** = 功能维 ≥ 对手分 **且** 质感维 ≥ 我方基准（Analytics 屏）分；
   - **超过** = 平齐 + 至少一维严格高于对手（我方胜负手：自动进线 / Otto 代做）；
   - **未及** = 任一维 < 对手 → **进待裁清单**（发生了什么/试了什么/差距/2-3 选项），不藏（终验第⑫节）。
4. **门槛**：起步上市要求三锚各自「关键旅程」全部达**平齐**；「超过」是加分不是门槛；「未及」必须显式登记待裁。

---

## 三、信息架构与页面清单（对齐 A′ crm 4 页，做减法）

> A′ 沉浸城 `crm/` 实测 4 页：`contacts` / `contact-profile` / `segments` / `deals`。起步形态**保留 3 页、剥离 1 页**。

| # | 页面（人工入口路由） | 保/删 | 理由 | 承载能力行 |
|---|---|---|---|---|
| 1 | `crm/contacts` 联系人名册 | **保** | B0-59 自动进来的着陆面 + B0-61 入口 | B0-59 |
| 2 | `crm/contact-profile` 联系人档案 | **保**（做减法） | B0-60；剥离 Deals/Companies/Quotes 卡（§1.3） | B0-60 |
| 3 | `crm/segments` 分群 | **保** | B0-61；NL→确定性规则编译 | B0-61 |
| 4 | `crm/deals` 交易管道 | **删** | OUT-DEAL；起步不建管道 | —（出程） |

### 3.1 页面一 · 联系人名册（`crm/contacts`）

**信息架构（A 档最小版，自上而下）**：
- 页头：标题 + 「Add lead（手工加）」+「Import（CSV 导入，B 档）」+ CRM 内导航。
- 四张数据卡：联系人数 / 累计订单额（只读自回执，§11.3）/ 现在几个「热」/ 在险金额（唤回锚）。
- **Otto 洞察条**（CRM 唯一 coral 触点）：一句人话，不是数字打分（例「3 位联系人看起来很热，趁还在你脑子里回一句」）。
- 名册列表：头像 + 名字 +（New 徽章）+ 热度徽章 + 生命周期徽章 + 来源 + 渠道标 + 累计订单额 → 整行点开档案。
- 搜索 + 热度筛选 chip（All/Hot/Warm/Cold）。

**A′ 已有、判为 B 档后置的件**：CSV 导入向导（贴表→映射→查重→确认）、查重合并提示条、流失唤回条（预填草稿+复制不发）、预测「下次消费」列。理由见 §9。

### 3.2 页面二 · 联系人档案（`crm/contact-profile`，做减法后）

**保留卡（A 档核心）**：
- 头部：头像 + 名字 + 热度/生命周期/来源 chips + 「来自哪个入口」一句话。
- **Identities（多渠道身份合一）+ consent/勿扰开关**：每个渠道一行（WhatsApp/IG/FB/email…）+「Okay to message」开关（写 consent，§6.4）+「Merge duplicate」入口。
- **Activity（活动时间线）**：来源/导入/回复/任务汇成一条流——「这人从哪来 + 之后发生了什么」。是「自动进来」故事的证据面。
- **字段变更留痕**（折叠）：复用 ActionEvent（判决「可直接纳入」）。
- **Conversations（只读链回 B5）**：列出与此人的会话线程，点开跳收件箱。

**B 档后置卡**：自定义字段、待办任务（follow-up）。
**剥离卡（§1.3）**：Deals（OUT-DEAL）、Quotes & payment（B5）、B2B 公司（OUT-COMPANY）。

### 3.3 页面三 · 分群（`crm/segments`）

**信息架构**：
- 左栏：已存分群列表（内建生命周期分群 + 自建分群），每个显示实时命中数。
- 右栏：选中分群 → 命中联系人列表（每人链回档案）+ 勿扰者标禁用态 +「Post to this group」→ 排期（B4）。
- **New segment 建群对话框（B0-61 核心）**：人话描述框 →「Otto 帮我」把老板原话落进描述 → **确定性规则编译**成 chip 预览（消费门槛/渠道/N天活跃/标签/可联系）+ 实时命中数「X 命中 · Y 可群发」→ 命名（可选）→ 存。
- **内建生命周期分群**（一等公民）：Hot right now / Win-back（流失唤回）——lifecycle 分群不靠店主自建。
- **预建生命周期自动化配方库**（欢迎新客/唤回/复购/生日）：开关式（判决「可直接纳入」NS_RECIPES）；**注意配方=自动化，归 B7 落地**，CRM 分群页只作**入口展示**（§11.2 边界）。

---

## 四、每表面六态（happy / empty / loading / denied / failure / retry + 移动端）

> 六态是六级状态 `sandbox-verified` 的证据（双执行器都走）+ 终验第⑥节全旅程证据。逐表面列，宁写「无」不留空。

### 4.1 联系人名册（`crm/contacts`）

| 态 | 表现 |
|---|---|
| happy | 名册有人；数据卡实数；热度/来源/金额齐；Otto 洞察条一句人话。 |
| empty | 全新商家零联系人：不显示裸空表，显示「联系人会自动进来——连上 WhatsApp/接一条广告线索，第一个人就出现在这里」+「或手工 Add lead」。**空态即教学**（宪法 11 自解释）。 |
| loading | 骨架屏（skeleton）占位卡 + 列表行骨架；不闪空态再填（避免布局跳动）。 |
| denied | 非本租户/未登录 → requireOwner 拦截，回登录；跨租户读一字节=事故（宪法 6）。**CRM 页不对 Otto 冒充态开放写**（市政厅豁免与此无关，CRM 是商家自有面）。 |
| failure | 名册加载失败：错误卡「暂时读不到你的联系人」+「重试」按钮；不吞错、不假装空。 |
| retry | 点重试 → loading → happy/failure；重试幂等不重复建档。 |
| 移动端 | 单列；数据卡 2×2；行内渠道标折叠进次行；筛选 chip 横滑；Otto 洞察条常驻顶部。 |

### 4.2 联系人档案（`crm/contact-profile`）

| 态 | 表现 |
|---|---|
| happy | 身份合一、consent 开关、时间线、会话链齐。 |
| empty | 新建档但零活动：时间线只有「Came in via <来源> · <日期>」一条；会话卡「No conversations yet」；consent 默认「unknown」显式标注（不假装已同意，§6.4）。 |
| loading | 头部 + 卡骨架；`id` 查询中。 |
| denied | 联系人不属本租户 → EmptyState「Contact not found / 可能已被移除」（不泄露存在性）。 |
| failure | 某卡数据失败**局部降级**（该卡显错+重试），不整页崩——时间线失败不该拖垮身份卡。 |
| retry | 局部重试各卡独立。 |
| 移动端 | 卡纵向堆叠；身份行渠道标 + handle 两行；Merge/开关触达区≥44px。 |

### 4.3 分群（`crm/segments`）

| 态 | 表现 |
|---|---|
| happy | 左栏分群 + 右栏命中人；建群对话框 chip 预览实时命中数。 |
| empty | 零自建分群：左栏只有内建生命周期分群；右栏「选一个分群看命中的人」引导。**建群词不中**（`compileSegmentPhrase` 返回空）→ 提示可用词「spent over RM500 / on Instagram / active in last 30 days / 标签」+「Otto 帮我」兜底（stall 治理）。 |
| loading | 命中数计算中显骨架数字（避免 0→真数跳变误导）。 |
| denied | 同 requireOwner。 |
| failure | 存分群失败：对话框保留店主输入（不清空）+ 错误提示 + 重试；已编译规则不丢。 |
| retry | 重试存群幂等（同 owner+同 phrase+同 rules 不重复建）。 |
| 移动端 | 左右栏改上下：分群列表上、命中人下；建群对话框全屏 sheet。 |

> **模板注**：`denied` 与 `failure` 是后续工位最易漏的两态——凡涉租户数据的页，`denied` 一律 requireOwner + 不泄露存在性；`failure` 一律**局部降级 + 显式重试**，禁止「转圈到天荒地老」或「失败假装空」（宪法：状态诚实）。

---

## 五、人工 / Otto 双执行矩阵（宪法 7 双 100%）

> 每能力一行：人工路径 + Otto 话术例（含设置/异常/取消）。数据面走**同一批 server actions**（harmony-01 §一③：没有 Otto 专用表/专用实现）。Otto 经动作层，不做像素操作（宪法 11）。

| 能力 | 人工路径 | Otto 话术例（设置 / 异常 / 取消） |
|---|---|---|
| **建群**（B0-61） | 分群页 →「New segment」→ 打描述 → 看 chip 预览 → 存 | 设置：「Otto，把常买的批发客户建成一个群」→ Otto 编译规则、回「这会变成这些规则（chip），现在命中 12 人、9 人可群发，要存吗？」→ 店主点批准。异常（词不中）：「我不太确定门槛，你是指消费超过 RM 多少？」（追问澄清而非乱猜）。取消：「先不存」→ 不落库。 |
| **给联系人打勿扰/改可群发**（B0-60↔B7） | 档案页「Okay to message」开关 | 设置：「把这个客户设成勿扰」→ Otto 写 consent=opt_out。异常（此人正在活跃会话）：Otto 提示「他昨天还在问单，确定勿扰？」。取消：不写。**Otto 永不代客户做 opt-in**（同意必须来自客户动作，§6.4）。 |
| **合并重复联系人**（B0-60） | 名册查重条 / 档案「Merge duplicate」→ 并排比对 → 确认保留哪条 | 设置：「这两个是同一个人，合并」→ Otto 走确定性判据（强标识匹配才建议，§6.3），回并排比对卡请店主确认。异常（无强标识、仅同名）：Otto **不自动合并**，标「可能重复」请人工判。取消：不合并、不删数据（永不物理删，harmony-01 §四②）。 |
| **手工加联系人**（B0-59 兜底） | 名册「Add lead」表单 | 「加一个客户：Siti，WhatsApp 012-xxx，来自市集」→ Otto 建 Contact+Identity+来源标签。异常（号码已存在）：命中唯一索引 → 回「这人已经在你名册里了，打开档案？」。取消：不建。 |
| **CSV 导入**（B 档，B0-59） | 名册「Import」→ 贴表→映射→查重预览→确认 | 「把这份客户表导进来」→ Otto 解析、映射列、预览查重、回「38 条新增、4 条疑似重复，重复的先跳过？」→ 店主确认。异常（格式乱）：Otto 指出哪几行读不了。取消：不导入。 |
| **看某人是谁 / 找人**（B0-60 读） | 名册搜索 / 打开档案 | 「Siti 上次买了什么、能不能发她消息」→ Otto 读档案回一句人话（读对等：宪法 7 free/read skill）。 |
| **对一个群起草唤回**（分群→B7 交接） | 分群页「Post to this group」→ 排期 / 名册唤回条「Copy 草稿」 | 「给沉默的批发客户起草一条唤回」→ Otto 用品牌记忆起草、**只起草不发**（发=外部写=审批闸，§7）。取消：丢弃草稿。 |

> **双模缺口债**：每条 Otto 列若起步未实现，必登记 `missing(debt-nn)` 挂 `parity-debt.md`，B8 块验收=债清零（`B0-CONTRACT.md` §三）。新 Otto 能力 = 新 skill（缝 1，见 §10）。

---

## 六、数据契约需求单（本试产最关键输出 —— 喂给 B2 数据契约 spec，可直接消费）

> **原则**：**不发明新对象**。Contact / ContactIdentity / Segment 的形状已由 `harmony-01` §三定死（#7、#13），本节只**具体化起步形态需要哪些字段、写什么事件、身份怎么判同人、consent 谁读谁写**。全部 additive migration，遵守建筑规范（harmony-01 §一④按终局设计按阶段落地）。租户铁幕：每表带 `ownerId`（无默认）+ 进 `TENANT_MODELS` 守卫 + 领头 `(ownerId, …, deletedAt)` 索引（harmony-01 §一②）。

### 6.1 需要的表 / 字段（起步 A 档）

**表 A · Contact**（harmony-01 #7）— 客户唯一档案：

| 字段 | 类型 | 起步必需 | 说明 / 出处 |
|---|---|---|---|
| `id` / `ownerId` | id | ✅ | 租户隔离领头键 |
| `name` | text | ✅ | 显示名 |
| `lifecycleStage` | enum | ✅ | 生命周期阶段（起步值域见 §12-Q1，判决 N respond.io 阶段「归 P3 CRM 时再议」） |
| `source` | text | ✅ | **首触来源人话标签**（「来自哪个入口」，MISSING-CONTINENTS 首触来源） |
| `firstTouchCampaignId` | fk? 可空 | ✅ | 归因用（harmony-01 §四②：从 identity 首触 campaign 记） |
| `firstTouchAt` / `lastSeenAt` | ts | ✅ | 进线时间 / 最近可见（热度/活跃度算子输入） |
| `marketingConsent` | enum(`opt_in`/`opt_out`/`unknown`) | ✅ | **同意状态**（§6.4；默认 `unknown` 不假装同意） |
| `consentSource` / `consentAt` | text / ts | ✅ | 同意从哪来、何时（PDPA 姿态，B13） |
| `doNotDisturb` | bool | ✅ | 勿扰（档案页开关写入；与 opt_out 语义区分见 §6.4 注） |
| `heat` | enum(`hot`/`warm`/`cold`) | ⬜派生 | 起步可**派生不落列**（由 lastSeenAt/活跃度算），避免脏缓存；落列=B 档优化 |
| `totalOrdersMyr` | money | ⬜只读 | **只读自回执/EasyStore**（§11.3），CRM 不自建账本（宪法边界四层「读取并验证」） |
| `createdAt` / `deletedAt` | ts | ✅ | 软删（永不物理删） |

**表 B · ContactIdentity**（harmony-01 #7）— 多渠道身份：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `contactId` | fk | 指向 Contact |
| `channel` | enum(`whatsapp`/`instagram`/`facebook`/`email`/…) | 渠道 |
| `externalId` | text | 渠道内唯一标识（waPhone E.164 / igPsid / fbPsid / email 小写） |
| `handle` / `label` | text | 展示用 |
| `createdAt` / `deletedAt` | ts | |
| **唯一索引** | — | **`(ownerId, channel, externalId)`**（harmony-01 §七钉子 + P2-2）——防重复建档的机器闸 |

**表 C · Segment**（harmony-01 #13）— 分群：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id | |
| `name` | text | 分群名 |
| `phrase` | text | **NL 原文**（店主原话，可回看） |
| `rulesJson` | jsonb | **确定性编译产物**（宪法 10：不存模型输出，存规则） |
| `kind` | enum(`builtin_lifecycle`/`custom`) | 内建 vs 自建 |
| `createdAt` / `deletedAt` | ts | |

- **成员物化 vs 实时算**：harmony-01 #13 写「+ 物化成员表」。起步 A 档**实时算**（`contactMatchesRules` over 联系人）即可满足 SMB 体量；**物化 SegmentMember 表 + 重算触发**是 B/C 档规模优化（Klaviyo 动态分群级），列 §9 与 §12-Q4。契约上预留：Segment 规则是**纯函数可重算**，物化只是缓存，不改语义。

### 6.2 事件写入（什么动作写什么 AttributionEvent —— B2 直接消费）

> AttributionEvent / SourceTag 是 B2 的 E5-06 六原语。CRM 是**写方**，B2 是**读方+算方**。下表 = CRM 触发的写入清单。

| 触发动作 | 写谁 | 事件/字段 | 归属块 |
|---|---|---|---|
| 收件箱首次入信（新 externalId） | Contact + ContactIdentity + AttributionEvent | `kind=contact_created`，`source=<渠道>`，`firstTouchAt`；`firstTouchCampaignId` 若入信带 SourceTag/短链则回填 | 写触发在 **B5 入信 handler**，CRM 消费展示 |
| 广告线索进线（Meta lead / 短链 / QR） | Contact + Identity + AttributionEvent | `kind=contact_created`，`source=ad/qr/link`，`firstTouchCampaignId` 从 SourceTag 解析 | 写触发在 **B2/L0 归因**，CRM 消费展示 |
| 扫码欢迎流（B7 B0-50） | Contact + Identity + 来源标签 | `source=<QR 贴放位置>`（QrPlacement） | 写触发在 **B7 欢迎流**，CRM 消费展示 |
| 手工 Add lead | Contact + Identity | `source=manual` | **CRM 自身写** |
| CSV 导入（B 档） | Contact + Identity（批量，查重后） | `source=imported` | **CRM 自身写** |
| 合并联系人 | 重指 Identity.contactId + merge 审计 | **不删数据**（harmony-01 §四②） | **CRM 自身写** |
| 改 consent/勿扰 | Contact.marketingConsent / doNotDisturb + 字段变更留痕 | 复用 ActionEvent | **CRM 自身写** |

> **关键边界**：「联系人自动进来」的**写入点在邻块（B5/B2/B7）**，CRM 起步页面**只读消费 + 展示**这些自动建的档。CRM **自身只写**手工/导入/合并/consent 四类。这条边界让 B2 数据契约 spec 知道：Contact 的 upsert 逻辑要放在**入信/归因/欢迎流的共享 server action**里，不要每个入口各写一套（单一动作层，宪法 7）。

### 6.3 身份解析规则（跨渠道判同人 —— 确定性，宪法 10）

> 「跨渠道合并靠 Identity 表，不靠猜」（harmony-01 §四②）。起步规则**纯确定性**，禁止模型/模糊自动合并：

1. **入信 upsert 判据**：以 `(ownerId, channel, externalId)` 唯一索引 find-or-create。同一 externalId 再次入信 = 命中已有 Identity → 更新 Contact.lastSeenAt，**不新建**。
2. **自动合并（强标识才允许）**：仅当两条 Identity 的**强标识精确相等**才可系统建议合并——同 waPhone（E.164 规范化后）、同 email（小写化后）、同 fbPsid。规范化规则须写死（去空格/加国码/大小写），列 §12-Q5 待钉。
3. **禁止自动合并的情形**：仅同名、仅相似 → **不自动合并**，在名册顶部标「可能重复」请人工在档案页并排比对确认（对齐 A′ `duplicatePairs`）。
4. **合并动作语义**：把被合并方的 Identity **重指**到保留方 Contact + 写 merge 审计；**永不物理删**（可逆、可追溯）。
5. **归因继承**：合并后首触归因取**较早的 firstTouchAt / firstTouchCampaignId**（不丢最早来源）。

### 6.4 consent / 退订字段 与 B7 抑制名单的读写边界（逐条）

> 这是 CRM↔B7 最容易撞车的接缝，逐条钉死谁写谁读：

| 项 | 谁写 | 谁读 | 边界说明 |
|---|---|---|---|
| `marketingConsent`（opt_in/opt_out/unknown） | **CRM**（档案页手工）+ **B7**（入信退订关键词 handler 写 opt_out）+ **B2/欢迎流**（明确 opt-in 动作写 opt_in） | B7 运行时（发前）+ CRM（展示）+ 分群 contactable 规则 | consent 是**字段**，落 Contact 表；CRM 拥有展示与手工编辑，B7 拥有「入信 STOP→opt_out」的自动写 |
| `doNotDisturb`（勿扰开关） | **CRM**（档案页开关） | B7 运行时 + 分群 | 与 opt_out **语义区分**：doNotDisturb=店主主观「先别打扰」（可逆软状态）；opt_out=客户法定退订（合规硬状态）。**两者任一为真 → 不可群发**。〔Q6：是否合并为单一状态，见 §12〕 |
| **抑制名单**（B0-45） | **B7 运行时**（判决 7-9：硬编码进 agent 运行时，**非字段**） | B7 自动化系统层（发前跳过） | **不是 CRM 表**——抑制名单是运行时硬约束（origami 判决）。CRM 只提供 consent/DND 字段作为**输入之一**；抑制名单还含频控（B0-46）等运行时因素。CRM 不建、不写、不读抑制名单本体。 |
| **频控**（B0-46） | B7 | B7 运行时 | 与 CRM 无字段交叉；CRM 不涉及。 |

> **给 B2 的一句话**：CRM 交付 Contact 上的 `marketingConsent` + `doNotDisturb` 两个字段作为**发送资格的数据输入**；发送资格的**最终裁决**（叠加抑制名单/频控）在 B7 运行时，不在 CRM。分群的「可群发/contactable」规则 = `marketingConsent=opt_in AND NOT doNotDisturb`（起步定义，Q6 可调）。

---

## 七、权限 / 花费闸逐行初判（CRM 基本 $0；标任何潜在花费点）

> 审批数学（宪法 4）：`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`。CRM 起步几乎全是**内部读写**（reach=internal），故基本 $0、基本 `needsApproval=❌`。逐行：

| 动作 | cost | effect | reach | needsApproval | 闸 |
|---|---|---|---|---|---|
| 看名册 / 档案 / 分群（读） | 无 | read | internal | ❌ | 无（requireOwner） |
| 建群 / 存群（人工点，纯规则编译落库） | 无 | write | internal | ❌ | 无 |
| 打 consent/勿扰 / 合并 / Add lead / 改字段 | 无 | write | internal | ❌ | 无（字段变更留痕即可） |
| CSV 导入（B 档） | 无 | write | internal | ❌ | 无（查重预览是 UX 闸不是钱闸） |
| **Otto 编译分群（LLM 轮）** | **turn 计量** | write(建议) | internal | ⚠️例外① | **宪法 4 例外①：turn 计量类**（Otto LLM 按轮 reserve→settle，余额即闸；不逐次弹审批）。**注**：分群本体是确定性编译（`compileSegmentPhrase` 纯代码 $0），Otto 只在「帮我落描述」时耗一轮 LLM——这轮走 Otto 通用轮计费，不是 CRM 新收费点。 |
| **对群起草唤回文案**（Otto，起草） | turn 计量 | write(草稿) | internal | ⚠️例外① | 起草=内部；**发**才是 external write |
| **对群/对人真发消息**（唤回/群发） | 通道费 | write | **external** | ✅ | **归 B7/B5**，不在 CRM 起步。发=外部写=审批闸；通道费走第二账道（宪法 5）。CRM 只到「起草+交接」为止。 |

- **结论**：CRM 起步**无自有收费点、无 mock-变真💰行**（对照 `08-B8.md`：B0-59/60/61 三行的闸列本设计初判为「无（$0 内部读写）」，Otto 轮计费与真发消息的💰点**归属邻块**）。
- **红线**：任何「对群一键发」若日后收口到 CRM 页面，必**过 `money-safety-review`** 且走审批公式——起步明确不做（只起草不发，§5）。

---

## 八、假设台账（每假设：依据文件:行 / 待验证方法）—— 设计闸门

| # | 假设 | 依据 | 待验证方法 |
|---|---|---|---|
| A-01 | Contact/ContactIdentity/Segment 形状沿用 harmony-01，起步只做字段子集 + additive | `harmony-01` §三 #7/#13、§七钉子 | B2 数据契约 spec 时对 harmony-01 逐字段核；migration additive 校验 |
| A-02 | 「自动进来」的写入点在 B5/B2/B7，CRM 只消费 | `MISSING-CONTINENTS:47`「承接端已建好」；harmony-01 §四② | B5/B7 spec 联审：确认 upsert 共享 action 落哪块 |
| A-03 | consent 是字段、抑制名单是运行时（非字段） | 判决 7-9（origami）；`07-B7.md` B0-45 | B7 spec 联审确认边界（§6.4） |
| A-04 | 分群规则纯确定性编译，Otto 只作「帮我落描述」 | 宪法 10；O-09 判决（规则/自动化域不用画布）；A′ `compileSegmentPhrase` | 编译器规则表 spec 化 + 单测覆盖五类规则 |
| A-05 | VIP/高价值 = 确定性规则（消费门槛+活跃度），不是模型打分 | `08-B8.md` B0-61 尾注；`MISSING-CONTINENTS:61`「识别 VIP」 | **founder 钉 VIP 定义**（§12-Q3）——阈值/是否内建分群 |
| A-06 | 起步分群成员**实时算**，物化是规模优化 | harmony-01 #13「+物化成员表」（终局） | 体量过目时定档（§9）；契约预留纯函数可重算 |
| A-07 | 三对标锚版本为近似，spec 当日复核 | 本文 §2 | spec 冻结日实机抓版本号 + 并排截图作为 exact-head 附件/链接写入对应 GitHub task/PR |
| A-08 | 档案页 Deals/Companies/Quotes 剥回邻块，不阻断起步 | `OUT.md` OUT-DEAL/OUT-COMPANY；蓝图边界四层表 | A′ 页做减法后 UI 走查确认无断链 |
| A-09 | `totalOrdersMyr` 只读自回执/EasyStore，CRM 不自建账本 | 蓝图边界四层表「读取并验证」；`06-B6.md` | B6 回执 spec 联审读取契约；起步无回执时该字段=空/隐藏 |
| A-10 | lifecycleStage 值域起步待 founder，判决曾「归 P3 再议」 | 判决 N（respond.io 阶段）`GRILL-VERDICTS:147` | §12-Q1 待裁 |

---

## 九、深度档位 A / B / C + 成本估算（founder「体量过目」直接输入）

> 三档，founder 用 Q6 机制逐项裁「本程做多深」。工作量级为**相对量级**（非工时承诺）。

### A 档 —— 最小可上市（L2/L4 的对象载体够用）

- **页面**：3（名册 / 档案-做减法 / 分群）。
- **新表**：3（Contact / ContactIdentity / Segment，起步字段子集）+ 复用 AttributionEvent/ActionEvent。
- **能力**：自动进来（消费邻块写入）+ 手工 Add lead + 搜索/热度筛选 + 档案（身份合一/consent/时间线/会话链）+ 分群（确定性编译五类 + 内建 Hot/Win-back）+ 双模。
- **工作量级**：中。**风险**：身份解析正确性（去重/规范化）、consent↔B7 边界对齐。
- **判定**：**满足 respond.io 级起步平齐门槛**（§2.1 三旅程齐）——这是上市下限。

### B 档 —— 对标平齐（respond.io 全 + HubSpot 档案深度）

- **A 档 +**：CSV 导入向导（映射/查重预览）、查重合并主动提示、自定义字段（文本/数字/日期/下拉）、follow-up 待办任务、流失唤回条（预填草稿+复制不发）、预测「下次消费」列、更多编译规则类（生日/复购间隔）。
- **新增表/字段**：ContactCustomField（或 JSONB 扩展）、ContactTask（若不复用现有 todo）。
- **工作量级**：中→大。**风险**：自定义字段的双模等价 + 时间线信息密度不过载。
- **判定**：HubSpot 档案深度平齐；respond.io 完全平齐。

### C 档 —— 超越（Klaviyo CDP 级 + Otto 主动）

- **B 档 +**：物化 SegmentMember + 实时成员进出（live reflection 秒级，宪法 11）、行为事件驱动分群、预测 CLV/流失风险（确定性算子+一句人话理由）、Otto **主动**提议分群/唤回（不等店主问）、跨渠道身份自动合并含置信度门槛。
- **工作量级**：大。**风险**：预测算子若滑向「模型天赋」违宪法 10；物化重算的成本/延迟；Otto 主动性与「永不抢占主场」的平衡（宪法 11）。
- **判定**：Klaviyo 级「超过」，是胜负手加分档，非上市门槛。

> **建议（仅在 founder 问时）**：起步锁 **A 档**上市，**B 档的 CSV 导入 + 查重合并**因「获客基本盘」价值高、工程量小，建议提前进 A→A⁺；自定义字段/预测/物化留 B/C 按收入排队。最终由 founder「体量过目」裁。

---

## 十、九缝映射（每个新件走缝几；新 Otto 能力 = 缝 1 skill 名列表）

| 新件 | 走哪条缝 | 说明 |
|---|---|---|
| Contact / ContactIdentity / Segment 三表 | **缝 5**（Tenant model：requireOwner + ownerId 全链 + TENANT_MODELS 守卫） | harmony-01 §一②强制 |
| 三个 CRM 页面 UI | **缝 7**（.gb + shadcn 单一设计系统；coral 只属 Otto） | Otto 洞察条=唯一 coral 触点 |
| 联系人 upsert / 建群 / 合并 / consent 等 server actions | **缝 9**（Parity Manifest：每个 action 出生即配 skill 或明示豁免，CI 拦截） | 宪法 7 机器围栏 |
| AttributionEvent 消费（首触展示） | **缝 5**（读，租户隔离） | 写在 B2/L0；CRM 读 |
| （B/C 档）物化 SegmentMember 重算 | **缝 6**（Queue/worker：异步重算 + 回收器） | 仅 B/C 档需要 |

**新 Otto 能力 = 缝 1（defineOttoSkill）skill 名清单**（3 字段 + 注册五步；起步）：

| skill 名（建议） | 类型 | 能力 |
|---|---|---|
| `listContacts` / `getContact` | free/read | 读名册/档案（读对等，宪法 7） |
| `searchContacts` | free/read | 按名/标签/来源找人 |
| `buildSegment` | write（$0，确定性编译） | 把老板原话编译成规则并存群 |
| `previewSegment` | free/read | 预览命中数（存前看见） |
| `mergeContacts` | write（$0） | 强标识判据下合并（请人工确认卡） |
| `addLeadContact` | write（$0） | 手工/口述建档 |
| `setContactConsent` | write（$0） | 改 consent/勿扰（**永不代客户 opt-in**） |
| `draftWinBack`（交接 B7） | write（草稿，turn 计量） | 用品牌记忆起草唤回，只起草不发 |

> 每个 skill 走缝 1 注册五步；对应人工 action 进 Parity Manifest（缝 9），CI 扫描未登记即拦。

---

## 十一、与既有城的接线（复用与边界）

### 11.1 brand memory「客群」tab（资产区 Brand memory v2，6-tab）

- **现状**：Brand memory v2 已上线（#103/#113），6-tab 知识库 + living collections + 产品档案。
- **接线**：CRM 的 Contact 是**结构化客户档案**；brand memory 是**品牌自由记忆**（Memory 对象，harmony-01 §二「与结构化并存互补」）。**边界**：客群洞察（品牌语气对哪类客户）留在 brand memory；**具体某个客户是谁**归 CRM Contact。二者**互指不合并**——Otto 起草唤回时**读 brand memory 的语气** + **读 CRM 的这个人**，各取所需。
- **待验证**：brand memory 是否已有「客群」子 tab、其数据是否要引用 Segment（§12-Q7）。

### 11.2 收件箱（B5）与自动化配方（B7）

- **收件箱**：档案页 Conversations 卡**只读链回** B5 会话；B5 首次入信**写** Contact/Identity（§6.2）。Conversation/CustomerMessage 与 Otto 的 ChatThread **零交叉**（harmony-01 §四③、§七钉子）——CRM 不碰 Otto 内部对话表。
- **自动化配方**：分群页的「生命周期自动化配方库」（欢迎/唤回/复购/生日）是**入口展示**，**落地归 B7**（Routine/规则文件）。CRM 分群页开关 = 触发 B7 的 recipe，不在 CRM 建自动化引擎。**边界**：分群定义「谁」（CRM），自动化定义「对谁做什么」（B7）。

### 11.3 L0 归因与回执（B2 / B6）

- **归因**：首触来源/campaign 从 L0 的 SourceTag/AttributionEvent 来（§6.2）。CRM **读**归因、**展示**「来自哪个入口」，**不自算**效果数值（口碑/复购率归 B2 B0-09）。
- **回执/订单额**：`totalOrdersMyr` **只读自回执脊柱/EasyStore**（B6，宪法边界四层「读取并验证」）——CRM 永不自建账本、永不代管资金（宪法 8）。起步无回执数据时该字段隐藏/空。

### 11.4 售前对话与收款链接（B5，剥离项复述）

- A′ 档案页的「Quotes & payment」卡属**售前成交促进**（蓝图边界四层「本体负责·售前对话」→ 落 B5 B0-37）。CRM 起步**不含**报价/收款链接；订金付款链接由 Otto 在**收件箱**代发（钱进商家账户，涉钱走审批闸，蓝图释义②）。**边界**：CRM 认「这个人」，B5 管「跟这个人谈成一单」。

---

## 十二、開放问题（需 founder 或跨块裁定，逐条）

| # | 问题 | 为什么要裁 | 选项 |
|---|---|---|---|
| Q1 | **lifecycleStage 起步值域**是什么？ | 判决 N「respond.io 阶段归 P3 CRM 时再议」——现在就是 P3 CRM 起步 | A. 最小三态（New/Active/Dormant）；B. respond.io 五阶；C. 可配。**建议 A**（零学习曲线） |
| Q2 | **档案页「自定义字段 / 待办任务」进 A 档还是 B 档**？ | 影响起步页面复杂度与工作量 | A. 都进 B 档（起步不做）；B. 待办进 A、自定义进 B。**建议 A** |
| Q3 | **VIP/高价值定义**（B0-61 明文点名）？ | 需确定性阈值才能编译（宪法 10），不能模型猜 | A. 内建分群「消费 ≥ RM X 且近 N 天活跃」（X/N 待定）；B. 派生 chip 标 VIP；C. 两者。**建议 A+B** |
| Q4 | **分群成员实时算 vs 物化**（体量过目）？ | harmony-01 终局要物化；起步 SMB 体量实时算够 | A. 起步实时算（A 档）；B. 直接物化（C 档）。**建议 A**，契约预留可重算 |
| Q5 | **身份规范化规则**（waPhone 国码/email 大小写）由谁钉？ | 决定自动合并正确性；跨 B5/B7 一致 | 需 B2/B5 spec 联审定一份规范化标准，CRM 复用 |
| Q6 | **doNotDisturb 与 opt_out 是否合并为单一 consent 状态**？ | 两者语义不同（主观勿扰 vs 法定退订），但 UI 可能想合一 | A. 两字段（合规清晰）；B. 单状态多值。**建议 A**（合规优先，PDPA） |
| Q7 | **brand memory「客群」与 CRM Segment 是否互指**？ | 避免两处各建一套客群概念 | 需资产区 owner 联审：客群洞察留 memory、成员归 Segment 是否够 |
| Q8 | **口碑域 VIP 识别**（MISSING 第2名工作6）与 B0-61 VIP 是否同一件？ | 避免重复建 | 建议同源：CRM Segment 的 VIP 规则即口碑域复用，不另建 |

---

> **交付自检（对照 `FINAL-REPORT-STANDARD` 终验七节，本设计能否兑现）**：本文档的 §5 双执行矩阵→兑现终验③双模演示；§4 六态→兑现⑥全旅程证据；§2 对标锚→兑现④对标三栏；§6 数据契约→兑现⑧schema/consent；§7 花费闸→兑现⑨；§12 开放问题→兑现⑫待裁清单（写「无」不藏）。**结论**：本设计全图为 B8-CRM 的 spec-ready 提供了完整锚清单与数据契约底座，可直接进入 spec 冻结。
