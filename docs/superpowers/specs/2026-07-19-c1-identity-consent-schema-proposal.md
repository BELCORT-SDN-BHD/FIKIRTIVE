# C1 身份+同意底座建表方案（ChannelScope / ConsentEvent / DND / ProviderRefusal 物理合同整理）

> **状态：docs-only PROPOSAL，等待 Founder schema 批准**
>
> 本文档不含代码、不动 Prisma schema、不动 migration、不执行任何 R-010 §7 M0–M6 步骤。批准本文档仅满足
> R-010 §11.2 gate 1（`2026-07-16-r010-schema-authority-alignment.md:651`）与 gate 3
> （`2026-07-16-r010-schema-authority-alignment.md:653`）对本文档列出的表的**方案批准**，不构成 migration
> 授权、production 授权或 implementation 授权。每个 M-step 的执行仍须另行 Founder schema/migration/production
> 授权（`2026-07-16-r010-schema-authority-alignment.md:432`）。
>
> 证据基线：live `main` `0613e961c88509c35c5d20bbcf042ca345435ac4`（2026-07-19）。
>
> 关联：#352（本票 mandate）；#345 map C1（`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:200`）；
> R-010（`docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md`）。
>
> 零发明声明：本文档不选择、不新增、不细化任何 R-010 未冻结的字段、约束、命名或流程。凡 R-010 标记为
> 「建议」的物理形状，本文档原样保留该词并原样转述，不代为「做实」或「收紧」；本文档只是把已冻结/已提案的内容
> 集中整理成一份供 Founder 批准的方案文件。

## §1 目标与边界

本文档做什么：

- 把 R-010 已冻结（【已批准】）与已提案（【本 PR 提案】）的 `ChannelScope`、`ConsentEvent`、
  `ConsentStateProjection`、`ContactDndEvent`、`ProviderRefusalEvent`、`ProviderRefusalState` 物理形状，
  逐表集中整理为一份方案，附出处行号，供 Founder 一次性审阅并批准（或退回）。
- 转述 R-010 §7 冻结的 M0–M6 建议执行顺序，标明每一步仍需的另行授权与 gate 依赖。
- 转述 R-010 §4.7/§11.2 gate 6 的 B13/privacy 逐 carrier 清单要求。
- 列出本方案明确不做的事项（D7/D9 禁止的 lifecycle machinery、Campaign UTM store、D8 延后载体）。

本文档不做什么（不授权）：

- 不修改 `packages/db/prisma/schema.prisma`、不生成或执行任何 migration。
- 不启动 R-010 §7 的任何 M0–M6 步骤（含 SELECT-only reconcile）。
- 不批准或启用 D8 延后的 reactive/D5 物理载体（`DeliveryManifest`、`ActionReceipt`、confirmation/outbox/receipt
  runtime）——这些仍归各自 native implementation/schema task，保持 fail-closed
  （`2026-07-16-r010-schema-authority-alignment.md:248`）。
- 不通过或声称通过 B13/privacy 逐 carrier gate（R-010 §11.2 gate 6，`:656`）；该 gate 现状为 Unknown，见 §7。
- 不改变 D1–D10 已批准的产品/authority 结果（R-010 §11.1 明示不得重新呈问，
  `2026-07-16-r010-schema-authority-alignment.md:632`）。

Founder 批准本文档后，下一步仍是：（a）针对本文档列出的表逐条另取 Founder migration 授权（R-010 M1，
`:443-450`）；（b）B13/privacy 逐 carrier gate 通过（gate 6）之后 `ConsentEvent` 及其 projection 才可
additive（`:448`）；（c）C1 build ticket 依 §345 map 候选另行开票。

## §2 表清单

### §2.1 ChannelScope（D9 minimal，§7 M1）

用途一句话：provider-neutral 的最小稳定 Channel-instance 记录，是身份 authority 的载体之一，不承载生命周期状态。

R-010 冻结形状（【已批准 D6/D7/D9】，`2026-07-16-r010-schema-authority-alignment.md:102-118`）：

| 字段 | 冻结合同 | 出处 |
|---|---|---|
| `id` | stable scope row ID | `:106` |
| `ownerId` | authenticated tenant；任何 reference 都须 tenant-qualified | `:107` |
| `channel` | provider-neutral broad channel | `:108` |
| `scopeKey` | 单一 server chokepoint 产出的 canonical stable key；caller/client/connector 不得提交或覆盖 canonical 值 | `:109` |
| `createdAt` | immutable creation fact | `:110` |

Keys/uniques：`UNIQUE(ownerId, channel, scopeKey)`（`:111`）。

关联合同（不属于 ChannelScope 自身字段，但同一物理合同的一部分）：

- `ChannelConnection` reference：映射/reference 同 owner、同 channel 的 `ChannelScope`；credential/provider
  connection 不得成为 identity authority（`:112`）。
