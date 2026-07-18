# B8 设计全图 v2 与 Phase-1 完整 Customer Engagement CRM 覆盖映射

> **文档性质**：本文档是 Route-B 总计划 §四.3（`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:62`）的交付物，对应 issue #345：重排 B8 设计全图，并建立 B2/B5/B6/B7/B8 → Phase-1 完整 Customer Engagement CRM 的唯一功能/验收映射。
>
> **docs-only**：本文档不修改产品代码、Prisma/schema/migration、Blueprint、provider、production 或 global config；不产生任何 spend。
>
> **不解冻施工**：本文档不解冻 PR #327 / #328 / #329（三者继续保持 Draft/frozen head），只在 §6 给出它们的 future disposition；不开始任何 implementation。
>
> **下一批任务仅为候选**：§8 的 native tasks 候选归组（C1～C7）均为无序候选，须取得 Founder durable approval 后才可建票开工；本文档本身不建票、不排序。
>
> **状态**：DRAFT，待 independent cross-family review（P0=0/P1=0）与 Founder durable approval。
>
> **基线**：live main `02de92de9530b22dfee6a66a4ae96f72f6f2060f`（2026-07-18）。

---

## §1 权威链

按序引用，仅引用不复述全文；若本文档与以下任一权威冲突，以上游权威为准：

1. **Blueprint v2.12**（`docs/BLUEPRINT.md`；PR #337 合并）。第七章修订表 v2.12 行批准列现写「待 founder 终审」（`docs/BLUEPRINT.md:239`）；按 `docs/BLUEPRINT.md:210-211` 的既定规则（「已合并的行批准列由下一次修订回填」「批准列写法：修订行在 PR 分支上一律写『待 founder 终审』；founder 合并 PR 即定稿」），这是规则内正常状态，不是权威冲突。
2. **GitHub Founder Resolution #334**（逐项重确认，经 #336 统一批准起草，见 `docs/BLUEPRINT.md:239`）：334-1 产品本体、334-2 目标商家、334-3 核心承诺修正版、334-4 第一期可售终点、334-5 内容环可用性细化。
3. **Route-B 总计划 v1.1**（`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md`）：D-038 对齐修订（`:10-12`）；§四.3（`:62`，「先闭合 R-010，再重排 B8 设计全图」）、§四.4（`:63`，纵切规则）、§七·甲（`:84-151`）为准。
4. **R-010**（issue #339 的 D1–D10 Founder Resolution + `docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md`；PR #342 已合并于 live main）。
5. 本文档。

本文档不创造新 roadmap、不新增 B0 ID、不改任何矩阵状态（`docs/ops/route-b/matrix/*.md` 的六级状态列不因本文档变化）。

---

## §2 术语与真源表

| 术语 | 唯一定义 | 权威出处 | 被取代的旧读法 |
|---|---|---|---|
| **ChannelScope / 四事实身份** | 身份权威 = owner + channel + ChannelScope + canonical externalId 的 active 精确身份（「四事实」）；禁止 issuer 状态/TTL、recycle、auto-revive、assignment epoch、quarantine、auto-merge 等 lifecycle machinery | R-010 D9（`2026-07-16-r010-schema-authority-alignment.md:35`、§3.2 `:102-119`）；D7（`:33`） | B2 v1.2 issuer/version 生命周期读法（`docs/superpowers/specs/2026-07-12-b2-data-contract.md`；R-010 §2 `:80` 明示 supersede）；#314/B8 live partial 三事实 `(ownerId, channel, externalId)` 读法（R-010 §2 冲突表 `:74`） |
| **ConsentEvent** | 唯一长期 permission-fact 权威；Contact 上 `marketingConsent/consentSource/consentAt` 三字段只是迁移期兼容投影，映射规则由 R-010 §4.6 冻结；`unknown` ≠ `opt_out`：unknown 不硬阻断商家发送，也绝不伪造成 consent | R-010 D2（`:28`）、§4.2（`:160-181`）、§4.6（`:348-359`）；Route-B 七·甲 E-1（`ROUTE-B-MASTER-PLAN-2026-07-12.md:144`） | B8 Contact 三字段作为长期真源的读法（R-010 §2 `:81`） |
| **STOP / purpose-bound unsubscribe（D4）** | 无限定 STOP 原子撤回该渠道全部 `proactive_non_transactional` 用途（Phase-1 为 `marketing + review_request`）；purpose-bound unsubscribe 只撤指定用途；严格 `transactional` 不因 STOP 自动撤回，但不得夹带营销 | R-010 D4（`:30`）、§4.3.1（`:210-218`） | 原 Route-B 七·甲 E「已知 STOP/退订…必须 fail closed 抑制」的笼统读法，被 R-010 精确化为「自动/无人确认发送继续 hard stop，商家精确人工动作走 D5 override」（R-010 §2 `:82`，见下一行） |
| **D5 两次确认人工 override** | consent risk tag + 两次独立人工确认，只对精确冻结的一次行动生效；不产生 consent、不构成 standing waiver；Otto/connector/后台任务不得代确认或复用 | R-010 D5（`:31`）、§4.3.3（`:235-250`） | Route-B 七·甲 E 中把「merchant 精确手工动作也绝对 hard suppress」解释为无例外硬阻断的读法（R-010 §2 `:82` 明示 supersede） |
| **link-time UTM / TrackedLink（D3/D10）** | 可量测链接在 generation-time 定案严格五键；link 是 effective authority，event 是历史 authority；`Campaign.utmBase` 停写、留存 legacy；`Tracked-Redirect` / `Tagged-Direct` 两种模式按 path 固定；外部分析（GA/Meta）只作分列 enrichment，Unknown 永不显示为 0 | R-010 D3（`:29`）、D10（`:36`）、§5（`:368-390`） | B8 `Campaign.utmBase` 作为长期 authority 的读法（R-010 §2 `:87`）；B2 Phase-1 Campaign-level editable structured UTM store 的读法（`:88`） |
| **Segment（Prisma 规则对象）vs `save-customer-segment`（Otto brand-memory 卡片）** | 同名不同物；后者属品牌记忆域，不是 CRM Segment 面，不计入本映射覆盖（§4/§5）；术语消歧动作挂到对应切片验收 | `packages/otto/src/skills/save-customer-segment.ts`；`docs/superpowers/specs/2026-07-02-brand-memory-taxonomy-fable-design.md:66`；开放问题实际记录于 `docs/superpowers/specs/2026-07-14-b8-phase1-campaign-crm.md:357`（L-3：「brand memory『客群』与 CRM Segment 互指口径——资产区 owner 联审」，来源 CRM 设计图 Q7） | 无（新增消歧记录，非取代既有条款） |
| **完整 Customer Engagement CRM** | 唯一定义 = Route-B §七·甲 A 表第 95 行的跨块并集，详见 §4；任何单块、旧「CRM 三行」、老客唤回 playbook 都不能独立宣称完成 | `ROUTE-B-MASTER-PLAN-2026-07-12.md:95`；`docs/BLUEPRINT.md:164` | 旧「CRM 三行」/单次老客唤回代表完整 CRM 的读法——该旧读法承载于 2026-07-12 两张 B8 设计图与 2026-07-14 原 11 行 spec（见 §6），Route-B 现行文本（`:36`、`:49`）与 Blueprint（`:190`「不是三行 SMB-lite 或单次老客唤回」）已明确否定 |
| **respond.io 基线** | 第一期 Contact 产品/UX 行为对标 respond.io（不复制代码/UI）；不进入 Salesforce 深度 | Route-B 七·甲 D.3 已锚定 respond.io 同任务走查（`ROUTE-B-MASTER-PLAN-2026-07-12.md:139`）；D7 进一步把 Contact 产品/UX 行为基线明确为 respond.io（R-010 `:33`）；`docs/BLUEPRINT.md:164` | 无被取代读法（D7 是对既有 respond.io 锚的补充明确，非取代）；被 D7 撤回的是此前「号码回收/revive/assignment epoch/quarantine」复杂待决题 |

