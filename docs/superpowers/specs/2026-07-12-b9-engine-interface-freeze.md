# B9 引擎横切 · 引擎接口冻结 spec（v0.3——冻结候选）

> 2026-07-12。epoch `claude-20260712-03`。性质：**冻契约不冻实现**——本 spec 冻结的是接口形状与语义，扫描器/实现行号可继续演进（B10 车道并行改扫描器不构成移动靶）。
> **状态：冻结候选（freeze candidate）——冻结待 founder 明示 ack（D-018②/D-020⑤）。** SOL 跨族复审 §2 的 B9 六条阻断项已逐条闭合（对照见 §六）。本文本属共享契约/schema=founder-only 类别，SOL 复审通过不替代 founder 明示过目；未获 ack 前 09-B9 相关行不迁 `spec-ready`。
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

  | P0.5 六域（旧） | v0.3 新枚举 | 归置依据（出处） |
  |---|---|---|
  | `core`（propose/proposePack/generate/updateBrief/setTitle/describeRefs） | `core` | 常驻不变（caching-design:88） |
  | `creation`（seedreamPrompt/seedancePrompt/proposeStoryboard） | `create` | create/* zone（A′ 65 页 `create/canvas·factory·storyboard`；caching-design:89） |
  | `brand`（rememberBrandFact/saveProduct/saveCustomerSegment/saveOffer/lookupProducts/ingestProduct） | `assets`（品牌真相）+ 多域成员 `create`/`crm-inbox` | 品牌记忆住 `assets/brand-memory·brand-kit`（A′ 65 页）；但 brand skills 跨 create（生成注入）与 crm（分群），故多成员（caching-design:90） |
  | `meta`（metaInsights/metaAdPerformance/metaExpert/metaListObjects/listMetaPages/proposeMetaAction/proposeAdBuild） | `ads-analytics` | ads/* + analytics/* zones（A′ 65 页 `ads/*`·`analytics/*`；caching-design:91） |
  | `schedule`（schedulePosts） | `schedule` | 不变（A′ 65 页 `schedule/*`；caching-design:92） |
  | `research`（researchWeb/proposeResearch） | `research` + 多域成员 `campaign`/`create` | **跨域**：研究服务 campaign/trends 与 create；`Domain[]` 多成员正是为此（SOL 阻断解，caching-design:93） |

- **新表面归置**（按五份 B8 设计的 IA，逐条注明出处）：

  | 新表面 | 归域 | 出处 |
  |---|---|---|
  | 口碑技能（listReviews/draftReviewReply/draftReviewRequest/sendReviewRequest/listReferrals/designReferralReward/issueReferralReward/listLoyaltyMembers/draftLoyaltyWinBack） | `crm-inbox` | 口碑页「CRM/口碑区内导航」；请评触达复用 B5 inbox + B7（reputation-design §3.1/§10 skill 清单） |
  | Marketplace 技能（listing 优化/店铺装修生成） | `create`（生成，复用创作工厂+品牌记忆）；大促日历/研究 → `campaign`+`research` | marketplace-design §11「listing=品牌记忆+产品档案+创作工厂组合应用」；§10 缝 1 |
  | 第一米 技能（微站/物料 generate；发帖/回评 propose+execute；读净值 free/read） | `create`/`assets`（生成物料）；归因读 → `campaign` | firstmile-design §5 双执行矩阵行 319；§6.1 复用 QrAsset/创作工厂 |

- **装载协议**：按 `viewContext.zone` + 确定性意图规则选域装载（宪法 10：确定性代码，不靠模型天赋路由；映射表=一张可读 TS 常量文件）；回滚开关 env 一个（`OTTO_SKILL_SCOPING=off`=全静态挂载=现状，caching-design:112）。
- **出生纪律**：本 spec 冻结后，**任何块的新 skill 出生即带 `domains`**（缝 1 六处登记升七处，+domains）。
- **待 worker 填证**：25 技能现状域划分表（P0.5 Phase 2 spec 已有底，核对时效）；每域前缀 token（见契约 6 对标锚，已落实测数）。

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
  2. **数量上限**：`selection` 注入前截断到上限 `N`（建议 ≤ 20，worker 定稿）；超限丢尾 + 记 ActionEvent。
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
3. **RunState 恢复 × 工具集变化的兼容规则（toolset snapshot / version）**（出处 §3.4·V5 `:105`，佐 V7 `:107`）：`tryRestoreRunState` 恢复的历史含已卸载 tool 的 tool_call/tool_result 时，SDK 可能报错/降级（playbook F24：`fromString` 抛错=全线程变砖）。**冻结规则**：恢复轮全量装载（第 1 条）保证被恢复历史引用的所有 tool 在场；worker 需实测 V5（恢复×工具集变化）/V6（审批恢复）/V7（10 步链内跨域，SDK 报 unknown tool 的失败形态），三场景回归测试绿（caching-design §3.7·2，`:119`）。若 SDK 需要，**冻结 toolset snapshot/version 或等效兼容规则**作为 RunState 的一部分（版本不匹配→回退全量），实现随 V5-V7 结果落地（§3.5 原则先钉死，`:109-113`）。

### 契约 6 · live-event envelope 事件面接口定稿（E2-21，宪法 11 v2.6——SOL §2·B9⑤ 采纳，从「目标」变「接口」）

> SOL 坐实 v0.2 只有「秒级」目标、无接口。v0.3 把事件信封定为**接口**（B2 契约〇 引用此为「UI 秒级刷新」的唯一载体；live reflection 永不落归因流水）。

- **事件信封字段（冻结接口）**：
  ```
  LiveEvent = {
    ownerId: string,          // owner 鉴权:订阅方必须是同租户,服务端断言(宪法 6)
    resourceType: string,     // 'generation' | 'post' | 'campaign' | 'conversation' | … (对齐 SelectionKind 子集)
    resourceId: string,
    revision: number,         // resource revision:单调递增,客户端据此丢弃陈旧帧
    seq: number,              // 排序去重键:每 (ownerId,resourceType,resourceId) 单调,断线重连去重
    cursor: string,           // 断线 replay cursor:重连后从 cursor 补投缺失事件
    actor: { kind: 'system'|'otto'|'user', id?: string },  // 谁触发
    correlationId: string,    // 关联 job/turn,与 ActionEvent/归因链对齐排障
    payload: Json,            // 仅非敏感字段:敏感字段限制见下
  }
  ```
- **鉴权与租户**：订阅经服务端 owner 断言（宪法 6）；跨租户订阅拒绝；`payload` **敏感字段限制**——不含 PII/凭据/内部 ID 之外的敏感数据（PDPA），只带界面刷新所需的最小集。
- **传输与兜底**：推送优先（SSE/事件总线）；**短轮询兜底上限**——回退轮询间隔上限 ≤ 4s（对齐 canvas 现状 4s 轮询，推送化后此为兜底），断线 → 用 `cursor` replay 补投，`seq` 去重。
- **纪律**：「后台已完成而界面不知」按缺陷处理；实现归 B3（canvas 侧 4s 轮询→推送化）。

## 三、对标锚清单（§六 水准判官格式）

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| 宪法 7 四层结构保证 | v2.11 | 单一动作层/Parity/读对等/上下文桥 | 四层全部有机器闸或活体验证 |
| Higgsfield Supercomputer / Agentforce（对标地图·Otto 本体行） | 2026-07 | agent 操作全城而非一区 | 每功能块 Otto 话术全绿（B11 联验，sonnet 级——宪法 10） |
| 引擎效率（宪法 5 效率良心） | — | 每轮前缀 token | 分域装载后 core+单域 **≤ 3.75k tok（≤ 全量基线 7.7k 的 50%）**；实测见 §对标锚落数 |

### 对标锚落数（SOL §2·B9⑥ 采纳——TBD「≤基线 50%」用实测替换）

- **估算法（写明）**：对 25 技能各自序列化其 `@openai/agents` tool schema（`name` + `description` + zod→JSON-schema `parameters`），求字符数，**tokens ≈ 字符数 / 4**（混合英文/JSON 的 GPT tokenizer 近似）。测量脚本导入构建产物 `packages/otto/dist/registry.js` 的 `allSkills`，逐 skill `JSON.stringify({name,description,parameters})`。此法与 caching-design §3.2 独立测得的「~7.7k」吻合，可复核。
- **实测基线（全量 25 技能 tools schema）**：序列化 **30,916 字符 ≈ 7,729 tokens**（字符/4）。
- **core（6 常驻）**：5,723 字符 ≈ **1,431 tokens**。
- **core + 单域 目标数字**（实测各域组合）：

  | 装载组合 | 字符 | ≈tokens | 占全量基线 |
  |---|---|---|---|
  | core + schedule（1 技能） | 7,344 | 1,836 | 24% |
  | core + research（2） | 7,953 | 1,988 | 26% |
  | core + brand（6） | 10,955 | 2,739 | 35% |
  | core + creation（3） | 12,561 | 3,140 | 41% |
  | core + meta（7，最重域，含 propose-ad-build 单个 ~4.2k 字符） | 14,995 | 3,749 | **49%** |

- **落数结论**：**core+单域目标 ≤ 3.75k tokens（≤ 全量 7.7k 基线的 50%）**——最重域（meta，7 技能）实测 49%，达标；典型域（create/brand/research/schedule）落 24%–41%。数字随证据层 worker 复核时效（技能增减后重跑上述脚本）。

## 四、假设台账

| 假设 | 依据 | 验证法 |
|---|---|---|
| domain 闭集 9 项 + `Domain[]` 多成员够用 | 六域迁移表 + 五份 B8 设计 IA（本 spec §契约 1） | B8 块 spec 冻结时按 IA 复核归置；新表面出生带 domains |
| `Domain[]` 多成员解 research 跨域 | SOL §2·B9① 坐实单域装不下 research | worker 实测 research 技能从 campaign/create 两 zone 均可命中装载 |
| SelectionKind 闭集可枚举（禁 …） | A′ 65 页对象类型 + 二三波新对象 | B3/B8 spec 对表；新增 kind=founder-only 单列 |
| 恢复轮全量满足 RunState 工具兼容 | 旧 spec §3.5.1 + V5/V6/V7 | worker 实测 V5-V7 三场景回归绿（§3.7·2） |
| live-event envelope 字段足以承载秒级刷新且不越 PDPA | 宪法 11 v2.6 + 敏感字段限制 | B3 canvas 推送化联验；payload 最小集审查 |

## 五、冻结条件与状态

- **状态：冻结候选（freeze candidate）。** v0.1 骨架 → v0.2 吸收 Campaign 试产 → **v0.3 闭合 SOL §2·B9 六阻断项（本稿）** → **founder 明示 ack（D-018②/D-020⑤）** → spec-ready（09-B9 相关行随冻结 PR 迁级）。SOL 复审通过不替代 founder 过目（共享契约/schema=founder-only）。
- **开放问题（v0.2 两项处置）**：
  1. domain 与 A′ 左轨导航 zone 是否 1:1 → **闭合**：非 1:1；多 zone 可映射同域，跨域技能用 `Domain[]` 多成员（§契约 1 迁移表 + 归置表给出 zone→域映射依据）。
  2. contextBridge 隐私边界（selection 注入是否过滤跨租户引用）→ **闭合**：契约 2 租户校验入契约——服务端 resolve + ownerId 断言 + 数量上限 + 丢弃越权/过期，客户端裸 ID 永不持久化（宪法 6）。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①`domains` 字段加入 defineOttoSkill（缝 1 登记扩展）；②SelectionKind 二三波 union 扩展；③RunState toolset snapshot/version 若 V5-V7 实测需要则落 schema。这些**不在本 spec 自行落地**，是冻结 ack 时的明示清单。