- `ContactIdentity` reference：同 owner、同 channel 地 reference 该 `ChannelScope`，并保存 server-canonical
  external contact ID；handle/label 只展示（`:113`）。
- active identity authority：active `(ownerId, channel, ChannelScope, canonical externalId)` 唯一指向一个
  Contact；exact constraint naming 与 soft-delete 表达可在 implementation contract 规范化，但不得退回三事实
  authority（`:114`）。

明确禁止（Phase 1，`:116`）：不得给 `ChannelScope` 添加 status、TTL、issuer、retirement/reactivation、
assignment epoch、recycle/reassignment automation、quarantine、auto-revive、automatic person inference、
auto-merge 或其它 lifecycle machinery。当前 B8 三事实 partial index 只是既有物理事实，在 D9
migration/implementation 另获批准、安全 backfill 完成且四事实 writer/index 原子启用前，不能冒充 final
authority。

canonicalization 规则（`:118`）：canonical scope 与 canonical external ID 只由一个 server-side chokepoint 从已
验证 raw facts 导出。unmapped、ambiguous、conflicting scope 或 caller-supplied canonical value 一律
fail-closed：不走 exact attach/create、不猜 identity，只给 merchant-visible suggestion/action。continuity
proof 的 physical evidence carrier 属于 D8 允许延后的 implementation contract；未获批、实现并验证前，该
attach writer 保持 disabled/fail-closed。

M1 冻结顺序（§3 M1，`:446`）：Phase 1 identity 只 additive 建立本表五字段、`UNIQUE(ownerId,channel,scopeKey)`、
`ChannelConnection`/`ContactIdentity` references 与 active 四事实 unique；exact 命名/constraint 表达可规范化，
但不得新增上述 lifecycle machinery。

### §2.2 ConsentEvent + ConsentStateProjection（append-only 四轴，§4.2/§4.4/§4.6）

用途一句话：`ConsentEvent` 是唯一长期 permission-fact truth 的append-only事件表；`ConsentStateProjection` 是
从事件全量 replay 可重建的读模型，不是第二真源。

标记：【本 PR 提案】（R-010 原文标记；本文档原样保留，不做实为已批准）。

#### ConsentEvent 字段（`2026-07-16-r010-schema-authority-alignment.md:162-181`）

| 字段 | 提案语义 |
|---|---|
| `id` | stable sortable event ID（建议 ULID） |
| `ownerId` | authenticated tenant |
| `contactId` | 同 owner Contact |
| `channel` | provider-neutral closed taxonomy |
| `purpose` | code-validated closed set；Phase 1 为 `marketing / transactional / review_request`，每项必须有 server-owned purpose class |
| `action` | `grant / revoke` |
| `actorKind` | server-derived `customer / merchant / legacy_unknown`；future `system` 组合须另走合同演进 |
| `entryMode` | server-derived `interactive / backfill`；caller 不可传 |
| `sourceKind` | endpoint-bound closed set；caller 不可传 |
| `evidenceStatus` | server-derived `verified / asserted / unresolved`；caller 不可传，直接决定该 event 能否改变 effective state |
| `evidenceRef` | endpoint-validated opaque reference；不得默认保存 raw message body 或不必要 PII |
| `operationId` | server-derived stable operation group；普通单 tuple event 可等于自身 operation，D4 STOP fan-out 各 purpose 共享一个值；caller 不可传 |
| `idempotencyKey` | server 构造的稳定 business key |
| `occurredAt` | 外部声称的业务时间，只展示/审计 |
| `receivedAt` | server 赋予的规范 replay 顺序；冻结为 `Timestamptz(6)`，tick = 1μs（§4.4，`:275`） |
| `createdAt` | DB 写入时间，不参与 fold |

约束（`:183-189`）：

- 无 ordinary `updatedAt/deletedAt`；普通产品路径不得 UPDATE/DELETE；
- `UNIQUE(ownerId, idempotencyKey)`；
- replay index `(ownerId, contactId, channel, purpose, receivedAt, id)`；
- `ownerId + contactId` 同租户由 writer fail-closed；composite FK 最终房规仍归 #317；
- privacy erasure/de-identification 是另一个受控 privacy operation，不能假装普通 event mutation。

#### closed source/action matrix（§4.3，`:191-208`）

这是当前 writer 组合全集；任何未列 `sourceKind × action × actorKind × entryMode × evidenceStatus` 一律拒写，
新增组合属于合同演进，不得由 endpoint 临时放宽：