---

## §3 B8 设计全图 v2（重排）

本节取代 2026-07-12 两张旧图（`2026-07-12-b8-campaign-design.md`、`2026-07-12-b8-crm-design.md`）的总图地位；旧图 disposition 见 §6。

- **身份层**：Contact + ContactIdentity + ChannelScope（R-010 D6/D7/D9，`2026-07-16-r010-schema-authority-alignment.md:32-35`、`:100`）。自动挂接只按 D6 allowlist（同一 verified stable logical Channel scope 的 exact reuse，或可审计 continuity proof，`:127-128`）；普通资料匹配（phone/email/profile/order/name/address/avatar 等）只是 merchant-visible 建议，不确定跨渠道匹配只提示商家确认（D1，`:27`）。
  - 导入（manual/CSV/connector）、确定性 dedupe、可逆 merge、来源事实 = **B0-59**（`docs/ops/route-b/matrix/08-B8.md:15`）。
  - 档案/字段/tags/Lifecycle 展示 = **B0-60**（`08-B8.md:16`）。
- **同意层**：ConsentEvent 权威 + Contact 三字段投影（D2，R-010 §4.6）；D4 STOP 语义（§4.3.1）；D5 override（§4.3.3）。D8 明确 `DeliveryManifest`/`ActionReceipt` 等物理承载可延后到 native implementation task，但延后期间所有依赖发送路径必须 disabled/fail-closed，且必须在任何 live send 或 Phase-1 CRM completion 之前完成冻结、实现与验证（`2026-07-16-r010-schema-authority-alignment.md:248`、`:250`）。
- **Campaign 层**：B0-51～58（最薄对象/归组外键/工作台/日历（无全局 auto-publish 正向授权）/列表详情/Otto 策划师/打包总价确认闸💰（money-safety-review 硬门）/TrendSnapshot，`docs/ops/route-b/matrix/08-B8.md:7-14`）。UTM 按 D3：Campaign 一期只归组，不存可编辑 UTM（`2026-07-16-r010-schema-authority-alignment.md:374`）。
- **受众层**：B0-61 动态 Segments（内建 + 自定义确定性规则；NL→规则编译走宪法 10 确定性，`docs/BLUEPRINT.md:77`）。
- **追踪/报告层**：B2 E5-06 六张量测原语表 + E5-07 短链 redirect（D10 第一方事实层，`docs/ops/route-b/matrix/02-B2.md:15-16`）；回执消费端 = B6 B0-41 脊柱。
- **缝**：B5（Inbox/模板/护栏/接手/recipes）、B6（回执脊柱/只读 connector）、B7（Broadcast/permission/抑制/频控/Routine/规则编辑器/journey）各自承接，B8 不复制其行。
- **B8 缺失大陆行（B0-62～76）**：不属于 CRM 支柱，原位保留在建城图（`docs/ops/route-b/matrix/08-B8.md:18-32`），不因本图纳入 Phase-1（见 §5）。

---

## §4 唯一映射表（核心交付）

### 4.1 Phase-1 CRM 原子集锚定

Phase-1 完整 CRM 原子集 = Route-B §七·甲 A 表第 95 行（`ROUTE-B-MASTER-PLAN-2026-07-12.md:95`）「上述已批准 feature 的并集才是第三支柱」的跨块并集，逐 ID 列出：

- **B8**：B0-51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61（11 个）
- **B5**：B0-31, 32, 33, 38, 40, 98（6 个）
- **B7**：B0-43, 44, 45, 46, 47, 48, 49（7 个）
- **B6**：B0-41, 42（2 个）
- **B2**：E5-06, E5-07（2 个，编制判断：七·甲行 95 只写「B2 量测/报告」未给具体 ID；E5-06/07 是 D3/D10 冻结的追踪权威的物理底座，故 pin 为支柱内的 B2 部分；此 pin 随本文档一并交 Founder 批准）

**合计 28 个原子**（11+6+7+2+2=28）。

### 4.2 主映射表

列定义：`B0-ID | CRM 能力（七·甲 D.1 措辞对应）| 人工 surface | Otto surface | WhatsApp/connector 真实路径 | permission/receipt/report 挂钩 | UIUX/user-flow 验收 | test/acceptance 门`

