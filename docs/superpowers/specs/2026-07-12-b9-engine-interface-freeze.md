# B9 引擎横切 · 引擎接口冻结 spec（v0.5——冻结候选）

> 2026-07-12。epoch `claude-20260712-03`。性质：**冻契约不冻实现**——本 spec 冻结的是接口形状与语义，扫描器/实现行号可继续演进（B10 车道并行改扫描器不构成移动靶）。
> **状态：冻结候选（freeze candidate）——冻结待 founder 明示 ack（D-018②/D-020⑤）。** SOL 跨族复审 §2 的 B9 六条阻断项已逐条闭合；v0.4 闭合 codex 异族评审（第二轮 BLOCK）清单：上下文桥上限常量+截断顺序+审计形状（契约 2）、RunState 兼容不悬置（契约 5·附）、LiveResourceType 封闭 union+静态映射（契约 6）、seq/cursor/replay 逐项定义+transactional outbox 方案（契约 6）、按最终 `Domain[]` 成员重测全部装载组合+归域调整（契约 1/§对标锚落数）、敏感字段白名单改写（契约 6）；**v0.5（codex R5⑤ 并发主权主动扫）**：LiveEventOutbox 的 seq 分配确认=BIGSERIAL 天然序列化，并补冻**分配序≠提交序**的消费端语义——cursor 只推进连续已提交前缀（契约 6）。本文本属共享契约/schema=founder-only 类别，异族复审通过不替代 founder 明示过目；未获 ack 前 09-B9 相关行不迁 `spec-ready`。
> 人话：给 Otto 的「发动机舱」定接口标准，后面每个块加新能力都插同一套插座，不许各拉各的线。

## 一、范围与矩阵行映射

B9 块（`docs/ops/route-b/matrix/09-B9.md`）21 行；本 spec 冻结其中的**六个契约**；明示排除：Otto 用户可感技能的产品语义（归各功能块）、市政厅（永久豁免）。

## 二、冻结对象（六契约）

### 契约 1 · Skill 注册表 + 分域装载（E2-19，缝 1 扩展——SOL §2·B9① 采纳）

- **`defineOttoSkill` 现有三字段之上新增 `domains` 字段**（`packages/otto/src/skill.ts:22-36` 的 spec 之上），闭集且**多域成员**：一个 skill 声明**一个或多个**域（`Domain[]`，≥1）。
  - **为何是 `Domain[]` 而非单 `domain`**：SOL 坐实「单一 domain 装不下 research 这类跨域依赖」——`researchWeb`/`proposeResearch` 同时服务 campaign 与 create。多成员集解此阻断：单域技能=singleton，跨域技能列多成员。装载 = `core ∪ (domains ∩ 当前 zone 映射域 ≠ ∅ 的技能集)`。
- **domain 闭集定稿**（枚举**必须闭合、无省略号**）：
  ```
  Domain = 'core' | 'create' | 'assets' | 'ads-analytics' | 'schedule'
         | 'research' | 'campaign' | 'crm-inbox' | 'account'
  ```
  `core` 常驻装载。