| `sourceKind` | action / actor / mode / evidence | 规则 |
|---|---|---|
| `explicit_inbox_optin` | `grant / customer / interactive / verified` | flow 须 server-bind exact purpose；普通 reply 不进此端点、不生成 event |
| `unsubscribe_link` | `revoke / customer / interactive / verified` | token 与 Contact/channel/exact purpose 由 server 验证；只写该 purpose |
| `resubscribe_link` | `grant / customer / interactive / verified` | 必须是受控、purpose-bound re-opt-in 动作 |
| `stop_keyword` | `revoke / customer / interactive / verified` | D4 server-derived non-transactional fan-out；原始 opaque message ID 作 evidence |
| `start_keyword` | `grant / customer / interactive / verified` | 只有 server 可证明 approved flow 与 exact purpose 时写单 tuple；无限定 START 不生成 grant |
| `double_optin` | `grant / customer / interactive / verified` | 只有 verified confirmation |
| `crm_manual` | `grant\|revoke / merchant / backfill / asserted` | 只记录商家 claim；不能冒充 customer action 或覆盖 verified stance |
| `import` | `grant\|revoke / merchant / backfill / asserted` | 只记录来源 claim；不能制造 verified customer fact |
| `legacy_contact_snapshot` | `grant\|revoke / legacy_unknown / backfill / unresolved` | 保留原 claim；actor/channel/purpose/evidence 不猜 |
| `historical_verified_revoke` | `revoke / customer / backfill / verified` | server-only、revoke-only baseline；evidence 须精确证明同 owner/exact tuple 的 purpose-bound unsubscribe/revoke，且早于该 tuple 首个 live interactive event；无限定 STOP 不得塞入此 source |
| `historical_verified_stop` | `revoke / customer / backfill / verified` | server-only D4 fan-out；evidence 须证明同 owner/contact/channel 的无限定 customer STOP 并生成稳定 operationId，且早于各 affected tuple 首个 live interactive event |
| `stop_purpose_expansion` | `revoke / customer / backfill / verified` | server-only、revoke-only；只在新 proactive purpose 启用前从同 owner/contact/channel 的 verified `stop_keyword` 或 `historical_verified_stop` operationId 确定性导出；无 grant 对偶端点 |

purpose scope 与 STOP 原子 fan-out（§4.3.1，`:210-218`，出处同段落）：

- `marketing` 与 `review_request` 归类为 `proactive_non_transactional`；`transactional` 只允许既有订单、付款、
  收据、配送或安全事件所必需的封闭内容；顾客主动服务对话按 D5 独立归为 `reactive_service_reply`。
- purpose 及 purpose class 由 shared action 按 server-owned closed registry 推导，caller、connector、merchant
  payload 与 Otto 参数都不可覆盖。
- purpose-bound unsubscribe link 只写 token 绑定的 exact tuple，不 fan-out；无限定 STOP 忽略 caller 提交的
  purpose，按本 channel registry 计算全部 active `proactive_non_transactional` purposes；Phase 1 恰为
  `marketing + review_request`。
- STOP writer 在**一个 DB transaction** 内为每个 affected purpose 各写一条 ConsentEvent、更新各
  projection/cursor；任一 lock、insert、projection 或 cursor 步骤失败都 rollback 全部，禁止 half-revoked
  state。
- 共享 `operationId = stop:<channel>:<channelEventRef>:<opaqueMessageId>`；每条 event 使用
  `idempotencyKey = stop:<channel>:<channelEventRef>:<opaqueMessageId>:<purpose>`（`UNIQUE(ownerId,idempotencyKey)`）。

strict transactional eligibility（§4.3.2，`:220-233`）：`transactional` 不是 caller 可选标签。shared send
action 须构造 server-owned `TransactionalSendContext = { kind, subjectRef, triggerEventRef, templateVersionId,
contextHash }`，closed matrix 限定四类 `kind`：`order_confirmation`、`payment_receipt`、`delivery_update`、
`security_notice`，各自要求已存在的同 tenant 事实 + confirmed trigger event，且只允许 immutable registered
template 与 closed 变量形状；每类使用 `tx:<kind>:<triggerEventRef>:<contactId>:<channel>:<templateVersion>`
稳定 send idempotency key。

#### deterministic fold（§4.4，`2026-07-16-r010-schema-authority-alignment.md:258-275`）

每个 permission tuple 按 `(receivedAt, id)` 全序 replay。允许的 transition 穷尽：

| Incoming event class | 任何旧状态后的新状态 |
|---|---|
| `verified + customer + interactive + revoke` | `effective_revoke` |
| `verified + customer + interactive + grant` | `verified_grant`（也是唯一可解除 customer revoke 的 re-opt-in） |
| `verified + customer + backfill + historical_verified_revoke` | 只有尚无任何 verified interactive event 时把 `unknown` 变成 `effective_revoke`；已有 interactive stance 则只留历史、不覆盖较新的 live stance |
| `verified + customer + backfill + historical_verified_stop` | 按 D4 fan-out；每个 affected tuple 无 verified interactive stance 时变成 `effective_revoke`，已有较新 live stance 则只留历史 |
| `verified + customer + backfill + stop_purpose_expansion` | 新 purpose 上线前从原 verified STOP 导出 `effective_revoke`；只写此前不存在、尚无 interactive stance 的 new purpose |
| `asserted + merchant + backfill + grant\|revoke` | effective state 不变；只在 history 显示 merchant assertion |
| `unresolved + legacy_unknown + backfill + grant\|revoke` | effective state 不变；只进 quarantine/evidence |
| 未列组合 | 写入时拒绝，不进入 replay |