通用口径（适用全表，逐行不重复展开）：
- Otto surface 一律须满足 Blueprint 宪法 7 双模（单一动作层、Parity Manifest、读对等，`docs/BLUEPRINT.md:67-69`）与规则域不做节点画布 O-09（`:72`）、宪法 10 sonnet 级确定性（`:77`）。
- 人工/Otto 两列填写的是该行满足宪法 7 所需的**行为面**（人工入口在哪里、Otto 的 read 对等与 act 同层落在哪个动作层）；具体页面路由以矩阵 A′ 注记为准、具体 skill 命名在切片票内定案——本文档不新增任何未批准 feature 或 ID。
- WhatsApp/connector 列：**出站**真实路径由 B0-31/32/33/38（会话、模板、护栏、接手）与 B0-43（Broadcast 最终外发）承载；**入站**真实路径（opt-in/opt-out/STOP/DND 等 permission 事实的接收与落账）由 B0-44/45 经 provider-neutral WhatsApp 入站事件路径承载（adapter 合同同样适用 E-3：contract tests/健康状态/幂等去重/对账/统一 receipt/回滚）；B0-40/47/48/49/98 等规则/自动化行不直接承载渠道路径，其触发的实际发送统一经 B0-43/B0-31 发送执行层与 adapter 合同执行；其余不涉收发的行一律「N/A（不经渠道）」。
- UIUX/user-flow 验收列：统一走七·甲 D.3 respond.io 同任务走查水平（`ROUTE-B-MASTER-PLAN-2026-07-12.md:139`）+ desktop/mobile 全通（D.2，`:138`）。
- test/acceptance 门列：统一对应七·甲 D.1 真实实现无 mock（`:137`）/ D.2 端到端可恢复（`:138`）/ D.4 五个 0（0 跨租户、0 未批准/重复发送、0 STOP 绕过、0 受众漂移、0 假回执，`:140`），逐行按其能力性质标注最相关的子项。