- **六域→新枚举迁移表**（先读 P0.5 既有六域，出处 `docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md:85-95`）：

  | P0.5 六域（旧） | v0.4 新枚举 | 归置依据（出处） |
  |---|---|---|
  | `core`（propose/proposePack/generate/updateBrief/setTitle/describeRefs） | `core` | 常驻不变（caching-design:88） |
  | `creation`（seedreamPrompt/seedancePrompt/proposeStoryboard） | `create` | create/* zone（A′ 65 页 `create/canvas·factory·storyboard`；caching-design:89） |
  | `brand`（rememberBrandFact/saveProduct/saveCustomerSegment/saveOffer/lookupProducts/ingestProduct） | `assets`；**仅 `lookupProducts` 多成员 `[assets, create]`** | 品牌记忆住 `assets/brand-memory·brand-kit`（A′ 65 页）。**v0.4 归域调整（codex P1⑨）**：v0.3 曾把 brand 六技能全体多成员进 create/crm-inbox（P0.5「canvas→creation+brand」zone 映射的直译），实测使 core+create 载荷 5,006 tok=65% 超阈。改**最小多成员**：创作轮真正需要的品牌面=产品**查读**（`lookupProducts`，504 字符，读端口——提案引用产品时用）；品牌**写**技能（saveProduct/saveOffer 等）不随创作自动装载——①品牌事实注入走 brandContext（system message），不需技能在场；②创作中途要「记住/保存」由**确定性意图词表**（caching-design §3.3 机制②，`:100`）按需追加 `assets` 域；③零命中全量兜底不变（契约 5·附·2） |
  | `meta`（metaInsights/metaAdPerformance/metaExpert/metaListObjects/listMetaPages/proposeMetaAction/proposeAdBuild） | `ads-analytics` | ads/* + analytics/* zones（A′ 65 页 `ads/*`·`analytics/*`；caching-design:91） |
  | `schedule`（schedulePosts） | `schedule` | 不变（A′ 65 页 `schedule/*`；caching-design:92） |
  | `research`（researchWeb/proposeResearch） | **`[research, campaign]`**（v0.4：去掉 create 成员） | **跨域**：研究服务 campaign/trends（TrendSnapshot/大促研究——marketplace-design §6.2）；`Domain[]` 多成员正是为此（SOL 阻断解，caching-design:93）。**create 成员移除（codex P1⑨ 归域调整）**：创作轮要研究由意图词表（「研究/搜一下/search」）按需追加，非每轮预载 |

- **最终 25 技能 `domains` 成员表（v0.4 定稿——重测的输入，同时闭合「待 worker 填证」的现状域划分表）**：

  | domains | 技能（tool 名） |
  |---|---|
  | `[core]`（常驻 6） | propose · proposePack · generate · updateBrief · describeRefs · setTitle |
  | `[create]`（3） | seedreamPrompt · seedancePrompt · proposeStoryboard |
  | `[assets]`（5） | rememberBrandFact · saveProduct · saveCustomerSegment · saveOffer · ingestProduct |
  | `[assets, create]`（1） | lookupProducts |
  | `[ads-analytics]`（7） | meta-insights · meta-ad-performance · meta-expert · meta-list-objects · list-meta-pages · propose-meta-action · propose-ad-build |
  | `[schedule]`（1） | schedulePosts |
  | `[research, campaign]`（2） | researchWeb · proposeResearch |
  | （今日无技能，占位域） | `campaign`（专属技能如 listTrendSnapshots 未建）· `crm-inbox` · `account` —— zone 命中时装载=core ∪ 多成员命中者 |

- **新表面归置**（按五份 B8 设计的 IA，逐条注明出处）：

  | 新表面 | 归域 | 出处 |
  |---|---|---|
  | 口碑技能（listReviews/draftReviewReply/draftReviewRequest/sendReviewRequest/listReferrals/designReferralReward/issueReferralReward/listLoyaltyMembers/draftLoyaltyWinBack） | `crm-inbox` | 口碑页「CRM/口碑区内导航」；请评触达复用 B5 inbox + B7（reputation-design §3.1/§10 skill 清单） |
  | Marketplace 技能（listing 优化/店铺装修生成） | `create`（生成，复用创作工厂+品牌记忆）；大促日历/研究 → `campaign`+`research` | marketplace-design §11「listing=品牌记忆+产品档案+创作工厂组合应用」；§10 缝 1 |
  | 第一米 技能（微站/物料 generate；发帖/回评 propose+execute；读净值 free/read） | `create`/`assets`（生成物料）；归因读 → `campaign` | firstmile-design §5 双执行矩阵行 319；§6.1 复用 QrAsset/创作工厂 |

- **装载协议**：按 `viewContext.zone` + 确定性意图规则选域装载（宪法 10：确定性代码，不靠模型天赋路由；映射表=一张可读 TS 常量文件）；回滚开关 env 一个（`OTTO_SKILL_SCOPING=off`=全静态挂载=现状，caching-design:112）。
- **出生纪律**：本 spec 冻结后，**任何块的新 skill 出生即带 `domains`**（缝 1 六处登记升七处，+domains）。
- **待 worker 填证**：~~25 技能现状域划分表~~（v0.4 已落上表）；每域前缀 token 已落实测数（§对标锚落数）；worker 复核项=技能增减后重跑测量脚本 + 意图词表（华/英双语）初版。

### 契约 2 · 上下文桥（E2-20，宪法 7 第四层——SOL §2·B9③ 采纳）

- **形状（冻结）**：`viewContext = { view: string, zone: Domain, selection: Selection[], activeJobId?: string }`，其中 `Selection = { kind: SelectionKind, id: string }`。
- **`SelectionKind` 真闭集**（从 A′ 65 页对象类型 + 新设计对象枚举完整 union，**禁 `…`**）：
  ```
  SelectionKind =
    // A′ live/近期（创作·排期·CRM·量测）
    | 'generation' | 'node' | 'post' | 'campaign' | 'contact' | 'segment'
    | 'product' | 'brandFact' | 'link' | 'qr' | 'voucher' | 'conversation'
    | 'researchJob' | 'trendSnapshot'
    // 二三波入册（口碑·Marketplace·第一米——D-021 部分保持 listed）
    | 'review' | 'reviewRequest' | 'referral' | 'loyaltyMember'
    | 'listingDraft' | 'microsite'
  ```
  - **union 演进=founder-only 棘轮**：新增 kind 与 B2 kind 闭集同纪律（schema/契约演进单列上报），不得留 `…` 占位。二三波 kind（review/reviewRequest/referral/loyaltyMember/listingDraft/microsite）**入册待排产**（D-021：口碑部分行 + Marketplace 70/72 + 第一米 76 保持 listed），登记于此供上下文桥前瞻校验，不构成即时上线。
- **租户校验入契约（宪法 6——SOL 坐实「租户铁幕」不可留开放问题）**：
  1. **服务端 resolve 一切引用**：`selection[].id` 到达服务端后，**服务端**按 `kind` 逐一 resolve 到真实对象并**断言 `ownerId === 当前会话租户`**；resolve 失败/越权/已软删/过期的对象**静默丢弃**（不注入、不报错泄漏存在性）。
  2. **数量上限（v0.4 冻结常量+截断顺序+审计形状——codex P1⑤ 采纳）**：
     - **常量**：`CONTEXT_SELECTION_MAX = 20`（冻结值；founder ack 时可调，调整=改常量一处）。
     - **截断顺序（先截断后 resolve，不回填）**：①解析硬上限=20——`selection` 数组**保留头部前 20**（UI 上报顺序=选中顺序；头部语义载重：「把这个改成 9:16」的 this 是 `selection[0]`），第 21 项起**不 resolve 直接丢弃**（防越权批量探测的资源放大）；②对存活者逐一 resolve+owner 断言，越权/过期/不可解者丢弃；③**不回填**——丢弃后不从尾部递补（防探测者靠填充位回捞被丢弃对象的存在性信号）。最终注入 ≤ 20，可少于 20。
     - **审计形状**（ActionEvent，system 写）：截断=`type='otto.context.truncated'`，`payload={reported, kept}`；丢弃=`type='otto.context.dropped'`，`payload={reason: 'unauthorized'|'stale'|'unresolvable', kind, id}`——越权 id **记入本租户审计**（跨租户探测线索的安全取证），但**永不**出现在注入的上下文或对用户的错误信息里（静默丢弃原则不变）。
  3. **客户端裸 ID 永不作为可信上下文持久化**：UI 上报的 `selection[].id` 只是**待校验线索**，服务端 resolve+断言前**永不**写入会话态或 system message；resolve 后注入的是服务端确认过 owner 的对象引用，非客户端裸传。
- **注入点**：每轮 system message 的 brandContext 同级新段；UI 端上报=页面挂载/选中变更时写入会话态（推送，非轮询）。
- **验收活体**：「把这个改成 9:16」在 B3 第一个旅程里可解析（`selection[0]`，服务端 resolve+owner 断言后）——B3 依赖此契约，是 B9 先行的主因。
- **待填证**：buildContextSystemMessage 现状、OttoChatStream 注入链、`buildOttoContext`（`apps/web/lib/otto-actions.ts:191`）resolve 链。

### 契约 3 · Parity 三态语义与债清偿协议（E2-15/16）

- 三态 `skill / exempt(四类闭集) / todoSkill` 语义冻结；**债只降不升**（棘轮），新增豁免类别=修宪。
- 随块清零协议：块验收=`parity-debt.md` 该块债全清（B0 已挂行）；基线文件唯一写权=控制面收口 PR。

### 契约 4 · TOOL_STEP_LABELS 一致性闸（修 H1 断层①）

- 冻结：registry ↔ TOOL_STEP_LABELS 机器一致性检查（新 skill 无 label = CI 红，fail-closed 替代现状 fail-open 静默）。
- 待填证：现缺 label 的 6 技能清单（MATRIX-V0 B 断层④）。

### 契约 5 · 读对等端口（B0-77/78 行族，宪法 7「读的对等」）

- 冻结：read-skill 一律 `cost:"free", effect:"read"`，走 ctx ports（缝 1），**skill 内禁直连 Prisma**；Otto 首页数据面（债 41-49,84）的端口清单。
- **二三波读技能挂此契约**：口碑 `listReviews`/`listReferrals`/`listLoyaltyMembers`、Marketplace listing 读、第一米读净值——全部 `free/read` 走 ctx port，不直连 Prisma（reputation §10 skill 清单；marketplace §11；firstmile §319）。

### 契约 5·附 · 旧引擎逃生条款（补回，SOL §2·B9④ 采纳——逐字级恢复 + 出处行号）

> SOL 坐实新稿丢了旧引擎 spec 的关键逃生条款。以下三条**逐字级恢复**，出处=`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md`（分域装载原设计）：

1. **恢复轮全量工具集（approve / worker-resume / 中断续跑）**（出处 §3.5.1，`:110`）：凡走 RunState 恢复的轮次一律**全量装载**——恢复正确性优先于 token 节省（安全 > 效率，宪法 1）。分域只作用于 fresh turn。补强：approve 轮**必须**装载原 tool 所在域（否则 approval 无法回放，V6，`:106`）；因走全量则天然满足。
2. **意图零命中→全量回退**（出处 §3.3 `:101` + §3.5.2 `:111`）：装载 = core ∪ 命中域；**零命中 → 全量装载**（fail-open 到今日行为，宁多勿缺）——意图识别失败永远不会让 Otto「少一只手」。
3. **RunState 恢复 × 工具集变化的兼容规则（v0.4 现在冻结，不悬置——codex P1⑥ 采纳）**（出处 §3.4·V5 `:105`，佐 V7 `:107`；playbook F24：`fromString` 抛错=全线程变砖）：
   - **toolset version（冻结定义）**：`toolsetVersion = sha256(按 registry 顺序串接每技能的 name + parameters JSON-schema)` 截断 16 hex；**每次创建 RunState 快照时随快照记录**。
   - **不匹配行为（冻结）**：恢复时先比对 `toolsetVersion`。相同→直接恢复（恢复轮仍全量装载，第 1 条）。不同→**兼容预检**：历史 `tool_call`/`tool_result` 引用的每个 tool 名必须存在于当前 registry（含 resume-only stub，见退役规则）；全在→恢复；**任一缺失→拒绝恢复**（不调 `fromString`，从根上避开 F24 变砖）——线程转 fresh turn 续聊（对话历史文本保留、RunState 弃用）+ 用户可见一句话提示（宪法 11 状态诚实）+ ActionEvent `otto.runstate.restore_refused` 留痕 `{threadId, missingTools, storedVersion, currentVersion}`。**永不让恢复失败砖死线程**。
   - **历史工具兼容期（冻结常量）**：**90 天**（≥ 审批挂起与 worker-resume 的最长实际周期；founder ack 时可调）。
   - **退役规则（冻结，两阶段棘轮）**：技能退役永不一步删除——①**deprecate**：从 fresh 装载与意图词表移除，注册保留为 **resume-only stub**（schema 原样、仅恢复轮装载、`execute` 改为确定性拒绝返回「此能力已退役」）；②兼容期（90 天）满→物理移除，此后引用它的陈年 RunState 走「拒绝恢复→转 fresh」路径。
   - worker 实测项（验证，非悬置前提）：V5（恢复×工具集变化）/V6（审批恢复）/V7（10 步链内跨域，SDK 报 unknown tool 的失败形态）三场景回归测试绿（caching-design §3.7·2，`:119`）——实测结果只影响 stub 的实现细节，不改上述冻结规则。

### 契约 6 · live-event envelope 事件面接口定稿（E2-21，宪法 11 v2.6——SOL §2·B9⑤ 采纳，从「目标」变「接口」）

> SOL 坐实 v0.2 只有「秒级」目标、无接口。v0.3 定信封；**v0.4 闭合 codex P1⑦/⑧**：resourceType 封闭 union + 与 SelectionKind 的静态映射；`revision` 字段删除，冻结「事件表自带 seq」（transactional outbox）方案——现实是 `ScheduledPost`/`ChatThread` 等既有表**无 revision 列**，逐表补列=大迁移面；outbox 全局序即可承担陈旧帧判定，正面处理此现实。（B2 契约〇 引用此为「UI 秒级刷新」的唯一载体；live reflection 永不落归因流水。）

- **`LiveResourceType` 封闭 union（v0.4 冻结——禁 `…`）**：
  ```
  LiveResourceType = 'generation' | 'post' | 'researchJob' | 'conversation' | 'campaign'
  ```
  即今日有「后台完成→界面感知」旅程的五类：生成任务、排期发布、研究任务、收件箱会话、campaign 执行。**与 `SelectionKind` 的静态映射**：`LiveResourceType ⊂ SelectionKind`，恒等映射，冻结为 TS 常量表 `LIVE_RESOURCE_TO_SELECTION satisfies Record<LiveResourceType, SelectionKind>`（编译期断言，漂移=CI 红）。union 扩展与 SelectionKind 同纪律（founder-only 棘轮；二三波的 review/microsite 等待其行排产后随块扩）。
- **事件信封字段（冻结接口——v0.4 修订：删 `revision`，其职责由 per-resource 最大 `seq` 派生承担）**：
  ```
  LiveEvent = {
    ownerId: string,          // owner 鉴权:订阅方必须是同租户,服务端断言(宪法 6)
    resourceType: LiveResourceType,
    resourceId: string,
    seq: number,              // 全局单调排序去重键（分配法见下）;客户端按 (resourceType,resourceId)
                              // 记住已见最大 seq,丢弃 seq ≤ 已见的帧——即原 revision 职责,零逐表迁移
    cursor: string,           // 断线 replay cursor（格式见下）
    actor: { kind: 'system'|'otto'|'user', id?: string },  // 谁触发
    correlationId: string,    // 关联 job/turn,与 ActionEvent/归因链对齐排障
    payload: Json,            // 白名单纪律见下
  }
  ```
- **seq / cursor / replay 逐项定义（v0.4 冻结——codex P1⑧ 采纳）**：
  - **来源与原子分配**：新表 `LiveEventOutbox`（founder-only 单列建表）——`seq BIGSERIAL`（DB 序列原子分配；全局单调 ⇒ 每 owner 单调 ⇒ 每资源单调）+ ownerId + resourceType + resourceId + actor + correlationId + payload + createdAt。**写入与产生该事件的状态变更同一 DB 事务**（transactional outbox——原子性与「不丢事件」的来源）；投递器从 outbox 读、推 SSE。
  - **分配序 ≠ 提交序（v0.5 冻结——codex R5⑤ 主动扫）**：BIGSERIAL 分配=DB 原生序列化（**确认：分配无需额外锁**）；但序号分配在事务内、提交在事务尾——**低 seq 行可能晚于高 seq 行提交**。消费端语义冻结：**cursor 只推进「连续已提交前缀」**——投递器/replay 端点按 seq 升序扫描时，**不得越过尚未确认提交的空洞**（晚提交的低 seq 永不被跳过）；实现形态（单投递器 + txid 快照下界，或 `FOR UPDATE SKIP LOCKED` 批读后按连续前缀推进）归实现，**语义（无跳号丢失）是契约**。回滚事务留下的永久空洞以「序号已废弃」判定越过（如超时阈值或 txid 快照证明无在途事务），判定规则随实现细化但不得引入丢失。
  - **cursor 格式**：opaque string=最后送达 `seq` 的十进制编码（服务端铸造与解释，客户端只回传不解析）。
  - **replay**：重连带 `cursor` → 服务端按 `seq` 升序补投本 owner `seq > cursor` 的全部事件。
  - **保留期（冻结常量）**：outbox 行保留 **24 小时**（founder ack 时可调）。
  - **replay 缺口**：cursor 早于保留窗 → 服务端答 `{gap: true}`，客户端放弃增量、对当前可见资源走**常规读 API 全量刷新**（读对等端口，契约 5）——诚实降级，不假装无缺口。
  - **轮询降级**：SSE 不可用 → 客户端以**同一 cursor 端点**短轮询，间隔上限 ≤ 4s（对齐 canvas 现状 4s 轮询，推送化后此为兜底）；语义与 SSE 完全一致（同 seq/cursor/gap），只是拉取形态。
- **鉴权与租户**：订阅经服务端 owner 断言（宪法 6）；跨租户订阅拒绝。
- **payload 白名单纪律（v0.4 改写——codex P2 采纳，废双重否定）**：`payload` **仅含**界面刷新所需最小字段集——资源状态、进度百分比、结果引用（资源 id/资产 key）；**PII、凭据、密钥、跨租户引用一律禁止**（PDPA + 宪法 6）。
- **纪律**：「后台已完成而界面不知」按缺陷处理；实现归 B3（canvas 侧 4s 轮询→推送化）。

## 三、对标锚清单（§六 水准判官格式）

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| 宪法 7 四层结构保证 | v2.11 | 单一动作层/Parity/读对等/上下文桥 | 四层全部有机器闸或活体验证 |
| Higgsfield Supercomputer / Agentforce（对标地图·Otto 本体行） | 2026-07 | agent 操作全城而非一区 | 每功能块 Otto 话术全绿（B11 联验，sonnet 级——宪法 10） |
| 引擎效率（宪法 5 效率良心） | — | 每轮前缀 token | 分域装载后 core+单域 **≤ 3.75k tok（≤ 全量基线 7.7k 的 50%）**；实测见 §对标锚落数 |

### 对标锚落数（SOL §2·B9⑥ 采纳；**v0.4 按最终 `Domain[]` 成员重测全部装载组合——codex P1⑨ 采纳**）

- **估算法（写明）**：对 25 技能各自序列化其 `@openai/agents` tool schema（`name` + `description` + zod→JSON-schema `parameters`），求字符数，**tokens ≈ 字符数 / 4**（混合英文/JSON 的 GPT tokenizer 近似）。测量脚本导入构建产物 `packages/otto/dist/registry.js` 的 `allSkills`，逐 skill `JSON.stringify({name,description,parameters})`；装载组合按**契约 1 最终成员表**取 `core ∪ {s : s.domains ∋ zone域}`。此法与 caching-design §3.2 独立测得的「~7.7k」吻合，可复核。
- **实测基线（全量 25 技能 tools schema）**：序列化 **30,916 字符 ≈ 7,729 tokens**（字符/4）。
- **core（6 常驻）**：5,723 字符 ≈ **1,431 tokens**。
- **codex 发现的超阈复现（v0.3 成员表）**：v0.3 把 brand 六技能 + research 两技能全体多成员进 `create`，zone=create 实际装载 17 技能=20,023 字符≈**5,006 tokens=65%**——复现 codex 实测 ~5.0k，**超 3.75k 阈值，坐实**。
- **v0.4 处置：二选一取「调整归域」**（理由见契约 1 迁移表 brand/research 行：品牌事实注入走 brandContext 不需技能在场；写技能与研究由确定性意图词表按需追加；零命中全量兜底不变——产品行为不失手，非为凑数削装载）。**按最终成员表重测全部 8 个 zone 装载组合**：

  | zone 装载组合（core ∪ 命中成员） | 技能数 | 字符 | ≈tokens | 占全量基线 |
  |---|---|---|---|---|
  | core + `crm-inbox`（今日无专属技能） | 6 | 5,723 | 1,431 | 19% |
  | core + `account`（今日无专属技能） | 6 | 5,723 | 1,431 | 19% |
  | core + `schedule` | 7 | 7,344 | 1,836 | 24% |
  | core + `research`（researchWeb/proposeResearch） | 8 | 7,953 | 1,988 | 26% |
  | core + `campaign`（=research 两技能多成员命中） | 8 | 7,953 | 1,988 | 26% |
  | core + `assets`（6，含多成员 lookupProducts） | 12 | 10,955 | 2,739 | 35% |
  | core + `create`（3 creation + lookupProducts） | 10 | 13,065 | 3,266 | 42% |
  | core + `ads-analytics`（7，最重域，propose-ad-build 单个 4,207 字符） | 13 | 14,995 | 3,749 | **49%** |

- **落数结论**：阈值 **≤ 3.75k tokens（≤ 全量 7.7k 基线的 50%）维持不变**——最终成员表下全部 8 组合 19%–49%，最重组合（ads-analytics）3,749 tok 恰达标，其余全部显著低于。若未来某域成员增长再超阈，处置顺序=先审归域（意图词表能否承接）再谈调阈值。数字随证据层 worker 复核时效（技能增减后重跑脚本+本表）。

## 四、假设台账

| 假设 | 依据 | 验证法 |
|---|---|---|
| domain 闭集 9 项 + `Domain[]` 多成员够用 | 六域迁移表 + 五份 B8 设计 IA（本 spec §契约 1） | B8 块 spec 冻结时按 IA 复核归置；新表面出生带 domains |
| `Domain[]` 多成员解 research 跨域 | SOL §2·B9① 坐实单域装不下 research | worker 实测 research 技能从 research/campaign 两 zone 均可命中装载；create zone 经意图词表追加 |
| 创作轮不预载品牌写技能/研究技能不伤体验（v0.4 归域调整） | 品牌事实注入走 brandContext；意图词表+零命中全量双兜底 | B3 第一旅程联验：canvas 内「记住这个产品」「搜一下趋势」经意图词表正确追加域 |
| SelectionKind 闭集可枚举（禁 …） | A′ 65 页对象类型 + 二三波新对象 | B3/B8 spec 对表；新增 kind=founder-only 单列 |
| 恢复轮全量满足 RunState 工具兼容 | 旧 spec §3.5.1 + V5/V6/V7 | worker 实测 V5-V7 三场景回归绿（§3.7·2） |
| live-event envelope 字段足以承载秒级刷新且不越 PDPA | 宪法 11 v2.6 + 敏感字段限制 | B3 canvas 推送化联验；payload 最小集审查 |

## 五、冻结条件与状态

- **状态：冻结候选（freeze candidate）。** v0.1 骨架 → v0.2 吸收 Campaign 试产 → v0.3 闭合 SOL §2·B9 六阻断项 → v0.4 闭合 codex R2 BLOCK 清单（上下文桥上限/截断/审计冻结、RunState 兼容规则冻结、LiveResourceType 封闭 union+静态映射、outbox seq/cursor/replay 冻结、按最终成员重测全组合+归域调整、payload 白名单改写） → **v0.5（本稿，codex R5⑤ 主动扫）：outbox 分配序≠提交序的消费端语义冻结（cursor 只推进连续已提交前缀）** → **founder 明示 ack（D-018②/D-020⑤）** → spec-ready（09-B9 相关行随冻结 PR 迁级）。异族复审通过不替代 founder 过目（共享契约/schema=founder-only）。
- **开放问题（v0.2 两项处置）**：
  1. domain 与 A′ 左轨导航 zone 是否 1:1 → **闭合**：非 1:1；多 zone 可映射同域，跨域技能用 `Domain[]` 多成员（§契约 1 迁移表 + 归置表给出 zone→域映射依据）。
  2. contextBridge 隐私边界（selection 注入是否过滤跨租户引用）→ **闭合**：契约 2 租户校验入契约——服务端 resolve + ownerId 断言 + 数量上限 + 丢弃越权/过期，客户端裸 ID 永不持久化（宪法 6）。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①`domains` 字段加入 defineOttoSkill（缝 1 登记扩展）；②SelectionKind 二三波 union 扩展；③RunState 快照增 `toolsetVersion` 字段（契约 5·附·3 已冻结定义与行为）；④`LiveEventOutbox` 建表（契约 6 已冻结形状与纪律）。这些**不在本 spec 自行落地**，是冻结 ack 时的明示清单。
