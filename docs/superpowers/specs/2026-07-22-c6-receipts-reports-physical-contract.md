# C6 回执 / 对账 / 报告读面 物理合同

> **状态：docs-only PROPOSAL；等待 Founder 对本文回执事实模型方向、拟议 M1 载体形状与报告读面边界作决定。**
>
> 本文只冻结 C6（B0-41/42）的领域、统一回执脊柱（Mandate/Action/ExternalEffect/BusinessEvent/Receipt）的
> provider-neutral 事实模型、模拟era 与真实era 的统一回执契约、对账（reconciliation）收敛规则、owner-scoped 只读
> 报告读面、以及拟议物理载体。本文**不修改 Prisma/schema/migration**，不建任何回执/送达写入器，不连接任何 provider/WABA，
> 不配置凭证，不调用 Meta，不接任何真实 webhook，不写任何真实回执，不花费，不碰钱路，不越 D8 载体，不部署 production。
>
> 证据基线：worktree base `156e770875cabfca805b890bee927a9179e91b8a`（本 worktree 分支 `claude/c6-m0-spec` 的 base）。
> live main 在 M1 首次动作前须重新查询（不预支）。
>
> 连续性与 authority：[#399](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/399) 是本票唯一 authority。
> [#359 台账](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359) 只作后台账证据，不授予实现权：第 10 条=D8 延后载体
> （`DeliveryManifest`/`ActionReceipt`/confirmation-outbox）各自 bounded 票，任何 live send 与 Phase-1 CRM completion 前必须
> 闭合（`#359` 第 10 条）；第 28 条=产品先行、外界最后——**全部剩余产品票（含 C6）以模拟供应商 + 完整 QA/QC 用户流建成，
> 真实外界连接（Meta App Review、生产库迁移 #11/#12、生产部署、B13）集中在最终「连接与上线」阶段一次执行**（`#359` 第 28 条）；
> 第 29 条=WhatsApp 路线为 Meta Tech Provider 直连 + Embedded Signup（**非 Gupshup/360dialog/Twilio**），M4 真实 webhook 属最终
> 阶段（`#359` 第 29 条）；C6 M0 方案站已获 Founder 2026-07-21 预授权（纯文档、零代码、零建表，`#359` 评论「C6 M0 方案站预授权…
> M1 建表起逐站另取授权」）。**与 C5 不同：C6 无「四站一次性授权」——`#399` 明写 M1 建表 / M2 引擎 / M3 界面逐站另取授权**（§10、§14）。
> 上位范围来自 map §8 C6 候选行（`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:205`）、B0-41/42 行
> （`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:106-107`）与 B6 矩阵块（`docs/ops/route-b/matrix/06-B6.md:7-8`）。
> 「读取并验证」只读铁律与「明确交接」契约的冻结上位是 `docs/BLUEPRINT.md:48-49`；「钱路神圣」是 `docs/BLUEPRINT.md:61`。
> 上游发送域已冻结的合同是 C5（`docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md`）与 C4a
> （`docs/superpowers/specs/2026-07-19-c4a-inbox-whatsapp-physical-contract.md`）。

## §1 一句话结果

C6 只承接**发送之后实际发生了什么**：把 provider 送达/已读/失败/回复这些**外部事实**，按统一回执脊柱
（Mandate/Action/ExternalEffect/BusinessEvent/Receipt）规范成 owner-scoped、provider-neutral 的**只读**回执事实，做**对账**
（把「我尝试发了什么」与「provider 说发生了什么」收敛），并对商家呈一个只读**报告读面**（发出/送达/已读/失败/回复率）。
C6 **绝不复制 C5 的发送 policy、绝不成为第二个发送入口、绝不回写假的 delivery status、绝不代管或自建商家账本、
绝不碰钱路、绝不越 D8 的发送侧载体**（`docs/BLUEPRINT.md:48`、`docs/BLUEPRINT.md:61`；C5 §2.2、C5 §8）。分界一句话：
**C5 = 「此刻能否尝试发送」，C6 = 「发送之后实际发生了什么」**（C5 §8 第 511 行原文）。在真实 provider webhook（C4a §4 adapter
seam，M4）与 D8 发送侧 ExternalEffect/ActionReceipt 绑定（`#359` 第 10 条）齐备并验证前，**没有任何真实 delivery 事实存在**；
模拟供应商时代（`#359` 第 28 条）的回执读一律如实呈现「已模拟尝试（simulated），送达/已读/失败=unknown」，**绝不伪造成绿**。

## §2 Authority、范围与不做

### §2.1 C6 只承接两行

| B0 | 本合同承接 | 验收边界 |
|---|---|---|
| B0-41 | 统一回执/报告脊柱（Mandate/Action/ExternalEffect/BusinessEvent/Receipt；发送、送达、失败、回复可追溯）+ 对账 + owner-scoped 只读报告读面 | 只读回执事实；`0 假回执`（map D.4，`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:85`）；unknown 不伪装成 delivered |
| B0-42 | 统一 commerce/POS/CRM **只读** connector seam（订单/顾客/交易/积分；webhook + reconciliation）的领域边界与 seam 形状；EasyStore 为可选首批 adapter 之一 | 只读；永不代管、永不自建账本（`docs/BLUEPRINT.md:48`）；零 connector 不阻塞 CRM 核心（`docs/ops/route-b/matrix/06-B6.md:8`）；物理载体是**独立 Founder-gated 决定**（§7.5、§14） |

### §2.2 明确不吸收

- **C5 发送资格 / 四轴 policy**：consent-STOP / DND / provider-refusal / frequency 四轴、发送闸、频控计数、broadcast-run chokepoint
  全归 C5（C5 §3–§8）。C6 只**读** C5 已冻结的发送侧事实（`BroadcastAudienceMember.sendState`、`skipReason`、
  `ContactSendFrequencyEvent`）作报告，**绝不复制、绝不重算 eligibility、绝不据四轴作任何发送决定**（C6 是发送**之后**的域）。
- **第二发送入口**：C6 不建、不暴露任何 send/enqueue/outbox/retry/confirm 路径。会话发送唯一 chokepoint 仍是 C4
  `submitConversationReply`（C4a §6.2），群发唯一 chokepoint 仍是 C5 `submitBroadcastRun`（C5 §6.2）；二者「结果交 C6
  receipt/reconciliation，**不回写假的 delivery status**」（C5 §6.2 第 447 行、C4a §6.2 第 431 行）。C6 只**读入**它们产生的事实。
- **D8 发送侧运行时载体**：`DeliveryManifest`、confirmation-outbox、worker、lock/retry、`ActionReceipt`（发送侧运行时回执产物）、
  两次确认铸造/消费、`actionId/actionRevision → outbox/worker → provider` 全归 D8 各自 native task（`#359` 第 10 条；C5 §8、
  C4a §8）。C6 只承接**入站 provider 事实**（送达/已读/失败/回复）与**对账读**，靠 D8 送发侧提供的 `provider-message-ref ↔
  logical-send` 绑定来 join；D8 载体未落地前，真实回执 ingestion 不可用（§4.4、§5、§8）。
- **钱路 / 账本**：C6 无 credits、无 ledger、无 money-safety 触发。「读取并验证」经营事实是**只读、类比 pixel tracking，永不代管、
  永不自建商家账本**（`docs/BLUEPRINT.md:48`）；真实通道费计价归 C4a §10 M6 的 `ChannelFeeWallet/ChannelFeeLedger`，不在本文。
- **归因 / 追踪原语（E5-06/07、D10）**：TrackedLink/QrAsset/AttributionEvent 六原语与短链 redirect 是 **B2 数据层**（已
  `spec-ready`，`docs/ops/route-b/matrix/02-B2.md:15-16`），其报告消费端**汇入** B0-41 报告面，但**本 M0 不冻结它们**；D10
  tracked-generation 逐 path bounded contract 归 R-010 §11.2 gate 5（`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:205`）。
  「回复率」等**把回复/转化归因到某次具体群发**的能力依赖该归因层，本文只如实呈可得口径、把精确归因列为 deferred（§6.4、§14）。
  （map §8 C6 候选行含 E5-06/07，但 `#399` scope 只列 B0-41/42；本文据此**裁定**：归因/追踪原语归 B2 层（已 spec-ready）与 D10
  bounded contract、**不在 C6-M0**——此边界**已决**，非悬而未决的张力。§14 只保留「回复率口径」这一更窄的 Founder 问题。）
- **真实外界**：Meta Cloud API/Tech Provider 连接、Embedded Signup、WABA 凭证、Meta App Review、真实 webhook endpoint、
  真实 delivery/read/failure 事实、生产库迁移（`#11/#12`）、B13 privacy、production/deploy——全部集中到最终「连接与上线」阶段
  （`#359` 第 28/29 条）；本文零 provider call、零 spend、零真实回执。

### §2.3 当前事实（已 live main `156e7708`）

- **发送侧载体已 live（C5-M1，PR #385）**：`BroadcastRun` / `BroadcastAudienceMember` / `ContactSendFrequencyEvent` 三表在
  live schema（`packages/db/prisma/schema.prisma:1654-1744`）。`BroadcastAudienceMember.sendState ∈ {pending,
  skipped_ineligible, simulated_sent, send_unavailable}`（`:1711`），`skipReason`（哪条轴 block，`:1712`），
  `ContactSendFrequencyEvent.simulated`（M1–M3 恒 true，`:1736`）与 `sendRef`（opaque ref 到产生计数的发送，`:1735`）。
  **这些就是 C6 报告读面的发送侧只读上游**；发送执行仍是模拟（C5 §6.2），真实发送在 D8/C6/M6 前 `SEND_PATH_UNAVAILABLE`。
- **会话侧载体已 live（C4b-M1）**：`CustomerMessage`（`:1399`）是规范化会话历史；`direction=outbound` 的 writer 在 D8/C5/C6
  gate 前 disabled（C4a §5.3）；`CustomerMessage` 行**不等于** provider receipt，「没有 C6 provider evidence 时 UI 不得显示
  sent/delivered/read」（C4a §3.1 第 62-63 行、CONTEXT.md `Customer message` 条）。
- **不存在任何回执事实**：production 没有任何 `MessageDeliveryEvent`/delivery-state/回执脊柱表、没有 provider adapter、
  没有 webhook endpoint、没有 commerce connector。所有 delivery/read/failure/replied 事实当前恒 **unknown**（无真源，如实缺席）。
- **入站事实路由已由 C4a 冻结**：C4a §4.1 fact routing 表已把 `delivery_changed`/provider failure → 「receipt/reconciliation
  spine | C6」、`template_review_changed` → 「C6 receipt writer；C4 只消费其 verified projection」（C4a §4.1 第 135/138 行）。
  **本文即定义 C6 侧承接这些 verified fact 的物理契约**（adapter 验签/规范化本身仍是 C4a §4 的 provider-neutral port，M4 才接真实 provider）。

## §3 领域边界与不变量

### §3.1 固定词义

1. **回执（receipt）**：对「一次已尝试的发送，provider 实际发生了什么」的**只读、经核验**的事实记录。回执**不是**本地消息行、
   不是 draft、不是 outbox start、不是模拟发送态；本地任何这些状态**都不构成** delivery truth（C4a §3.1 第 62-63 行、
   C4a §8 第 513 行）。回执按统一脊柱分层持有（§4.1），永不代管商家账本（`docs/BLUEPRINT.md:48`）。
2. **回执脊柱五层（Mandate/Action/ExternalEffect/BusinessEvent/Receipt）**（map B0-41，`docs/ops/route-b/matrix/06-B6.md:7`）：
   `Mandate`=发送授权/D5 两次确认（D8/C5，本文不建）；`Action`=exact frozen action（`BroadcastRun` / 会话回复，C5/C4，已 live）；
   `ExternalEffect`=对 provider 的一次尝试及其 ack 生命周期（发送侧 outbox/worker 产物，**D8** 持有，本文不建，C6 只**观察**其 ack）；
   `BusinessEvent`=规范化的**入站** provider 事实（送达/已读/失败/回复；或 commerce 订单/付款）——**C6 承接**；
   `Receipt`=把 Action↔ExternalEffect↔BusinessEvent 收敛后的**对账真相**记录——**C6 承接**。C6-M0 只新增 `BusinessEvent` 与
   `Receipt` 两层的 messaging 物理载体（§7），发送侧三层引用既有 C5/C4/D8 authority，绝不重建。
3. **送达真相（delivery truth）**：`BusinessEvent` 层里 messaging 的规范化生命周期事实：`accepted`（provider 收下）→
   `delivered`（送达）→ `read`（已读）；终态失败 `failed`；无事实时 `unknown`。它只能来自**真实 provider webhook/reconcile**
   （C4a §4，M4+）；模拟era 无任何送达真相，一律 `unknown`（§4.3）。
4. **对账（reconciliation）**：把「发送记录（Action + 发送侧 ExternalEffect 声称尝试了 send X）」与「回执（BusinessEvent 说 X
   发生了 Y）」按稳定 `logical-send ref` 收敛成一个 per-send 的 `MessageDeliveryState`，并给出 `converged / pending /
   conflict / timeout_unknown` 处置。对账**永不**把「超时未回执」当成 delivered，也**永不**盲重投（C4a §4.2 第 167/169 行）。
5. **报告读面（report read surface）**：owner-scoped、只读的聚合读——发出 / 送达 / 已读 / 失败 / 回复率，逐项标注其 authority
   与 freshness，`unknown` 如实呈现、绝不补零冒充完成。报告面是**人工可完整操作**的读面（`docs/BLUEPRINT.md:66`：founder 否决
   「报表引擎由 Otto 替代」，人工面是卖 seats 的根），Otto read 对等（不做瞎子操作员，`docs/BLUEPRINT.md:69`）。
6. **logical-send ref（逻辑发送标识）**：由发送侧 chokepoint 铸造的、per-一次单条发送 的稳定 opaque 标识（群发=某 audience
   member 的发送；会话=某单条 outbound message 的发送），与 `ContactSendFrequencyEvent.sendRef`（`packages/db/prisma/
   schema.prisma:1735`）同一口径。C6 的回执与对账**只按此 ref join**，caller 不可传、不可覆盖（真实事实的 ref 由 provider-message-ref
   经 D8 发送侧绑定 server-resolve，§4.4）。
7. **只读 connector seam（B0-42）**：对经营事实（订单/交易/积分等）的**只读**接入缝——provider 可替换、零 connector 不阻塞
   CRM 核心（`docs/ops/route-b/matrix/06-B6.md:8`）；类比 pixel tracking，**永不代管、永不自建账本、绝不成为收款/开票/催收系统**
   （`docs/BLUEPRINT.md:48-49`）。

这些词同时写入根目录 `CONTEXT.md` 的「Customer engagement 顾客互动」段。代码/UI/API 必须显式使用这些词义；
`账本 / ledger / 代管 / 收款 / fake receipt / 假回执` 只作被禁止的反面词出现。

### §3.2 核心不变量

- **`ownerId` 只从 authenticated session、verified server route 或验签后的 channel account claim 得到**；浏览器、Otto 参数、
  connector payload、webhook body 都不能提交或覆盖。每个 owner-scoped relation tenant-qualified；新 owner models 出生即登记
  `TENANT_MODELS`。每一次回执/对账/报告查询都在 authenticated `ownerId` 边界内（§9）。
- **C6 只读 C5/C4/D8 状态，不复制其 policy**（同 C4a §7.1 point 4 对 C5 的约束）：报告读面链接到各事实 owner（发送态/skipReason
  归 C5、送达真相归 C6、连接健康归 provider/adapter），配置入口指向 owner，**不在 C6 复制发送资格或频控 policy**。
- **回执是入站事实的投影，不是本地宣称**：C6 的 delivery truth **只能**来自真实 provider verified fact（C4a §4 port）。draft、
  outbox start、worker start、`simulated_sent`、本地 approval 都**不生成 delivery receipt**（C4a §11.5 第 665 行）。任何经 C6
  路径把本地态**写成** delivered/read/failed 即 **P0**（伪造回执，违 map D.4「0 假回执」）。
- **unknown 不伪装（no optimistic green）**：缺回执、缺 provider capability、缺 reconcile cursor、超时未回执一律 `unknown`/
  `unavailable` 并如实标出，**绝不**补成 delivered、绝不补零冒充「全部送达」。模拟era 的 delivered/read/failed 恒 `unknown`——
  这是如实的，不是漏读（§4.3、§6.3）。
- **回执 append-only、幂等、乱序不倒退**：真实era 回执按 versioned canonicalization 的 server-derived `sourceEventKey`/hash 幂等
  写入（同 key 同 hash = no-op replay；同 key 不同 hash = 冲突零覆盖）；规范顺序以 server `receivedAt` + stable id 决定，迟到事件
  **不倒写**较新 state（C4a §4.2 第 157/164 行）；生命周期单调（`accepted→delivered→read` 只进不退，`failed` 终态），
  `delivered` 与 `failed` 对同一 send 的**冲突**进 `conflict` 处置并如实呈现，**不静默择一**（§4.4、§5）。
- **超时/丢失 = unknown + reconciliation-needed**：任何已尝试的 external effect 若 provider response 丢失/超时，只进
  `timeout_unknown`，**不宣称成功、不盲重投**（C4a §4.2 第 167/169 行）。
- **内容 vs 元数据分离**：回执/对账/报告表只存 opaque ref/hash/稳定 code 与规范化 delivery/read/failed 状态，**绝不**塞 raw
  provider payload、message body、phone、token、签名材料（同 R-010 §4.5.1 `receiptRef` opaque 口径、C4a §9.1）。消息正文仍住
  `CustomerMessage`/template version，回执只以 opaque ref 指向它。
- **只读铁律（B0-42）**：commerce connector 是**只读**接入；C6 不写回商家系统、不代管资金、不自建账本、不成为第二收款/开票/
  催收系统（`docs/BLUEPRINT.md:48-49`）。零 connector 时 CRM 核心（含 B0-41 报告面的发送侧读）必须完整可用。
- **missing/degraded fail closed**：缺 projection、缺 provider capability/health、缺 authority、缺 D8 绑定一律 fail closed
  （标 unknown/unavailable + 禁用受影响 external action），绝不拼一个乐观的绿。

## §4 回执事实模型（C6 核心）

### §4.1 五层脊柱与逐层 authority

C6-M0 冻结统一回执脊柱的**逐层 authority 边界**，只新增底部两层的 messaging 物理载体：

| 层 | 语义 | authority owner | 本文是否新建 |
|---|---|---|---|
| **Mandate** | 发送授权 / D5 两次确认 / exact frozen action 的资格 | C5 四轴 + D8 two-confirm override（C5 §4/§6.4） | 否（只引用） |
| **Action** | exact frozen action（`BroadcastRun` / 会话回复） | C5 `BroadcastRun`（已 live）/ C4 会话回复 | 否（只引用 `logical-send ref`） |
| **ExternalEffect** | 对 provider 的一次尝试及其 ack（outbox/worker/provider-message-ref） | **D8** 发送侧 native task（`#359` 第 10 条） | 否（C6 只观察其 ack，靠 `provider-message-ref ↔ logical-send` 绑定 join） |
| **BusinessEvent** | 规范化**入站** provider 事实：messaging 送达/已读/失败/回复；commerce 订单/付款 | **C6**（本文） | 是（messaging：§7.2 `MessageDeliveryEvent`；commerce：§7.5 seam，Founder-gated） |
| **Receipt** | Action↔ExternalEffect↔BusinessEvent 收敛后的对账真相 | **C6**（本文） | 是（messaging：§7.3 `MessageDeliveryState` reconciled 投影） |

因此 C6 的对外承接面 = **入站 BusinessEvent 的幂等 ingestion + 对账收敛读 + 只读报告读面**，三者都不新增任何发送/outbox/worker
路径（那些是 D8），也不重建 Action/Mandate（那些是 C5/C4）。

### §4.2 回执读结果形状（语义合同，不是本票代码授权）

```ts
// messaging delivery lifecycle：只进不退（accepted→delivered→read），failed 终态，unknown 无真源
type DeliveryLifecycle = "unknown" | "accepted" | "delivered" | "read" | "failed";

// 对账处置：send-record 与回执的收敛结果
type ReconciliationStatus =
  | "converged"        // send 记录与 provider 事实一致收敛
  | "pending"          // 已尝试、尚未有终态回执（真实era 正常在途）
  | "conflict"         // 同一 send 出现互斥终态（如 delivered 与 failed），如实呈现，不静默择一
  | "timeout_unknown"; // 已尝试但 response 丢失/超时；不宣称成功、不盲重投

interface DeliveryReceiptView {
  logicalSendRef: string;          // server-resolved；caller 不可传
  channel: string;                 // provider-neutral
  lifecycle: DeliveryLifecycle;    // 送达真相；模拟era 恒 "unknown"
  reconciliation: ReconciliationStatus;
  simulatedAttempt: boolean;       // 本次发送尝试是否模拟（读自发送侧 send 记录）
  lastProviderEventAt: string | null;  // 分开返回，缺值即 unknown（C4a §7.3）
  lastReconciledAt: string | null;
  reason?: string;                 // 稳定 merchant-visible code；不含 PII/raw payload
}
```

**形状纪律**：`lifecycle` 与 `reconciliation` 是两个正交轴，**不得**合成单一「已发送/已送达」布尔（正如 C5 四轴不得合并）。
`lastProviderEventAt / lastReconciledAt / lastDataLoadedAt` 分开返回，缺值是诚实 unknown，**绝不**拼成一个假的 `lastSyncedAt`
（C4a §7.3 第 497 行）。

### §4.3 模拟era 回执语义（`#359` 第 28 条）

模拟供应商时代（M1–M3）**没有任何真实 provider 事实**。回执读对一个 `sendState=simulated_sent` 的成员如实返回：

- `simulatedAttempt = true`（读自 `BroadcastAudienceMember.sendState` / `ContactSendFrequencyEvent.simulated`）；
- `lifecycle = "unknown"`（**无送达真相**——模拟发送零外部效果，绝不产出 `delivered`/`read`/`failed`）；
- `reconciliation = "pending"`（如实：已模拟尝试、无真源回执可收敛）；
- `lastProviderEventAt = null`。

**【设计选择】** 模拟era 的「模拟回执」是一个**只读投影**，从发送侧 `sendState` 派生，**不写任何 `MessageDeliveryEvent` 行**。
理由一句话：模拟发送没有 provider 事实，写一条「模拟回执」行有被误读为送达真相的风险；把它做成「尝试态已知 + 送达真相
unknown」的纯读投影，才能既满足「如实标 simulated」又满足「绝不伪造 delivery 真相」（`#399` scope 第 1 条）。`MessageDeliveryEvent`
载体在 M1 建表但**在真实era（M4）前保持空**——这是如实的空态，报告据此如实呈现 delivered/read/failed = unknown（§6.3）。
（对照：C5 `ContactSendFrequencyEvent` 需要在模拟era 写行是因为**频控必须计模拟发送**以验证防打扰；回执**没有**任何必须在模拟era
落库的真相，故不写——两者差异是刻意的，见 §11.2。）

### §4.4 真实era webhook ingestion 约束（M4+，只定契约，不实现）

真实 provider delivery/read/failure/reply 事实经 **C4a §4 的 provider-neutral adapter port** 进入：adapter
`verifyAndNormalizeWebhook` 验签并规范化，产出 closed fact union 里的 `delivery_changed`/provider failure，按 C4a §4.1 路由到
「receipt/reconciliation spine | C6」（C4a §4.1 第 138 行）。C6 侧 ingestion 的物理契约（与 C4a §4.2 inbound 同纪律）：

1. **owner/scope 解析**：只在 adapter 验签成功后，从 verified account claim 找唯一 `ChannelConnection`/`ChannelScope`；
   zero/multiple/mismatch 拒绝、零产品写、不泄漏 tenant 是否存在（C4a §4.2 第 148-149 行）。webhook 是「收信与授权回执」，
   合宪（`docs/BLUEPRINT.md:85`），但真实 endpoint/secret/mapping 须动作前另取 Founder authorization。
2. **logical-send 绑定（tenant-consistent）**：delivery 事实携带的 `provider-message-ref` 必须经**发送侧 D8 ExternalEffect/ActionReceipt
   的 `provider-message-ref ↔ logical-send` 绑定**解析为 C6 的 `logicalSendRef`；该绑定归 D8（`#359` 第 10 条）。**绑定解析必须在
   step 1 已 verified 的 owner 边界内完成**：解析出的 `logicalSendRef`（及其发送侧 run/identity/connection）其 `ownerId` 必须**恒等于**
   step 1 验签所得的 owner；**cross-owner 或 ambiguous（zero/multiple）解析一律 reject、fail closed、零产品写、不泄漏 tenant 是否
   存在**——这是租户不变量在 ingestion **写路径**的点名落点，不靠 §3.2 泛化兜底。**D8 绑定未落地前，真实回执 ingestion 不可用**
   （fail closed）——无法把一条 provider 事实安全归到某次 send。caller/webhook 不可自报 `logicalSendRef`。
3. **幂等**：每个 normalized fact 各持含 `eventKind` 的 namespaced server-derived `sourceEventKey`/`sourcePayloadHash`；同 key 同
   hash = no-op replay，同 key 不同 hash = 冲突零覆盖零第二行（C4a §4.2 第 157 行）。不得拿整包 request ID 让一事实替另一事实去重。
4. **乱序**：provider `occurredAt` 只展示；规范顺序以 server `receivedAt` + stable id 决定；迟到事件**不倒写**较新 state
   （C4a §4.2 第 164 行）。生命周期单调：一条迟到的 `accepted` 不得把已 `delivered`/`read` 的 state 回退。
5. **冲突**：同一 `logicalSendRef` 收到互斥终态（`delivered` 之后又 `failed`，或反之）→ `reconciliation=conflict`，
   如实呈现并留可见 reason，**不静默择一、不假装成功**。**M2 lifecycle 投影占位规则**：`lifecycle` 保持已单调达到的值**不动**
   （不因冲突事实回退、也不擅自跳到冲突事实的终态），冲突这一事实**只由 `reconciliation=conflict` 轴呈现**、不污染 lifecycle 轴；
   `delivered/failed` 的**终态择定规则**仍留 §14 待 Founder。（此占位让 §11.2 fixture 断言有据：冲突下 lifecycle 稳定、conflict 轴点亮。）
6. **超时/丢失**：已尝试但 provider response 丢失/超时 → `reconciliation=timeout_unknown` + reconciliation-needed；
   **不宣称 delivered、不盲重投**（C4a §4.2 第 167/169 行）。重投属发送侧 D8/outbox，不是 C6 对账动作。
7. **未识别事实**：不明 provider 事实只进**已获批 quarantine/可重放载体**，不写产品回执真相（C4a §4.2 第 171 行）；该 quarantine
   的 privacy/ownership 合同冻结前，整个真实 endpoint 关闭。
8. **template-review 外部事实**（C4a §4.1 路由到「C6 receipt writer」，第 135 行）：Meta 模板送审 approved/rejected 亦是 C6
   承接的入站 provider 事实，materialize 后**投影回 C4 模板三轴**（C4a §5.6）。其物理载体是与 `MessageDeliveryEvent` 共用同一
   脊柱还是独立 bounded carrier，列为待 Founder（§14）——本 M0 只固定「C6 owns 它、C4 只消费其 verified projection」这条边界。
   **显式调和义务**：该后置载体决定**必须调和** C4a §5.6（`reviewRevision` 只由 C6 verified receipt materializer 推进）与 §7.6
   的「不改 C4b 六表」——「不改」指**不改 C4b 表的 schema/列/既有行为**；C6 materializer 依 C4a §5.6 已冻结契约把 verified
   projection 值写入既有 `CustomerMessageTemplateVersion` 字段，是**该契约下的数据推进**、非 schema 变更；exact writer 边界
   （C6 直接推进 vs C4 从 C6 verified fact 自推）是待 Founder 决定的一部分（§14），本文不静默裁定。

## §5 对账（reconciliation）

对账把 §4.1 的 Action / ExternalEffect / BusinessEvent 三源按 `logicalSendRef` 收敛成一个 per-send 的 `MessageDeliveryState`
（§7.3），并给 `ReconciliationStatus`。规则：

- **收敛口径**：以 `logicalSendRef` 为 join key（发送侧铸造、C6 只读）。真实era 里 provider 事实经 §4.4 step 2 的 D8 绑定归到
  该 ref；`MessageDeliveryState` 取该 ref 下**最新 server-canonical** 且**单调不退**的生命周期作为当前送达真相。
- **在途诚实态**：已尝试（发送侧记录存在）但尚无终态回执 → `pending`（真实era 正常在途）；模拟era 恒 `pending`（无真源，§4.3）。
- **超时未回执的诚实态**：已尝试、response 丢失/超时且超过 server freshness 阈值 → `timeout_unknown`（**不是** delivered、
  **不是** failed）；报告如实呈 unknown，人工可见 reconciliation-needed，绝不静默补成 delivered（§3.2、C4a §4.2 第 167 行）。
- **冲突态**：互斥终态 → `conflict`，如实呈现，终态择定须人工/Founder-gated 规则（§14），**绝不**代码静默择一。
- **fail-closed 缺省**：缺 D8 绑定、缺 provider capability、缺 reconcile cursor、authority 读不到一律 fail closed
  （`unknown`/`unavailable`，不放行任何「已送达」呈现）。
- **不盲重投、不本地猜测、不假成功**（C4a §8 第 514 行 Reconciliation 行：`blind retry / local guess / fake success` 三禁）。
  重投是发送侧 D8/outbox 的动作；C6 对账只**读并如实标注**，不触发发送。

对账是**读**：它产出 `MessageDeliveryState`（rebuildable 投影，§7.3），不写任何发送、不改任何 C5/C4 事实。

## §6 报告读面（owner-scoped 只读聚合）

### §6.1 读面轴与 authority

报告面对一次群发 / 一个 Campaign / 一个联系人时间线，呈**三组正交轴**（A 发送侧 / B 回执侧 / C 对账侧）、逐项标注 authority
与 freshness 的只读聚合，**三组不得跨组合并**：

| 组 | 读数 | 定义 | authority 源 | 模拟era 可得性 |
|---|---|---|---|---|
| A 发送侧 | **发出（attempted）** | 进入发送尝试的成员数 | C5 `BroadcastAudienceMember.sendState ∈ {simulated_sent}`（真实era：reached-provider） | **已知**（模拟尝试） |
| A 发送侧 | **待执行（pending）** | 尚未进入发送尝试的成员数（run 中断/部分执行的余量——分母不漏） | C5 `sendState=pending`（`schema.prisma:1711`） | **已知**（读 C5） |
| A 发送侧 | **跳过（skipped）** | 因资格 block 未发的成员数 + 逐轴 skipReason | C5 `sendState=skipped_ineligible` + `skipReason`（`schema.prisma:1711-1712`） | **已知**（读 C5） |
| A 发送侧 | **不可用（unavailable）** | send path 不可达的成员数 | C5 `sendState=send_unavailable` | **已知**（读 C5） |
| B 回执侧 | **送达（delivered）** | `reconciliation=converged` 且 lifecycle 达 `delivered` 的 send 净数 | C6 `MessageDeliveryState` | **unknown**（无真源，§4.3） |
| B 回执侧 | **已读（read）** | `reconciliation=converged` 且 lifecycle 达 `read` 的 send 净数 | C6 `MessageDeliveryState` | **unknown** |
| B 回执侧 | **失败（failed）** | `reconciliation=converged` 且 lifecycle 达 `failed` 的 send 净数 | C6 `MessageDeliveryState` | **unknown** |
| C 对账侧 | **对账在途（pending）** | 已尝试、尚无终态回执的 send 数 | C6 `MessageDeliveryState.reconciliation=pending` | **已知**（模拟era 全部已尝试 send 恒在此） |
| C 对账侧 | **对账冲突（conflict）** | 收到互斥终态、未决的 send 数 | C6 `reconciliation=conflict` | 0（无真源） |
| C 对账侧 | **对账超时未决（timeout_unknown）** | 已尝试但 response 丢失/超时的 send 数 | C6 `reconciliation=timeout_unknown` | 0（无真源） |
| — | **回复率（reply rate）** | 回复量 / 基数 | 依归因层（E5-06/07、D10）；C6 只呈可得会话级口径 | **deferred**（§6.4） |

**净数封死（防洗绿）**：B 组的 delivered/read/failed **只**数 `reconciliation=converged` 的 send；**`conflict` 与 `timeout_unknown`
的 send 绝不计入 delivered/read/failed 任何净数**——它们**只**出现在 C 组对账轴。这正是本契约要在逐 send 层封死、绝不让冲突/超时
在聚合层被洗成绿的事（呼应 §4.2「lifecycle 与 reconciliation 两轴不得合并」）。A、B、C 三组各自求和、各自展示；报告 UI 不得把
三组压成单一「成功率」数字掩盖 unknown/conflict/timeout。

报告面是**纯读**：聚合查询跨 C5 发送侧表 + C6 `MessageDeliveryState` + C4 会话回复，不写任何表、不重算 eligibility、
不触发任何发送。

### §6.2 与 C5 四轴 / 频控计数的权威边界

- **C5 = 能否发（发送前）；C6 = 发生了什么（发送后）**——报告的「跳过（by axis）」读自 C5 冻结的 `skipReason`（发送**前**的资格
  结果），**与**「发出但未送达」（C6 回执真相，发送**后**）是两码事，报告必须分列、**绝不混为一谈**。C6 不重算四轴、不据四轴作任何判定。
- **频控计数只作上下文**：`ContactSendFrequencyEvent` 计的是「已计入频控额的模拟发送数」（C5 §5.4），报告可呈作上下文，但它
  **不是** delivery truth——一条计入频控的模拟发送其 delivered 仍 unknown。报告不得把频控计数当送达数。
- **不复制 policy**：报告配置入口链接到各 owner（资格/频控 → C5，送达真相 → C6，连接健康 → provider/adapter），不在 C6 复制
  发送资格或频控 policy（同 C4a §7.1 对 C5 的边界）。

### §6.3 页面状态（必须区分，同 C4a §7.2）

`loading / empty / disconnected / degraded / stale / partial-error / error / ready` 逐块如实标注；
**尤其**：模拟era 的 `delivered/read/failed` 呈 `unknown/unavailable`（而非 `0` 冒充「全部未送达/全部送达」），并明确标注
「模拟供应商时代 · 无真实送达数据」。`额度/掉档/messaging-tier` 等需 live provider capability 的读恒 `unavailable` 如实显示
（同 C5 §6.1），绝不画绿。

### §6.4 回复率与归因（deferred，诚实边界）

把「顾客回复/转化」精确归因到「某一次群发」需要归因层（TrackedLink/AttributionEvent，E5-06/07，B2 层；D10 tracked-generation
逐 path bounded contract，R-010 §11.2 gate 5）。本 M0 **不冻结**归因；C6 报告面可呈**会话级**回复活动（读 C4 `CustomerMessage`
inbound），但「回复率归因到具体 broadcast」的精确口径 **deferred**，列为待 Founder（§14）。绝不因 M0 未接归因而在报告里编造回复归因。

## §7 拟议物理合同（M1 preview — 全部标 PROPOSED；M1 另开票取 schema/migration 授权）

### §7.1 总览

本提案是 M1 的 additive-only package：新增**两个** owner-scoped messaging 回执载体，全部沿用 C4b-M1/C5-M1 约定（每表 `ownerId`
出生即有、`Organization` 加 back-relation、composite tenant FK、`@@unique([ownerId, ...])` 幂等、closed taxonomy 存 String +
code validator、historical relation `onDelete: Restrict`、partial unique 由 migration raw SQL 建并配 drift test、加入
`TENANT_MODELS`）。**不建任何 outbox/worker/ActionReceipt/发送路径**（D8）、**不建任何账本/ledger**（`docs/BLUEPRINT.md:48`）、
**不建第二发送入口**。B0-42 commerce 载体是**独立 Founder-gated 决定**（§7.5）。

| Carrier | 唯一职责 | 不是 |
|---|---|---|
| `MessageDeliveryEvent` | append-only 规范化入站 provider 送达/已读/失败/回复事实（BusinessEvent 层，真实era 才有行） | 发送/outbox/重投、ActionReceipt（D8）、账本、consent/refusal 事实、raw payload 容器 |
| `MessageDeliveryState` | rebuildable per-`logicalSendRef` 当前对账真相投影（Receipt 层） | 独立 mutation API、发送授权、第二真源、mutable 累加器绕过 append-only 事实 |

### §7.2 `MessageDeliveryEvent`（PROPOSED）

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org；FK `Organization.id`，`onDelete: Restrict` |
| `logicalSendRef` | server-resolved 逻辑发送标识（§3.1.6）；真实事实经 §4.4 step2 的 D8 绑定解析；caller 不可传 |
| `channelScopeId` + `channel` | tenant/channel-qualified FK `(channelScopeId, ownerId, channel) → ChannelScope`；provider-neutral |
| `providerConnectionId` | tenant-qualified FK `(providerConnectionId, ownerId) → ChannelConnection`；哪个连接产生该事实 |
| `factKind` | code-validated `accepted / delivered / read / failed / replied`（closed taxonomy） |
| `providerCode` | opaque provider code（如 failure reason code）；不含 raw payload |
| `externalMessageRef` | nullable opaque provider message ref；**不是**可信 authority，只作对账 join 辅证 |
| `receiptRef` | opaque reference（同 R-010 §4.5.1 口径）；**绝不**存 raw phone/message/token/签名材料 |
| `actorKind` | code-validated `provider / system`（`system` 仅限受控 reconcile/backfill；`merchant`/`otto` 禁止——回执非人工可写） |
| `sourceEventKey` | server-derived、含 `eventKind` namespace 的幂等 key（partial-unique live 谓词由 migration raw SQL 建） |
| `sourcePayloadHash` | versioned canonical hash；同 key 同 hash = no-op、同 key 不同 hash = 冲突（§4.4 step3） |
| `occurredAt` | nullable 声称业务时间，仅展示（`Timestamptz(6)`） |
| `receivedAt` | server canonical 时间，规范顺序据此（`Timestamptz(6)`） |
| `createdAt` | DB insert time |

约束/索引：`UNIQUE(ownerId, sourceEventKey)`（幂等）；index `(ownerId, logicalSendRef, receivedAt, id)`（对账主查询）；
index `(ownerId, providerConnectionId, receivedAt, id)`（连接级 reconcile 游标）。append-only：无 `updatedAt`/`deletedAt`
（更正靠新事实，不 in-place 改，同 `ConsentEvent`/`ProviderRefusalEvent`）。**无 `simulated` 列**：C6 在模拟era **从不写行**
（§4.3 的设计选择），此表只含真实 provider 事实，故不需要 C5 `ContactSendFrequencyEvent` 那样的 era-filter 列——这是与 C5 的
**刻意差异**（C5 必须计模拟发送、C6 没有任何模拟真相可落库）；因而此表也**没有模拟行需要 cutover 清理**（§9.2、M4）。

### §7.3 `MessageDeliveryState`（PROPOSED，rebuildable 投影）

| 字段 | 合同 |
|---|---|
| `ownerId` | authenticated Org |
| `logicalSendRef` | 该 send 的逻辑标识（一 send 一行） |
| `lifecycle` | code-validated `unknown / accepted / delivered / read / failed`；单调不退（§3.2） |
| `reconciliation` | code-validated `converged / pending / conflict / timeout_unknown`（§4.2） |
| `lastEventId` | 推进本 state 的最新 `MessageDeliveryEvent.id`（CAS cursor） |
| `lastProviderEventAt` | 最新 provider 事实的 server 时间；缺=null=unknown（分开返回，不拼假 lastSynced） |
| `lastReconciledAt` | 最近一次对账时间 |
| `updatedAt` | row lifecycle |

约束：`UNIQUE(ownerId, logicalSendRef)`。它是**从 `MessageDeliveryEvent` 全量可 rebuild 的 cache**，**不是**独立 authority、
无独立 mutation API（同 `ConsentStateProjection`/`ProviderRefusalState`）；乱序/迟到事件按 §4.4 step4 不倒退。

### §7.4 报告读面（无新表——纯读）

报告读面（§6）是跨表**只读聚合**，**不新增任何表**：读 C5 `BroadcastRun`/`BroadcastAudienceMember`/`ContactSendFrequencyEvent`
+ C6 `MessageDeliveryState` + C4 `CustomerMessage`。**【设计选择】** 不建物化报表表：一期报告是可从既有事实实时聚合的读，
建第二份物化真相会引入与源事实的 drift 与一致性负担；若未来量级需要物化/预聚合，那是独立 bounded 决定（列为 Unknown，§14），
不在本文预埋。

### §7.5 B0-42 commerce connector seam（PROPOSED，独立 Founder-gated）

B0-42 是**只读** commerce/POS/CRM connector seam：经 C4a §4 adapter port 的 `reconcile?`（`NormalizedProviderFacts`）拉取，或经
webhook（「收信」合宪，`docs/BLUEPRINT.md:85`）接入订单/交易/积分等经营 `BusinessEvent`；EasyStore 为可选首批 adapter 之一
（`docs/ops/route-b/matrix/06-B6.md:8`）。**契约级铁律固定**：只读、provider 可替换、零 connector 不阻塞 CRM 核心、
**永不代管、永不自建账本**（`docs/BLUEPRINT.md:48-49`）。

**其物理载体（如 `CommerceEvent` append-only + 可选 state 投影）本文只给形状草案，不在本 M0 冻结**：commerce 事实 taxonomy
（订单/付款/退款/积分…）范围大，且与钱路/账本铁律相邻，宜作**独立 Founder-gated scope 决定**（是否纳入 C6-M1、还是拆独立票；
是否与 messaging 回执共用脊柱表还是分表）——列为待 Founder（§14）。M0 只固定 B0-42 的只读边界与 seam 归属（C6 承接、adapter
可替换、非 WhatsApp 发送路径）。

### §7.6 为什么不新增其它表

- **不新增 outbox/worker/lock/retry/`ActionReceipt`/`DeliveryManifest`**：发送侧运行时全归 D8（`#359` 第 10 条；C5 §8、C4a §8）。
- **不新增任何 ledger/账本/钱路表**：经营事实只读、类比 pixel tracking（`docs/BLUEPRINT.md:48`）；通道费账道归 C4a §10 M6。
- **不新增第二发送/enqueue/confirm 入口**：C6 只读入 provider 事实；发送 chokepoint 仍是 C4/C5 各自唯一入口。
- **不改** C5 三表、C4b 六表、consent/refusal 五表、publishing `Channel`——C6 只**读**它们并新增回执两表（此处「不改」指
  schema/列/既有行为不变；template-review 外部事实经 C4a §5.6 推进既有 `reviewRevision` 的 writer 边界，须按 §4.4 step8 的
  **显式调和义务**处理，不在本 M0 静默裁定）。
- **不新增归因/tracked-link 表**：E5-06/07 归 B2 层（已 spec-ready），D10 归 R-010 §11.2 gate 5（§2.2、§6.4）。

## §8 D8 / C5 / C6 fail-closed matrix（C6 列为本票 scope）

| Surface | C6 可定义/保存 | 未有 native carriers 时必须 disabled / 不得声称 | 最终 owner |
|---|---|---|---|
| 入站 delivery/read/failure 事实 | append-only 规范化 provider 事实（`MessageDeliveryEvent`，真实era） | 把本地/模拟态写成 delivered/read/failed；伪造 receiptRef；塞 raw payload | C6（事实）/ C4a port（验签规范化） |
| 对账真相 | per-send `MessageDeliveryState` + `converged/pending/conflict/timeout_unknown` | 超时当 delivered、冲突静默择一、盲重投、本地猜测、假成功 | C6 |
| 报告读面 | owner-scoped 只读聚合（发出/跳过/不可用已知；送达/已读/失败据回执） | 模拟era 把 unknown 补成 delivered/补零冒充完成；把频控计数当送达；重算四轴 | C6（读）/ C5（发送侧事实） |
| logical-send 绑定 | 只读引用发送侧 `logicalSendRef` | 自造发送、代 provider-message-ref↔send 绑定（那是 D8） | D8 发送侧（`#359` 第 10 条） |
| template-review 外部事实 | C6 承接 verified 事实、materialize 后投影回 C4 三轴 | C4/C6 本地宣称 submitted/approved、乱序倒退 projection | C6（真相）/ C4（read projection，C4a §5.6） |
| commerce connector（B0-42） | 只读 seam 边界；provider 可替换；零 connector 不阻塞核心 | 代管资金、自建账本、写回商家系统、当第二收款/开票系统 | C6 只读 / provider adapter |
| 发送 / outbox / receipt(发送侧) | C6 不碰 | draft/outbox/worker-start 画 sent/delivered/read；铸造 ActionReceipt | D8 native task（未分配）+ C5 chokepoint |

D8 hard rule（承接 C5 §8 / C4a §8）：native contracts 未获批、实现、验证前，所有 dependent outbox/worker/retry/receipt/真实
delivery ingestion 都是 disabled/fail-closed/no availability claim。JSON、cache、`ChannelConnection` row、request ID、旧确认都
不能替代 authority。**C5 负责「此刻是否允许尝试发送」；C6 负责「provider 实际发生了什么」；D8 负责跨域发送侧运行时**（C5 §8
第 511-512 行）。本文不静默抢 C5/D8 归属。

## §9 Privacy、security 与 retention gate

### §9.1 已知

- `MessageDeliveryEvent`（含 `logicalSendRef`/`providerCode`/`receiptRef`/`externalMessageRef`）与 `MessageDeliveryState` 可关联
  到某联系人的某次发送，属 PII-adjacent 元数据；回执**只存** opaque ref/hash/规范化状态，**不存** raw phone/message/token/签名。
- current B13 scoped PASS 只覆盖 consent 五表（`ConsentEvent`/`ContactDndEvent`/`ProviderRefusalEvent` 及两投影），**不覆盖**本
  合同两个新 carriers（同 C4a §9.1 / C5 §9.1 对各自 carriers 的诚实 caveat）。
- current house policy 是 DB/storage platform-managed encryption at rest + TLS in transit；本提案沿用作候选，不声称已批准回执 privacy。

### §9.2 schema implementation 前必须补齐

B13/privacy 必须逐一给两表新增 row，冻结：source、data class、merchant ownership、read/export/delete、retention、backup
cadence、encryption、日志/telemetry redaction。当前提案建议 Phase-1（**均须 Founder 批**）：

- 回执事实为 merchant-owned；平台自动 retention 的**方向**（长留 vs 定期删/compact）本身是 Founder 判断题（见下 retention/TTL 条），本文不预设默认；
- Contact/Identity/BroadcastRun archive 不级联抹掉回执历史（`onDelete: Restrict`）；删除/导出走后续正常 privacy capability；
- `receiptRef`/`providerCode` 依 DB at-rest encryption + tenant boundary，不做不可搜索的 ad-hoc field crypto；
- **retention/TTL**：回执与对账事实的最终保留时长**仍 Unknown**，本文**不冻结具体 TTL、也不预设默认方向**——两个方向各有代价，
  中性陈述交 Founder 判断：**长留**便于事后对账/审计/纠纷举证与迟到 reconciliation，但 PII-adjacent 元数据留存越久、隐私与合规
  暴露面越大（PDPA/数据最小化压力，B0-93）；**短留/定期删**降低隐私暴露，但牺牲历史对账能力，且删除须与「回执是外部真相、
  不得删后重投」（§10 Rollback）协调。真实era 后旧行 terminal 处理策略一并交 Founder（§14）；【状态 2026-07-22】
  retention/TTL 已由 Founder Resolution 冻结：回执数据商家自有；平台默认 24 个月、到期清理前提醒、商家可调长/调短/关闭；
  随时手动删/导出（证据：#359 issuecomment-5037075282；#405 issuecomment-5037395417 八点批件）。原中性陈述保留为决策背景。
- production backup/PITR 实际 cadence 仍 Unknown，不能在本文宣称。

Founder 对本文 §4/§7 的方向若批准，也**不等于**上述 B13 rows 与 TTL 已通过；privacy gate 仍在 migration 前独立到期（`#11/#12`、`#359`）。

## §10 Migration、activation 与 rollback 提案

所有步骤都是顺序合同，不是当前执行授权；**每站另取 Founder 授权**（`#399`：M1/M2/M3 逐站）。

### M0 — authority/gates（本票）

- Founder 批准本文回执事实模型方向、两个 M1 carrier 的形状与报告读面边界（`#359` C6 M0 预授权已覆盖 docs-only 起草）；
- M1 建表另开票取 schema/migration 明确授权；两个 carrier 的 B13/privacy rows + TTL 获批（`#11/#12`、`#359`）；
- B0-42 commerce 载体范围作独立 Founder 决定；
- live main、dependencies、claim、branch/worktree/PR 重新查询。

### M1 — additive storage only（另取 schema/migration 授权）

- 新 migration 增两表（`MessageDeliveryEvent` / `MessageDeliveryState`）、FK/unique/index、`Organization` back-relations；
  复用既有 `ChannelScope`/`ChannelConnection` 的 `@@unique([id, ownerId(, channel)])`；partial unique 由 raw SQL 建并配 drift test；
  两表加入 `TENANT_MODELS`，coverage/static migration/rollback tests；
- 不改旧 migration，不开 route、worker、adapter、UI availability、ingestion wiring；所有 receipt/ingestion path 仍 zero-call；表恒空。
- **验收**：两表 ownerId coverage、每 relation tenant-qualified、幂等 unique 存在、`TENANT_MODELS` 命中、migrate
  deploy/rollback/Prisma generate 隔离通过。**不做**：ingestion、对账引擎、报告读面、UI、任何真实/模拟回执写入。

### M2 — 对账引擎 + 报告读面（模拟供应商）

- 实现 §4.2 回执读投影、§5 对账收敛（对**模拟era**：`MessageDeliveryEvent` 空表 → 所有 send 呈 `lifecycle=unknown`、
  `reconciliation=pending`，如实）；实现 §6 owner-scoped 只读报告聚合（发出/跳过/不可用**已知**，送达/已读/失败**unknown**）；
- **真实 ingestion 保持 disabled**（无 adapter、无 endpoint、无 D8 绑定）；C6 read access 的 capability matrix 先获 Founder 批准，
  Unknown/default deny；
- fake clock/fixture 完成对账 + 报告 contract tests（含 tenant、幂等占位、乱序占位、unknown-不伪装、冲突处置）。
- **验收**：模拟era 报告如实呈 delivered/read/failed=unknown、绝不补零/补绿；发出/跳过/不可用读自 C5 且不重算四轴；
  对账对空回执表恒 `pending`、超时占位恒 `timeout_unknown`。**不做**：真实 provider、真实 webhook、真实回执、发送、
  **commerce seam 实现（B0-42）**、**归因层（E5-06/07）接入**。

### M3 — 报告读面 UI（模拟数据 + Founder 认证走查）

- 接报告工作台：群发/Campaign/联系人时间线报告页；逐项 authority/freshness 标注；`loading/empty/disconnected/degraded/stale/
  partial-error/error/ready` 如实区分；模拟era 明确标「无真实送达数据」，delivered/read/failed 呈 unknown；
- 人工可完整操作（`docs/BLUEPRINT.md:66`），Otto read 对等（不做瞎子操作员，`docs/BLUEPRINT.md:69`）；
- **Founder 认证走查**（本地 magic-link；对标 respond.io Broadcast/Analytics 报告面走查在此站补齐，§12）。
- **验收**：报告端到端只读可恢复；模拟era 零假回执、零补零冒充、unknown 如实；0 跨租户；人工/Otto 双读一致。
  **不做**：真实 webhook、真实 provider、真实回执、发送、commerce 写回、**commerce seam 实现（B0-42）**、**归因层（E5-06/07）接入**。

### M4 — 真实回执 ingestion（最终「连接与上线」阶段，D8/C4a adapter/M6，另取 authorization）

- `#359` 第 28 条：真实外界连接集中在最终阶段一次执行；`#359` 第 29 条：WhatsApp 路线为 Meta Tech Provider 直连 + Embedded
  Signup（**非 Gupshup**）；
- C4a §4 adapter port 接真实 provider、真实 webhook endpoint/secret、D8 发送侧 `provider-message-ref↔logical-send` 绑定
  （`#359` 第 10 条）全部另获批、实现、验证后，才可打开 §4.4 的真实 ingestion；
- `MessageDeliveryEvent` **无模拟行**（模拟era 从不写，§4.3/§7.2）→ 真实era 上市**无模拟行需 cutover 清理**、无跨 era 幻影之虞；
  真实事实自 M4 首个 verified webhook 起累积；
- B0-89 隐私政策/ToS/数据删除回调、B13、production 迁移（`#11/#12`）、deploy、exact-head CI + independent review 全绿。

Rollback：

- M1–M3 无真实 ingestion：关闭 feature flag；drop 仍是 destructive migration，须另取 Founder approval；报告是纯读、无写数据可回退；
- M4 起有真实回执：disable 真实 ingestion 后 **keep-forward** 已收 provider 事实与对账真相（回执是外部真相，不得删除后重投，
  同 C4a §10 M5「保留 C6 receipt truth… reconcile；不得删除后重投」第 610 行）；
- 任一步 tenant/idempotency/privacy 不明时只停 affected path，留下可见 reason 与 forward-fix ticket。

## §11 Acceptance 与 adversarial tests

### §11.1 schema/domain（M1）

- 两表 ownerId coverage、每 relation tenant-qualified、`MessageDeliveryEvent`（`ownerId,sourceEventKey`）/`MessageDeliveryState`
  （`ownerId,logicalSendRef`）幂等/唯一存在；`TENANT_MODELS` 命中；migration deploy/rollback/Prisma generate/tenant guard 隔离通过；
- 零新增 outbox/worker/ActionReceipt/ledger/发送表（静态断言）；C5 三表、C4b 六表、consent 五表零修改、零第二 writer 引用。

### §11.2 对账 / unknown 不伪装 / tenant / security（M2）

- **unknown 不伪装**：`MessageDeliveryEvent` 空表时，任意 send 的 `lifecycle` 恒 `unknown`、报告 delivered/read/failed 恒
  `unknown/unavailable`——**断言不存在**把本地/模拟态输出成 `delivered/read/failed` 的路径（0 假回执）；
- **幂等回执**：同 `sourceEventKey` 同 `sourcePayloadHash` 二次 ingestion = no-op；同 key 不同 hash = 冲突、零覆盖、零第二行；
- **乱序**：迟到 `accepted` 不把已 `delivered/read` 的 state 回退；`occurredAt` 乱序不改 server `receivedAt` 规范顺序；
- **对账收敛**：已尝试无终态 → `pending`；超时/response 丢失 → `timeout_unknown`（不 delivered、不盲重投）；互斥终态 →
  `conflict`（不静默择一）——**且冲突下 `lifecycle` 保持已达单调值不动、冲突只由 reconciliation 轴呈现**（§4.4 step5 占位规则）；
  缺 D8 绑定/缺 capability → fail closed；
- **跨租户**：两 Org 互换 `logicalSendRef`/deliveryEvent/state/broadcastRun/contact IDs → 统一 not-found/denied，零泄漏、零写、
  零 provider call；**ingestion 绑定 tenant 一致性**（§4.4 step2）：一条 provider 事实解析出的 `logicalSendRef` 若属**另一 owner**、
  或 ambiguous（zero/multiple）→ reject、fail closed、零产品写、不泄漏 tenant 是否存在；
- **零第二发送入口**：静态可达性断言——C6 无任何 send/enqueue/outbox/retry/confirm 路径；ingestion 只写回执事实、绝不触发发送。

### §11.3 报告读面 / 边界（M2/M3）

- 报告发出/待执行/跳过/不可用读自 C5（`sendState`/`skipReason`）且**不重算四轴**、**不改** C5 数据；送达/已读/失败据 C6 回执，
  模拟era 恒 unknown；**`pending` sendState 成员（中断/部分执行 run）计入报告分母不漏**（§6.1 A 组）；
- **对账轴聚合**：报告分列 A 发送侧 / B 回执侧 / C 对账侧三组；断言 **`conflict` 与 `timeout_unknown` 的 send 绝不计入
  delivered/read/failed 任何净数**（不被 lifecycle 聚合洗绿），B 组净数只数 `reconciliation=converged`；C 组 pending/conflict/
  timeout_unknown 计数独立呈现；报告不得把三组压成单一「成功率」掩盖 unknown/conflict/timeout；
- 频控计数不被当作送达数；「跳过（by axis，发送前）」与「发出未送达（回执，发送后）」分列、不混为一谈；
- 回复率归因 deferred 时报告不编造 broadcast 级回复归因（只呈会话级可得口径，§6.4）；
- `loading/empty/disconnected/degraded/stale/partial-error/error/ready` 的 desktop/mobile snapshot/interaction tests；
  `messaging-tier/额度` 恒 unavailable 如实；0 跨租户、0 假回执、0 补零冒充完成、人工/Otto 双读一致。

### §11.4 真实 ingestion（M4，占位/契约级）

- crash before/after webhook ack/事实持久化的 exactly-once/reconcile、验签失败统一拒绝零产品写、未识别事实进 quarantine、
  template-review verified 才 materialize 且乱序不倒退——这些真实 ingestion tests 由 M4 与 C4a §4/D8 native tests 承接；缺失即不激活。

## §12 respond.io comparison anchor（诚实缺口声明）

C4a §12 已核实会话/模板文档锚；C5 §12 把 Broadcast 面走查推迟到 M3。本 C6 M0 轮**未登录 respond.io workspace、未做报告/
Analytics 面文档或实机走查**，因此本文**不捏造** respond.io Reports/Analytics 文档 URL/日期。冻结如下诚实边界：

- 公开 benchmark 面（Broadcast/Campaign 报告、送达/已读/失败统计、reply/attribution 呈现、messaging-tier 限制显示）的
  desktop/mobile 真实走查与文档锚**推迟到 M3 报告读面站**（Founder 认证走查一并捕获，写入 map D.3）；
- 差异化硬线（不靠 prompt，靠数据/契约 hard rule）：FIKIRTIVE 把回执做成**只读、经核验、乱序不倒退、超时=unknown、
  冲突不静默择一**的事实，把「模拟era 绝不伪造 delivery、unknown 如实」做成 read/engine 契约，把「永不代管/永不自建账本」
  做成 B0-42 只读铁律；真实 sent/delivered/read 仍须 provider evidence，**绝不为视觉追平而造假**（map D.4「0 假回执」）；
- C6 的上市地板：回执只读经核验、对账诚实（unknown/conflict 不掩盖）、报告读面人工可完整操作且 Otto 读对等、B0-42 只读边界正确；
  模拟era 全绿后进最终「连接与上线」阶段。

（本节的 respond.io 锚缺口在 M3 前须补齐；不得因 M0 未走查而在后续声称已对标。）

## §13 六级状态与 evidence contract

按 `docs/ops/route-b/B0-CONTRACT.md`：

| B0 | 当前 live 状态 | 本 PR（M0 docs-only）合并后 | 后续到期条件 |
|---|---|---|---|
| B0-41 | `listed / absent` | 仍 `listed / absent` | M1 回执两表 + M2 对账/报告引擎 + M3 报告 UI + M4 真实回执 ingestion 后才 code-complete/verified |
| B0-42 | `listed / absent` | 仍 `listed / absent` | commerce 只读 seam 载体（独立 Founder 决定）+ adapter + reconcile tests；永不代管/账本 |

`B0-CONTRACT.md` 把 `spec-ready` 绑定「所属块 spec 冻结 + 对标锚清单」。C6 只冻结 B6 的这两行、且本轮**未做 respond.io 报告面
锚走查**（§12），因此即使本文经 Founder 方向批准并 merged，也**不预支** `spec-ready`；升级须未来 Founder 明确认定 + matrix 写入
exact PR/SHA + 对标锚清单。每个后续 head 依 current workflows + `docs/runbooks/local-ci.md` 重跑适用 jobs、发布 exact-head
evidence；独立 cross-family review unresolved P0=0/P1=0；CI unavailable 不是 green。**docs-only 合并由 orchestrator 执行
（`#399`：双独立非作者审查零 P0/P1 + CI 全绿）；M3 报告 UI 保留 Founder 认证走查。**

## §14 Gates、Unknowns 与当前决定

### §14.1 后续 Founder-only gates（均不由本文授权）

| 动作 | 何时单独问 |
|---|---|
| schema/migration implementation 或 DB apply（`MessageDeliveryEvent`/`MessageDeliveryState`） | 对应 M1 issue 首次动作前 |
| B13/privacy rows、retention/**TTL 具体时长**、encryption/export/delete（两 carrier） | M1 migration 前（`#11/#12`、`#359`）。【2026-07-22】rows+TTL 内容已呈 PR #407（合并即闭）；backup cadence 仍 Unknown。 |
| B0-42 commerce connector 物理载体范围（是否纳入 C6-M1、是否与 messaging 回执分表、commerce fact taxonomy） | commerce seam 实现前（独立 scope 决定） |
| template-review 外部事实的载体归属（共用脊柱表 vs 独立 bounded carrier） | template-review ingestion 实现前 |
| 回复率/转化归因到具体 broadcast 的精确口径（依赖 E5-06/07、D10） | 归因层接入前 |
| C6 read access 的 tenant RBAC（报告读面 / 回执读面 权限） | 对账/报告读面启用前；Unknown/default deny |
| D8 发送侧 `provider-message-ref↔logical-send` 绑定、outbox/worker/ActionReceipt | native issue 建立/实施前，且任何真实回执 ingestion 前必须闭合（`#359` 第 10 条） |
| C4a §4 adapter 真实 provider、真实 webhook endpoint/secret、Meta Tech Provider 连接/Embedded Signup/App Review | 每个对应动作前（`#359` 第 28/29 条） |
| 通道费 costing、money-safety review | 任何会产生 provider cost 的真实动作前（C4a §10 M6；本文零 spend） |
| production/backfill/reconcile/deploy（`#11/#12`） | 每个 production 动作前 |
| **每站授权（M1/M2/M3）** | **C6 无四站一次性授权——逐站另取 Founder 授权**（`#399`；对照 C5 台账 #30 是 C5 专属，不及 C6） |

### §14.2 当前 Unknown（不偷偷填）

- 两个 carrier 的最终 retention/export/delete 方向与 TTL 具体时长（回执无模拟行，无 cutover 清理项，§7.2）；【2026-07-22 已冻结，见 §9.2 状态注记】
- B0-42 commerce fact taxonomy 与载体范围（订单/付款/退款/积分的规范化边界）；
- template-review 外部事实的载体归属；
- 回复率/转化归因到具体 broadcast 的精确口径（归因层未接）；
- delivered/failed 互斥终态冲突的**终态择定规则**与人工核对流程；
- C6 报告/回执读面的 exact capability matrix（未决期间所有 read 默认按 owner-scope + default deny）；
- 真实 Meta Tech Provider account、messaging-tier/quality-rating 真实配额与法律状态；
- 报告是否需物化/预聚合（一期纯读；量级触发另议）；
- production backup/PITR 实际 cadence。

### §14.3 只向 Founder 呈这一题

> **是否批准本文的 C6 方向：一个 provider-neutral、只读、经核验的回执事实模型（统一脊柱 Mandate/Action/ExternalEffect/
> BusinessEvent/Receipt，C6 只承接底部 BusinessEvent + Receipt 两层的 messaging 载体，发送侧引用 C5/C4/D8 既有 authority）；
> 两个 tenant-qualified、additive-only 的 M1 carriers（`MessageDeliveryEvent` append-only 事实 + `MessageDeliveryState`
> reconciled 投影）；对账收敛规则（超时=unknown、冲突不静默择一、fail-closed 缺省）；owner-scoped 只读报告读面（发出/跳过/
> 不可用已知，送达/已读/失败据回执、模拟era 恒 unknown 不伪造）；以及 B0-42 只读 connector seam 的边界（永不代管/永不自建账本，
> 物理载体作独立后续决定）？**
>
> 批准的含义仅是：允许本文在通过 exact-head 双独立非作者审查（P0=0/P1=0）+ CI 全绿后由 orchestrator 合并（`#399`），并允许下一张
> M1 issue 以这套 shape 准备 schema/migration 实施申请。批准**不授权**修改 Prisma/migration、连接 provider、接真实 webhook、
> 写任何真实回执、配置 credentials、Meta submission、花费、代管资金/建账本、commerce 写回、RBAC、B13/privacy/TTL 面、production、
> deploy 或 CI-unavailable merge；**也不构成 M2/M3 的授权（C6 逐站另批）**。

建议：**批准**。它是满足 B0-41/42 的最小完整方案——回执只读经核验、读写分离（C6 只读入 provider 事实、绝不成为第二发送入口）、
无账本（`docs/BLUEPRINT.md:48`）、unknown 不伪装、超时/冲突诚实、报告人工可完整操作且 Otto 读对等、与 C5 边界干净
（C5=能否发 / C6=发生了什么），且所有真实回执 ingestion 在 C4a adapter / D8 绑定 / M4 前继续 fail closed。