| B0-ID | CRM 能力（七·甲 D.1 措辞对应） | 人工 surface | Otto surface | WhatsApp/connector 真实路径 | permission/receipt/report 挂钩 | UIUX/user-flow 验收 | test/acceptance 门 |
|---|---|---|---|---|---|---|---|
| B0-51 | Campaign/Broadcast（独立对象：状态机/goal/period，最薄容器，不升格 project）（`08-B8.md:7`）——矩阵行内「UTM 基串」措辞已被 R-010 D3/D10 supersede：Campaign 一期只归组、不存可编辑 UTM，追踪权威在 TrackedLink/E5-06/07（`2026-07-16-r010-schema-authority-alignment.md:374-376`，见 §3 Campaign 层） | Campaign 对象经 B0-53 工作台 / B0-55 列表详情维护（本行是对象层，无独立页面） | Otto 经同一 Campaign 动作层读/建/改 Campaign 对象（read 对等 + act 同层） | N/A（不经渠道） | N/A（本行不发送；供 B0-43 归组引用） | D.3 respond.io 走查 + D.2 desktop/mobile | D.1 无 mock；六级状态现为 `listed`（`08-B8.md:7`），完成前不得写 Done |
| B0-52 | Campaign/Broadcast（归组接线：Project/ScheduledPost/Generation 的 campaignId 可空外键）（`08-B8.md:8`） | 归组操作在 B0-53/54 工作台与日历内执行（campaignId 选择） | Otto 排产/归组走同一 campaignId 外键动作层（read 对等） | N/A（不经渠道） | N/A（本行不发送；供 B0-43 引用外键归组） | D.3 + D.2 | D.1 无 mock；`listed`（`08-B8.md:8`） |
| B0-53 | Campaign/Broadcast（工作台：结构化表单发起，不靠聊天 prompt）（`08-B8.md:9`） | A′ 页 `campaign/workbench`（切片4，`08-B8.md:9`） | Otto 经同一 server action 代填结构化表单发起 Campaign（不得另开聊天旁路） | N/A（不经渠道） | N/A（结构化入口，不发送；静态展示文案不接钱路，X 计费收口另属 E4-14） | D.3 respond.io 工作台走查 + D.2 | D.1 无 mock；`listed`（`08-B8.md:9`） |
| B0-54 | Campaign/Broadcast（日历工作台；无全局 Auto-publish 正向授权）（`08-B8.md:10`） | A′ 页 `campaign/calendar`（切片4，`08-B8.md:10`） | Otto 只可建/改 $0 日历草稿；正向外发授权仅逐帖/精确批次人工批准，Otto/preference/全局开关均不构成授权（`08-B8.md:10`） | N/A（不经渠道；Direct 真实外发另属 B4，非本行） | N/A（计划编辑 $0；不得由 preference/global switch 获得外发权，历史 queue 不转换，`08-B8.md:10`） | D.3 + D.2；相关开关/文案移除或隐藏（`08-B8.md:10`） | D.1 无 mock；D.4「0 静默换 mode」；`listed`（`08-B8.md:10`） |
| B0-55 | Campaign/Broadcast（列表+详情页）（`08-B8.md:11`） | A′ 页 `campaign/list`、`detail`（切片4，`08-B8.md:11`） | read 对等（Campaign 列表/详情读面） | N/A（不经渠道） | N/A（只读展示） | D.3 + D.2 | D.1 无 mock；`listed`（`08-B8.md:11`） |
| B0-56 | Campaign/Broadcast（Otto Campaign 策划师：研究 trend → CAMPAIGN_CARD 提案 → 用户改/批 → 排产）（`08-B8.md:12`） | A′ 页 `campaign/proposal-card`（切片4，`08-B8.md:12`） | Otto 主动提案（trend 研究→CAMPAIGN_CARD→商家改/批）；提案与排产走同一动作层（宪法7单一动作层） | N/A（不经渠道；下游真实发送经 B0-43 挂 B0-44/45/46+41） | 提案→批准走审批公式；排产触发生成=花钱闸（`08-B8.md:12`） | D.3 + D.2；Otto 提案卡走查对齐 respond.io 无对应功能则以 D.1 功能全为准 | D.1 无 mock；D.4「0 未授权 spend」；`listed`（`08-B8.md:12`） |
| B0-57 | Campaign/Broadcast（打包总价确认页💰：大单花费闸，server 重算+generate 闸）（`08-B8.md:13`） | A′ 页 `campaign/pack-confirm`（切片4，`08-B8.md:13`） | Otto 可发起打包提案；花费确认/批准=人工 only（涉钱必审批，`docs/BLUEPRINT.md:52`），server 重算不可被绕过 | N/A（不经渠道） | **挂 `money-safety-review` 💰**（`08-B8.md:13`头注）；server 重算总价 + genRequest 闸（缝3）+ 审批公式，变真必过 `.claude/skills/money-safety-review/SKILL.md` | D.3 + D.2；mock 风险点 2/18（全舰单最高优先💰，`08-B8.md:13`） | D.1 无 mock；D.4「0 未授权 spend、0 重复扣费」；`listed`（`08-B8.md:13`） |
| B0-58 | Campaign/Broadcast（趋势存档页 + TrendSnapshot 最薄数据层，ownerId 隔离）（`08-B8.md:14`） | A′ 页 `campaign/trends`（切片4，`08-B8.md:14`） | read 对等（趋势存档读面） | N/A（不经渠道） | N/A（只读存档数据层，无发送；新表走缝5，引擎侧协调=B9复核） | D.3 + D.2 | D.1 无 mock；`listed`（`08-B8.md:14`） |
| B0-59 | Contact/Identity + 导入去重合并（manual/CSV/connector import；跨渠道建档/更新、确定性 dedupe、可逆 merge、来源事实）（`08-B8.md:15`） | A′ 页 `crm/contacts`（切片7，`08-B8.md:15`）+ manual/CSV 导入向导与 merge 确认流 | Otto 可发起建档/更新与 merge 建议；确定性 dedupe 由代码执行（宪法10）；不确定跨渠道匹配仅提示、商家确认（D1/D6），Otto 不得自动合并 | N/A（不经渠道；导入不经 WhatsApp 发送路径） | N/A（本行不发送；owner 隔离，导入不伪造 opt-in，merge 留痕且不物删，`08-B8.md:15`；merge/unmerge lineage 见 R-010 §3.4） | D.3 + D.2；respond.io 导入/去重走查水平 | D.1 无 mock；D.4「0 跨租户、0 重复建档/丢档（确定性 dedupe）」；`listed`（`08-B8.md:15`） |
| B0-60 | Contact/Identity（档案展示面）+ 标准/自定义字段 + tags + **Lifecycle（展示，不含规则执行——规则执行归 B0-48/49，见该两行注，避免重复宣称）**（`08-B8.md:16`） | A′ 页 `crm/contacts`、`contact-profile`（切片7，`08-B8.md:16`） | read 对等（档案读面）+ 字段/tags 编辑走同一动作层 | N/A（不经渠道） | N/A（本行不发送；permission/DND 分轴，字段变更留痕，`08-B8.md:16`） | D.3 + D.2 | D.1 无 mock；`listed`（`08-B8.md:16`） |
| B0-61 | 动态 Segments（内建高价值/VIP 等规则 + 自定义确定性规则；NL→规则编译走宪法10确定性）（`08-B8.md:17`） | A′ 页 `crm/segments`（切片7，`08-B8.md:17`） | Otto NL→规则编译走确定性代码（宪法10）；规则保存/预览与人工同一动作层 | N/A（不经渠道） | N/A（本行不发送；受众选择与发送资格分离，最终硬限制在 B7，即挂 B0-44/45/46，`08-B8.md:17`） | D.3 + D.2 | D.1 无 mock；D.4「0 受众漂移」；`listed`（`08-B8.md:17`） |
| B0-31 | Inbox/历史/搜索/分派（Customer Engagement 共享 Inbox + WhatsApp 真对话）（`docs/ops/route-b/matrix/05-B5.md:7`） | A′ 页 `inbox/shared`（切片7，`05-B5.md:7`） | Otto 同台参与会话（接手协议见 B0-38）；read 对等（历史/搜索/分派读面）；provider-neutral，不依赖 adapter | **出站：Gupshup=首个可替换 adapter；须 contract tests/健康状态/幂等去重/对账/统一 receipt/回滚**（七·甲 E-3，`ROUTE-B-MASTER-PLAN-2026-07-12.md:146`）；核心 schema/UI/Otto workflow 不依赖 provider（`05-B5.md:3,7`） | 挂 B0-44/45/46（permission/抑制/频控）+ B0-41（回执）；护栏前置（`05-B5.md:7`）；D8 延后的 `DeliveryManifest`/`ActionReceipt` 等物理承载项在获批实现前 fail-closed | D.3 respond.io Inbox 同类走查 + D.2 | D.1 无 mock；D.4「0 跨租户/错联系人、0 未批准/重复发送」；`listed`（`05-B5.md:7`） |
| B0-32 | Inbox/历史/搜索/分派（消息模板库 + Meta 送审）（`05-B5.md:8`） | A′ 页 `inbox/templates`（切片7，`05-B5.md:8`） | Otto 可起草模板文案；送审提交走同一动作层与人工批准 | 出站：Gupshup 首 adapter 承载模板送审路径；同 B0-31 合同要求（E-3，`ROUTE-B-MASTER-PLAN-2026-07-12.md:146`） | 挂 B0-41（回执，模板送审状态）；发送时经 B0-44/45/46（`05-B5.md:8`） | D.3 + D.2 | D.1 无 mock；`listed`（`05-B5.md:8`） |
| B0-33 | Inbox/历史/搜索/分派（防误发护栏 + Otto 措辞纪律上真，#55/#56）（`05-B5.md:9`） | 发送预检提示与护栏配置（inbox 发送流内） | 护栏对 Otto 措辞硬前置（O-01+O-06 绑定判决，`05-B5.md:9`），Otto 不可绕过 | 出站：Gupshup 首 adapter 通道上的发送前置护栏；同 B0-31 合同要求（E-3） | 挂 B0-44/45/46（护栏是硬前置，如 money-gate 不可绕，`05-B5.md:9`） | D.3 + D.2 | D.1 无 mock；D.4「0 未批准发送」；`listed`（`05-B5.md:9`） |
| B0-38 | 人工/Otto 接手（对话视图：人+Otto 同台，可见 takeover/handoff；人插手自动化即停）（`05-B5.md:14`） | A′ 页 `inbox/conversation`（切片7，`05-B5.md:14`） | Otto 同台，takeover/handoff 可见；人插手自动化即停（硬规则，非开关） | 出站：Gupshup 首 adapter 承载对话通道；同 B0-31 合同要求（E-3） | 挂 B0-44/45/46 + B0-41；`reactive_service_reply` 独立 send class（R-010 §4.3.3 `:237`），D5 override 在 D8 获批物理载体前 fail-closed（`:248`） | D.3 + D.2；判决 7-8（origami 硬规则，`05-B5.md:14`） | D.1 无 mock；D.4「0 未批准发送」；`listed`（`05-B5.md:14`） |
| B0-40 | Workflows（Customer Engagement Workflows / 收件箱自动化 recipes；与 B7 journey/routine 共用一套动作与权限边界）（`05-B5.md:16`） | A′ 页 `inbox/recipes`（切片7，`05-B5.md:16`） | Otto 起草/解释 recipes；规则域不做节点画布，产出人看得懂改得动的规则文件（O-09） | N/A（本行是自动化规则层；触发的实际发送经 B0-43/B0-31 发送执行层与 adapter 执行，见 §4.2 通用口径） | 挂 B0-44/45/46 + B0-41；对客动作走同意/抑制/频控与审批闸（`05-B5.md:16`） | D.3 + D.2 | D.1 无 mock；D.4「0 未批准/重复发送」；`listed`（`05-B5.md:16`） |
| B0-98 | Workflows（营业时间自动回复原语，M 区；与 B0-40 recipes 泛桶区分，本行为具名原语）（`05-B5.md:17`） | `automation/rules` / `inbox/recipes` 内的营业时间原语配置面 | Otto 可设置/解释营业时间自动回复（同一原语动作层） | N/A（同 B0-40：触发的发送经 B0-43/31 执行层） | 挂 B0-44/45/46 + B0-41；对客自动发送过 B7 同意/频控读契约（`05-B5.md:17`） | D.3 + D.2 | D.1 无 mock；D.4「0 未批准发送」；`listed`（`05-B5.md:17`） |
| B0-41 | 回执与报告（统一回执/报告脊柱：Mandate/Action/ExternalEffect/BusinessEvent/Receipt）（`docs/ops/route-b/matrix/06-B6.md:7`） | 回执/报告查看面（Campaign/Broadcast 报告页与联系人时间线，消费端呈现） | read 对等（回执/报告读面；Otto 不做瞎子操作员，`docs/BLUEPRINT.md:69`） | N/A（不经渠道；本行是回执消费端，不是发送端） | 本行即回执权威；只读铁律：永不代管/永不自建商家账本（`06-B6.md:7`；`docs/BLUEPRINT.md:48`） | D.3 + D.2 | D.1 无 mock；D.4「0 假回执」；`listed`（`06-B6.md:7`） |
| B0-42 | 回执与报告（统一 commerce/POS/CRM 只读 connector seam；EasyStore 为可选首批 adapter 之一）（`06-B6.md:8`） | 渠道/connector 连接管理（Account/Connections 商家自助授权，`docs/BLUEPRINT.md:113-114`） | read 对等（经营事实只读消费）；连接授权属账户安全操作，Otto 永不代办（宪法7豁免，`docs/BLUEPRINT.md:73`） | N/A（EasyStore 只读、可选，非 WhatsApp 发送路径；`06-B6.md:8`） | N/A（只读；provider 可替换，零 connector 不阻塞 CRM 核心，`06-B6.md:8`） | D.3 + D.2 | D.1 无 mock；`listed`（`06-B6.md:8`） |
| B0-43 | Campaign/Broadcast（通用受众发送；会员唤回/积分到期只是 playbook；L0 归因+安全网）（`docs/ops/route-b/matrix/07-B7.md:7`） | A′ 页 `inbox/broadcast`（切片7，`07-B7.md:7`）：受众确认 + 精确批准发送流 | Otto 可备好受众/文案/预检；正向外发授权=人工逐次/精确批次批准（同 B0-54 口径） | 出站：Gupshup 首 adapter 承载最终外发通道；同 B0-31 合同要求（E-3） | 挂 B0-44/45/46 + B0-41；发前额度预检/掉档横幅/降速剧本（`07-B7.md:7`） | D.3 + D.2 | D.1 无 mock；D.4 五个 0 全项适用（本行是主发送闸）；`listed`（`07-B7.md:7`） |
| B0-44 | 退订（联系人来源/permission 事实 + opt-in/opt-out 记录；商家选择并确认受众，未知证据不自动删名单）（`07-B7.md:8`） | 联系人 permission 面板与受众确认流（`crm/contacts` 档案内） | read 对等（permission 事实读面）；D5 两次确认为人工专属，Otto/connector/后台不得代确认（R-010 §4.3.3） | **入站：真实 opt-in/opt-out/STOP 事件经 provider-neutral WhatsApp 入站事件路径写入 ConsentEvent**（adapter 合同含 contract tests/幂等去重，E-3） | 本行即 permission 权威（挂 D2/R-010 §4.2-4.6）；导入不伪造 consent；不得覆盖 consent state——自动/无人确认发送对已知退订 hard stop，获授权商家仅可按 D5 对精确冻结行动完成两次独立人工确认后提交，且不产生 consent（`07-B7.md:8`；R-010 `:237-250`） | D.3 + D.2 | D.1 无 mock；D.4「0 假 consent」；`listed`（`07-B7.md:8`） |
| B0-45 | 退订（已知 STOP/退订/DND/provider hard limit 抑制，运行时 fail-closed）（`07-B7.md:9`） | 抑制状态在联系人档案与发送预检可见 | read 对等（抑制状态读面）；抑制对 Otto 与自动化不可绕过 | **入站：STOP/退订解析与 DND/provider 硬限制事实经同一 provider-neutral 入站路径落账**；运行时抑制在发送执行层（B0-43/31）生效 | 本行即抑制权威（挂 D4/R-010 §4.3.1）；对自动/无人确认发送运行时 fail-closed；不因未知 permission 自动缩小受众；商家人工例外仅走 D5 两次确认通道（`07-B7.md:9`） | D.3 + D.2 | D.1 无 mock；D.4「0 STOP 绕过」；`listed`（`07-B7.md:9`） |
| B0-46 | Campaign/Broadcast（发送安全闸：频控，同一联系人短期触达上限）（`07-B7.md:10`） | 频控策略与触发状态见发送预检与 `automation/rules` | read 对等（频控状态读面）；频控为统一发送层硬限制，Otto/playbook 不可绕过 | N/A（不经渠道；本行是频控规则层，执行在 B0-43/31 发送层） | 本行即频控权威；统一发送层硬限制，不因 playbook 不同绕过（`07-B7.md:10`） | D.3 + D.2 | D.1 无 mock；D.4「0 未批准/重复发送」；`listed`（`07-B7.md:10`） |
| B0-47 | Workflows（Routine/RoutineRun 授权模型：范围声明/预算上限/kill switch/事后摘要=字段+DB约束）（`07-B7.md:11`） | A′ 页 `automation/routines`（切片8，`07-B7.md:11`） | Otto 在商家授权四件套（范围/预算/kill switch/摘要）内执行 routine 并出事后摘要 | N/A（routine 触发的对客动作经 B0-43/31 发送执行层与 adapter 执行） | 挂 B0-44/45/46（routine 触发的对客动作仍过同一轴）；四件套=DB约束（宪法4例外②，`07-B7.md:11`） | D.3 + D.2 | D.1 无 mock；D.4「0 超预算/无 kill switch」；`listed`（`07-B7.md:11`） |
| B0-48 | Workflows + **Lifecycle（规则/journey 执行面，不含档案展示——展示归 B0-60，见该行注）**（Customer Engagement rules/Workflow 编辑器：人工面=可读规则+开关，O-09分域）（`07-B7.md:12`） | A′ 页 `automation/rules`（切片8，`07-B7.md:12`） | Otto 写规则文件（人看得懂、改得动，O-09）；人工面=规则编辑器+开关 | N/A（触发的发送经 B0-43/31 执行层） | 挂 B0-44/45/46 + B0-41；对客动作统一叠加 permission/抑制/频控与批准边界（`07-B7.md:12`） | D.3 + D.2；O-09 规则文件编辑器（人看得懂、改得动，非节点画布） | D.1 无 mock；`listed`（`07-B7.md:12`） |
| B0-49 | Workflows + **Lifecycle（规则/journey 执行面，同 B0-48 注）**（Customer Engagement journey 多步触发序列，Phase-1 Workflow/Lifecycle 组成）（`07-B7.md:13`） | journey 序列在 `automation/rules` 编辑器维护（O-09 分域） | Otto 起草/解释 journey 规则；执行走确定性代码（宪法10） | N/A（触发的发送经 B0-43/31 执行层） | 挂 B0-44/45/46；对客动作逐步经过 permission/抑制/频控与 routine 授权（`07-B7.md:13`） | D.3 + D.2 | D.1 无 mock；D.4「0 未批准/重复发送」；`listed`（`07-B7.md:13`） |
| E5-06 | 回执与报告（六张量测原语表：TrackedLink/QrAsset/QrPlacement/VoucherToken/SourceTag/AttributionEvent）（`docs/ops/route-b/matrix/02-B2.md:15`） | 数据层无独立人工面（`02-B2.md:15`）；**消费端=Campaign/Broadcast 报告面与 B0-41 回执面**（本行产出经彼处对商家呈现） | read 对等经 B2 契约读面（消费端读能力随报告面同片配齐）；写入归属按 B2 契约〇/契约1 与对应 GitHub task 确认（`02-B2.md:15`） | N/A（不经渠道；本行是量测数据层） | 挂 B0-41（回执/report 承接端）；D3/D10 first-party fact layer（`2026-07-16-r010-schema-authority-alignment.md:372`） | D.3 + D.2 | D.1 无 mock；六级状态 `spec-ready`（`02-B2.md:15`） |
| E5-07 | 回执与报告（短链 redirect：TrackedLink 的 (domain,slug)→跳转，D4-2 计划件）（`02-B2.md:16`） | 无独立人工面（redirect 运行时基础设施）；扫码/点击链路的商家可见结果在报告面（同 E5-06 消费端） | read 对等（归因读面）；redirect 落 AttributionEvent 写入按 B2 契约1 规范（`02-B2.md:16`） | N/A（不经渠道；本行是 redirect 基础设施） | 挂 B0-41 承接端；D10 `Tracked-Redirect`/`Tagged-Direct` 按路径固定（`2026-07-16-r010-schema-authority-alignment.md:380-390`） | D.3 + D.2 | D.1 无 mock；六级状态 `spec-ready`（`02-B2.md:16`） |