没有可改变状态的 verified event 时为 `unknown`。`historical_verified_revoke` 不是补写 opt-in 的后门：只能在
无较新 interactive stance 时建立 revoke baseline；evidence 无法证明其早于首个 live interactive event 时进入
visible quarantine 并阻止 M5。`legacy_unresolved` 不是 permission state，也不能成为隐藏 global block。DND、
provider refusal、frequency suppression 不进入 fold。

receivedAt 赋值规则：每个 tuple 都取 tenant-qualified lock，读取自身前一最大值，再赋
`max(clock_timestamp() at storage precision, previous + 1 tick)`；insert、projection fold 与 cursor 更新同
transaction。

#### ConsentStateProjection（`:277-287`）

建议作为可重建读模型，而非第二真源：

| 字段 | 语义 |
|---|---|
| `ownerId/contactId/channel/purpose` | 唯一 permission tuple |
| `state` | `unknown / verified_grant / effective_revoke` |
| `lastEventId/lastReceivedAt` | fold 已消费到的规范 cursor |
| `stateActorKind/stateSourceKind/evidenceStatus` | UI 显示当前状态的来源/理由 |
| `updatedAt` | cache 维护时间，不参与 authority |

projection 无独立 mutation API；每次 event 同 transaction 维护，清空后全量 replay 必须得到同一 semantic
state。

#### Contact 三个 legacy 字段的 compatibility projection 映射（§4.6，`2026-07-16-r010-schema-authority-alignment.md:348-359`）

现有 `Contact.marketingConsent/consentSource/consentAt` 在迁移期可保留，但不再留下 implementation 自行选语义：

1. compatibility projection **只映射 `whatsapp × marketing`**；其它 channel/purpose 不得读写这三个字段（`:352`）。
2. 第一条 live `whatsapp × marketing` event 起，event insert 与 compatibility projection 同 transaction
   更新；send consent-state reader 同时直接/可靠读取 event authority 并产生 D5 risk disposition，不能只等
   M5（`:353`）。
3. 字段级映射固定为（`:354`）：
   - `unknown → (marketingConsent="unknown", consentSource=null, consentAt=null)`
   - `verified_grant → ("opt_in", "consent_event:<stateSourceKind>", stateEvent.receivedAt)`
   - `effective_revoke → ("opt_out", "consent_event:<stateSourceKind>", stateEvent.receivedAt)`
   时间一律取决定 current state 的规范 `receivedAt`，不取可伪造/迟到的 `occurredAt`。
4. asserted/unresolved 或已被较新 interactive stance 盖过的 historical baseline 是 state-neutral：不得改变
   三个 compatibility bytes；只有在证明无 effective event 且零 unresolved legacy opt-out 后，受控 reconcile
   才可把 legacy bytes 定案为 `unknown/null/null`（`:355`）。
5. `legacy_unresolved` 只在 quarantine/report 存在，不写成 projection state；production 中任何不能安全表示
   的 known historical revoke（含无 tuple legacy `opt_out`）若非零，M5 前必须逐项解决，或另获 Founder 批准一
   条显式、可见、临时 legacy-block 规则；不能隐藏 global block，也不能静默丢失（`:356`）。
6. cutover 后禁止 independent direct write；M5 后所有 business readers 停止读取三个旧字段，只读 per-tuple
   projection/event（`:357`）。
7. 所有 readers/exports/Otto/report 切换后，旧字段才可进入另一次 destructive-removal approval（`:358`）。
8. `doNotDisturb` 不属于待淘汰 consent projection；它在 DND event 启用后只作 compatibility projection，不再是
   可旁路直写的独立 authority（`:359`）——详见 §2.3。

M1 冻结顺序（`2026-07-16-r010-schema-authority-alignment.md:448`）：`ConsentEvent` 及其 projection 只有在本
方案对应物理合同获批**且** §4.7/B13 逐 carrier privacy gate 通过后才可 additive；缺任一项不得启动 migration
或 implementation。

### §2.3 ContactDndEvent（closed matrix，§4.5.1）

用途一句话：append-only 的 DND set/clear 事实表；DND 是 Contact-wide、覆盖全部 customer channels/purposes 的
独立轴，不是 consent。

标记：【本 PR 提案】（R-010 原文标记，`2026-07-16-r010-schema-authority-alignment.md:331-335`，`:335` 为
「建议」）。

出处（`:333-335`）：generic `ActionEvent.payload` 只可镜像 UI/admin audit，不能充当这两条发送安全轴（DND 与
provider refusal）的唯一真源。

