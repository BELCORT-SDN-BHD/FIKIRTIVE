# B8 · Campaign + Contact/Identity/Segment 底座 —— 原 11 行冻结稿（D-038 对齐）

> **性质**：wayfinder 票 **#296** Resolution（founder 12 槽判决，2026-07-14 晚，12/12 全清）喂 to-spec 的产物。其 11 行 Campaign/CRM 底座机械合同曾按 D-034 冻结；schema 类实施 PR 仍按 AGENTS.md founder-only 类别处理。日期 2026-07-14。
> **2026-07-16 D-038 上位对齐（Blueprint v2.12/#334）**：本稿不再代表「商业第一期全部」或「完整 CRM 的唯一 to-tickets 依据」。它只控制 B0-51～61 的 Campaign + Contact/Identity/Segment 底座，兼容的 schema、动作、钱路与安全合同继续有效；任何把「Campaign 8 + CRM 3」等同 Phase‑1 完成、把 CRM 缩成三页/三行、把老客唤回当独立产品支柱、或把 EasyStore/Gupshup 写成核心依赖的旧含义均被取代。完整 Customer Engagement CRM 由 B5～B8 既有行横切承接：Contact/Identity、导入/去重/合并、标准/自定义字段、tags、动态 Segments、Lifecycle、全渠道 Inbox/历史/搜索/分派、Campaign/Broadcast、Workflows、human/Otto takeover、unsubscribe、receipts 与 reports；Phase‑1 真实顾客渠道只有 WhatsApp，Gupshup 只是首个可替换 adapter。完整 release contract 与 UIUX/user-flow 门见总计划「七·甲」。本修订不新增 schema/ID，不迁任何实现状态。
> **[R-010 schema authority](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339) 硬停**：「兼容的合同继续有效」只指不存在冲突的机械部分。本稿/#314 的 `(ownerId,channel,externalId)` identity、Contact consent 字段、Campaign `utmBase` 与 B2 v1.2 已冻结的 issuer/version identity、`ConsentEvent` 四轴、结构化 `utmJson` 三处互斥。D-038 不选择真源；本 PR 不改 schema。三处须经独立 Founder-approved schema alignment 后才可进入施工。
> **判决真源**：①issue #296 Resolution（D-1～D-12 终局）②issue #294 Resolution（授权信封：精确清单式+指纹保鲜+72h）③issue #295 Resolution（停按钮：基线三分流+单粒度+对象级插手）④`docs/research/GRILL-VERDICTS-2026-07-03.md` 2026-07-14 追加节（审批粒度 :259 / 停按钮 :260 / 三环卖法 / 建卖两图）。
> **设计底稿**：`docs/design/route-b/2026-07-12-b8-campaign-design.md`（Campaign 8 行）+ `docs/design/route-b/2026-07-12-b8-crm-design.md`（CRM 3 行）——本 spec 只取原 11 行底座相关部分；无需依赖仓库外草稿即可恢复本稿依据。
> **范围锚**：`docs/ops/route-b/matrix/08-B8.md` 的 B0-51～B0-61（文件第 7～17 行，§八逐行对账）。**数据上位**：`docs/design/2026-07-03-harmony-01-data-model.md`。**缝配方**：`docs/review/EXPANSION-SEAMS.md`。
> **同批同构件**：[`2026-07-14-envelope-stop-design.md`](2026-07-14-envelope-stop-design.md)（#294/#295 冻结图纸）——本 spec 的打包总价页💰与停按钮两节与之**同构**，机器细节以该稿为准，本文只写 Campaign 化身处。
> **纪律**：**零发明**——每条设计指回判决原文或两份设计图原文；拿不准的进 §七假设台账或 §九留白。语言华语（宪法 9）；生成 brief 英文；界面文案英文 sentence case（founder 设计罗盘）。💰行变真必过 `money-safety-review`。
> **当前去向**：只把不涉及 R-010 的机械部分作为 B0-51～61 后续施工输入；identity/consent/UTM 三处不得派工。冲突闭合后，本稿才可与 B5～B7 及总计划「七·甲」共同进入后续 to-spec/to-tickets；任何时候都不得单独签发为完整商业 Phase‑1。

---

## 〇、人话对照表（先看这张）

| 术语 | 人话 |
|---|---|
| B0-51～B0-61 | B8 的 11 条底座能力行（`08-B8.md` 台账行号；不是商业第一期全部） |
| 原 11 行 slice | Campaign 8 行（B0-51～58）+ Contact/Identity/Segment 底座 3 行（B0-59～61）；完整 Customer Engagement CRM 横切 B5～B8，Salesforce 深度明确不在 Phase‑1 |
| D-1～D-12 | founder 2026-07-14 对 #296 草案 12 个决定槽的逐槽判决（本 spec 的直接上级判决） |
| Campaign 独立对象 | "活动"是自己的一张表，不升格 project（红旗六："干净最重要"） |
| Contact / ContactIdentity | 客户档案 / 同一客户在各渠道的身份（WhatsApp 号、IG 帐号…），多身份指向一人 |
| Segment | 分群：店主一句话 → 确定性规则（宪法 10），不靠模型猜 |
| TrendSnapshot | 趋势快照：Otto 研究过的市场热点落成一行行存档，策划先翻自家存档 |
| 授权信封 | 用户一次点头批下的"封套"：恰好哪些产出、恰好多少钱；封外任何事回来再问（#294） |
| 指纹保鲜 / 72h | 信封按内容变质不按时间变质：价格/素材/清单漂移→指纹失效整封作废；另加 72h 未开工兜底；开跑后不再过期（#294） |
| 停按钮 | 每个在跑任务卡一颗「停」：不开新动作、排队的撤销退款、在跑的诚实跑完（#295） |
| 双模（宪法 7） | 人可亲手操作 100%，Otto 也能代办 100%，两条路走同一个 server 动作 |
| 缝 1～9 | 九条扩建缝（`EXPANSION-SEAMS.md`）；任何新东西必须走缝，绕缝直连=审查一票否决 |
| ownerId 隔离（缝 5） | 每行数据写死属于哪家商家；跨商家读一个字节=事故（宪法 6 租户铁幕） |
| 💰行 | 碰真钱的行；一期唯一💰 = B0-57 打包总价确认页（全舰单最高优先），变真必过 money-safety-review |
| 六态（发布契约） | B0 六级状态 `listed→spec-ready→code-complete→sandbox-verified→review-submitted→live-verified→release-certified` |
| 界面六态 | 每个表面的 happy/empty/loading/denied/failure/retry 六种状态 + 移动端（sandbox-verified 证据） |
| A′ | `apps/web/app/northstar-immersive/*` 沉浸城原型页（Campaign 区 7 页、CRM 区 4 页在其中） |