### 4.3 零缺口证明（反向表一：七·甲 D.1 十二能力词 → 承接 B0-ID）

| D.1 能力词（`ROUTE-B-MASTER-PLAN-2026-07-12.md:137`） | 承接 B0-ID（多对多允许） |
|---|---|
| Contact/Identity | B0-59、B0-60 |
| 导入去重合并 | B0-59 |
| 标准/自定义字段 | B0-60 |
| tags | B0-60 |
| 动态 Segments | B0-61 |
| Lifecycle | B0-60（展示）、B0-48、B0-49（规则/journey 执行，见 §4.2 行内分工注） |
| Inbox/历史/搜索/分派 | B0-31、B0-32、B0-33 |
| Campaign/Broadcast | B0-51、B0-52、B0-53、B0-54、B0-55、B0-56、B0-57、B0-58、B0-43、B0-46 |
| Workflows | B0-40、B0-98、B0-47、B0-48、B0-49 |
| 人工/Otto 接手 | B0-38 |
| 退订 | B0-44、B0-45 |
| 回执与报告 | B0-41、B0-42、E5-06、E5-07 |

十二个能力词均有承接 ID，**缺口 = 0**。

### 4.4 零重复证明（反向表二：B0-ID → 主表行）

主表（§4.2）28 个原子中每个 B0-ID/E5-ID **只出现一行**（逐行一一对应，无重复行）。Lifecycle 在 B0-60 与 B0-48/49 之间的双触之处已在 §4.2 对应行内以「见该行注」互相标注分工（B0-60 = 档案展示，B0-48/49 = 规则/journey 执行），避免同一能力被两行重复宣称完成，**重复 = 0**。