建议字段：`id, ownerId, contactId, action(set|clear), actorKind(merchant|otto|legacy_migration), actorId?,
sourceKind(crm_ui|otto_approved_action|legacy_contact_snapshot), evidenceRef?, idempotencyKey, receivedAt,
createdAt`（`:335`）。

closed matrix（未列组合拒写，`:335`）：

| `sourceKind` | `actorKind` | `action` |
|---|---|---|
| `crm_ui` | `merchant` | `set` \| `clear` |
| `otto_approved_action` | `otto` | `set` \| `clear` |
| `legacy_contact_snapshot` | `legacy_migration` | `set` |

约束：`UNIQUE(ownerId,idempotencyKey)`、tenant-qualified Contact relation、按
`(ownerId,contactId,receivedAt,id)` replay、无 ordinary UPDATE/DELETE；shared action 在同一 transaction 写
event 并维护 `Contact.doNotDisturb` compatibility projection。legacy `true` 生成一条确定性 migration `set`；
legacy `false` 等于无 active set。clear 只改变 DND fold，不制造 consent grant。Otto 只能经既有可见审批/动作层
调用同一 shared action。

Contact-wide scope note（§4.5，`2026-07-16-r010-schema-authority-alignment.md:326`）：DND 当前物理 scope 明确
为 **Contact-wide、覆盖全部 customer channels/purposes**；未来 channel-scoped DND 是新产品/schema 决定，本
方案不预设。

DND 独立性（`:325`）：DND 是 Contact 独立轴；清除 DND 不制造 grant。

M5 冻结顺序（`:488`）：`ContactDndEvent` 成为 DND authority；`doNotDisturb` 只作 compatibility projection，
generic `ActionEvent` 只作镜像。

### §2.4 ProviderRefusalEvent + ProviderRefusalState（kind 分类法，closed validator）

用途一句话：append-only 的 provider 层拒收事实表；`ProviderRefusalState` 是可重建的当前 block 状态读模型。

标记：【本 PR 提案】（`2026-07-16-r010-schema-authority-alignment.md:337-346`，`:337` 为「建议」）。

taxonomy（§4.5，`:327`）：provider refusal 的 normalized taxonomy 至少分三类：`permanent_recipient`（hard
block affected connection/channel/recipient，直到 verified clear）、`transient`（429/5xx/timeout，只
重试/backoff，不写长期 Contact block）、`account_level`（暂停该 connection/account，不污染其它
provider/channel）。provider 更换不改 consent history，也不得把旧 connection refusal 静默提升为新 connector
的全局事实。

建议字段（`:337`）：`id, ownerId, scopeKey, providerConnectionId, channel?, contactIdentityId?,
kind(permanent_recipient|transient|account_level), action(block|observe|clear|expire), actorKind(provider|system),
actorId?, providerCode, receiptRef, reversesEventId?, idempotencyKey, receivedAt, expiresAt?, createdAt`。

server-derived `scopeKey`（`:337`）：`account_level` → `account:<connectionId>`；`permanent_recipient` →
`recipient:<connectionId>:<channel>:<identityId>`；目的是避免 nullable-column unique 漏网。

closed validator 规则（`:338-344`）：

- `permanent_recipient` 必须完整指向同 tenant 的 connection + channel + ContactIdentity；只允许
  `block|clear`，**禁止 expire**；clear 须有同 scope verified provider/recipient evidence 并引用 active
  block；
- `account_level` 必须只有同 tenant connection scope，不能污染其它 connection/channel/Contact；允许
  `block|clear`，只有原 block 带 provider/account policy 可验证的 finite `expiresAt` 时才允许 system
  `expire`；
- `transient` 只能 `observe`，零长期 block projection；
- `clear` 与获准的 account-level `expire` 必须引用同 scope active block 与可验证 receipt/evidence，并以
  `UNIQUE(ownerId,idempotencyKey)` exactly-once；`scopeKey` 必须由字段重算验证，caller 不可传或覆盖；
- account-level `expiresAt` 只作受控 system 任务的调度证据，reader 不得因 wall clock 越过它而隐式解除
  block；到期时 system 必须在同 scope lock 内 append `expire` event，引用 active block 与原 verified expiry
  evidence，并使用 `refusal-expire:<blockEventId>:<expiresAt>` 稳定 idempotency key；event 未成功落账前
  block 继续生效；
- 可重建 `ProviderRefusalState` 以 `UNIQUE(ownerId,scopeKey)` 只保存 exact scope、`blocked`、
  `lastEventId/lastReceivedAt`，无独立 mutation API；send reader 按本次实际 connection/identity 读取；raw
  payload/PII 不进该表。

fold 规则（`:346`）：两类 event 都使用 tenant-qualified scoped lock 与 `(receivedAt,id)` deterministic
fold。删除 generic audit、清 projection 或更换 provider adapter 均不能改变 authority；projection 可由 event
全量 replay 恢复。

