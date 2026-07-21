# C5 Broadcast / permission / 抑制 / 频控 物理合同

> **状态：docs-only PROPOSAL；等待 Founder 对本文唯一 schema 方向与四轴读接口边界作决定**
>
> 本文只冻结 C5（B0-43/44/45/46）的领域、四轴 provider-neutral 资格读接口、拟议物理载体、发送闸/chokepoint、
> C4 preflight 点亮合同、D8/C5/C6 fail-closed 边界与验证合同。本文不修改 Prisma/schema/migration，不建第二个
> consent/DND/refusal writer，不建合并式抑制名单，不连接任何 provider/WABA，不配置凭证，不调用 Meta，不花费，
> 不发真实消息，不实现 D8 载体，不部署 production。
>
> 证据基线：live `main` `2c3f1d89ae82afd70d993cc1ff5e2e4f30dbac2c`（本 worktree base）。
>
> 连续性：[#382](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/382) 是本票唯一 authority（10 条 scope 为约束）。
> [#359 台账](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359) 第 10/28/29/30 条只作后台账证据，不授予实现权：
> 第 10 条=D8 延后载体（`DeliveryManifest`/`ActionReceipt`/confirmation-outbox）各自另票；第 28 条=产品先行、外界最后
> （模拟供应商）；第 29 条=WhatsApp 路线改为 Meta Tech Provider 直连 + Embedded Signup，**supersede C4a spec 的
> Gupshup 首实现命名**；第 30 条=C5 四站一次性授权（M0 规格→M3 界面），但 M1 建表仍须其自己的 schema/migration 票。
> 上位范围来自 map §8 C5 候选行（`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:204`）与
> B0-43/44/45/46 行（`docs/ops/route-b/matrix/07-B7.md:7-10`）。四轴发送资格语义的冻结上位是
> R-010 §4.5/§4.5.1（`docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md`）。

## §1 一句话结果

C5 只新增**一个对外面：四轴发送资格 READ API**——把 R-010 已冻结的四条独立发送安全轴（consent-STOP、
merchant DND、provider refusal、frequency）读成逐轴 `pass / block / risk / unknown / unavailable` 结果，供 C4 的
`getConversationPreflight` 与未来 broadcast-run 1:1 消费。`consent-runtime` 仍是 consent/DND/refusal 事实的**唯一
writer**；C5 只加读，绝不加第二 writer，也不建、不写、不读任何合并式抑制名单本体（origami 判决 7-9）。B0-43 的
群发发送授权永远是**人工逐次/精确批次**（同 B0-54 口径）：Otto 只能备受众/文案/预检；C4 的 `submitConversationReply`
仍是唯一的会话发送 chokepoint 并**调用** C5 的四轴 gates；群发另有一个 C5 自有的 broadcast-run chokepoint，形状与
C4 chokepoint 同样 fail-closed。在 D8/C6 native carriers 与最终「连接与上线」阶段未获批、实现并验证前，任何**真实**
外发都返回 `SEND_PATH_UNAVAILABLE`；模拟供应商时代（M1–M3）只有模拟发送、零真实 provider、零 webhook、零凭证、
零花费。

## §2 Authority、范围与不做

### §2.1 C5 只承接四行

| B0 | 本合同承接 | 验收边界 |
|---|---|---|
| B0-43 | 通用受众 Broadcast：Otto 备料 + 人工逐次/精确批次外发授权；C4 chokepoint 调 C5 gates，群发另有 C5 自有 chokepoint | 无第二发送入口；真实外发在 D8/C6/M6 前一律 unavailable |
| B0-44 | 联系人 permission 事实读面 + 受众语义：未知不自动缩名单、导入不伪造 consent、商家不可翻转已知退订 state | 只**读** R-010 consent authority；写仍归 consent-runtime |
| B0-45 | 已知 STOP/退订、DND、provider hard limit 的运行时 fail-closed 抑制（三轴分立读数） | 三轴分立，非合并名单；对自动/无人确认发送 hard stop |
| B0-46 | 频控：统一发送层每联系人滚动窗口硬上限，playbook 不可绕 | 频控在发送执行层计数；模拟era 计模拟发送 |

### §2.2 明确不吸收

- **第二 writer / 合并抑制名单**：C5 不建、不写、不读任何统一 suppression/blocklist 表、字段或 API；四轴永远是四轴。
  consent/DND/refusal 事实的写入唯一入口仍是 `consent-runtime`（R-010 §4.2–4.6/§4.5.1）；C5 只 fold-read。
- **D8 载体**：`DeliveryManifest`、reactive anchor、两次确认铸造/消费、`actionId/actionRevision`、confirmation-outbox、
  worker、`ActionReceipt`、lock/retry/reconciliation 全归各自 Founder-approved native task（台账 #10）；C5 不静默抢归属。
- **C6 receipt truth**：provider 送达/失败/已读、reconciliation、统一报告归 C6（B0-41/42）。C5 只定义「此刻是否允许
  尝试发送」，**不**定义「provider 实际发生了什么」。
- **真实外界**：Meta Cloud API 连接、商家 Embedded Signup、WABA 凭证、Meta App Review、真实 template submission、
  真实 webhook、真实 send、生产库迁移（台账 #11/#12）、B13 privacy、production/deploy——全部集中到最终「连接与上线」
  阶段（台账 #28）；本文零 provider call、零 spend。
- **money 路径**：C5 无 credits、无 ledger、无 money-safety 触发。B0-43 的「额度预检/掉档横幅」是 WhatsApp
  provider-tier（messaging tier / quality rating）词汇，是**读 provider 配额证据**，不是 FIKIRTIVE 花钱闸（见 §6.1）。
  真实通道费计价归 C4a §10 M6 的 `ChannelFeeWallet/ChannelFeeLedger`，不在本文。B0-57 打包花费确认页💰属 C2b（台账 #7）。
- **C7 / Routine / 规则编辑器 / journey**：B0-40/47/48/49/98 归 C7；C5 只提供它们对客发送时必须叠加的同一四轴 gates。

### §2.3 当前事实（已 live main `2c3f1d89`）

- `ConsentEvent` / `ConsentStateProjection` / `ContactDndEvent` / `ProviderRefusalEvent` / `ProviderRefusalState` 五表已在
  live main（R-010 consent-batch additive migration merged PR #362，consent 引擎 merged PR #364；台账 #13 记录该「第二批
  建表」事项——台账无 closure 列，本文只以 merged PR 与 live schema 为证，不断言台账已闭合）；
  `packages/db/src/consent-runtime.ts` 是这些事实的唯一 writer
  （`recordConsentEvent` / `recordUnqualifiedStop` / `recordStopPurposeExpansion` / `recordContactDndEvent` /
  `recordProviderRefusalEvent` / `expireProviderRefusal` / `rebuildConsentRuntimeProjections`）；
  `packages/db/src/consent-fold.ts` 提供 `foldConsentEvents` / `foldDndEvents` / `foldProviderRefusalEvents` 纯 fold，与
  `CONSENT_PURPOSES = [marketing, review_request, transactional]`、`PROACTIVE_NON_TRANSACTIONAL_PURPOSES =
  [marketing, review_request]`、`failClosedD5Override()`（D5 载体故意缺席）。
- C4b Inbox 存储已 live（`CustomerConversation` / `CustomerMessage` / `CustomerConversationEvent` /
  `CustomerConversationDraft` / `CustomerMessageTemplate` / `CustomerMessageTemplateVersion`）；
  `apps/web/lib/customer-inbox-service.ts` 的 `getConversationPreflight` 已渲染
  `consentStop / doNotDisturb / providerRefusal / frequency` 四轴，但当前全部硬编码为
  `{ status: "unknown", source: "c5_not_read_in_m2" }`——**这正是本文要定义 live wiring 的四轴**。
- production 没有任何 broadcast run、audience snapshot、frequency counter 或发送资格 READ API；`sendEligibility` 当前
  恒为 `{ status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" }`。
- `Campaign` 已 live（`status/goal/startAt/endAt/planJson`，一期只归组、不存可编辑 UTM，R-010 D3/D10）；它不是发送
  authority，broadcast run 只可空外键归组引用它（B0-51/52）。
- 没有任何 provider adapter、WhatsApp 连接或 send 执行层；模拟供应商时代（台账 #28）的所有「发送」都是模拟。

## §3 领域边界与不变量

### §3.1 固定词义

1. **Send eligibility（发送资格）**：对「此刻是否允许尝试向这个 exact channel identity 发一条这种 purpose 的消息」的
   **只读**回答，由四条独立轴组成（consent-STOP / DND / provider-refusal / frequency）。资格本身**永不**等于发送授权：
   正向外发授权始终是人工逐次/精确批次动作（B0-43）。资格也不制造 consent、不改变任何 state。
2. **四轴（four axes）**：consent-STOP（R-010 consent fold，per contact×channel×purpose）、merchant DND（Contact 级、
   覆盖全部 channel/purpose）、provider refusal（per exact scope 的 provider 硬拒）、frequency（发送层滚动窗口触达上限）。
   四轴分立求值、分立展示、分立记 authority source；**任何代码/UI/API 不得把四轴合成一个 boolean 或一张合并名单**。
3. **Broadcast run（群发运行）**：一个 merchant 对一个冻结受众、在一个 logical channel account 上、用一个冻结 template
   version 发起的一次 proactive 发送动作。它是 D5 语义下的「exact frozen action」载体；`Campaign` 只归组，不是它的 authority。
4. **Audience member snapshot（受众成员快照）**：broadcast run 冻结受众时，每个成员一行，携带**冻结时**的逐轴 eligibility
   verdict 快照（用于展示/审计），以及 merchant 的纳入选择。快照 verdict 只作展示/审计；执行时必须**重读** live authority
   （§6.2），永不凭冻结的旧 PASS 发送。
5. **Frequency（频控）**：统一发送层对「同一 contact 在一个滚动窗口内可接收的 proactive 发送条数」的硬上限。它**不是**
   CRM 字段、不是合并名单的一部分、不因 playbook 不同而绕过；窗口/上限来自 config（§5.5）。频控只作用于
   `proactive_non_transactional`；`transactional` 与 `reactive_service_reply` 不受频控。
6. **模拟供应商时代（simulated-provider era）**：台账 #28 决议下，M1–M3 全部对模拟发送运行，零真实 provider。频控在发送
   执行层计数，因此模拟era 的 counter **计的是模拟发送**（§5.4）；`额度预检/掉档横幅`（provider messaging tier 证据）在
   模拟era 恒为 `unavailable` 并如实显示，绝不伪造成绿（§6.1）。

这些词同时写入根目录 `CONTEXT.md` 的「Customer engagement 顾客互动」段。代码/UI/API 必须显式使用这些词义；
`suppression list / blocklist / 抑制名单本体` 只作被禁止的反面词出现。

### §3.2 核心不变量

- `ownerId` 只从 authenticated session、verified server route 或 trusted worker context 得到；浏览器、Otto 参数、
  connector payload、broadcast 输入都不能提交或覆盖。每个 owner-scoped relation tenant-qualified；新 owner models 出生即
  登记 `TENANT_MODELS`。
- **`purpose` 与 `callerClass` 同样 server-derived**（与 `ownerId` 同规矩）：二者在 chokepoint 由**实际发送上下文**推导
  （`purpose` 由 broadcast run 的 template/发送意图定案、`callerClass` 由执行主体是人工精确批准还是 Otto/connector/rule/
  background 定案），**绝不**接受 client/Otto/connector payload 自报；`reactive_service_reply` 必须对**真实存在的 open
  service window** 校验通过才成立，否则按 proactive 归类。**open service window 必须锚定于客户主动的 inbound event
  （customer-initiated），绝不能由商家自己发出的消息开启或续期**（R-010 §1 已把 `reactive_service_reply` 定义为「可验证的
  **顾客主动**对话下的一对一回复资格」；本文将其固化为 C5 对 C4 chokepoint 的显式要求，堵住 self-opened-window 绕过）。
  任何夹带 proactive element 的 reply 在资格读**之前**重归类为真实 `marketing/review_request` purpose（§6.3、§11.2）。
  此项在 M4 真实发送若被违反即升为 **P0**（caller 自报 purpose 或商家自开窗口可绕开 consent/频控）。
- **四轴永远四轴**：C5 不新增任何名为/形如统一 suppression/blocklist 的表、字段或 API。发送资格由四条 fold-read 组合而成，
  组合逻辑只活在 shared eligibility evaluator 内，不落库成第二真源（origami §6.4：CRM/发送层不建、不写、不读抑制名单本体）。
- **consent-runtime 唯一 writer**：C5 只对 `ConsentStateProjection`、`ContactDndEvent` fold、`ProviderRefusalState` 与新增
  frequency counter 做 owner-scoped **读**；任何经 C5 路径的 consent/DND/refusal **写**都是 P0。普通 broadcast 回复、
  受众纳入、导入都不能制造 opt-in（R-010 §4.1.5）。
- **unknown 不缩名单**：未知 permission 如实显示 risk，但绝不被静默移出 merchant 选定受众（flag + keep，商家决定，
  R-010 §4.1.3、B0-44）。`verified only` 只作可选 filter，不是默认收窄。
- **商家不可翻转已知退订 state**：merchant 不能把 `effective_revoke` 改成 grant，也不能靠自动/无人确认发送绕过它
  （R-010 §4.5）。仅 R-010 D5 允许获授权 merchant 对 exact frozen action 完成两次独立人工确认后**提交一次发送**（consent
  state 不变），且该 override 铸造/消费按 R-010 §4.3.3 归 D8，在 D8 载体获批实现前**不可用**（§6.4）。
- **effective_revoke hard-stop**：对 Otto、connector、import、rule 与无人确认 background action，`effective_revoke` 永远是
  hard stop（R-010 §4.5）；C5 read 对这些调用方一律返回 consent-STOP = `block`。
- **D5 只覆盖 consent 轴**：DND、permanent/account provider refusal、frequency、operator/role、security、legal/channel
  prohibition、connection/capability、stale action revision 都是不可由 D5 绕过的 hard block（§6.4）。
- **资格读 ≠ 发送**：READ API 返回 truthful 四轴，但**不**授予任何发送；真实发送在 D8/C6/M6 前 fail closed；模拟发送
  仅在 M3 workbench 内、仅对四轴全过成员、仅走模拟 provider 执行。
- **missing = unknown/degraded fail closed**：缺 projection、缺 config、缺 provider capability/health、缺 authority 一律
  fail closed，绝不拼一个乐观的绿。

## §4 四轴发送资格 READ 接口（C5 唯一新增对外面）

### §4.1 位置与逐轴结果形状

**【设计选择】** 纯资格 evaluator 落 `packages/db`（server-only，暂名 `packages/db/src/send-eligibility.ts`），作为
`consent-runtime.ts` / `consent-fold.ts` 的兄弟；app 侧的 principal/`requireOwner` 包装（暂名 `getSendEligibility`）落
`apps/web/lib`（沿用 customer-inbox gateway 模式）。理由：四轴的 authority（`ConsentStateProjection`、`ContactDndEvent`
fold、`ProviderRefusalState`、frequency counter）全都住在 `packages/db`，且 `consent-runtime` 已是那里的唯一 writer；把
reader 与它们同处保持一条 authority 边界，并让 C4 preflight 与未来 broadcast-run 调**同一个纯函数**，天然 1:1。

evaluator 语义合同（不是本票代码授权）：

```ts
type EligibilityAxisStatus = "pass" | "block" | "risk" | "unknown" | "unavailable";

interface EligibilityAxis {
  status: EligibilityAxisStatus;
  source: string;        // authority 来源标识，替换 "c5_not_read_in_m2"
  reason?: string;       // merchant-visible 稳定 code；不含 PII / raw payload
  checkedAt: string;     // server 读取时间，Timestamptz(6)
}

interface SendEligibilityInput {
  ownerId: string;               // server-resolved，caller 不可传
  contactId: string;
  contactIdentityId: string;     // exact channel identity
  channel: string;               // provider-neutral
  purpose: "marketing" | "review_request" | "transactional" | "reactive_service_reply"; // chokepoint-derived，caller 不可传（§3.2）
  providerConnectionId: string;  // 决定 provider-refusal scope
  callerClass: "unconfirmed_automatic" | "merchant_manual"; // chokepoint-derived，caller 不可传（§3.2）；决定 effective_revoke 呈现
}

interface SendEligibilityResult {
  consentStop: EligibilityAxis;
  doNotDisturb: EligibilityAxis;
  providerRefusal: EligibilityAxis;
  frequency: EligibilityAxis;
  // M1–M3：aggregate 恒取 unavailable 分支；AggregateDisposition 仅 M4 真实 send path 激活（§4.4）。
  aggregate: { status: "unavailable"; reason: "SEND_PATH_UNAVAILABLE" } | AggregateDisposition;
  checkedAt: string;
}

// 仅 M4 激活；M1–M3 永不返回此分支。read-only 呈现，绝不等于发送授权。
interface AggregateDisposition {
  formula: "unconfirmed_automatic" | "merchant_manual"; // 哪条 R-010 §4.5 公式被求值（由 callerClass 决定）
  candidate: boolean;                                    // 该公式的候选布尔结果
  blockingAxes: Array<"consentStop" | "doNotDisturb" | "providerRefusal" | "frequency">; // 命中的阻断轴（可空）
  requiresD5Override: boolean;                           // 仅 merchant_manual + consentRisk 且其余轴不 block 时为 true
}
```

形状对齐说明（精确）：live `getConversationPreflight` 的每轴当前是 `{ status, source }`，另有一个 **top-level** `checkedAt`；
C5 轴是其**超集**——额外**附加** per-axis `reason?` 与 per-axis `checkedAt`（老字段只增不删），因此这四个 `c5_not_read_in_m2`
占位可 1:1 替换为 evaluator 的四个返回轴（§7）。C4 的**兄弟轴**（`connection` / `d8Carrier` / `exactApproval` / member
role-capability / current revision）**不在 M2 被 C5 改写或加 per-axis 字段**——它们仍归 C4/D8/D9 自持（§7）。

### §4.2 四轴语义（各自 authority、各自 fail-closed）

| 轴 | authority（read-only） | `source` | pass | risk | block | unknown / unavailable |
|---|---|---|---|---|---|---|
| **consent-STOP** | `ConsentStateProjection`（per `ownerId,contactId,channel,purpose`）；等价于 `foldConsentEvents` 全量 replay | `consent_state_projection` | 见 §4.2.1 的 3×2 映射（consent-state × callerClass）——本行不用单格表达，杜绝 `unknown` 一词歧义 | 见 §4.2.1 | 见 §4.2.1 | 见 §4.2.1（仅 projection/fold 读不到才用 `unavailable`） |
| **doNotDisturb** | `ContactDndEvent` 的 `foldDndEvents`（Contact 级、覆盖全 channel/purpose，R-010 §4.5.1）；或其 `Contact.doNotDisturb` compatibility projection | `contact_dnd_fold` | fold `doNotDisturb=false` 或无 DND 事实 | —（DND 无 risk 档，非 D5 可绕） | fold `doNotDisturb=true` | — |
| **provider-refusal** | `ProviderRefusalState`（per server-derived `scopeKey`）：读 recipient scope `recipient:<connectionId>:<channel>:<identityId>` 与 account scope `account:<connectionId>` 两个 key | `provider_refusal_state` | 两 scope 均无 `blocked` | —（无 risk 档） | 任一 scope `blocked=true`（permanent_recipient 或 account_level） | 模拟era 无 provider 事实 → pass（不伪造 block） |
| **frequency** | 新增 frequency counter（§5.4）：数 `(ownerId,contactId,channel,purposeClass)` 在滚动窗口内的计数行 | `send_frequency_counter` | 窗口内计数 `< cap` | —（无 risk 档） | 窗口内计数 `>= cap` | 缺 config → `unavailable` fail closed（不放行） |

#### §4.2.1 consent-STOP 的 consent-state × callerClass 映射

`consentState` 是 consent 语义状态（R-010 fold：`verified_grant` / `unknown` / `effective_revoke`），与**轴 status** 是两回事；
本表把二者显式解耦，杜绝 `unknown` 一词在「consent 解析为无 permission」与「projection 物理读不到」之间混用：

| consentState ＼ callerClass | `merchant_manual` | `unconfirmed_automatic` |
|---|---|---|
| `verified_grant` | `pass` | `pass` |
| `unknown`（含 fold-null / projection `state="unknown"`） | `risk`（D5-eligible；不缩名单） | `block` |
| `effective_revoke` | `block`（D5-eligible；state 不变，§6.4） | `block` |
| projection/fold **物理读不到**（DB/replay error 等） | `unavailable`（fail closed） | `unavailable`（fail closed） |

轴 status `unknown` / `unavailable` **严格保留**给「projection/fold 物理读不到」这一种情况（映射到 `unavailable` fail closed）；
consent-state 解析为 `unknown`/`effective_revoke` 一律映射为 `risk`/`block`（按 callerClass），**绝不**误用轴 `unknown` 表达
「已解析为无 permission」。`unconfirmed_automatic`（Otto/connector/rule/background）对 `unknown` 与 `effective_revoke` 都
`block`（R-010 §4.5：后台不得静默自动发送给非 `verified_grant`）；`merchant_manual` 两个 D5-eligible 格子仍受 override
D8-gating（§6.4），模拟era 因 override 不可铸造而实际零发送。

轴级细则：

- **consent-STOP** 按 broadcast/reply 的 exact purpose 读。D4 无限定 STOP 已让 `marketing` 与 `review_request` 两 tuple
  同时 `effective_revoke`，因此对 marketing broadcast 读 `(contact,channel,"marketing")` 即命中。`reactive_service_reply`
  是独立 send class，不进 consent purpose、不要求 consent（R-010 §4.3.3）：其 consent-STOP 轴呈 `pass`（source
  标注 `reactive_service_reply_not_consent_gated`），但 DND/provider-refusal 仍适用。
- **doNotDisturb** 是 Contact-wide（R-010 §4.5：当前物理 scope 明确覆盖全部 customer channels/purposes）；清除 DND 不
  制造 grant。若 DND writer/UI 尚未接线（R-010 §4.6.8 的 projection switch 目前 deferred），多数 contact 无 DND 事实 →
  轴 `pass`；这是如实的，不是漏读。
- **provider-refusal** 的 `transient`（429/5xx/timeout）按 R-010 §4.5.1「零长期 block projection」——它根本不进
  `ProviderRefusalState`，因此 C5 read 不把 transient 当 block（transient 的 retry/backoff 归发送执行层/C6，非 C5 资格轴）。
- **frequency** 只对 `proactive_non_transactional` 计数与 gating；`transactional`/`reactive_service_reply` 的 frequency 轴呈
  `pass`（source 标注 `not_proactive_not_counted`）。

### §4.3 provider-refusal 闭合分类的分别处置（R-010 §4.5.1）

| kind | C5 read 结果 | 说明 |
|---|---|---|
| `permanent_recipient` | 命中 recipient scope 的 active block → 轴 `block` | 硬拒该 connection/channel/recipient，直到 same-scope verified clear（`block\|clear`，**禁止 expire**） |
| `account_level` | 命中 account scope 的 active block → 轴 `block` | 暂停该 connection/account，不污染其它 connection/channel/Contact；只有原 block 带可验证 finite `expiresAt` 时才允许 system `expire`；reader 不因 wall clock 越过 `expiresAt` 隐式解除（须已 append `expire` event，key=`refusal-expire:<blockEventId>:<expiresAt>`） |
| `transient` | 不进 projection → 轴不 block（`pass`） | 只 `observe`，零长期 block；retry/backoff 归发送层/C6 |

provider 更换不改 consent history，也不得把旧 connection 的 refusal 静默提升为新 connector 的全局事实（R-010 §4.5.1）。
C5 read 只按**本次实际 connection/identity** 算 `scopeKey`，caller 不可传或覆盖 `scopeKey`。

**空态 ≠ 缺能力（no optimistic green）**：`ProviderRefusalState` **存在但无 active block**（该 scope 从未被拒或已 verified
clear）⇒ refusal 轴 `pass`——这是有据的空态。provider-tier **能力本身缺席**（模拟era 无任何 provider 连接/capability）是另
一回事：**只有 refusal-history 轴**可在空态 `pass`；`额度预检/掉档` 这类需要 live provider capability 的读一律 `unavailable`
（§6.1），绝不因「读不到」而给绿，也绝不当作发送资格 pass。

### §4.4 aggregate disposition 与两条 D5 公式

evaluator 在四轴之上给一个 aggregate，但**仅作 read 呈现**，绝不等于发送授权。它按 R-010 §4.5 的两条公式（本文只
如实表达，不改）派生，`callerClass` 决定用哪条：

```text
consentRisk        = consentState != verified_grant
nonConsentHardBlock = doNotDisturb OR providerRefusalBlocked
runtimeSuppressed  = frequencyOverCap

# 无人确认自动主动发送候选（Otto/connector/rule/background）
candidateForUnconfirmedAutomaticProactiveSend =
  selectedByMerchant AND NOT consentRisk AND NOT nonConsentHardBlock AND NOT runtimeSuppressed

# 获授权 merchant 手工主动发送候选
candidateForMerchantManualProactiveSend =
  selectedByMerchant AND NOT nonConsentHardBlock AND NOT runtimeSuppressed
  AND (NOT consentRisk OR exactD5TwoConfirmOverride)
```

`aggregate` 的具名 `AggregateDisposition`（§4.1：`formula` / `candidate` / `blockingAxes` / `requiresD5Override`）**仅 M4
真实 send path 激活**；M1–M3 期间 `aggregate` 恒取 `{ status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" }` 分支，与
live `getConversationPreflight` 一致。四轴本身在 M2 起如实点亮，但 aggregate 的 candidate 判定要等 send path 存在才有意义。

`exactD5TwoConfirmOverride` 按 R-010 §4.3.3/§4.5 归 D8：在 §6.4 列明的 native carrier/runtime/privacy gates 全部通过前
**不可被铸造或消费**（`failClosedD5Override()` 就是当前的 hard 缺席）。因此模拟era 的 aggregate：

- 真实发送方向：`aggregate = { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" }`，与 live `getConversationPreflight`
  一致；C5 点亮四轴但**不**把它翻成 available——send path 由 D8/C6 独立 gate。
- 模拟发送方向（仅 M3 workbench 内）：只有四轴全过（`verified_grant` + 无 DND + 无 provider block + 未超频控）的成员
  才可走模拟 provider 执行；`consentRisk`（unknown 或 effective_revoke）成员因 override 不可铸造而得零模拟发送，D5 双人
  确认 UI 可渲染流程但 override 保持 unavailable（§6.2/§6.4）。

`strict transactional`（R-010 §4.3.2）与 `reactive_service_reply`（§4.3.3）分别按各自上下文判定，不借这两条 proactive
公式绕路。资格 aggregate 也不替代 exact send approval、账号/模板规则、provider capability 或其它既有 gates。

### §4.5 read-only 与模拟纪律

- evaluator 与 gateway 只做 owner-scoped **读**；发现任何经它写 consent/DND/refusal 的路径即 P0。
- 每轴分开返回 `checkedAt`；read model 另分开返回 `lastProviderEventAt / lastHealthCheckedAt / lastDataLoadedAt`
  （沿用 C4a §7.3），缺值是诚实 unknown，绝不拼成一个假的 `lastSyncedAt`。
- 模拟era：provider-refusal 与 `额度预检` 无真实 provider 事实 → 如实 `pass`/`unavailable`，绝不 fabricate；frequency
  counter 计的是模拟发送（§5.4），因此模拟era 里连着两次群发同一 contact 会如实触发频控 `block`——这是正确行为，不是 bug。
- 读接口对未识别 purpose/channel/scope、缺 config、缺 projection 一律 fail closed（`unknown`/`unavailable` + 不放行）。

## §5 拟议物理合同（M1 preview — 全部标 PROPOSED；M1 另开票取 schema/migration 授权）

### §5.1 总览

本提案是 M1 的 additive-only package：新增三个 owner-scoped carriers，全部沿用 C4b-M1 约定（每表 `ownerId` 出生即有、
`Organization` 加 back-relation、composite tenant FK、`@@unique([ownerId, ...])` 幂等、closed taxonomy 存 String + code
validator、historical relation `onDelete: Restrict`、partial unique 由 migration raw SQL 建并配 drift test、加入
`TENANT_MODELS`）。**不建任何合并抑制名单表**；四轴 authority 继续复用既有五表。

| Carrier | 唯一职责 | 不是 |
|---|---|---|
| `BroadcastRun` | 一次群发的冻结动作 header（受众/内容/状态/CAS） | 发送授权、receipt、抑制名单、Campaign |
| `BroadcastAudienceMember` | 冻结受众每成员一行 + 冻结时逐轴 verdict 快照 + 纳入选择 + 发送态 | 合并名单、consent 真源、provider receipt |
| `ContactSendFrequencyEvent` | append-only 频控计数事实（滚动窗口按行数计） | mutable 单行计数器、抑制名单、consent/DND 事实 |

**【设计选择】** 频控用 append-only 事件（滚动窗口按 `countedAt` 数落在窗口内的行）而非 mutable 单行计数器：滚动窗口需
时间过期，单行 count 只能靠 decrement/sweep，会引入并发竞态与不可 replay；append-only + 读时窗口计数与 `ConsentEvent`/
`ProviderRefusalEvent` 同房规、可 rebuild、幂等去重天然。理由一句话：滚动窗口不可被单一 mutable 计数如实表达。

### §5.2 `BroadcastRun`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org；FK `Organization.id` |
| `channelScopeId` + `channel` | tenant/channel-qualified FK `(channelScopeId, ownerId, channel) → ChannelScope(id, ownerId, channel)`；发送所用 logical channel account |
| `campaignId` | nullable tenant-qualified FK `(campaignId, ownerId) → Campaign(id, ownerId)`；**只归组**（B0-51/52），非 authority。该复合 FK 需 `Campaign` 具备 `@@unique([id, ownerId])`——live `Campaign` 当前**无**此 unique，故 M1 对 `Campaign` **仅新增 additive** `@@unique([id, ownerId])`（与 PR #375 对 `ContactIdentity → Contact` 的加固同一 pattern），不改任何既有列/行为（详 §5.6；M1 票须显式列明该 additive 变更） |
| `templateVersionId` | nullable tenant-qualified FK `(templateVersionId, ownerId) → CustomerMessageTemplateVersion(id, ownerId)`；冻结内容；provider-neutral |
| `purpose` | code-validated `marketing / review_request`（proactive；`transactional` 不走 broadcast，R-010 §4.3.2） |
| `status` | code-validated `draft / audience_frozen / confirmed / executing / completed / cancelled / failed`；`executing/completed` 仅 M3 模拟；真实执行在 M6 前不可达 |
| `audienceRevision` | 冻结受众快照的 CAS integer；受众变更须新 revision |
| `revision` | aggregate monotonic CAS；每次 status/audience mutation +1 |
| `creationIdempotencyKey` | **caller-supplied** 稳定 dedup key（house `idempotencyKey` 口径；非 authority/identity 字段，不违 §3.2）；`UNIQUE(ownerId, creationIdempotencyKey)` 使「创建 broadcast run」的重复提交（双击/重放）零重复建 run |
| `frozenAt / confirmedAt / executedAt` | nullable truth timestamps |
| `createdByMembershipId` | tenant-qualified FK `(id, ownerId) → Membership(id, orgId)` |
| `createdAt / updatedAt` | row lifecycle |

约束/索引：`UNIQUE(id, ownerId)`（供 tenant-qualified 引用）；`UNIQUE(ownerId, creationIdempotencyKey)`；index
`(ownerId, status, createdAt, id)`；index `(ownerId, campaignId, createdAt, id)`。`Organization` 加 back-relation；`Membership`
复用 C4b 已建的 `UNIQUE(id, orgId)`；`Campaign` 由 M1 **additive** 补 `UNIQUE(id, ownerId)`（§5.6）。一个 run 是 D5 语义的
exact frozen action：任一 authority/action 变化使旧 confirm 失效（§6.2）。

### §5.3 `BroadcastAudienceMember`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `broadcastRunId` | tenant-qualified FK `(broadcastRunId, ownerId) → BroadcastRun(id, ownerId)` |
| `contactId` | tenant-qualified FK `(contactId, ownerId) → Contact(id, ownerId)` |
| `contactIdentityId` | tenant-qualified FK `(contactIdentityId, ownerId) → ContactIdentity(id, ownerId)`；exact 发送目标 |
| `audienceRevision` | 该成员所属的 run audience revision（冻结快照） |
| `eligibilityVerdictJson` | 冻结时逐轴 verdict 快照：`{ consentStop, doNotDisturb, providerRefusal, frequency, aggregate, evaluatedAt }`，各轴 `{ status, source, reason?, checkedAt }`；**仅展示/审计**，执行时须重读 live authority |
| `verdictHash` | verdict 的 versioned canonical hash（完整性） |
| `includedByMerchant` | boolean；merchant 的受众纳入选择——unknown-permission 成员 flag + keep（`true`），B0-44 |
| `sendState` | code-validated `pending / skipped_ineligible / simulated_sent / send_unavailable`；真实 send 态在 M1–M3 永不出现于此 |
| `skipReason` | nullable 稳定 code：哪条轴 block（merchant-visible 解释）；不含 PII |
| `createdAt` | row insert time |

约束/索引：`UNIQUE(id, ownerId)`；`UNIQUE(ownerId, broadcastRunId, contactIdentityId)`（一 run 内一 identity 一行，
幂等）；index `(ownerId, broadcastRunId, sendState, id)`。冻结 verdict 与执行时重读的关系见 §6.2：快照 PASS **绝不**授权
一次陈旧发送；执行必重读四轴 live authority，任一先行变化使该成员 fail closed。

### §5.4 `ContactSendFrequencyEvent`（频控计数事实）

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `contactId` | tenant-qualified FK `(contactId, ownerId) → Contact(id, ownerId)` |
| `channel` | code-validated provider-neutral channel |
| `purposeClass` | code-validated；当前只 `proactive_non_transactional`（频控只作用于 proactive） |
| `sourceKind` | code-validated `broadcast_run / conversation_reply`（哪个发送层产生该计数） |
| `sendRef` | opaque ref 到产生计数的发送（broadcast member / conversation send）；**不是** receipt |
| `simulated` | boolean；M1–M3 恒 `true`（模拟发送计数）；真实发送仅在 M6 后写 `false` |
| `idempotencyKey` | server-derived stable key，冻结推导为 logical send identity。broadcast 来源 = `freq:<ownerId>:<broadcastRunId>:<contactIdentityId>:<channel>:<purposeClass>`（**排除 `audienceRevision`**，使 CAS 重冻结/重试不双计）。会话来源 = `freq:conv:<ownerId>:<conversationSendId>`，其中 `conversationSendId` = 该次**单条**发送/消息 id——**每条 reply 一个 key，绝不塌缩到 `conversationId`**（否则同一会话内第一条之后的 proactive reply 都被 `UNIQUE` 挡掉、只有首条计数，频控在会话路径被静默绕过，M4 即成真实 bypass）。`UNIQUE(ownerId, idempotencyKey)` 使 retry 零重复计数 |
| `occurredAt` | nullable 声称业务时间，仅展示 |
| `countedAt` | server canonical 时间，用于滚动窗口计数，`Timestamptz(6)` |
| `createdAt` | DB insert time |

约束/索引：`UNIQUE(ownerId, idempotencyKey)`；index `(ownerId, contactId, channel, purposeClass, countedAt, id)`
（滚动窗口计数查询主索引）。**读**（frequency 轴）：`count(rows where ownerId,contactId,channel,purposeClass 命中 且
countedAt > now - windowHours 且 simulated == 本次发送尝试自身的 simulated 值)`；`>= cap → block`，否则 `pass`。

**写时机（exactly-once）**：counter 行只在成员**进入 `simulated_sent`（模拟era）或 reached-provider terminal（真实era）**
的那次 transition 写一行，靠上面冻结的 `idempotencyKey` 保证 exactly-once；`skipped_ineligible` 与 `send_unavailable` 成员
**不写任何行**（未触达即不占频控额）。

**硬上限的原子性【设计选择】**：count-and-insert 必须原子——在一个 transaction 内先取 per-`(ownerId, contactId, channel,
purposeClass)` 的 tenant-qualified scoped lock，再数窗口内行、再 insert（与 `consent-runtime` STOP fan-out 的同一 scoped-lock
锁序，R-010 §4.3.4），而**非**固定 bucket 的 partial-unique key。理由一句话：§5.1 选的是**滚动**窗口，固定 bucket 会破坏
滚动语义且 cap>1 时 slot 分配本身仍竞态；scoped lock 保滚动窗口下两个 distinct 并发发送不双占同一 cap 名额（`idempotencyKey`
只挡同一 logical send 的 retry，挡不住两个 distinct send 抢名额，二者都需要）。

**era filter 真源【设计选择】**：窗口计数按**本次发送尝试自身携带的 `simulated` flag** 过滤（模拟era 尝试只数 simulated
行、真实era 尝试只数真实行），**不**依赖全局 env、也**不**依赖 per-connection 信号。理由一句话：真源必须是这次发送自己的
性质，才能保证上市前模拟测试计数绝不在真实上市日造成幻影频控 block。

### §5.5 频控 config（不 hardcode）

**【设计选择】** 频控窗口/上限落 server-owned config（与 pricing 同规矩：config 模块 + code validator，不散落 literal 到
业务/UI 代码，尊重 Blueprint 的 pricing-in-config 约定），暂名 `SEND_FREQUENCY_POLICY`，形状：

```ts
type SendFrequencyPolicy = Record<string /* channel */, { windowHours: number; maxProactiveSends: number }>;
```

Phase-1 **建议默认**（保守防打扰底线，Founder 可在 config 内调整）：`{ whatsapp: { windowHours: 24, maxProactiveSends: 1 } }`
——即同一 contact 在同一 channel 每 24 小时滚动窗口最多接收 1 条 proactive 发送。理由一句话：频控是防失控自动化与
消息疲劳的安全网，默认从紧，商家/Founder 经 config 放宽，绝不硬编码进产品法。缺该 channel 的 config → frequency 轴
`unavailable` fail closed（不放行）。

### §5.6 为什么不新增其它表

- **不新增合并抑制/blocklist 表**：四轴 authority 复用既有五表 + 新增 frequency 事件；组合只活在 evaluator（origami §6.4）。
- **不新增第二 consent/DND/refusal writer**：写入唯一入口仍是 `consent-runtime`；C5 只 fold-read。
- **不新增 D5 override / manifest / outbox / receipt / confirmation carrier**：external truth 全归 D8/C6（台账 #10）。
- **不新增 provider/quota 表**：`额度预检/掉档横幅` 是 provider messaging-tier 证据的**读**，归 provider capability/C6 层，
  模拟era 恒 `unavailable`（§6.1）；不建 FIKIRTIVE 侧配额表。
- **对 `Campaign` 仅新增 additive `@@unique([id, ownerId])`**（支撑 `BroadcastRun.campaignId` 的复合租户 FK，与 PR #375 对
  `ContactIdentity → Contact` 的加固同一 pattern）——**不改任何既有列/行为**；M1 票须显式列明该 additive 变更。
- **不改** `ConsentEvent`/projection、`ContactDndEvent`、`ProviderRefusalEvent`/state、consent fold、C4b Inbox 六表、
  publishing `Channel`。

## §6 发送闸与 chokepoint

### §6.1 B0-43 发送授权 = 人工逐次/精确批次（同 B0-54 口径）

Otto 可备好受众、文案、逐轴预检，但**每一次正向外发授权都是人工**：逐次（single run）或精确批次（exact batch）。Otto、
preference、全局开关、connector、worker 都不构成外发授权。资格 READ（§4）为 read-only，永不代替这次人工授权。

`额度预检 / 掉档横幅`（B0-43 词汇）是 WhatsApp provider messaging-tier / quality-rating 概念（Meta 侧「每 24h business-
initiated 会话上限」与质量降档），是**读 provider 配额证据**，不是 FIKIRTIVE 花钱闸、不是四条硬轴之一。它归 provider
capability/C6 evidence 层，与 C4a §7.1 的 connection/health 轴同类；模拟era 无 provider → 恒 `unavailable` 并如实显示，
绝不伪造成绿配额，绝不当作发送资格 pass。

### §6.2 群发 chokepoint（C5 自有，形状同 C4 chokepoint）

UI、Otto、connector、job 未来只能进入同一个 C5 自有 `submitBroadcastRun`（**【设计选择】** 落 `apps/web/lib` 的
broadcast service，名对齐 C4 `submitConversationReply`；理由：与 C4 会话 chokepoint 同层同形状，共用 §4 evaluator，
避免第二发送入口）。它不得放在任何 adapter。该 chokepoint 必须在对应 native contract 中依序做到：

1. authenticated owner + Founder-approved action capability + exact `BroadcastRun` + `audienceRevision` + `revision`；
2. D8 manifest / two-confirm carriers 存在且可重放（真实发送时）；
3. 对受众每成员**重读** live 四轴 authority（consent-STOP / DND / provider-refusal / frequency），**不**凭 §5.3 冻结快照发送；
4. 调 §4 evaluator 与 exact approval hard gates；`consentRisk` 成员只有携带并重验 `exactD5TwoConfirmOverride` 才可提交
   （override 归 D8，模拟era 不可铸造）；
5. 原子 enqueue/outbox、stable logical send id、provider idempotency；频控名额按 §5.4 的 scoped-lock **原子 count-and-insert**
   占用，且仅在进入 `simulated_sent`/reached-provider terminal 时 exactly-once 写一行（`skipped_ineligible`/`send_unavailable`
   不写、不占额，模拟era 计模拟）；
6. adapter submission；结果交 C6 receipt/reconciliation，不回写假的 delivery status。

现在 2–6 的真实 carriers/authority 未齐：`submitBroadcastRun` 在 M2 只能返回明确 `SEND_PATH_UNAVAILABLE` 并证明零
provider call。M3 workbench 内的**模拟**执行只对四轴全过成员走模拟 provider（零外部效果、零 spend），计入 frequency
counter（`simulated=true`）；真实发送在 D8/C6/M6 前一律不可达。禁止 UI button、Otto skill、connector 或 worker 另造快捷路径。

### §6.3 C4 会话 chokepoint 调用 C5 gates

C4 的 `submitConversationReply` 仍是**唯一**的会话发送 chokepoint（C4a §6.2）；它 CALL C5 的四轴 gates，不复制、不旁路。
C5 不为会话另造发送入口。`purpose`/`callerClass` 由 C4 chokepoint **server-derive**（§3.2），不接受 client/Otto 自报：
`reactive_service_reply` 只有对**真实存在的 open service window** 校验通过才成立，且该窗口**必须锚定于客户主动的 inbound
event（customer-initiated），绝不能由商家自己发出的消息开启或续期**（R-010 §1，§3.2）；成立时其 consent-STOP 轴才呈
`pass`（独立 send class）、frequency 轴不计（非 proactive）；窗口不成立（含商家自开窗口）或 reply 夹带 proactive element，
就在**资格读之前**重归类为真实 `marketing/review_request` purpose 并进入 D5 two-confirm 与频控（R-010 §4.3.3）。真实会话
发送同样在 D8/C6 前 `SEND_PATH_UNAVAILABLE`。

### §6.4 D5 例外边界（verbatim 承接 C4a §6.2 / R-010 §4.3.3）

> Preflight 不把所有 negative 混成同一种 override：只有 R-010 D5 的 **consent risk** 可在 exact frozen action 上走两次独立
> human confirms，且不改变 consent、不形成 standing waiver；DND、permanent/account provider refusal、frequency、
> operator/role、security、legal/channel prohibition、connection/capability 与 stale action revision 都是不可由 D5 绕过的
> hard block。角色/能力 Unknown 也是 hard block；Otto、connector、job 不能代任何 confirm。

补充（R-010 §4.5 精确语义，本文只如实表达）：`consent risk` 含 `unknown` 与 `effective_revoke` 两态（`consentState !=
verified_grant`）。「商家不可翻转已知退订」= 不能把 `effective_revoke` 改成 grant、不能靠自动/无人确认发送绕过；但获授权
merchant 仍可按 D5 对 exact frozen action 完成两次独立人工确认后**提交一次发送**，consent state 保持 `effective_revoke`
不变（R-010 §4.5 effective_revoke 条 + §2 supersede 第 82 行）。该 override 的**铸造与消费**按 R-010 §4.3.3 归 D8：在
§8 列明的 native carrier/runtime/privacy gates 全部通过前保持 disabled/fail-closed（当前即 `failClosedD5Override()`）。
`effective_revoke` 对 Otto/connector/import/rule/无人确认 background action 永远 hard stop。

## §7 C4 preflight 点亮合同（wiring）

`getConversationPreflight`（`apps/web/lib/customer-inbox-service.ts:628-663`）当前把
`consentStop / doNotDisturb / providerRefusal / frequency` 四轴硬编码为 `{ status: "unknown", source: "c5_not_read_in_m2" }`。
M2 wiring：这四个占位 1:1 替换为 §4 evaluator 对该会话 `(ownerId, contactId, contactIdentityId, channel, purpose,
providerConnectionId, callerClass)` 的四个返回轴（C5 轴是老 `{status, source}` 的**超集**——只加 per-axis `reason?`/`checkedAt`，
见 §4.1；无需改 preflight 的其它轴，兄弟轴不被 C5 触碰）。约束：

- C4 只**读** C5 状态，配置入口链接到各轴 owner（consent/DND/provider-refusal 归 R-010 consent 域，frequency 归 C5），
  **不在 C4 复制 policy**（C4a §7.1 point 4）。
- C4 preflight 的 `sendEligibility` aggregate 仍保持 `{ status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" }`——
  C5 点亮四轴不等于点亮 send path；send 仍由 D8/C6 gate（§4.4）。
- `connection / D9 identity / D8 carrier / member role-capability / exact approval / current revision` 等 C4/D8/D9 自有轴
  不由 C5 触碰。C4 与 broadcast preflight 调**同一** evaluator，保证会话与群发四轴口径一致。

## §8 D8 / C5 / C6 fail-closed matrix（C5 列为本票 scope）

| Surface | C5 可定义/保存 | 未有 native carriers 时必须 disabled / 不得声称 | 最终 owner |
|---|---|---|---|
| 四轴资格 READ | truthful `pass/block/risk/unknown/unavailable` + 逐轴 authority source | 把四轴合成单 boolean / 合并名单；把 `unknown` 当 block 缩名单；伪造 provider-refusal/额度为绿 | C5 |
| consent-STOP 轴 | 只读 `ConsentStateProjection`/fold | 经 C5 写 `ConsentEvent`、把 ordinary reply 当 opt-in、partial STOP fan-out | C5 读 / consent-runtime 写 |
| DND 轴 | 只读 `ContactDndEvent` fold（Contact-wide） | 把 DND clear 当 grant、channel-scoped DND（当前是 Contact-wide） | C5 读 / consent-runtime 写 |
| provider-refusal 轴 | 只读 `ProviderRefusalState`（recipient+account scope） | C5 自写 block、伪造 receiptRef、把 transient 当长期 block、把旧 connection refusal 提升为新 connector 全局 | C5 读 / consent-runtime 写 |
| frequency 轴 | 读新增 counter 的窗口计数；模拟era 计模拟发送 | mutable 单行计数、跨 era 幻影 block、playbook 绕过 | C5 |
| Broadcast run/audience | owner-scoped run header + 冻结受众成员 + 冻结 verdict 快照 + 纳入选择 | automation/schedule/recurrence、真实 send、把冻结 PASS 当执行授权 | C5 |
| Broadcast 发送执行 | M3 内对四轴全过成员的**模拟** provider 执行 + frequency 计数 | 真实 provider send、DeliveryManifest/outbox/worker/receipt、D5 override 铸造 | D8 native task（未分配）+ C6 |
| D5 two-confirm override | 只渲染 two-confirm 流程 UI（M3） | 铸造/消费 `exactD5TwoConfirmOverride`、standing waiver、Otto/connector/job 代确认 | D8 native task（未分配） |
| 发送结果/receipt | C5 不碰 | draft/outbox/simulated-start 画 sent/delivered/read | C6 |
| provider 配额（额度/掉档） | 读 provider capability 证据；模拟era 恒 unavailable | 伪造绿配额、当 FIKIRTIVE 花钱闸、当发送资格 pass | provider/C6 |

D8 hard rule：native contracts 未获批、实现、验证前，所有 dependent confirmation/override/automation/outbox/worker/
retry/receipt/真实 send path 都是 disabled/fail-closed/no availability claim。JSON、cache、`ChannelConnection` row、
request ID、旧确认、standing waiver 都不能替代 authority。

C5 负责「此刻是否允许尝试发送」；C6 负责「provider 实际发生了什么」；D8 负责跨域 D5 `actionId/actionRevision →
two confirmations → eligibility re-read → outbox/worker → provider → reconciliation → ActionReceipt` 的物理/runtime 合同。
本文不静默抢 C6/D8 归属。

## §9 Privacy、security 与 retention gate

### §9.1 已知

- `BroadcastAudienceMember`（含 identity/verdict/skipReason）、`BroadcastRun`（含 template version 引用）、
  `ContactSendFrequencyEvent`（含 contact + sendRef）都可能关联 PII / 商业内容；broadcast 内容经 template version 引用，
  可能含 personalization。
- current B13 scoped PASS **只覆盖** `ConsentEvent`、`ContactDndEvent`、`ProviderRefusalEvent` 及两个 projection，
  **不覆盖本合同三个新 carriers**（与 C4a §9.1 对其六个 carriers 作的同一诚实 caveat 一致）。
- current house policy 是 DB/storage platform-managed encryption at rest + TLS in transit；本提案沿用作候选，不声称已批准
  Broadcast/eligibility privacy。
- raw provider payload/token/secret/签名材料不进 C5 表；`sendRef`/`receiptRef`/`verdictHash`/`skipReason` 只存 opaque
  ref/hash/稳定 code，不塞 raw phone/message/token。`eligibilityVerdictJson` 只存逐轴 status/source/code，不存原始 consent
  evidence 正文。

### §9.2 schema implementation 前必须补齐

B13/privacy 必须逐一给三表新增 row，冻结：source、data class、merchant ownership、read/export/delete、retention、
backup cadence、encryption、日志/telemetry redaction。当前提案建议 Phase-1：

- broadcast run/audience/frequency 事件为 merchant-owned；平台不自动 retention delete/compact；
- Contact/Identity archive 不级联抹掉 broadcast 历史或 frequency 事实（`onDelete: Restrict`）；删除/导出走后续正常 privacy
  capability；
- `eligibilityVerdictJson`/`skipReason` 依 DB at-rest encryption + tenant boundary；不做不可搜索的 ad-hoc field crypto；
- frequency counter 的最终 retention（尤其真实era 后旧行的 terminal 处理）与模拟行 cutover 清理策略仍 Unknown，不在本文冻结；
- production backup/PITR 实际 cadence 仍 Unknown，不能在本文宣称。

Founder 对本文 §4/§5 的方向若批准，也**不等于**上述 B13 rows 已通过；privacy gate 仍在 migration 前独立到期（台账 #13/#15）。

## §10 Migration、activation 与 rollback 提案

所有步骤都是顺序合同，不是当前执行授权：

### M0 — authority/gates（本票）

- Founder 批准本文唯一 schema 方向与四轴读接口边界（台账 #30 的 M0 站）；
- M1 建表另开票取 schema/migration 明确授权；三个 carrier 的 B13/privacy rows 获批（台账 #13/#15）；
- live main、dependencies、claim、branch/worktree/PR 重新查询。

### M1 — additive storage only（另取 schema/migration 授权）

- 新 migration 增三表（`BroadcastRun` / `BroadcastAudienceMember` / `ContactSendFrequencyEvent`）、FK/unique/index、
  `Organization` back-relations，复用 C4b 已建的 `Membership.@@unique([id, orgId])` 与 `Contact/ContactIdentity/
  ChannelScope/CustomerMessageTemplateVersion` 的 `@@unique([id, ownerId(, channel)])`；partial/普通 unique 由 raw SQL 建
  并配 drift test；三表加入 `TENANT_MODELS`，coverage/static migration/rollback tests；
- 不改旧 migration，不开 route、worker、adapter、UI availability、evaluator wiring；所有 send/eligibility path 仍 zero-call。
- **验收**：三表 ownerId coverage、每 relation tenant-qualified、幂等 unique 存在、`TENANT_MODELS` 命中、migrate
  deploy/rollback/Prisma generate 隔离通过。**不做**：evaluator、gates、UI、任何发送（真实或模拟）。

### M2 — eligibility engine + gates + C4 preflight wiring（模拟供应商）

- 实现 §4 evaluator（四轴 fold-read + 两公式 aggregate）与 gateway；C4 `getConversationPreflight` 四轴从
  `c5_not_read_in_m2` → evaluator（§7）；实现 `submitBroadcastRun` 域动作（建/冻结受众/confirm + 冻结 verdict 快照），
  但**执行/发送保持 `SEND_PATH_UNAVAILABLE`**（真实与模拟都不发）；`exactD5TwoConfirmOverride` 保持 `failClosedD5Override()`；
- C5 action-specific capability matrix 与 B13 read access row 先获 Founder 批准；Unknown/default deny；
- fake clock/fixture 完成 evaluator + gate contract tests（含 tenant/幂等/frequency 窗口/provider-refusal scope）。
- **验收**：四轴对既有 projection 如实读；`unknown` 不缩名单；四轴不合并；D5 只覆盖 consent 轴；`submitBroadcastRun`
  恒 `SEND_PATH_UNAVAILABLE` 且零 provider call；C4 preflight 四轴点亮且 aggregate 仍 unavailable。**不做**：真实/模拟发送、
  真实 provider、UI workbench、override 铸造。

### M3 — broadcast workbench UI（模拟发送 + Founder 认证走查，台账 #30）

- 接群发工作台：结构化发起（不靠 chat prompt）、受众确认（unknown flag+keep）、逐轴 preflight reason/time、精确批准流、
  D5 two-confirm UI（流程可见但 override 保持 unavailable）；
- 模拟 provider 执行：对四轴全过成员走模拟发送（零外部效果、零 spend），写 `BroadcastAudienceMember.sendState=
  simulated_sent` 与 `ContactSendFrequencyEvent(simulated=true)`；`consentRisk`/DND/provider-block/超频控成员如实
  `skipped_ineligible` + skipReason；
- honest loading/empty/disconnected/degraded/stale/error 状态；`额度预检/掉档横幅` 恒 unavailable 如实显示；
- **Founder 认证走查**（台账 #30 保留；本地 magic-link 登录）。
- **验收**：模拟群发端到端可恢复；频控在模拟发送上如实触发；四轴 skip reason 可解释；0 跨租户、0 未知缩名单、
  0 未授权/重复发送、0 真实 provider call、0 spend。**不做**：真实 webhook、真实 provider、真实 send、D8 override 铸造。

### M4 — 真实 send integration（最终「连接与上线」阶段，D8/C6/M6，另取 authorization）

- 台账 #28：真实外界连接集中在最终阶段一次执行；台账 #29：WhatsApp 路线为 Meta Tech Provider 直连 + Embedded Signup
  （**非 Gupshup**——C4a spec 的 Gupshup 首实现命名被此 supersede，M4 开票时以 docs PR 更正 C4a）；
- D8 carriers/runtime、`exactD5TwoConfirmOverride` 铸造/消费、C6 receipt/reconcile、通道费 costing（C4a §10 M6 的
  `ChannelFeeWallet/ChannelFeeLedger`，绝不混 credits）全部另获批、实现、验证后，才可把 `submitBroadcastRun` 与
  `submitConversationReply` 的真实 send path 由 `SEND_PATH_UNAVAILABLE` 打开；
- frequency counter 切到真实era：读按 `simulated=false` 过滤（§5.4），模拟测试行经 cutover 清理，绝不抑制真实上市发送；
- B0-89 隐私政策/ToS/数据删除回调、B13、production 迁移（#11/#12）、deploy、exact-head CI + independent review 全绿。

Rollback：

- M1–M3 未接 live send：关闭 feature flag；drop 仍是 destructive migration，须另取 Founder approval；模拟 broadcast/frequency
  测试数据可 keep-forward 或经受控清理，不影响 consent authority；
- M4 起有真实 send：disable 真实 send path 后 keep-forward run/verdict/frequency 事实与 reader；不得回退到无频控/无四轴的
  裸发送；
- 任一步 tenant/idempotency/privacy 不明时只停 affected path，留下可见 reason 与 forward-fix ticket。

## §11 Acceptance 与 adversarial tests

### §11.1 schema/domain（M1）

- 三表 ownerId coverage、每 relation tenant-qualified、`BroadcastRun/AudienceMember/FrequencyEvent` composite/幂等 unique
  存在；`TENANT_MODELS` 命中；migration deploy/rollback/Prisma generate/tenant guard 隔离通过；
- 零新增合并 suppression/blocklist 表/字段/API（静态断言）；`ConsentEvent`/`ContactDndEvent`/`ProviderRefusalEvent`/
  两 projection 与 consent fold 零修改、零第二 writer 引用。

### §11.2 四轴读 / tenant / security（M2）

- consent-STOP 全 3×2 矩阵（§4.2.1）：`verified_grant→pass/pass`；`unknown→risk(merchant_manual)/block(unconfirmed_automatic)`；
  `effective_revoke→block(D5-eligible)/block`；projection/fold **物理读不到→`unavailable`**（两 callerClass 皆 fail closed）；断言
  轴 status `unknown` 绝不用于「consent 解析为无 permission」。D4 STOP 后 `marketing`+`review_request` 双 tuple 均命中；
- **`purpose`/`callerClass` server-derived**：caller/Otto/connector payload 自报 `purpose` 或 `callerClass` 被忽略，一律按 chokepoint
  推导值求值；genuine open-window `reactive_service_reply` → consent 轴 `pass`、frequency 不计；**mislabeled reactive**——一条
  自称 `reactive_service_reply` 但夹带 proactive element（或无 open service window）的 reply，在**资格读之前**被重归类为
  `marketing/review_request`，走 D5 two-confirm + 频控（不得以 reactive 绕开 consent/频控）；
- DND fold `set→block`（Contact-wide，跨 channel/purpose）、无事实/`clear→pass`；DND clear 不产生 grant；
- provider-refusal：`permanent_recipient`/`account_level` active block → block（对应 scope）；`transient` 不 block；旧
  connection refusal 不提升为新 connector 全局；`scopeKey` 由字段重算、caller 不可传；
- frequency：窗口内 `< cap → pass`、`>= cap → block`；缺 config → unavailable fail closed；retry 同 idempotencyKey 零重复计数；
  模拟era 只数 simulated 行，真实era 只数真实行（跨 era 零幻影 block）；
- 两 Org 互换 broadcastRun/audienceMember/frequencyEvent/contact/identity/connection IDs：统一 not-found/denied，零泄漏、
  零写、零 provider call；
- 四轴合并断言：不存在把四轴压成单 boolean 或读一张合并名单的路径；`unknown` 永不使成员被移出受众。

### §11.3 D5 / send gate（M2/M3）

- `submitBroadcastRun` 在 M2 恒 `SEND_PATH_UNAVAILABLE`、零 provider call；`exactD5TwoConfirmOverride` 不可铸造
  （`failClosedD5Override()`）；
- D5 只覆盖 consent 轴：构造 DND/permanent-refusal/account-refusal/超频控/role-unknown/stale-revision 各一，two-confirm
  均**不能**放行；只有 consent risk 在 override 就绪（未来 D8）后才可 exact frozen action 双确认；
- 冻结受众后改 consent/DND/refusal/frequency，执行时重读使旧 confirm 失效、该成员 fail closed（不凭冻结 PASS 发送）；
- **频控并发一名额**：两个同时发起、命中同一 contact 且仅剩一个 cap 名额的发送，经 §5.4 scoped-lock 原子 count-and-insert
  后**恰好一个** `pass`/写一行、另一个 `block`/不写；同一 logical send 的 retry（同 `idempotencyKey`）零新增行、零双计；
  `skipped_ineligible`/`send_unavailable` 成员零 counter 行；**BroadcastRun 创建**双击/重放（同 `creationIdempotencyKey`）零
  重复建 run；
- **同一会话两条 proactive reply**（如两条被重归类为 `marketing` 的 reply）各写**自己的** counter 行（`conversationSendId`
  不同、`idempotencyKey` 不同），第二条可命中 cap → `block`——验证会话路径的 key **不塌缩到 `conversationId`**，频控不被绕过；
- Otto/connector/job 不能代 confirm、不能另造发送入口（静态可达性断言：无第二 send path）。

### §11.4 模拟发送 / UI（M3）

- 模拟群发只对四轴全过成员 `simulated_sent`；consentRisk/DND/provider-block/超频控成员 `skipped_ineligible` + 可解释
  skipReason；每条模拟发送计入 frequency counter（simulated=true），连发同 contact 如实触发频控 block；
- `unknown` 成员 flag + keep（`includedByMerchant=true`）、不被移出；导入不制造 consent；merchant 不能翻转 effective_revoke
  为 grant；
- loading/empty/disconnected/degraded/stale/error 的 desktop/mobile snapshot/interaction tests；`额度预检/掉档横幅` 如实
  unavailable，绝不画绿配额；0 真实 provider call、0 spend、0 money-safety 触发。

### §11.5 C4 wiring / 一致性

- `getConversationPreflight` 四轴由 evaluator 返回、`source` 不再是 `c5_not_read_in_m2`；aggregate 仍
  `SEND_PATH_UNAVAILABLE`；会话与群发调同一 evaluator，四轴口径一致；
- C4 不复制 policy（配置入口链接到轴 owner）；C4/D8/D9 自有轴不被 C5 触碰。

## §12 respond.io comparison anchor（诚实缺口声明）

C4a §12 **刻意排除** Broadcasts；C5 承接它。本 M0 轮**未登录 respond.io workspace、未做文档或实机走查**，因此本文不
捏造 respond.io Broadcast 文档 URL/日期（不同于 C4a §12 已核实的会话/模板文档锚）。冻结如下诚实边界：

- 公开 benchmark 面（Broadcast 发起、受众选择、opt-out/unsubscribe 抑制、send scheduling、messaging-tier 限制）的
  desktop/mobile 真实走查与文档锚**推迟到 M3 workbench 站**（台账 #30 的 Founder 认证走查一并捕获，写入 map D.3）；
- 差异化硬线（不靠 prompt，靠数据/并发 hard rule）：FIKIRTIVE 把四条发送安全轴做成分立 fold-read（非合并名单）、把
  `unknown 不缩名单 / effective_revoke 只可 D5 人工双确认且 state 不变 / 频控统一发送层硬限制` 做成 read/engine 契约、
  把 provider 换成 adapter（Meta Tech Provider 直连，台账 #29）；真实 sent/delivered/read 仍须 C6 evidence，绝不为视觉
  追平而造假；
- C5 的上市地板：四轴分立读、群发工作台（受众确认 + 逐轴 preflight + 精确批准）、频控统一硬限制、D5 边界正确，且
  UI/Otto 双入口同一 actions；模拟era 全绿后进最终「连接与上线」阶段。

（本节的 respond.io 锚缺口在 M3 前须补齐；不得因 M0 未走查而在后续声称已对标。）

## §13 六级状态与 evidence contract

按 `docs/ops/route-b/B0-CONTRACT.md`：

| B0 | 当前 live 状态 | 本 PR（M0 docs-only）合并后 | 后续到期条件 |
|---|---|---|---|
| B0-43 | `listed / absent` | 仍 `listed / absent` | M1 schema + M2 引擎/闸 + M3 模拟工作台 + D8/C6/M6 真实 send 后才 code-complete/verified |
| B0-44 | `listed / absent` | 仍 `listed / absent` | 四轴读 + unknown-不缩名单/导入-不伪造/不翻转退订 tests；写仍归 consent-runtime |
| B0-45 | `listed / absent` | 仍 `listed / absent` | 三轴分立读 + 运行时 fail-closed + provider-refusal 分类 tests |
| B0-46 | `listed / absent` | 仍 `listed / absent` | frequency counter + 窗口/上限 config + playbook-不可绕 tests |

`B0-CONTRACT.md` 当前把 `spec-ready` 绑定「所属块 spec 冻结」。C5 只冻结 B7 的这四行而非整个 B7，因此即使本文经 Founder
方向批准并 merged，也不预支 `spec-ready`；升级须未来 Founder 明确认定 + matrix 写入 exact PR/SHA/benchmark anchor。
PR ready、tests/review、ticket close、mock 或 UI screenshot 都不能单独升级状态。每个后续 head 依 current workflows +
`docs/runbooks/local-ci.md` 重跑适用 jobs、发布 exact-head evidence；独立 cross-family review unresolved P0=0/P1=0；
CI unavailable 不是 green，merge 前另取 Founder 明示批准（台账 #30：M0–M2 CI 全绿 + 双独立审查零 P0/P1 后由
orchestrator 合并，M3 保留 Founder 走查）。

## §14 Gates、Unknowns 与当前决定

### §14.1 后续 Founder-only gates（均不由本文授权）

| 动作 | 何时单独问 |
|---|---|
| schema/migration implementation 或 DB apply（三 carrier） | 对应 M1 issue 首次动作前 |
| B13/privacy rows、retention/encryption/export/delete（三 carrier） | M1 migration 前（台账 #13/#15） |
| C5 tenant RBAC（broadcast creator/approver/org role）与 carrier read access | evaluator/action/UI 启用前；Unknown/default deny |
| D8 native carriers（manifest/two-confirm/outbox/receipt）与 `exactD5TwoConfirmOverride` 铸造 | native issue 建立/实施前，且任何 live send 前必须闭合（台账 #10） |
| C6 receipt/reconciliation | 真实 delivery truth 前 |
| Meta Tech Provider 连接、Embedded Signup、WABA、Meta App Review、真实 template submission、真实 send | 每个对应动作前（台账 #28/#29） |
| 通道费 costing、独立账道（`ChannelFeeWallet/ChannelFeeLedger`）与 money-safety review | 任何会产生 provider cost 的真实 send 前（C4a §10 M6） |
| production/backfill/reconcile/deploy（#11/#12） | 每个 production 动作前 |
| CI-unavailable merge | merge 前；本地复现不替代 Founder approval |

### §14.2 当前 Unknown（不偷偷填）

- 三个 carrier 的最终 retention/export/delete 与模拟行 cutover 清理策略；
- C5 broadcast creator/approver/org-role 的 exact capability matrix；未决期间所有 mutation default deny；
- frequency `windowHours/maxProactiveSends` 的最终 Founder 定值（本文只给保守默认建议 24h/1）；
- 真实 Meta Tech Provider account、Embedded Signup、messaging-tier/quality-rating 真实配额与法律状态；
- WhatsApp 真实 per-message 成本与通道费产品配置（归 C4a §10 M6）；
- production backup/PITR 实际 cadence。

### §14.3 只向 Founder 呈这一题

> **是否批准本文的 C5 方向：一个四轴（consent-STOP / DND / provider-refusal / frequency）分立、provider-neutral 的
> 发送资格 READ 接口（consent-runtime 仍唯一 writer，C5 只加读、不建合并抑制名单）；三个 tenant-qualified、additive-only
> 的 M1 carriers（`BroadcastRun` / `BroadcastAudienceMember` / `ContactSendFrequencyEvent`）；C4 `getConversationPreflight`
> 四轴从 `c5_not_read_in_m2` 点亮为该读接口；以及 B0-43 人工逐次/精确批次发送授权 + C5 自有 broadcast-run chokepoint
> （真实 send 在 D8/C6/M6 前 fail closed）？**
>
> 批准的含义仅是：允许本文在通过 exact-head review 后合并（台账 #30 已一次性授权 C5 四站，M0–M2 CI 全绿 + 双独立审查
> 零 P0/P1 后由 orchestrator 合并，M3 保留 Founder 走查），并允许下一张 M1 issue 以这套 shape 准备 schema/migration
> 实施申请。批准**不授权**修改 Prisma/migration、连接 provider、配置 credentials、Meta submission、花费、真实 live send、
> D8 override 铸造、RBAC、B13/privacy 面、production、deploy 或 CI-unavailable merge。

建议：**批准**。它是满足 B0-43/44/45/46 的最小完整方案——四轴分立、读写分离（consent-runtime 仍唯一 writer）、无合并
抑制名单（origami §6.4）、`unknown` 不缩名单、`effective_revoke` 只可 D5 人工双确认且 state 不变（且 override D8-gated）、
频控统一发送层硬限制、C4 会话与群发共用同一 evaluator 与同一 fail-closed chokepoint 形状，且所有真实 send/override
在 D8/C6/M6 前继续 fail closed。