---

## §5 非纳入清单（zero-dup 边界）

| ID | 名称 | 为什么不在 Phase-1 CRM 支柱 | 原位去处 |
|---|---|---|---|
| B0-34、B0-35、B0-36、B0-37、B0-39（B5） | O-06护栏+试驾场、AI客服知识库、公开评论收件箱、售前对话促成、WhatsApp Status发布 | 七·甲行95明示「B0-34/35/36/37/39…等其他旧行不因相邻归块自动变成 Phase-1 必做」（`ROUTE-B-MASTER-PLAN-2026-07-12.md:95`） | 原位保留在 `docs/ops/route-b/matrix/05-B5.md:10-13,15`，未来按 Route-B 原序推进 |
| B0-50、B0-99（B7） | 扫码欢迎流、消息互动信号触发源 | 同上，行95明示不自动纳入 | 原位保留在 `docs/ops/route-b/matrix/07-B7.md:14-15` |
| B0-62～76（B8 缺失大陆） | 线下QR/请评/评价/推荐/忠诚计划/Marketplace/link-in-bio/GBP/增长实验等 | 属 B8 其他支柱/波次，非 CRM 支柱（Route-B 宪章 B8，`ROUTE-B-MASTER-PLAN-2026-07-12.md:50`） | 原位保留在 `docs/ops/route-b/matrix/08-B8.md:18-32` |
| B2 其余行（E2-12、E4-11、E5-01～05、B0-08、B0-09） | meta专家诊断技能、Meta读insights、Analytics各阶段、口碑量测维度等 | 分析区自身范围，非 CRM 支柱成分（B2 spec §一明示排除，`docs/ops/route-b/matrix/02-B2.md:4`） | 原位保留在 `docs/ops/route-b/matrix/02-B2.md:8-14,17-18` |
| 七·甲 E-4 排除（out，第一期不建） | Companies/Deals/Forecast/Quotes/发票收款/完整售后 ticketing、假 Salesforce 骨架 | 「第一期开口不建…也不预建假的 Salesforce 骨架」（`ROUTE-B-MASTER-PLAN-2026-07-12.md:147`；`docs/BLUEPRINT.md:164`） | Customer Email marketing 等其他顾客渠道各自真验后点亮，不阻塞第一期（D.4，`ROUTE-B-MASTER-PLAN-2026-07-12.md:140`）；售后 service desk 属 Blueprint 边界表「明确交接」（`docs/BLUEPRINT.md:49`） |