M5 冻结顺序（`:488`）：`ProviderRefusalEvent` 成为 refusal authority。

## §3 M0–M6 执行序列转述

R-010 §7 冻结的是**建议顺序**，不是本方案自带的执行授权；「所有执行都需要另行 Founder schema/migration/production
授权」（`2026-07-16-r010-schema-authority-alignment.md:432`）。以下逐步转述与本方案表清单相关的部分，出处均
标注行号：

- **M0 — Reconcile before mutation**（`:434-441`）：pin exact deployed SHA/image digest；SELECT-only 核
  production migration ledger、shared checksums、rollback chronology、物理 catalog/index/constraint、row
  counts/value distributions；inventory 全部 identity/consent/UTM readers/writers/raw SQL/imports/workers；
  产出无 PII dry-run mapping/collision report；建立并 restore-test 可识别 backup/PITR point；在 production
  snapshot clone rehearsal。
- **M1 — Expand before behavior change**（`:443-450`）：新 migration，不改旧 migration。Phase 1 identity 只
  additive 建立 D9 最小 `ChannelScope` 五字段、`UNIQUE(ownerId,channel,scopeKey)`、同 tenant/channel 的
  `ChannelConnection`/`ContactIdentity` references 与 active 四事实 unique；不得新增 lifecycle
  machinery；任何 migration/schema 仍须另获 Founder 批准。现有三事实 rows/index 只按 legacy 事实保留，先做
  tenant-qualified verified scope backfill；无法证明 scope 的 row 保持 disabled/quarantined。四事实
  writer/index 在 backfill 验证与原子切换前不得启用。`ConsentEvent` 及其 projection 只有在本 PR 物理合同
  获批**且** §4.7/B13 逐 carrier privacy gate 通过后才可 additive；缺任一项不得启动 migration 或
  implementation。`ContactDndEvent`、`ProviderRefusalEvent` 与其 projections 仍须本 PR 对应物理合同批准；不
  新增 Campaign UTM store。D8 延后的 reactive/D5 manifest/anchor/confirmation/outbox/receipt/runtime 不得在
  R-010 占位落地，native contract 未获批前全部 dependent implementation/path disabled。
- **M2 — Single writer seams**（`:452-463`）：identity、consent、DND、provider refusal、UTM 各建立唯一
  shared action/materializer；scope/external canonicalization 只有一个 server chokepoint；static/runtime
  tests 阻止 direct legacy writes。新 identity 只经 shared resolver 在获批 D9 carrier 上写 active 四事实
  Channel identity；unmapped/ambiguous/conflicting scope 零 exact attach/create。consent 先
  dark-launch/shadow；任何 live consent endpoint 启用时，须在同一 exact release 同时具备 event insert +
  `whatsapp × marketing` compatibility projection 同 transaction，以及 send consent-state reader 从第一条
  live event 起可见。STOP endpoint 启用前须证明 §4.3.1 的同 transaction fan-out、共享 operationId、
  per-purpose idempotency 与两 tuple consent-state readers 全在同一 exact release 生效。任何 live
  DND/provider refusal endpoint 同样要求 typed event + compatibility/state projection + send hard-negative
  reader 在同一 exact release 可见；禁止产生 reader 看不见的新 block。
- **M3 — Honest backfill**（`:465-474`）：Identity 轴——现有三事实 row 只有在同 tenant/channel 的 stable
  `scopeKey` 可验证时才 backfill 到 D9 `ChannelScope`，无法证明、unmapped、ambiguous、conflicting scope 或
  跨 owner 异常保持 disabled/quarantined。Consent 轴——`unknown` 不生成 event；verified purpose-bound
  historical revoke 写 `historical_verified_revoke`；verified unqualified historical STOP 按 D4 写
  `historical_verified_stop` 原子 fan-out；无法证明 scope 的 known negative 进 visible quarantine 并阻止
  M5。DND/provider refusal 轴——legacy DND `true` 写确定性 set event；可验证 provider block/clear 按 exact
  scope 迁移；actor/scope 不明不得猜。backfill 重跑必须 byte/semantic idempotent。
- **M4 — Shadow read and compare**（`:476-480`）：new projection 与 legacy behavior 同时计算，但只标一个
  authority；identity 比较 D9 scope/root/collision/backfill quarantine 与零 auto-attach；consent 比较 tuple
  state，特别验证 unknown 不被移出名单、known revoke 不被自动放行；所有差异分类、可解释；零 unexplained
  drift 才请求 cutover。
- **M5 — Authority cutover**（`:482-491`）：identity writer/read 只使用 D9 `ChannelScope` 与 active 四事实
  key；三事实 row 须完成 verified tenant-qualified backfill，否则保持 disabled/quarantined。ConsentEvent 成为
  唯一 permission-fact truth；writer、consent-state reader、projection 与 receipt cursor 按一个 controlled
  cutover 切换；Contact 三字段退出 business reads，只作待删 legacy；所有不能安全表示/排序的 known historical
  revoke 必须为零或已有单独 Founder 规则。`ContactDndEvent` 与 `ProviderRefusalEvent` 分别成为 DND/refusal
  authority；`doNotDisturb` 只作 compatibility projection，generic `ActionEvent` 只作镜像。不在 cutover 同时
  drop 旧列/index/table。