---

## 一、B8 底座范围：11 行逐行对号 + 判决引用

**D-038 修订后的地位**：D-1 的 Campaign 打包机械范围保留，但它不再单独定义商业 Phase‑1 或把三条 CRM 底座行当成完整第三支柱。三支柱必须共同通过；完整 Customer Engagement CRM 是 B5～B8 的横切结果。

| 行 | 能力（人话） | 一期做到 | 判决/出处 |
|---|---|---|---|
| B0-51 | Campaign 独立对象（最薄容器） | 一张最薄表：名字/状态/目标/起止/UTM 基串/提案快照；GM-03 目标进度条**字段**预留（UI 随 P3） | 红旗六；campaign 设计图 §六A；**D-4 ✅ UTM 基串口径确认**（一个 `utmBase` 字符串字段，完整归因仍 P3——O-1 闭合） |
| B0-52 | 归组接线（内容认领活动） | `ScheduledPost.campaignId?`、`Generation.campaignId?` 两条**加性 migration**；`Project.campaignId?` 已预留免动；不建关联表 | harmony-01 §四①；campaign 设计图 §六B |
| B0-53 | Campaign 工作台（表单发起） | 四项表单（目标/周期/预算/平台）即发起策划，不靠聊天 prompt；X pricing 静态文案**不接钱路**（矩阵注 mock 风险 7/18） | 第四批判决「专属工作台要」；§三.1 |
| B0-54 | Campaign 日历工作台 | 日历/列表双视图批改；D-038 后全局 Auto-publish 正向开关/文案移除或隐藏。Direct 只由精确 post/batch 批准，account switch 只负向暂停，历史 queue 不转换 | Blueprint v2.12/#334；§三.3 |
| B0-55 | Campaign 列表+详情页 | 列表四态 + 详情最薄（容器+只读归组产物 content/posts）；ads/results/research tab 诚实标 **P3 骨架** | campaign 设计图 §三/A2；§三.4 |
| B0-56 | Otto Campaign 策划师 | 研究 trend → CAMPAIGN_CARD 提案卡（$0）→ 用户改/批（$0，批的是计划）→ 铺生成清单进信封 | 冲刺 C 线 spec（2026-07-08 已冻结）；campaign 设计图 §五；§三.2 |
| B0-57 | 打包总价确认页 💰 | **一期做**（D-2 = B）：一次点头买一批 = 一张授权信封盖整单；server 重算总价+逐卡过生成闸+失败自动退该条。**全舰单最高优先💰行，变真必过 money-safety-review** | **D-1 = A、D-2 = B**（随 D-1 顺带锁定+审批粒度判决要求）；#294；判决 7-3/7-7；§三.5 |
| B0-58 | 趋势存档 TrendSnapshot | **最薄六字段**（D-10：富化后置）+ 两个写入点 + 一个读技能；引擎侧协调 = B9 复核（矩阵注） | **D-10**；campaign 设计图 §六C；§二.6 |
| B0-59 | 联系人自动进来 | 自动建档写入点在邻块（B5 入信/B2 归因/B7 欢迎流），CRM 消费展示；CRM 自身写四类：手工 Add lead / **CSV 导入（D-3 = A 一期带）** / 合并 / consent | **D-3 = A**（唤回名单冷启动）；CRM 设计图 §6.2；§二.7 |
| B0-60 | 联系人档案页 | 身份合一 + permission/DND 分轴 + 标准/自定义字段 + tags + Lifecycle + 时间线/会话链回；做减法：不含 Deals/Companies/Salesforce Quote object/发票收款，对话式答价/订金链接仍归 B5 B0-37 | **D-038 + D-7**；CRM 设计图 §3.2/§1.3；§三.8 |
| B0-61 | 联系人分群 | 一句话→确定性规则编译（宪法 10）+ 内建 Hot/Win-back 分群 + **VIP 内建分群 = 消费 ≥ RM500 且近 90 天有单（配置可调）**（D-7）；起步实时算成员（物化留 B/C 档，契约预留纯函数可重算） | **D-7**；CRM 设计图 §3.3/§6.1C/Q3/Q4；§三.8 |

**判决对账（12/12 去向）**：D-1/D-2/D-3/D-4/D-7/D-10 落本 spec（上表）；D-5（竞价/直播/增长实验只留缝）、D-6（微站活页最小成立）、D-8（口碑四推荐）、D-11（GBP 与 Meta 同批备料并行递）属二期 15 行，**不落本 spec**，随各自分域设计图进各自 spec；D-9（请评时机）**暂缓**至回执图纸联审（§九留白）；D-12（AEO=流程漏判，恢复原判）与 B8 一期无阻断关系，已由 #296 Resolution 记录在案。

**与三支柱的接缝**：内容生成继续走既有 generate 七步闸（缝 3）；成片经 schedulePosts 先建 DRAFT，真实 Reminder/Direct 发布归 B4；B0-59～61 只提供 Contact/Identity/Segment 底座，Inbox、Broadcast、Workflows、退订、回执与报告分别由 B5～B7/B6 共同闭环。此 slice 零新收费点：策划对话、search、生成继续复用既有 credits 轨。

---

## 二、数据模型（新表 5 张 + 加性外键 2 条；缝 5 全套：ownerId 无默认 + TENANT_MODELS + 2-org 隔离测试）

> 上位约束（harmony-01 §一五条数据宪法）：一份数据全城引用（禁影子副本）；每表 ownerId 无默认值 + 领头 `(ownerId, …, deletedAt)` 索引；没有"Otto 专用表"；按终局设计按阶段落地（全部 additive）；每个新对象出生即登记 Parity Manifest + CATALOG + 对象总表。状态值一律**代码校验字符串**不建 PG enum（house style；ChatMessageKind 例外见 §六缝 8）。

### 2.1 Campaign（harmony-01 §三 #11；红旗六：不升格 project，一张表长到完全体）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id / fk | server 端铸；organization 关系进 TENANT_MODELS |
| `name` | string | `deriveCampaignName(goal)` 可派生 |
| `status` | string | `DRAFT→ACTIVE→DONE/CANCELLED`；一期允许人工/Otto 切，无复杂流转守卫（完全体编排 = P3） |
| `goal` | string | GM-03 目标进度条数据源（UI 随 P3） |
| `startAt` / `endAt` | datetime | 周期（几天到几个月）；时区记 Asia/Kuala_Lumpur |
| `utmBase` | string? | **D-4 确认口径**：一个字符串字段（形如 `utm_source={platform}&utm_medium=social&utm_campaign=<slug>`），非完整归因系统；写进 ScheduledPost 发布链接由排期/发布区消费 |
| `planJson` | json | 提案卡快照（逐条 entry：date/platform/format/hook/英文 brief/estCredits） |
| `createdAt`/`updatedAt`/`deletedAt` | datetime | 软删，永不物理删 |