---

## §6 旧资料与冻结 PR 处置表

| 对象 | 分类 | 理由（带权威引用） | future disposition |
|---|---|---|---|
| `docs/design/route-b/2026-07-12-b8-campaign-design.md` | **rework** | 页面流/结构并入本图 v2；其 identity/consent/UTM 三轴与 auto-publish 措辞已被 R-010/D-038 取代 | 文件保留为历史证据，不删除 |
| `docs/design/route-b/2026-07-12-b8-crm-design.md` | **rework** | 同上；其 respond.io 起步形态与 D7（`2026-07-16-r010-schema-authority-alignment.md:33`）一致部分并入 v2 | 文件保留为历史证据，不删除 |
| `docs/superpowers/specs/2026-07-14-b8-phase1-campaign-crm.md` | **双行处置**：拆票计划 = **out**；spec 机械输入 = **rework** | Route-B §四.3 原文禁止从旧 11 行拆票恢复施工（`ROUTE-B-MASTER-PLAN-2026-07-12.md:62`）；不涉三轴的部分仍是切片票的输入证据 | 拆票计划不采用；机械内容（如 §12 L-3 开放问题）作为切片票输入证据保留 |
| `docs/superpowers/specs/2026-07-12-b2-data-contract.md` | **retain** | v1.2 冻结合同继续有效；三轴冲突部分已由 R-010 裁决取代（文档头已自标注） | 不在本图重复改写 |
| `docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md` | **rework** | 对应 B0-56（支柱内，`docs/ops/route-b/matrix/08-B8.md:12`） | Campaign 底座形状须按 R-010 更新后才可作施工输入 |
| `docs/research/2026-07-03-*.md` 对标研究文档 | **retain**（证据层） | live main 上该日期共 **28 份**对标研究文档（respond-io/hubspot-crm-sales/hubspot-marketing/klaviyo/salesforce-crm-core/salesforce-marketing/adobe-genstudio 等），是 Blueprint 第六章「功能清单不凭空发明」的底稿证据（`docs/BLUEPRINT.md:172`） | 全部保留为证据层，不逐一列举 |
| northstar 原型 mock（`apps/web/components/northstar/immersive/crm-inbox/data.ts`、`northstar/campaign/_data.ts`） | **retain**（原型证据） | northstar 材料仅为历史设计证据，不作为 current scope、批准或状态真源（`docs/review/REVIEWER-PLAYBOOK.md:206-215`） | 不计入生产覆盖；仅在当前 task 显式链接时作为原型证据引用 |
| `packages/otto/src/skills/save-customer-segment.ts` | **out** | CRM 映射范围外；属品牌记忆域（见 §2 术语表第6行） | 术语消歧动作挂到 Segments（B0-61）切片验收 |
| **PR #327** | **rework** | 保留 owner-scoping、原子 merge+rollback、测试骨架；identity 键须改 ChannelScope 四事实（D9）、consent 写路径须改 ConsentEvent+投影（D2/R-010 §4.6） | 保持 Draft/frozen；由未来身份+同意底座候选票（C1）承接后 close-and-supersede，届时决定，不在本文档执行 |
| **PR #328** | **rework** | `utmBase` 写路径须停（D3/D10）；zero-cost action 层结构（propose/approve 不扣费）保留 | 保持 Draft/frozen，同上（由 C2 承接） |
| **PR #329** | **rework（轻）** | `/crm/segments` UI 纵切与 fail-closed 保存保留；consent/channel 读取须改投影口径；parity 注册收口 | 保持 Draft/frozen，同上（由 C3 承接） |

附注：三 PR 文件零重叠、无 schema/migration/真实钱路写入（本轮盘点事实）；hosted CI 因账号计费未启动，属 CI-unavailable 事实，任何未来合并按项目法走 local-ci 复现 + Founder 批准。

---

## §7 验收映射（七·甲 D/E 逐条 → 本图承接）

| 七·甲条目 | 承接方式 |
|---|---|
| D.1（功能全，`ROUTE-B-MASTER-PLAN-2026-07-12.md:137`） | §4.3 十二词反向表（主表见 §4.2） |
| D.2（流程通，端到端可恢复，`:138`） | 端到端流程：导入（B0-59）→ 分群（B0-61）/Lifecycle（B0-60/48/49）/Inbox（B0-31/38）→ Campaign（B0-51～58）/Workflow（B0-40/47/48/49） → 精确批准/发送（B0-43，挂 B0-44/45/46）→ 回复/STOP/退订（B0-44/45）→ 回执/报告（B0-41、E5-06/07），每步承接 ID 见 §4.2 |
| D.3（体验好，respond.io 走查，`:139`） | §4.2 UIUX 列 + respond.io 走查（D7 基线） |
| D.4（真实且安全，五个0，`:140`） | §4.2 test/acceptance 列；WhatsApp 唯一必真渠道（B0-31/32/33/38 + B0-43） |
| E-1（商家自主+consent+已知限制 fail-closed，`ROUTE-B-MASTER-PLAN-2026-07-12.md:144`） | B0-44/45 + D2/D5（R-010 §4） |
| E-2（统一模型，`:145`） | 统一模型 + B0-41/42 connector seam |
| E-3（Gupshup adapter 合同，`:146`） | adapter 合同验收条款（§4.2 WhatsApp 路径列：contract tests/健康状态/幂等去重/对账/统一 receipt/回滚） |
| E-4（Salesforce 深度排除，`:147`） | §5 排除清单 |