- **M6 — Contract / destructive cleanup**（`:493-498`）：所有 readers、exports、Otto、reports、workers 与
  tests 已脱离 legacy authority；production verification、backup restore、rollback/forward-fix rehearsal 与
  independent review 全通过；另取 Founder destructive approval 后才 drop 旧 identity index、Contact consent
  fields 或 `utmBase`；DND 与历史 events/links/snapshots 不随 legacy 字段删除。

四事实 writer/index 只在原子切换（backfill 验证完成后一次性启用）前不得启用（`:447`）；`ConsentEvent`
additive 只在本方案获 Founder 批准**且** §4.7/B13 per-carrier 隐私 gate 通过后才可进行（`:448`）——这是本
方案与 §4 privacy gate 的直接衔接点。

## §4 B13/privacy gate 清单

出处：R-010 §4.7（`2026-07-16-r010-schema-authority-alignment.md:361-366`）与 §11.2 gate 6（`:656`）。

在 gate 6 通过前，任何依赖的 `ConsentEvent`/D5 implementation 不得开始或启用（`:656`）。gate 6 要求以下事项
必须逐 carrier 完成，才允许 §2 中 `ConsentEvent` 与 D5 相关载体的 migration/implementation 启动：

- `evidenceRef` 只保存 opaque ID/哈希引用，不默认复制 raw message、email、phone、token 正文或 provider
  payload；source system 另按其 retention 控制（`:363`）。
- `ConsentEvent`、D5 source action/manifest/reactive anchor/confirmation/outbox/receipt 与 provider refs 都
  必须进入 B13/privacy 逐 carrier 矩阵：authorized reader/writer、最小字段、加密/key scope、retention、
  access/export/DSAR、erasure/pseudonymization、terminal compaction、backup/replica expiry 与 support
  access（`:364`）。
- Contact erasure 不能靠普通 event UPDATE/DELETE 假装完成；受控 privacy operation 必须独立授权、审计、幂等、
  可验证，保留依法可保留且不改变 permission fold 的最小事实，并覆盖 primary、backup、replica、export、
  receipt 与 support tooling（`:365`）。
- 具体 retention 期限与 terminal 处理由 B13/privacy implementation gate 冻结，不是 D5 consent 行为或本
  Draft Ready 的产品选择；但该 gate 未通过前，任何依赖的 ConsentEvent/D5 implementation 与 send path 不得
  开始或启用（`:366`）。

排除项（也是同一 gate 的一部分）：raw payload/PII 默认不进本方案任何表——`evidenceRef` 只存 opaque
引用（`ConsentEvent.evidenceRef`，`:176`）；`ProviderRefusalState` 明示 raw payload/PII 不进该表（`:344`）。

本方案不通过、不宣称已通过 B13/privacy 逐 carrier 矩阵——现状见 §7（Unknown）。

## §5 明确不做

以下事项本方案明确不建、不实现、不占位：

- **D7/D9 禁止的 lifecycle machinery**：不得给 `ChannelScope` 添加 status、TTL、issuer、
  retirement/reactivation、assignment epoch、recycle/reassignment automation、quarantine、auto-revive、
  automatic person inference、auto-merge（`2026-07-16-r010-schema-authority-alignment.md:116`）；Phase 1 不
  建设 issuer/recycle/revive/reassignment lifecycle（D7，`:33`；`:640`）。
- **不建 Campaign UTM store**：Phase 1 Campaign 只归组，不保存可编辑 UTM string/JSON；`Campaign.utmBase`
  实施后 stop-write（D3/D10，`:374`）；M1 明示「不新增 Campaign UTM store」（`:448`）。
- **D8 延后载体不在本方案**：`DeliveryManifest`、provider-ingested reactive anchor、`ActionReceipt`、
  `actionId/actionRevision` minting、confirmation attempt、outbox、receipt、lock/retry、retention 与
  reconciliation 的完整 physical/runtime 合同全部移到各自 native implementation/schema task
  （§4.3.3，`:248`）。在适用合同另获 Founder 批准、实现并验证前，所有依赖它们的 reactive/D5 carrier、
  first/final confirmation、automation、submission、outbox、worker、receipt 与 send path 保持
  disabled/fail-closed 且不得作任何 user-facing availability claim（`:248`）；该 deferral 必须在任何对应
  live send path 启用前、并在 Phase-1 Customer Engagement CRM completion 可被接受前完成冻结、实现与验证
  （`:250`，gate 4：`:654`）。