### 2.2 归组外键（B0-52；harmony-01 §四①「归组=可空外键，不建关联表」）

| 宿主表 | 字段 | 现状 | 一期动作 |
|---|---|---|---|
| `Project` | `campaignId?` | 已预留（schema.prisma:66 软引用） | 复用，零 migration |
| `ScheduledPost` | `campaignId?` | absent | 加性 migration |
| `Generation` | `campaignId?` | absent | 加性 migration |

一个产物属于零或一个活动；多归属需求真到 Salesforce 级再加关联表（additive 不冲突）。B9 复核点：生成/排期技能透传 campaignId。

### 2.3 Contact（harmony-01 §三 #7；起步字段子集，全部 additive）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `ownerId` | id / fk | 租户隔离领头键 |
| `name` | string | 显示名 |
| `lifecycleStage` | string | **D-7 判决值域：最小三态 `New` / `Active` / `Dormant`**（CRM 设计图 Q1 = A 闭合） |
| `source` | string | 首触来源人话标签（「来自哪个入口」） |
| `firstTouchCampaignId` | fk? | 归因桥——CRM 与 Campaign 在数据层的唯一互指；从 identity 首触记 |
| `firstTouchAt` / `lastSeenAt` | ts | 进线时间 / 最近可见（热度算子输入；heat 起步**派生不落列**） |
| `marketingConsent` | string(`opt_in`/`opt_out`/`unknown`) | 默认 `unknown` 不假装同意；consent 是**字段**，抑制名单是 B7 运行时**非字段**（判决 7-9） |
| `consentSource` / `consentAt` | string / ts | 同意从哪来、何时（PDPA 姿态） |
| `doNotDisturb` | bool | **D-7 判决：勿扰与退订保持两个字段不合并**（Q6 = A 闭合）——doNotDisturb=店主主观软状态，opt_out=客户法定硬状态；**任一为真→不可群发** |
| `totalOrdersMyr` | money? | **只读**自 B6 可替换经营事实 connector（EasyStore 可选），CRM 永不自建账本；无回执数据时隐藏/空 |
| `createdAt` / `deletedAt` | ts | 软删 |

### 2.4 ContactIdentity（多渠道身份；防重复建档的机器闸）

| 字段 | 说明 |
|---|---|
| `id` / `ownerId` / `contactId` | 指向 Contact |
| `channel` | `whatsapp`/`instagram`/`facebook`/`email`/…（代码校验字符串） |
| `externalId` | 渠道内唯一标识（waPhone E.164 / igPsid / fbPsid / email 小写） |
| `handle` / `label` | 展示用 |
| **唯一索引** | **`(ownerId, channel, externalId)`**（harmony-01 §七钉子）——upsert find-or-create 判据；命中即更新 lastSeenAt 不新建 |

**跨渠道判同人纯确定性**（宪法 10；CRM 设计图 §6.3 五条原样）：强标识精确相等（同 waPhone E.164 规范化后 / 同 email 小写化后 / 同 fbPsid）才系统**建议**合并；仅同名仅相似**不自动合并**，标「可能重复」请人工并排比对；合并 = 重指 Identity.contactId + merge 审计，**永不物理删**；归因继承取较早的 firstTouchAt / firstTouchCampaignId。规范化规则表由 B2/B5 spec 联审钉死（Q5，§九留白）。

### 2.5 Segment（harmony-01 §三 #13）

| 字段 | 说明 |
|---|---|
| `id` / `ownerId` / `name` | |
| `phrase` | 店主原话（NL 原文可回看） |
| `rulesJson` | **确定性编译产物**（宪法 10：存规则不存模型输出）；五类规则：消费门槛/渠道/N 天活跃/标签/可联系 |
| `kind` | `builtin_lifecycle` / `custom` |

- **内建分群（一等公民）**：Hot right now / Win-back（流失唤回）+ **VIP**——**D-7 判决：VIP = 消费 ≥ RM500 且近 90 天有单，配置层可调**（确定性阈值，不是模型打分；口碑域 VIP 识别同源复用不另建——CRM 设计图 Q8 建议）。
- **成员实时算**（起步 A 档，Q4 = A）：`contactMatchesRules` over 联系人；物化 SegmentMember 表 = B/C 档规模优化；契约预留规则是纯函数可重算。
- **permission/受众分离（D-038）**：联系人来源、商家选择的受众、可验证 grant 与已知 hard block 分开呈现。import 不写 opt-in；已知 STOP/opt-out/DND/provider limit 由 B7 运行时硬拦；unknown 不冒充 consent，也不因缺少平台证据而被自动删出商家名单。

### 2.6 TrendSnapshot（D-10 判决：一期最薄六字段，TrendIntel 富化后置）

| 字段 | 说明 |
|---|---|
| `id` / `ownerId` | 缝 5 全套 |
| `summary` | 结论句 |
| `sources` | 来源引用 json（title + domain 数组） |
| `capturedAt` | 采集日 |
| `campaignId?` | 可空（research 可 standalone） |
| `createdAt` / `deletedAt` | |

只存**结论层**，正文留在 WebPageCache/RESEARCH_REPORT（禁影子副本）。**写入点两个**：①深研管线（#118）报告完成时提炼一行；②proposeCampaign rationale 引用的 trend 依据同步落档。**读取点**：`listTrendSnapshots` 读技能（缝 1，$0）。引擎侧协调 = B9 复核（矩阵 B0-58 注）。

### 2.7 CSV 导入 + 手机号查重合并的数据形状（D-3 = A，一期带）

**零新表**。导入 = 一个批量 server action，复用 2.3/2.4 的表与唯一索引：

1. **流程**（CRM 设计图 §3.1/§五原样）：贴表 → 列映射（名字/手机号/email/标签）→ **查重预览** → 确认导入。
2. **查重判据 = 唯一索引**：每行按规范化后的强标识（手机号 E.164 化、email 小写化）对 `(ownerId, channel, externalId)` find-or-create；命中 = 疑似重复，预览面报「N 条新增、M 条疑似重复」，默认**跳过重复**（用户可改为合并，走 2.4 合并语义：重指+审计+永不删）。
3. **写入形状**：新增行 `source=imported`，Contact + ContactIdentity 同 tx 建；重复行零写入（skip）或走合并动作（人确认）。
4. **幂等**：同一份表重复导入零重复建档（唯一索引 P2002 → 计入"跳过"，不报错不重建）；导入不触碰 consent（默认 `unknown`，**导入永不代客户 opt-in**——CRM 设计图 §6.4「同意必须来自客户动作」的推论）。
5. **格式失败诚实**：读不了的行逐行指出（Otto 侧同语义），不吞行、不静默丢。