> **标注说明**：Route-B 总计划 §七·甲 E 节（`:142-147`）原文为四段无编号 bullet；本文档采用「E-1～E-4」作为按段落顺序的非正式标签（E-1=`:144`、E-2=`:145`、E-3=`:146`、E-4=`:147`），源文件本身不含该编号——此为便于交叉引用的约定，非源文件既有标记，特此说明以免误认为逐字引用。

**结论行**：coverage claim = **零缺口、零重复**（以 §4.3、§4.4 两张反向表为证）。

---

## §8 下一批 native tasks 候选归组（不开工、不排序）

本节**不是新 roadmap**，不修改 Route-B 顺序权威（Route-B 总计划仍是唯一总计划，「不另建 roadmap」继续有效，`ROUTE-B-MASTER-PLAN-2026-07-12.md:10`）。本节只按既有 §四.4 纵切规则（每片 UI+后台+人工入口+Otto skill+测试+报告一次完成，`:63`），把 §4 的 28 个原子按最小可交付纵切**归组为候选票**（C1～C7，合计恰好覆盖 28 原子，与 §4.2 一一对应），供 Founder 决定拆分、取舍与先后；候选之间**不设本文档自定的执行顺序**，下表「权威约束」列只转述既有已批准约束，不构成排序决定。

| 候选归组 | 范围（承接原子） | 权威约束（既有批准的转述，非本文档排序） | Founder-only 项预告 |
|---|---|---|---|
| **C1 身份+同意底座** | B0-59/60（ChannelScope/ConsentEvent 投影读写 + Contact 档案）+ 承接 #327 rework | R-010 §7 冻结 M0-M6 迁移顺序；D8：身份/同意载体获批实现并验证前，所有依赖发送路径 disabled/fail-closed（R-010 `:248-250`） | 涉 Prisma/schema/migration → 须 Founder schema 授权（R-010 §7/§9） |
| **C2 Campaign 底座** | B0-51/52/53/54/55/56/57/58 + 承接 #328 rework | D3：Campaign 一期只归组、不存可编辑 UTM | B0-57💰 走 money-safety-review 硬门 + Founder 逐笔批真实花费验证（`docs/BLUEPRINT.md:147`） |
| **C3 Segments** | B0-61 + 承接 #329 rework + `save-customer-segment` 术语消歧 | 宪法 10：NL→规则编译=确定性代码 | 若涉 schema，另取 Founder 授权 |
| **C4 Inbox + WhatsApp 首渠道** | B0-31/32/33/38 | 七·甲 E-3 adapter 合同（contract tests/健康/幂等/对账/receipt/回滚）；D8 fail-closed 约束适用（依赖 C1 范围的载体获批） | 真实 provider（Gupshup/WABA）接入涉 credentials/spend/Meta 送审 → Founder 前置授权 |
| **C5 Broadcast/permission/抑制/频控** | B0-43/44/45/46（含 WhatsApp 入站 opt-in/STOP 路径） | D4/D5 语义；E-3 合同同样覆盖入站路径；D8 fail-closed 约束适用 | D5/D8 物理载体（`DeliveryManifest`/`ActionReceipt`/confirmation runtime 合同等）须 Founder 批准后才可实现（R-010 §4.3.3/§11.2）；D8 延后必须在任何 live send 与 Phase-1 CRM completion 之前到期完成 |
| **C6 回执/报告** | B0-41/42 + E5-06/07 | B2 契约〇/契约1 冻结写入规范；只读铁律（`docs/BLUEPRINT.md:48`） | 回执脊柱涉 `ActionReceipt` 等 D8 载体与可能的新表 → Founder schema/runtime 批准 |
| **C7 Workflows/Lifecycle** | B0-40/47/48/49/98 | O-09 规则文件编辑器（非节点画布）；对客动作统一过 permission/抑制/频控轴 | Routine 授权模型（宪法 4 例外②，`07-B7.md:11`）细化动工前须 Founder 过目；若涉新表同上 |

**明示**：是否合并/拆分候选、建票先后、每票验收 = Founder 审批点；本文档不代为决定，归组本身不产生任何执行顺序或依赖裁决——上表约束列引用的先后关系（如 D8）均来自既有 Founder-approved 语义，其如何落到票序仍由 Founder 决定。

---

## §9 Unknown / 风险登记

- hosted GitHub Actions 因账号计费未启动（三 Draft PR 的 check 2-3 秒 fail）：CI-unavailable 事实，未来合并须 local-ci 复现 + Founder CI-unavailable 批准。
- `docs/ops/route-b/matrix/` 无 `11-B11.md`（已核实：目录列表中不存在该文件），而 Route-B 总计划 §三定义 B11 全城联验（`ROUTE-B-MASTER-PLAN-2026-07-12.md:53`）：登记为台账缺口，不在本文档修复。
- Blueprint v2.12 修订行批准列「待 founder 终审」（`docs/BLUEPRINT.md:239`）待下次修订回填，第七章规则内正常（`:210-211`），非冲突。
- R-010 文档自标 `DRAFT/FINAL-CONVERGENCE-REVIEW-PENDING`（`2026-07-16-r010-schema-authority-alignment.md:3`），但 PR #342 已合并、#339 已以 P0=0/P1=0 关闭：两个事实并存照录，不代为裁决。
- B2「量测/报告」的 ID pin（E5-06/07）是本文档的编制判断，随本文档交 Founder 批准（见 §4.1）。
- `save-customer-segment` 与 CRM Segment 的互指口径问题此前仅记录于旧 spec 开放问题表（`docs/superpowers/specs/2026-07-14-b8-phase1-campaign-crm.md:357`，L-3），未进入任何已批准裁决；本文档 §2/§6 将其消歧动作挂到 B0-61 切片验收，属编制安排，随本文档交 Founder 批准。