- **continuity-proof carrier 与 full merge runtime**：其 physical evidence carrier 属于 D8 允许延后的
  implementation contract；未获批、实现并验证前，对应 attach/merge/unmerge writer 保持
  disabled/fail-closed（gate 2，`:652`）。
- **D10 下游 path bounded contract 未冻结的部分**：Campaign ID vs slug、逐 path exact
  source/medium/content/term mapping、physical storage、redirect domain/infrastructure、bot/dedupe、report
  UI、privacy/retention 归后续逐 path bounded contract（gate 5，`:655`），本方案不涉及、不占位。

## §6 批准语义与后续

Founder 批准本文档意味着：

- 对 §2 列出的表（`ChannelScope`、`ConsentEvent`/`ConsentStateProjection`、`ContactDndEvent`、
  `ProviderRefusalEvent`/`ProviderRefusalState`）的物理形状表示**方案层面认可**，满足 R-010 §11.2 gate 1
  （D9 `ChannelScope` 最小语义方案批准，`:651`）与 gate 3（ConsentEvent/closed writer/fold/projection 与
  typed DND/provider-refusal authority 的 bounded physical proposal 批准，`:653`）。

Founder 批准本文档**不**意味着：

- 不构成 Prisma schema 变更、migration 编写或执行的授权；
- 不构成 production 授权；
- 不构成 §3 中任一 M-step（M0–M6）的执行授权——每步仍须另行 Founder schema/migration/production 授权
  （`:432`）；
- 不构成 §4 B13/privacy 逐 carrier gate（gate 6）的通过——gate 6 是独立、另行的批准点（`:656`）；
- 不构成 D8 延后载体（reactive/D5 manifest/anchor/confirmation/outbox/receipt/runtime）的批准——归各自
  native task（gate 4，`:654`）；
- 不重开或重裁 D1–D10 已批准的产品/authority 结果（`:632`）。

下一步（按依赖顺序，非本文档裁定的排他顺序）：

1. 针对 §2 表清单逐条另取 Founder migration 授权，启动 R-010 M0–M1（`:432`、`:443-450`）。
2. B13/privacy 逐 carrier 隐私矩阵完成并通过 gate 6（`:656`），之后 `ConsentEvent` 及其 projection 才可
   additive（`:448`）。
3. 依 §345 map C1 候选归组（`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:200`）另行开
   C1 build ticket，承接 B0-59/60 与 #327 rework。

## §7 Unknown/风险

- **naming/constraint 规范化余地**：R-010 明示 exact constraint naming 与 soft-delete 表达可在
  implementation contract 规范化，但不得退回三事实 authority（`2026-07-16-r010-schema-authority-alignment.md:114`）；
  M1 同样允许 exact 命名/constraint 表达规范化但不得新增 lifecycle machinery（`:446`）。具体命名规范尚未
  冻结——**Unknown**，留待 implementation contract。
- **B13/privacy 矩阵现状**：**Unknown**。R-010 §4.7/§11.2 gate 6 要求逐 carrier 隐私矩阵，但本文档未发现
  该矩阵已存在或已通过的证据；gate 6 未通过前 `ConsentEvent`/D5 implementation 不得开始（`:656`）。此项按
  指示原样报告，不代为解决。
- **R-010 文档自身状态标记与已合并事实并存**：R-010 文档头部自标
  `DRAFT/FINAL-CONVERGENCE-REVIEW-PENDING/SPEC-ONLY`（`2026-07-16-r010-schema-authority-alignment.md:3`），
  但该文档已随 PR #342 合并入 live main（git log：`02de92de docs(crm): draft R-010 schema authority alignment
  (#342)`），且 map 文档 §9 记录「PR #342 已合并、#339 已以 P0=0/P1=0 关闭」
  （`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md:217`）。两个事实并存照录，本文档不代为裁决
  R-010 的最终状态标记是否应更新；沿用 map 文档同一处理方式（照录不裁决）。
- **§4.3 closed source/action matrix 与 fold 表的组合完整性**：本文档逐条转述 R-010 §4.3/§4.4 的表格，未
  发现内部矛盾；但 `system` actorKind 在 ConsentEvent 中被明确排除（`:172`、`:86`）而在 ProviderRefusalEvent
  中被允许（`actorKind(provider|system)`，`:337`）——这是 R-010 原文本身的差异化设计（不同 typed
  authority 各自明列 system actor 是否适用，`:86` 明示「不影响 ProviderRefusalEvent 等其它 typed authority
  明列的 system actor」），非本文档转述引入的不一致，特此注明供 Founder 审阅时留意，不代为消解。
- 除上述三项外，本文档在整理过程中未发现 R-010 §3.2/§4.2/§4.4/§4.5/§4.5.1/§4.6/§7/§9/§11.2 与
  map §8 C1 行之间存在实质性冲突或歧义；若审阅中发现本文档转述有误或遗漏，请对照本文档各条目的行号出处与
  R-010/map 原文核对。