---

## 三、界面：Campaign 工作台七房间 + CRM 三页

> founder 已拍（2026-07-07 原话）：专属结构化入口 + 表单发起 + 日历工作台；按钮与 Otto 同动作层（O-12「就地按钮=Otto 的手」）。七房间对齐 A′ campaign 区 7 页（campaign 设计图 §三逐页核对）；CRM 三页对齐 A′ crm 4 页做减法（deals 页出程）。全部走缝 7（.gb + shadcn；coral 只属 Otto）。

### 3.1 房间一 · 工作台（workbench，B0-53）
四项表单（目标/周期/预算/平台）填完即发起策划，零学习曲线不需要会写 prompt。X pricing 为静态展示文案**不接钱路**（真实计费随 E4-14 一处收口）。「Ask Otto」就地帮我。

### 3.2 房间二 · 提案卡（proposal-card，B0-56）
聊天里和工作台里是**同一张 CAMPAIGN_CARD、同一份数据**（Campaign 薄行 + planJson，不建第二份副本）：战略洞察 + 主题/目标/节奏 + N 条内容日历（受众×角度×明价×KPI×时段）+ 预估总价；逐条改/删/批。**计划层的改/批全程 $0**（批的是计划不是花钱）；rationale 带来源引用，Otto 不捏造 trend。

### 3.3 房间三 · 日历（calendar，B0-54）
日历/列表双视图批改（与聊天卡同一份 store）；改一条实时重算预估总价。原全局 Auto-publish 正向 preference 语义由 D-038 取代：当前 UI 移除或隐藏该开关；未来 preference 最多预选建议，永不拥有外发权。Direct 只消费精确 post/batch 的有效批准；account switch 只负向暂停，解除不补发过时项目，历史 Reminder/DRAFT queue 不转换。

### 3.4 房间四 · 列表 + 详情（list/detail，B0-55）
列表四态（DRAFT/ACTIVE/DONE/CANCELLED）+ 目标进度；详情一期只做容器 + 只读归组产物（content/posts tab 读 campaignId 外键）；ads/results/research tab 诚实标「P3 骨架」。

### 3.5 房间五 · 打包总价确认页（pack-confirm，B0-57）💰 —— 与 #294 授权信封**同构**

> **同构声明**：本页 = 授权信封卡（[`2026-07-14-envelope-stop-design.md`](2026-07-14-envelope-stop-design.md) 第一章）在 Campaign 区的化身。数据形状、失效谓词、追加流程、UI 状态**逐条沿用该稿 §1.1～§1.5**，此处只写 Campaign 化身处；两稿如有出入以信封稿为准并回报（不各自演化）。

1. **一次点头 = 一张授权信封盖整单**（GRILL-VERDICTS:259 审批粒度；D-2 = B 一期做）：Otto 先复述理解 + 报价（判决 7-7 原样：「My understanding: N posts for X, period, across platforms, to goal. The total below is the exact quote.」），用户点「Approve all (N · X credits)」；**不做逐卡弹批的钱路**——连环确认按缺陷处理。
2. **精确清单 + 指纹**（#294 形态 A）：信封 items[] = 本单每张生成卡（toolName/ref/**contentHash**/quotedCredits），totalCredits = Σ 分项，**envelopeHash** = canonical(排序分项指纹 + 总价)——内容或价格变一个字，号码对不上机器硬拒。落在既有 APPROVAL_CARD payload 上，**零新表**（B0-29 ApprovalRequest 落地时同 hash 平移）。
3. **两只钟**（#294 保鲜 C）：批准前 24h ask 时效（既有 APPROVAL_CARD_TTL_MS 不动）；批准后 **72h 未开工兜底过期**（startBy = approvedAt + 72h，惰性判定）；**开跑后（startedAt 非空）不再过期**，跑一半不中断。失效谓词只有 P1（指纹/价格漂移→整封作废重报价重批）与 P2（72h 未开工），无第三种死法。
4. **server 重算总价（不信客户端）**：卡上 estCredits 只是展示估价；确认时 server 从持久化的卡逐条重算重验（A′ 已明写此文案），报价数 = server 重算数 = 预留数 = 结账数（三数一致不变量，W-B3-E-P 口径）。
5. **逐卡过生成闸（缝 3）**：一次点头是**对这批卡的批准，不是绕闸**——server 仍逐卡过既有 generate 七步闸，每卡自己的幂等键 `cowork:<cardId>` once-EVER（DB partial-unique 兜底，双击/重放零双扣）。
6. **partial 退款**（判决 7-3）：任一条失败自动退该条 credits、其余不受累（REFUND 行落账，消费明细可见——宪法 3③）+ Retry；SETTLE/REFUND 互斥由既有 finalizer 索引保证。
7. **余额不足分支**：总价 > 余额 ⇒ 批钮禁用 + 显式差额 + 充值链接（`canAffordPack` 既有行为）；永不静默扣到 0；只显示 credits 不显示美元（宪法 3①）。
8. **追加三触发**（判决 8-5 闭集）：中途只有追加花钱 / 对外发布 / 客户承诺才再问，形态 = **增量小信封**（只装新增项与增量价，不重批已批部分）；清单内的事跑到哪步都不再问。
9. **成片只建草稿**：generate 成功经 schedulePosts 只建 DRAFT（归组 campaignId，$0 不发布）——「Nothing publishes without you.」
10. **变真闸门**：本页触碰批量 spend 路径，diff **必过 `money-safety-review`** 符号清单（typed genRequest gate / startGen / coworkGenerate / idempotencyKey·dedup / partial-unique 幂等索引 / `apps/worker/src/jobs/gen.ts` fal 调用）；总审查员双闸看守。**零新钱路零新收费点**：信封只是批准的包装，spend 权威链一条不加不改。

### 3.6 房间六 · 停按钮 —— 与 #295 **同构**

> **同构声明**：沿用 [`2026-07-14-envelope-stop-design.md`](2026-07-14-envelope-stop-design.md) 第二章全部语义（基线三分流/单粒度/对象级插手/幂等/文案基调），此处只写 Campaign 区落点。

1. **位置**：批量生成在跑时，信封卡/批次卡 running 态常驻一颗「Stop」（条件 = 既有 `cardState === "working"`）；**不建**全局红按钮/区级停（全局停归 routine 四件套 kill switch，本期不做）。
2. **基线三分流（无选项）**：DONE 留下（作品即进度）；GENERATING 诚实跑完（供应商不可撤，完成后照常结算）；QUEUED 撤销 + REFUND 行退款；信封剩余未开工分项一并按 QUEUED 撤销退款；停后零新动作开出。停不撤已发生的对外写（停 ≠ undo）。
3. **对象级插手**：用户对 Otto 持有排队动作的对象发生一次 effect=write 落库操作即「碰」——该对象排队动作撤销退款，其余照常；配一句让位提示（"This one's yours now — I'll keep working on the rest."）；read 类操作（查看/复制/下载）零触发，watch/live reflection 零回归。
4. **想继续 = 再说一句话** = 新 request = 新信封（重新报价重批）；无恢复按钮无存档（重机器已永久砍）。停后小结诚实汇报分流结果 + 引导句（宪法 3④建议按钮）。
5. **幂等**：重复点停 / 与 worker 取活竞态，同一项永不双退（对齐既有 finalizer 单终态纪律）。

### 3.7 房间七 · 趋势存档（trends，B0-58）
TrendSnapshot 只读翻阅面；「被哪个 campaign 用过」可见。一期最薄六字段（D-10）；A′ 的证据句/置信度/复核期富化 = 展示层后置。

### 3.8 CRM 底座三页（不是完整 Customer Engagement CRM；D-3/D-7 机械范围保留）

| 页 | 一期做到 | 判决落位 |
|---|---|---|
| `crm/contacts` 名册 | 页头「Add lead」+「**Import**（CSV，**D-3 一期带**）」；四张数据卡（联系人数/累计订单额只读/几个热/在险金额）；Otto 洞察条（CRM 唯一 coral 触点，一句人话）；名册列表 + 搜索 + 热度筛选 chip；**查重合并提示条随 CSV 导入一并进一期**（D-3「导入+查重合并」连体） | D-3 = A |
| `crm/contact-profile` 档案 | 头部 chips + Identities 身份合一 + 联系来源/permission facts 与 DND 分轴展示（不提供伪造顾客 opt-in 的万能开关）+ Merge duplicate + 标准/自定义字段 + tags + Lifecycle + Activity 时间线/字段变更留痕（ActionEvent）+ Conversations 链回 B5。**剥离**：Deals（OUT-DEAL）/ Companies（OUT-COMPANY）；对话式答价/数量价/订金链接归 B5 B0-37，但 Salesforce 式 Quote object、发票与收款仍 OUT；待办任务仍后置 | D-038 + D-7；完整 Customer Engagement CRM approved features |
| `crm/segments` 分群 | 左栏分群列表（内建 Hot/Win-back/**VIP** + 自建）实时命中数；右栏分开显示「商家所选 / verified permission / unknown / known hard-blocked」四桶，已知 STOP/opt-out/DND/provider hard limit 禁用且强制剔除，unknown 如实保留、不冒充许可也不自动删名单；「Post to this group」→排期。建群对话框：人话描述 → 确定性规则编译 chip 预览 + 四桶计数 → 存；配方库（欢迎/唤回/复购/生日）**只作入口展示，落地归 B7** | D-7 VIP 阈值 + D-038 受众主权 |
| `crm/deals` | **删**（OUT-DEAL，起步不建管道） | — |

**结构保证（全城）**：表单入口与聊天入口殊途同归——都落到同一个 server 动作（同一套校验、同一张卡、同一行数据）；每个新按钮出生即登记 Parity Manifest（缝 9，CI 硬拦）；live reflection = 推送/即时刷新 + coral 高亮 + 一行人话叙述（headless 动作层，非像素操作）。

---

## 四、Otto 技能对照表（宪法 7 双模逐行；带 * = 新技能走缝 1 注册五步）

> 双模铁律：人工可完整操作无例外 + Otto 可 100% 操控，同一个 server 动作两个入口。豁免只有四类（ADMIN/VISUAL/MONEY_IN/ACCOUNT_SECURITY），新增类别 = 修宪。

| 行 | 人工面 | Otto 面（skill + 姿势） | 三字段 | 审批闸 |
|---|---|---|---|---|
| B0-51/52 | 工作台建活动；产物认领活动 | *`proposeCampaign`（$0 写卡+薄行）；生成/排期技能透传 campaignId | free/write/internal | 免批 |
| B0-53 | 四项表单发起 | 同一 `proposeCampaign` 动作（表单=Otto 的手） | free/write/internal | 免批 |
| B0-54 | 日历逐条改/删/批 | 卡上逐条改（`updateCampaignEntry`/`removeCampaignEntry`/`approveCampaignEntry` 同一动作层，store 唯一事实） | free/write/internal | 免批（$0，批的是计划） |
| B0-55 | 列表/详情浏览 | *campaign 读技能（活动清单/详情，$0 read——读的对等） | free/read/internal | 免批 |
| B0-56 | 提案卡上改/批 | `researchWeb` 轻查（随轮计量）+ `proposeResearch` 深研（卡批）+ `proposeCampaign` | 复用既有 | 深研卡=用户点批 |
| B0-57 💰 | 打包确认页一次点头 | Otto 复述理解+报价→用户批→server 逐卡过 generate 七步闸（`ottoApprove`→`coworkGenerate` 既有链） | spend | **必批**（一单一封；#294 信封语义） |
| B0-58 | 趋势存档页翻阅 | *`listTrendSnapshots`（$0 read） | free/read/internal | 免批 |
| B0-59 | 手工 Add lead；**CSV 导入** | *`addLeadContact`；*`importContacts`（解析/映射/查重预览/确认——CRM 设计图 §五 CSV 行的 skill 化，D-3 提前进一期） | free/write/internal | 免批（查重预览是 UX 闸不是钱闸） |
| B0-60 | 档案页看/改 consent、字段/tags/Lifecycle；合并 | *`listContacts`/*`getContact`/*`searchContacts`（$0 read）；*`setContactConsent`（**永不代客户 opt-in**）；*`mergeContacts`（强标识判据→并排比对卡请人确认）；标准/自定义字段、tags、Lifecycle 必须有配对 Otto capability 并与人工入口共用动作层，具体 skill 名/数量留后续 Founder-approved implementation spec 冻结 | free/read + free/write/internal | 免批；consent/合并/字段/tags/Lifecycle 改动均留痕（ActionEvent） |
| B0-61 | 分群页建/改群 | *`buildSegment`（原话→确定性编译→分别预览商家所选、verified permission、unknown、known hard-blocked 四桶后请用户确认保存）；*`previewSegment`（$0 read）；词不中→追问澄清不乱猜 | free/write + free/read/internal | 免批（内部写） |
| 分群→B7 交接 | 「Post to this group」/唤回条复制草稿 | `draftWinBack`（品牌记忆起草，**只起草不发**；发=外部写归 B7） | turn 计量/write(草稿)/internal | 起草免批；真发归 B7 审批闸 |

**新技能计数**：原 v0.4 Campaign+薄 CRM 底座曾估约 **11-12 枚**；D-038 加入字段/tags/Lifecycle 双执行器后，该数字只保留为历史估算，不再是完整 Phase‑1 的冻结数量。后续 Founder-approved implementation spec 先按真实 action surface 定 skill 名与数量，再逐枚走缝 1 注册五步（registry+test 名单、migration gate 断言、CATALOG 重生、instructions、parity manifest）。全部为 free/$0（除 draftWinBack 轮计量）；**spend 技能零新增**（B0-57 走既有 generate/coworkGenerate 链）。

**对照表纪律**：每个新 server action 出生即登记 Parity Manifest（缝 9），CI `lint:parity` 硬拦漏登记；每个人工可见数据面配对 free/read skill（Otto 不做瞎子操作员）。

---

## 五、六态与验收标准（机器可测）

### 5.1 六态轨迹（11 行全部内部行：3→5 直迁标 n/a-internal）

| 行 | 现状 | 本 spec 冻结后 | 升级证据要点 |
|---|---|---|---|
| B0-51 | listed | spec-ready | 最薄行 schema + 2-org 隔离测试 + GM-03 字段预留 |
| B0-52 | listed | spec-ready | 2 条加性 migration + 归组测试（零或一个 campaign） |
| B0-53 | listed | spec-ready | 表单发起 e2e + parity 登记 + X pricing 不接钱路断言 |
| B0-54 | listed | spec-ready | 日历批改 e2e + 无全局正向 Auto-publish 权 + Direct 仅精确 post/batch 批准 + 历史 queue 不转换 |
| B0-55 | listed | spec-ready | 列表四态 + 详情只读归组 e2e + P3 骨架 tab 标注 |
| B0-56 | listed | spec-ready | proposeCampaign 六处登记 + CAMPAIGN_CARD 五道缝 + 双模走查 |
| B0-57 💰 | listed | spec-ready | 信封验收全项（5.3）+ **money-safety-review 通过记录** |
| B0-58 | listed | spec-ready | TrendSnapshot 表 + 2-org 隔离 + 两写入点 + 读技能 |
| B0-59 | listed | spec-ready | 唯一索引防重 + CSV 导入幂等 + 邻块写入点边界联审记录 |
| B0-60 | listed | spec-ready | 档案页减法走查（无 Deals/Companies/Salesforce Quote object/发票收款断链；对话式答价/订金链接仍归 B0-37）+ 标准/自定义字段、tags、Lifecycle、Identity/会话/活动时间线 CRUD + owner 隔离 + ActionEvent 留痕 |
| B0-61 | listed | spec-ready | 编译器五类规则单测 + VIP 阈值配置层 + 内建分群 |

**界面六态纪律**：每个表面（七房间 + CRM 三页）必须给全 happy/empty/loading/denied/failure/retry + 移动端，sandbox-verified 双执行器都走。CRM 三页的六态**以 CRM 设计图 §四为准**（原样已冻结：空态即教学 / denied=requireOwner 不泄露存在性 / failure 局部降级显式重试 / 重试幂等）；pack-confirm 页增补信封卡六态（pending/approved 未开工/running/invalidated/expired/rejected-consumed，信封稿 §1.5 原样）与停按钮态（working/stopping/stopped/插手注记，信封稿 §2.7 原样）。

### 5.2 验收标准（机器可测；vitest $0 = MockProvider，真钱验收只交方案不执行）

**数据与租户**
- [ ] 5 张新表全部：ownerId 无默认 + TENANT_MODELS 登记 + 领头 `(ownerId,…,deletedAt)` 索引 + 2-org 隔离测试（org A 建的 Campaign/Contact/Segment/TrendSnapshot，org B 读零字节）。
- [ ] 全部 migration additive（不改不删既有列）；`ContactIdentity(ownerId, channel, externalId)` 唯一索引存在且并发建档 P2002 收敛为单条。
- [ ] 归组外键可空：产物 campaignId 置空/置值均合法；删 campaign 不级联删产物（软删）。

**Campaign 主链**
- [ ] 表单入口与聊天入口落到同一 `proposeCampaign`：两路各建一次，产出同形 Campaign 行 + 同种 CAMPAIGN_CARD（不建第二份副本）。
- [ ] CAMPAIGN_CARD 五道缝逐条过：PG enum 加性 migration / threadToUiMessages / 流式白名单 / injectCardMessage 按 durableId 去重 / 渲染分支（缺一即 F23 型死卡）。
- [ ] 计划层改/删/批全程 $0：断言无 reserve 发生。
- [ ] 成片经 schedulePosts 只建 DRAFT：断言零发布调用、每条带 campaignId。

**打包总价页💰（对齐信封稿 §1.6 全项 + Campaign 化身）**
- [ ] 同一单全部生成卡**只弹一张**信封卡；出现第二张确认（增量三触发除外）= 缺陷。
- [ ] 铸封后任一分项内容漂移或 server 重算价漂移 → approve/execute 硬拒、整封作废翻 invalidated；不存在部分作废。
- [ ] `approvedAt + 72h` 未开工 → 执行拒绝翻 expired；`startedAt` 落后任何时点执行不再做过期检查。
- [ ] 每卡幂等键 `cowork:<cardId>` once-EVER：双击/重放零双扣（DB partial-unique 断言）。
- [ ] 报价=预留=结账三数一致；任一条失败只退该条（REFUND 行可见），其余格不受累；SETTLE/REFUND 互斥。
- [ ] 余额不足：批钮禁用 + 差额 + 充值链接；永不进入扣费流。
- [ ] 变真 diff 过 money-safety-review 符号清单（PR 留通过记录）。

**停按钮（对齐信封稿 §2.8 全项）**
- [ ] working 态卡有且仅有一颗停钮；全局/区级停不存在。
- [ ] 点停后：零新动作开出；QUEUED 全撤且每项一条 REFUND 行；GENERATING 照常跑完落 DONE；DONE 原样；重复点停零双退。
- [ ] 对被碰对象：排队动作撤销退款 + 让位提示恰好一条；同单其余对象队列原样；read 操作零触发。

**CRM**
- [ ] CSV 导入幂等：同一份表导两次，第二次全部命中跳过、零新建、零报错。
- [ ] 导入永不写 opt_in：断言导入后 marketingConsent 全部 `unknown`（除非已有值）。
- [ ] 合并：Identity 重指 + merge 审计行存在 + 零物理删；归因继承取较早值。
- [ ] 标准/自定义字段、tags 与 Lifecycle 可由人工/Otto 经同一动作层真实读写；owner 隔离、输入校验、刷新后持久化和每次变更 ActionEvent 全部通过。字段类型/目录的具体 schema 另由后续 Founder-approved spec 定，不在本对齐稿发明。
- [ ] Identity、Conversations 与 Activity timeline 都读同一 owner-scoped Contact；导入、merge、字段/tag/Lifecycle 更新按时间线可追溯，无影子档案或跨租户字节。
- [ ] 分群编译确定性：五类规则各有单测（同 phrase 同库存量 → 同 rulesJson 同命中集）；仅同名两联系人零自动合并。
- [ ] VIP 内建分群读配置层阈值（RM500/90 天为默认值，改配置即生效，零代码硬编码——宪法 5）。
- [ ] permission/受众职责分开：import/merchant update 不伪造 customer opt-in；已知 STOP/opt-out/DND/provider hard limit 在 B7 fail-closed；unknown 如实显示且不被平台自动删出商家所选名单。consent/merge/字段/tag/Lifecycle 变更各落 ActionEvent 留痕。
- [ ] `totalOrdersMyr` 无回执数据时隐藏/空，CRM 侧零写路径。

**对等与目录**
- [ ] `lint:parity` 绿：全部新 action 登记（配对 skill 或封闭豁免）；`catalog:check` 绿。

---

## 六、九缝映射（绕缝直连 = 审查一票否决）

| 缝 | 本 spec 走法 |
|---|---|
| 缝 1 Otto 技能 | 原底座 skill + D-038 字段/tags/Lifecycle 配对 capability 全走注册五步；确切名称/数量由后续 Founder-approved implementation spec 冻结。受闸集照旧从 registry `needsApproval` 机器推导；宪法 4 公式一字不动（改粒度不改公式） |
| 缝 2 模型/供应商 | **不触碰**（消费既有生成，零新模型零新供应商） |
| 缝 3 记账 | **零新钱路零新收费点**：打包批 reserve→settle 走既有链，每卡幂等键，partial 退款走 `refundReservation`；Otto 轮计费/search 照既有费率 |
| 缝 4 渠道 | **不触碰**（发布渠道既有；ScheduledPost.campaignId 只是归组字段） |
| 缝 5 租户 | 5 张新表全套（ownerId + TENANT_MODELS + requireOwner + 隔离测试）；spend/mutation 加 isImpersonating 块 |
| 缝 6 队列 | 复用深研 #118 worker 与既有 gen 队列；不新建队列（分群物化 worker = B/C 档才涉缝 6） |
| 缝 7 设计系统 | 全部 .gb + shadcn；coral 只属 Otto（洞察条/落卡 sweep/让位提示）；sentence case；Landed/skeleton/reduced-motion |
| 缝 8 卡片 | 新卡种 1：`CAMPAIGN_CARD` 五道缝全穿；信封 = 既有 APPROVAL_CARD payload 演化 + PackCard 渲染模板（零新卡种）；卡→钱定律：卡只是 display+parameters，spend 由 server 从持久卡重算重验 |
| 缝 9 Parity | 全部新 action（workbench Submit、calendar 改/删/批、pack Confirm、停、所有 CRM 写动作〔含字段/tags/Lifecycle〕、建群）出生即登记；CI 硬拦；「停」是否给 Otto 对等 skill 沿信封稿 W-5 待裁 |

---

## 七、假设台账（每假设：依据 / 若不成立）

| # | 假设 | 依据 | 若不成立 |
|---|---|---|---|
| A-1 | 信封稿（`2026-07-14-envelope-stop-design.md`）与本 spec 同批过目、同批冻结；打包页机器细节以它为准 | #294/#295 Resolution「同批设计」；#296「Campaign 打包总价页必须符合两票」 | 若信封稿被 Founder 改动，本 spec §3.5/§3.6 随之机械同步（同构不分叉） |
| A-2 | B0-59 自动进来的写入点在邻块（B5 入信/B2 归因/B7 欢迎流），一期 CRM 消费展示；邻块未上线期间，**手工 + CSV 导入即一期入口**（D-3 判决使冷启动闭环成立） | CRM 设计图 §6.2/A-02；D-3 | 若邻块联审改判写入点归属，只挪 upsert 共享 action 落点，表形状不变 |
| A-3 | 身份规范化规则（waPhone E.164 国码/email 小写）须在 R-010 的独立 Founder-approved schema alignment 中，与唯一键/issuer/version/consent 一并钉死；CRM 与 CSV import 复用该唯一口径 | CRM 设计图 Q5/A-04；R-010 | **R-010 闭合前 CSV identity/consent 导入不得施工**；闭合后按已批准合同实现，不允许先做一套再对齐 |
| A-4 | heat（hot/warm/cold）一期派生不落列；lifecycleStage 三态由确定性算子从 lastSeenAt/订单信号推导或人工改 | CRM 设计图 §6.1（heat ⬜派生）；D-7 值域 | 若上量出现性能压力，落列 = B 档缓存优化，additive |
| A-5 | 三对标锚（respond.io/HubSpot/Klaviyo + SF/HubSpot/GenStudio）版本为设计日近似，**spec 冻结入 repo 当日实机复核版本号，并把真截图作为 exact-head 附件/链接写入对应 GitHub task/PR** | 两设计图 §二/A-07 | 复核发现对手改版 → 只更新锚四件套，不动范围 |
| A-6 | 一期两拍合一：D-2=B 使打包批（原"第二期"）并入一期；campaign 设计图内"逐条批=第一期"的钱路表述作废，计划层逐条改/批（$0）保留 | D-1/D-2 + GRILL-VERDICTS:259（连环确认=缺陷） | — （判决已终局） |
| A-7 | 零新收费点成立的前提 = 全部产出是配置菜单价（pricedGenCredits 配置层） | #294「超支由结构吃掉」；campaign 设计图 A7 | 若混入非菜单价产出，该项无法入封 → fail-closed 单独问（信封稿 A-2 同款） |
| A-8 | GM-03 目标进度条一期只落 `goal` 字段，UI 随 P3 | campaign 设计图 §六A | founder 若要一期见进度条，升深度档另裁 |

---

## 八、与 `08-B8.md` 逐行对账（矩阵行号 → 本 spec 落点；TBD-B8 列的冻结值）

| 功能ID | 矩阵行号 | 人工入口（冻结） | Otto skill（冻结） | 权限/花费闸（冻结） | 本 spec 节 |
|---|---|---|---|---|---|
| B0-51 | :7 | campaign/workbench + list | proposeCampaign / campaign 读技能 | 免批 $0 | §2.1 §3.1 |
| B0-52 | :8 | （schema，无独立入口） | 生成/排期技能透传 campaignId | 免批 | §2.2 |
| B0-53 | :9 | campaign/workbench 四项表单 | 同一 proposeCampaign | 免批 $0；X pricing 不接钱路（矩阵注原样） | §3.1 |
| B0-54 | :10 | campaign/calendar 双视图 | 卡上逐条改（同动作层） | 计划编辑免批 $0；无全局正向外发权；Direct 仅精确 post/batch 批准 | §3.3 |
| B0-55 | :11 | campaign/list + detail | campaign 读技能 | 免批（只读） | §3.4 |
| B0-56 | :12 | campaign/proposal-card | proposeCampaign + researchWeb/proposeResearch | 提案$0；深研卡批；排产=花钱闸（矩阵注原样） | §3.2 |
| B0-57 💰 | :13 | campaign/pack-confirm | 既有 ottoApprove→coworkGenerate 链 | **必批**：server 重算+genRequest 闸（缝3）+信封（#294）；变真必过 money-safety-review（矩阵注原样） | §3.5 |
| B0-58 | :14 | campaign/trends | listTrendSnapshots | 免批；新表走缝5；引擎侧协调=B9 复核（矩阵注原样） | §2.6 §3.7 |
| B0-59 | :15 | crm/contacts（Add lead + Import） | addLeadContact / importContacts | 免批 $0 | §2.7 §3.8 |
| B0-60 | :16 | crm/contact-profile | listContacts/getContact/searchContacts/setContactConsent/mergeContacts + 字段/tags/Lifecycle 配对 capability（名称/数量由后续 Founder-approved implementation spec 冻结） | 免批；所有变更留痕 ActionEvent | §2.3 §2.4 §3.8 |
| B0-61 | :17 | crm/segments | buildSegment/previewSegment | 免批 $0；NL→规则=宪法10 确定性（矩阵注原样） | §2.5 §3.8 |

（测试/报告两列的冻结值 = §5.2 验收清单与六态证据要求，to-tickets 时回填矩阵。）

---

## 九、留白待裁（呈 founder / 待联审，本稿不裁）

| # | 待裁 | 背景 |
|---|---|---|
| L-1 | **D-9 请评时机默认值**：founder 判「暂缓至回执图纸联审」（EasyStore 研究已回，届时给选项）。属二期口碑域（B0-63），**不阻断一期任何行**；记录在此防漏 | #296 Resolution D-9 |
| L-2 | 身份规范化规则表（waPhone 国码/空格、email 大小写）——B2/B5 spec 联审产出一份全城标准，CRM/导入复用 | CRM 设计图 Q5 |
| L-3 | brand memory「客群」与 CRM Segment 互指口径——资产区 owner 联审（客群洞察留 memory、成员归 Segment 是否够） | CRM 设计图 Q7 |
| L-4 | 信封稿留白 W-1～W-6（「碰」的灰区/整封作废严格版/CANCELLED 枚举/停免二次确认/Otto 对等停 skill/72h 常数可调）**归信封稿裁**，本 spec 不重复开槽，裁定后机械同步 | `2026-07-14-envelope-stop-design.md` §五 |
| L-5 | campaign 读技能拆 1 枚还是 2 枚、CRM read 技能是否合并——工程裁量，registry 定案时按缝 1 惯例走，不需 founder | §四计数注 |

---

## 附：判决对账（零发明证据链）

- **12 槽判决**：#296 Resolution（2026-07-14 晚）——D-1=A（§一卖图地位）、D-2=B（§3.5）、D-3=A（§2.7/§3.8）、D-4 ✅（§2.1 utmBase）、D-5/D-6/D-8/D-11（二期，不落本 spec）、D-7（§2.3/§2.5）、D-9 暂缓（§九 L-1）、D-10（§2.6）、D-12（与一期无阻断，记录在案）。
- **信封两票**：#294（精确清单/指纹保鲜/72h/开跑不过期/Otto 工资另轨）→ §3.5；#295（基线三分流/单粒度/对象级插手）→ §3.6；粒度判决 GRILL-VERDICTS:259（一个 request 一次批准/连环确认=缺陷）、:260（不建重机器）。
- **既有判决**：红旗三（CRM 分阶段）、红旗六（Campaign 独立对象）、判决 7-3（总价确认+partial 退款）、7-7（复述理解+报价）、7-9（抑制名单=运行时非字段）、GRILL 7-3（首触归因埋点「不要」）、第四批（专属工作台）、O-12（就地按钮=Otto 的手）。
- **宪法依据**：3①③④（credits 显示/状态诚实/建议按钮）、4（审批公式+两例外）、5（配置层永不硬编码+毛利地板）、6（租户铁幕）、7（双模+单一动作层）、9（华语 spec/英文 brief）、10（确定性编译）、11（零学习曲线+live reflection+coral 法）。
- **底稿**：campaign 设计图（§〇 spec 底钉出处/§三 IA/§五 双执行/§六 数据契约/§七 花费闸/O-1 O-2 闭合）；CRM 设计图（§1.3 明示排除/§3 三页/§6 数据契约+身份解析+consent 边界/§7 花费闸/Q1-Q8）；spec 底 `docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md`（时效核对无实质冲突，campaign 设计图 O-6）。
- **机器对照（只读）**：`approval-content-hash.ts` / `otto-actions.ts` / `approval-tools.ts` / `PackCard.tsx` + `pack-credit-math.ts` / `schema.prisma:66,389,766` / `tenant-guard.ts` / `credits.ts`。

**结尾（D-038 修订）**：本 spec 继续冻结 B0-51～61 底座 slice 的兼容机械合同——新表 5、页面 10（七房间 + CRM 底座 3 页）、skill 数量待后续 Founder-approved implementation spec 按完整双执行器面冻结、新卡种 1、💰面 1、新收费点 0；它不是完整 Customer Engagement CRM，也不是商业 Phase‑1 唯一依据。后续工单必须同时引用 B5～B7/B6 对齐行与总计划「七·甲」，且不得借本稿预称任一支柱已完成。
