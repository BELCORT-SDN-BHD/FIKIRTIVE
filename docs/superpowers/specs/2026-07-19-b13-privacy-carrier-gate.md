# B13/Privacy 逐 Carrier Gate 清单（R-010 §11.2 Gate 6 前置）

> **状态：原五 carrier 的 scoped PASS 已在 PR #360 合并后生效；C4b-M0 六 carrier 扩展已获 Founder 产品批准，
> 待本次 PR 合并后生效（见 §5.2）。** 清单（PR #357）与原五行回填（PR #360）均已合并，#356 已关闭；
> Q-1～Q-7 已全部裁决（#356 评论 D-Q1～D-Q7，2026-07-19）。本次更新只依 #372 把相同已批原则扩展到
> C4a §5.1 已批准的六个物理 carrier，并给出独立判定；本文档不含代码、不动 Prisma schema/migration、不写
> 对外隐私政策/ToS 文本，也不代替任何下游施工或授权步骤。
>
> 证据基线：live `main` `660efe0e3b12f0ae469bf3c132fdd7c3f9760237`（2026-07-20，C4a PR #369
> 已合并；本次 C4b-M0 回填在此基线上进行）。
>
> 关联：[#356](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)（本票 mandate 与 Q-1～Q-7 裁决记录）；
> [#368](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/368)（C4a 合同 mandate）；
> [#372](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/372)（C4b-M0 Founder 批准、精确 scope 与
> [六个物理 carrier 名称勘误](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/372#issuecomment-5020434345)）；
> [#359](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359)（延后事项总台账，D-Qn 各裁决产生的延后
> 项均已登记于此，本文档回填时逐条引用）；R-010
> `docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md` §4.7 / §11.2 gate 6（`:656`）；
> `docs/superpowers/specs/2026-07-19-c1-identity-consent-schema-proposal.md` §4（PR #353 已批）；
> `docs/superpowers/specs/2026-07-19-c4a-inbox-whatsapp-physical-contract.md` §5/§9/§10/§14（PR #369 已批）。
>
> 零发明声明：本文档不选择、不新增、不细化任何来源文档未冻结的隐私规则、保留期、删除机制或访问权限。凡来源
> 标记为「建议」的物理形状，本文档原样转述；凡来源未给出答案的问题，本文档只呈递为【待 Founder 裁决】问题，
> 不代答、不给唯一推荐、不暗示默认值。本次 C4b-M0 回填只照录 #356 D-Qn、#372 已批规则与 C4a 已批物理合同；
> 不新增表、字段、runtime/provider 行为，也不代 Founder 补充来源未写的细节。

## §1 门的语义

**gate 6 挡什么、放什么什么时候解锁：**

R-010 §4.7 明示：「`ConsentEvent`、D5 source action/manifest/reactive anchor/confirmation/outbox/receipt 与
provider refs 都必须进入 B13/privacy 逐 carrier 矩阵：authorized reader/writer、最小字段、加密/key scope、
retention、access/export/DSAR、erasure/pseudonymization、terminal compaction、backup/replica expiry 与
support access」
（`docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md:364`）。同段落最后一句冻结了 gate 的
生效边界：「具体 retention 期限与 terminal 处理由 B13/privacy implementation gate 冻结……但该 gate 未通过前，
任何依赖的 ConsentEvent/D5 implementation 与 send path 不得开始或启用」（`:366`）。R-010 §11.2 把这条列为
gate 6：「B13/privacy 逐 carrier 矩阵不是本 Draft Ready 的产品选择，但未通过前不得开始依赖的
ConsentEvent/D5 implementation」（`:656`）。D8 决议同样把这题指回本 gate：「D5 行为不变，retention 归
B13/privacy implementation gate」（`:34`）。

**gate 6 不挡什么、不裁什么：**

- 不重新呈问 D1–D10 已批准的产品/authority 结果（`:632`）；
- 不构成 Prisma schema、migration 或 production 授权——那是 R-010 §11.2 gate 1/gate 3（`:651`、`:653`）分别
  管的「D9 `ChannelScope` 最小语义方案批准」与「ConsentEvent/closed writer/fold/projection 与 typed
  DND/provider-refusal authority 的 bounded physical proposal 批准」，均为独立、另行的批准点。现状：Founder
  已合并 C1 方案 PR #353（`a0429451`），据 C1 §6「Founder 批准本文档意味着……满足 R-010 §11.2 gate 1……与
  gate 3……」（`docs/superpowers/specs/2026-07-19-c1-identity-consent-schema-proposal.md:474-479`），gate
  1/gate 3 已在 **bounded-proposal 层面**满足；但同一节明示这不构成 Prisma schema 变更、migration、
  production 或任一 M-step 执行的授权，也不构成本 gate（gate 6）的通过（`:481-487`）——这些授权当时仍须
  另取；原五 carrier 后续由 PR #362（`49aca8f8`，五模型/additive migration/tenant guard/schema tests）、
  PR #364（`83946443`，closed writers/fold/replay/projections runtime）与 PR #366（`1f8d8f26`，Contacts
  UI/actions/Otto vertical；未新增 schema/migration）分步落地，scoped PASS 已生效。C4b-M0 六 carrier 是
  §2/§5.2 另列、仅在本次 PR 合并后生效的扩展，不重授或改变任何 schema/migration/production 权限；
- 不处理 D8 延后的 reactive/D5 物理载体（`DeliveryManifest`、`ActionReceipt`、confirmation/outbox/receipt
  runtime）本身的批准——那归 gate 4，各自 native implementation/schema task（`:654`）。本 gate 只在这些载体
  的物理形状被冻结之后，才需要把它们的隐私维度补进矩阵（见 §2 「未来扩展」行组）。

**本文档矩阵范围与 R-010 §4.7 字面列举的差异（需要照录说明，不代为消解）：** R-010 §4.7 原文字面点名的
carrier 是 `ConsentEvent`、D8 延后的 D5 source action/manifest/anchor/confirmation/outbox/receipt，以及
「provider refs」（对应 `ProviderRefusalEvent`/`ProviderRefusalState`），**并未点名** `ContactDndEvent`。但
[#356](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356) 的 Founder 批准 scope 明确把
`ContactDndEvent`、`ConsentStateProjection`、`ProviderRefusalState` 一并列入本次矩阵范围。本文档遵循 #356
这一更宽的现行 mandate 边界（DND 与 provider refusal 在 R-010 §4.5.1 中被称为「这两条发送安全轴」的同一段
落里共同定义，`:333`，结构上属同一隐私考量），但如实标注：把 `ContactDndEvent` 纳入 gate 6 矩阵这件事本身，
在 R-010 原文里没有逐字依据，只有 #356 的当前 mandate 依据。

**passing 的含义**：见 §5。原五 carrier 状态与 C4b-M0 扩展分别判定；C4b-M0 的文档创建、commit 或提交审阅
都不代表该扩展已生效。

## §2 逐 carrier 隐私矩阵

范围内五个 carrier（依 #356 scope）：`ConsentEvent`、`ContactDndEvent`、`ProviderRefusalEvent`、
`ConsentStateProjection`、`ProviderRefusalState`。本节保留其 R-010/C1 proposal 来源与当时的物理合同措辞；
五个模型/additive migration/tenant guard/schema tests 由 PR #362（`49aca8f8`）合并；closed
writers/fold/replay/projections runtime 由 PR #364（`83946443`）合并；PR #366（`1f8d8f26`）只新增 Contacts
UI/actions/Otto vertical，未新增 schema/migration。本票不修改或重审该 implementation。R-010 §11.2 gate
1/gate 3（`:651`、`:653`）曾因 Founder 合并
C1 方案 PR #353（`a0429451`）在 bounded-proposal 层面满足（C1 §6，`:474-479`）；五行 privacy scoped PASS
已在 PR #360 合并后生效。C4b-M0 六行扩展另见下表与 §5.2，且仍不授予任何 C4 schema/migration/production
动作。

| carrier | 数据类别与 PII 含量 | 保留期 | 删除与导出（PDPA） | 访问控制与审计 | raw payload 排除 | 跨租户隔离 | 法律依据 | 加密/key scope |
|---|---|---|---|---|---|---|---|---|
| **ConsentEvent** | append-only permission-fact 事件；字段 `id/ownerId/contactId/channel/purpose/action/actorKind/entryMode/sourceKind/evidenceStatus/evidenceRef/operationId/idempotencyKey/occurredAt/receivedAt/createdAt`（R-010 `:162-181`）。`contactId` 关联 Contact（PII-adjacent，非本表自身存 PII 正文）；`evidenceRef` 为 opaque 引用（`:176`） | **已裁决（#356 D-Q1，2026-07-19）**：平台不设强制保留期限，不做任何平台发起的自动删除/清理/压缩；permission 事件记录是商家资产，是否/何时处置由商家自主决定（平台不代删，见本表「删除与导出」列） | **删除已裁决（#356 D-Q2，2026-07-19）**：第一期只做 tag/提醒机制呈现给商家，平台不建删除/处置工具；物理 erasure 机制（匿名化/去标识 vs 硬删行）deferred，硬删除因破坏 append-only 证据链被明确不倾向，触发条件=将来给商家做处置工具时另行一题呈批（台账 #359-2）。**导出已裁决（#356 D-Q3，2026-07-19）**：导出是商家标准权利，随 CRM 功能正常排期建设，非隐私门阻塞项（台账 #359-3）。已冻结原则：受控 privacy operation 必须独立授权、审计、幂等、可验证，保留依法可保留且不改变 permission fold 的最小事实，并覆盖 primary/backup/replica/export/receipt/support tooling（`:365`）；普通 event 不得 UPDATE/DELETE 假装完成擦除（`:365`、`:185`） | 已冻结：`ownerId` 只来自 authenticated session（宪法 6，R-010 `:415`）；UI/Otto 只能经 shared action，不建 connector-specific 分叉（`:418`）；append-only、无 ordinary UPDATE/DELETE（`:185`；R-010 未称此为「审计轨迹」，本文档不代为定性）；writer 组合仅限 closed source/action matrix 列明的 `sourceKind×action×actorKind×entryMode×evidenceStatus` 组合，未列组合一律拒写（`:191-208`）。**已裁决（#356 D-Q4，2026-07-19）**：租户内部——第一期工作区成员均可查看（现阶段=老板/极小团队）；平台侧——沿用既有冒充模式（禁写+审计留痕，F15）。细分 RBAC（含 privacy operation 执行者/审计读者的独立角色划分）deferred，触发条件=「团队协作+市政厅 v2」街区动工时以真实协作模型为输入一并设计（台账 #359-6） | 已冻结：`evidenceRef` 只保存 opaque ID/哈希引用，不得默认保存 raw message、email、phone、token 正文或 provider payload（`:176`、`:363`） | 已冻结：`ownerId + contactId` 同租户由 writer fail-closed（`:188`）；共用 tenant 不变量 §6（`:410-419`）；two-org negative tests 要求（`:417`）；验收 ID-11/C-12 | **已裁决（#356 D-Q5，2026-07-19）**：平台采取受托处理方姿态（商家=数据主人，平台只按商家指令处理），与 D-Q1/D-Q3 一致。法律依据正式分类与对外文本（隐私政策/ToS/数据删除回调）deferred，触发条件=B13 法务面施工时逐字呈批（台账 #359-17），归入独立的 PDPA 姿态文件（`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:55`；矩阵行 B0-93，现状 `absent`，`docs/ops/route-b/matrix/13-B13.md:16`） | **已裁决（#356 D-Q7，2026-07-19）**：第一期采用平台托管加密（存储加密+传输 TLS），不做字段级加密。企业级加密（字段级/自管密钥）为未来必须项（Founder 明令，非可选），触发条件=企业级客户/分层产品设计时立项呈批（台账 #359-18） |
| **ContactDndEvent** | append-only DND set/clear 事实；字段 `id, ownerId, contactId, action(set\|clear), actorKind(merchant\|otto\|legacy_migration), actorId?, sourceKind, evidenceRef?, idempotencyKey, receivedAt, createdAt`（`:335`）；Contact-wide compatibility projection `Contact.doNotDisturb`（`:359`） | **已裁决（#356 D-Q1，2026-07-19，与 ConsentEvent 同题）**：平台不设强制保留期限，不做自动删除/清理/压缩；处置由商家自主决定 | **已裁决（#356 D-Q2/D-Q3，2026-07-19，与 ConsentEvent 同题）**：删除机制 deferred（tag-only Phase 1，触发条件=商家处置工具立项时呈批，台账 #359-2）；导出随 CRM 排期，非门阻塞（台账 #359-3）。DND 是 Contact 属性之一，受同一 Contact 处置原则约束（`:365`） | 已冻结：append-only、无 ordinary UPDATE/DELETE（`:335`）；writer 组合仅限 closed matrix `crm_ui × merchant × set|clear`、`otto_approved_action × otto × set|clear`、`legacy_contact_snapshot × legacy_migration × set`（仅 `set`，无 `clear`），未列组合拒写（`:335`）；Otto 只能经「既有可见审批/动作层」调用同一 shared action（`:335`）。**已裁决（#356 D-Q4，2026-07-19，与 ConsentEvent 同题）**：工作区成员均可**查看**（「清除/clear」是写操作，不由 D-Q4 授予，仍仅受本格前列已冻结 closed writer matrix 约束）；平台侧沿用冒充模式（禁写+审计）；细分 RBAC deferred 至「团队协作+市政厅 v2」街区（台账 #359-6） | 结构性排除：字段清单不含 raw 内容字段，仅 `evidenceRef?` opaque 引用（`:335`）；未见 R-010 对 `ContactDndEvent.evidenceRef` 逐字重申「不得默认保存 raw」，按 `:363` 的通用 evidenceRef 原则类推适用 | 已冻结：tenant-qualified Contact relation（`:335`）；共用 tenant 不变量 §6 | **已裁决（#356 D-Q5，2026-07-19，同 ConsentEvent）**：受托处理方姿态；正式法律依据分类 deferred 至 B13 法务面（台账 #359-17） | **已裁决（#356 D-Q7，2026-07-19，同 ConsentEvent）**：第一期平台托管加密（存储加密+TLS）；企业级字段级/自管密钥 deferred（台账 #359-18） |
| **ProviderRefusalEvent** | append-only provider 拒收事实；字段 `id, ownerId, scopeKey, providerConnectionId, channel?, contactIdentityId?, kind(permanent_recipient\|transient\|account_level), action(block\|observe\|clear\|expire), actorKind(provider\|system), actorId?, providerCode, receiptRef, reversesEventId?, idempotencyKey, receivedAt, expiresAt?, createdAt`（`:337`） | **已裁决（#356 D-Q1，2026-07-19，同题）**：平台不设强制保留期限，不做自动删除/清理/压缩；处置由商家自主决定 | **已裁决（#356 D-Q2/D-Q3，2026-07-19）**：删除机制 deferred（tag-only Phase 1，触发条件=商家处置工具立项时呈批，台账 #359-2）；导出随 CRM 排期，非门阻塞（台账 #359-3）。本表经 `contactIdentityId` 关联 Contact 时同受 Contact 处置原则约束（`:365`） | 已冻结：closed validator 按 `kind`（`permanent_recipient`/`account_level`/`transient`）固定允许的 `action` 集合，未列组合拒写（`:337-344`）；tenant-qualified scoped lock、`UNIQUE(ownerId,idempotencyKey)` exactly-once（`:346`）；system-actor 的 account-level `expire` 仅限受控调度证据触发（`:340-343`）。**已裁决（#356 D-Q4，2026-07-19，同 ConsentEvent）**：工作区成员均可查看；平台侧沿用冒充模式（禁写+审计）；细分 RBAC deferred 至「团队协作+市政厅 v2」街区（台账 #359-6） | 部分冻结：`ProviderRefusalState`（读模型）明示「raw payload/PII 不进该表」（`:344`），但这句话字面只覆盖 State 读模型，**已裁决（#356 D-Q6，2026-07-19）**：`receiptRef` 与 `evidenceRef` 及 State 表统一适用同一 raw-payload 排除规则——账本只存不透明引用，不复制供应商原始材料；商家在界面照常看到联系人与拒发事实（联系人数据本就在其归属表） | 已冻结：`scopeKey` 由字段服务端重算验证，caller 不可传或覆盖（`:337-338`）；tenant-qualified scoped lock（`:346`） | **已裁决（#356 D-Q5，2026-07-19，同 ConsentEvent）**：受托处理方姿态；正式法律依据分类 deferred 至 B13 法务面（台账 #359-17） | **已裁决（#356 D-Q7，2026-07-19，同 ConsentEvent）**：第一期平台托管加密（存储加密+TLS）；企业级字段级/自管密钥 deferred（台账 #359-18） |
| **ConsentStateProjection** | 可重建读模型；字段 `ownerId/contactId/channel/purpose, state, lastEventId/lastReceivedAt, stateActorKind/stateSourceKind/evidenceStatus, updatedAt`（`:280-285`）；无独立 mutation API，清空后全量 replay 得到同一 semantic state（`:287`） | **已裁决（#356 D-Q1，2026-07-19）**：本表无独立 mutation API，由底层 `ConsentEvent` replay 重建（`:287`），随底层 event 同受 D-Q1 约束——平台不设强制保留期、不做自动清理；本投影自身无独立留存策略可言 | 已冻结：无独立 mutation API；清空后全量 replay 得到同一 semantic state（`:287`）。**已裁决（随底层 `ConsentEvent`，#356 D-Q2/D-Q3，2026-07-19）**：处置作用于底层 event 后经 replay 自动反映到本投影；删除机制 deferred（同 ConsentEvent 行，台账 #359-2）；导出随 CRM 排期（同 ConsentEvent 行，台账 #359-3） | 已冻结：无独立 mutation API，只能由 event 写入同 transaction 维护（`:287`）。**已裁决（#356 D-Q4，2026-07-19，同 ConsentEvent）**：工作区成员均可查看；平台侧沿用冒充模式；细分 RBAC deferred 至「团队协作+市政厅 v2」街区（台账 #359-6） | 结构性排除：字段清单不含 `evidenceRef` 或任何 raw 内容字段（`:280-285`）；这是从字段清单推导的观察，R-010 未就投影表单独重申排除措辞 | 已冻结：`ownerId` 是唯一 permission tuple 的组成部分（`:281`）；共用 tenant 不变量 §6 | **已裁决（#356 D-Q5，2026-07-19，同 ConsentEvent）**：受托处理方姿态；正式法律依据分类 deferred 至 B13 法务面（台账 #359-17） | **已裁决（#356 D-Q7，2026-07-19，同 ConsentEvent）**：第一期平台托管加密（存储加密+TLS）；企业级字段级/自管密钥 deferred（台账 #359-18） |
| **ProviderRefusalState** | 可重建读模型；`UNIQUE(ownerId,scopeKey)` 只保存 exact scope、`blocked`、`lastEventId/lastReceivedAt`，无独立 mutation API（`:344`） | **已裁决（#356 D-Q1，2026-07-19，同 ConsentStateProjection 的推导逻辑）**：本表由底层 `ProviderRefusalEvent` replay 重建，随底层 event 同受 D-Q1 约束——平台不设强制保留期、不做自动清理 | 已冻结：无独立 mutation API；由 event 全量 replay 重建（`:344`、`:346`）。**已裁决（随底层 `ProviderRefusalEvent`，#356 D-Q2/D-Q3，2026-07-19）**：处置作用于底层 event 后经 replay 自动反映到本投影；删除机制 deferred（同 ConsentEvent 行，台账 #359-2）；导出随 CRM 排期（同 ConsentEvent 行，台账 #359-3） | 已冻结：send reader 按本次实际 connection/identity 读取，无独立 mutation API（`:344`）。**已裁决（#356 D-Q4，2026-07-19，同 ConsentEvent）**：工作区成员均可查看；平台侧沿用冒充模式；细分 RBAC deferred 至「团队协作+市政厅 v2」街区（台账 #359-6） | **已冻结**：「raw payload/PII 不进该表」（`:344`，逐字原文），本项无待裁决 | 已冻结：`UNIQUE(ownerId,scopeKey)`（`:344`）；共用 tenant 不变量 §6 | **已裁决（#356 D-Q5，2026-07-19，同 ConsentEvent）**：受托处理方姿态；正式法律依据分类 deferred 至 B13 法务面（台账 #359-17） | **已裁决（#356 D-Q7，2026-07-19，同 ConsentEvent）**：第一期平台托管加密（存储加密+TLS）；企业级字段级/自管密钥 deferred（台账 #359-18） |
| **MessageDeliveryEvent**（C6-M0 契约 PR #402 `9dcf8078` §7.2；[#405](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/405)） | append-only 入站 provider 送达事实（`accepted`/`delivered`/`read`/`failed`/`replied`）；字段仅 opaque ref/hash（`logicalSendRef`/`providerCode`/`receiptRef`/`externalMessageRef`/`sourceEventKey`/`sourcePayloadHash`）+ 时间戳（C6 §7.2）；可关联某联系人的某次发送，PII-adjacent（C6 §9.1） | **已裁决（Founder Resolution 2026-07-22，[#359](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359#issuecomment-5037075282)）**：回执数据商家自有；平台默认保留 24 个月，到期清理前提醒，商家可调长/调短/关闭；随时手动删/导出 | 走后续统一 privacy capability；Contact/Identity/BroadcastRun archive 不级联抹回执（`onDelete: Restrict`，C6 §9.2）；删除须与 C6 §10「回执是外部真相，不得删后重投」协调 | 仅 owner-scoped 只读对账/报告面，无独立 mutation API（C6 §7.1） | 绝不存 raw phone/消息内容/token/签名（C6 §7.2） | `ownerId` 强制 | 商家指令处理（平台为保管人）+ PDPA 数据最小化 + #356 D-Q1/D-Q3/D-Q5 + #359 retention resolution | DB at-rest + tenant boundary，不做 ad-hoc field crypto（C6 §9.2） |
| **MessageDeliveryState**（C6-M0 契约 PR #402 `9dcf8078` §7.3；[#405](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/405)） | rebuildable per-`logicalSendRef` 对账真相投影（`lifecycle`/`reconciliation`，C6 §7.3），PII-adjacent（C6 §9.1） | **已裁决（Founder Resolution 2026-07-22，#359，同 `MessageDeliveryEvent` 行）**：与 `MessageDeliveryEvent` 同策 | 同上；投影可由事件重建 | 仅 owner-scoped 读面，无独立 mutation API | 只存规范化状态与 ref | `ownerId` 强制 | 同上 | 同上 |

**备份/副本到期（R-010 `:364` 的 backup/replica expiry 维度，适用于上表全部五行）**：已裁决（#356 D-Q3，
2026-07-19）——平台灾备备份免费、仅用于灾难恢复、自动轮换过期，不构成独立数据用途、不是第二份可用数据；
「历史/归档深度」付费分层为停放创意（#358，台账 #359-5）。实际轮换配置/cadence 属基础设施实施事实，现状
= Unknown（见 §6），实施校验随 ConsentEvent 批次施工时核对；本维度的**政策**已由 D-Q3 裁决完毕。

**production backup/PITR（`MessageDeliveryEvent`/`MessageDeliveryState` 两行）**：production backup/PITR cadence
仍 Unknown，闸留 [#359](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359) item 12（生产授权），与 C6
§9.2 一致。

### C4b-M0 六 carrier 扩展（#372；本次 PR 合并后生效）

以下名称逐字沿用 C4a §5.1 的六个**物理 carrier**（`:185-200`），不是逻辑 alias，也不新增表。每行引用的
`C4-S1`～`C4-S8` 都是该行的规范内容，避免把同一已批规则复制六次：

| 共享规则 | 六行统一冻结内容 | 依据 |
|---|---|---|
| **C4-S1 ownership / legal-product basis** | 顾客对话、消息、事件、草稿与模板均属商家；平台只作保管人和工具，按商家指令处理。正式法律依据分类、隐私政策/ToS/数据删除回调仍留 B13 法务面逐字呈批。 | #356 D-Q1/D-Q3/D-Q5 与 Founder 原则「商家的 data，商家的权利，我们只是提醒」；#372；C4a §9.1–§9.2（`:524-546`） |
| **C4-S2 retention / delete / export** | 不设平台强制保留期，不做平台自动删除、清理、压缩或级联抹除；Contact/Identity/Member archive 不级联删历史。Phase 1 只给 tag/提醒，不建物理 erasure 工具；匿名化/硬删延后另批。标准导出随 CRM 正常排期。 | #356 D-Q1～D-Q3；C4a §5.1（`:209-211`）、§9.2（`:540-544`）；#372 |
| **C4-S3 access / audit / mutation** | Phase 1 同租户工作区成员可读；平台 impersonation 只读且必须审计。细分 RBAC 未获另批前，六 carrier 的所有 mutation 一律 default-deny；读权不推导 takeover、template submission 或 reply 权。 | #356 D-Q4；C4a M2（`:568-573`）、§11.2（`:637-638`）、§14.1–§14.2（`:746`、`:761`）；#372 |
| **C4-S4 tenant isolation** | `ownerId` 只来自 authenticated/trusted server context；所有 owner relation tenant-qualified。跨 owner、未知角色或 relation mismatch 均零读、零写、零 provider call。 | Blueprint 宪法 6；C4a §3.2（`:73-81`）、§11.2（`:628-638`）；#372 |
| **C4-S5 normalized product data / payload and log redaction** | 产品表可存各行已批的必要 normalized text 与结构化事实；不得存 raw webhook、provider DTO/payload、token、secret 或签名材料。电话、消息正文及 template/draft/handoff 正文不得进入 log/error/telemetry；可搜索 product text 不等于可记录 telemetry。 | C4a §3.2（`:82-87`）、§5.3–§5.6（`:245-375`）、§9.1（`:528-533`）、§11.2（`:636`）；#372 |
| **C4-S6 media** | Phase 1 只持久化 text 与安全的 `unsupported` placeholder；不保存顾客媒体 blob、remote signed URL 或隐藏 raw payload。新增 media kind/storage 必须另过 privacy/storage gate。 | C4a §5.3（`:254-283`）、§5.7（`:384-385`）、§9.2（`:543`）；#372 |
| **C4-S7 encryption / key scope** | Phase 1 使用平台托管 at-rest encryption 与 TLS；不加临时字段级加密。企业级字段级/自管密钥仍是未来必须项，触发时另行呈批。 | #356 D-Q7、台账 #359-18；C4a §9.1–§9.2（`:531-544`）；#372 |
| **C4-S8 backup / PITR** | 灾备备份仅用于恢复并按平台策略轮换，不构成独立数据用途；production backup/PITR 的实际状态、cadence 与数值仍为 **Unknown**。本矩阵不授权 production 查询、apply 或 deploy。 | #356 D-Q3；C4a §9.2（`:544`）、M0（`:552-558`）、§14.2（`:757`）；#372 |

| carrier | source / data class / PII | carrier-specific boundary and tenant relation | 统一维度与产品依据 |
|---|---|---|---|
| **CustomerConversation** | exact `ContactIdentity` 的稳定 Inbox thread/current projection；保存 status、assignee、automation/revision 与 activity 时间等结构化事实，identity/assignee 为 PII-adjacent。来源只可为同租户 identity resolver、accepted message writer 与 shared conversation actions（C4a §3.1 `:60-65`、§5.2 `:213-243`）。 | tenant-qualified `ContactIdentity`/`Membership` relation；identity-owner mismatch 零读写。conversation 不保存消息正文、raw provider 数据或媒体。 | **C4-S1～C4-S8 全部适用**；B0-31/38（C4a §2.1 `:29`、`:32`）。 |
| **CustomerMessage** | 规范化 inbound/outbound history；可含顾客/商家消息正文、`searchText`、actor 与时间（PII/商业内容），以及 canonical hash、stable key、opaque external ref。当前 outbound writer 在 D8/C6 gate 前 disabled（C4a §5.3 `:245-283`）。 | tenant-qualified Conversation relation；仅 bounded text 或 safe `unsupported` envelope，source payload hash 不携 raw payload；不得为了搜索保存第二份 raw 内容。 | **C4-S1～C4-S8 全部适用**；B0-31/33（C4a §2.1 `:29`、`:31`）。 |
| **CustomerConversationEvent** | assignment/control/open-close 的 append-only visible history；含 tenant-qualified actor/assignee、automation transition 与可能含 PII/商业内容的 bounded handoff note（C4a §5.4 `:285-300`）。 | tenant-qualified Conversation/Membership relation；note 只存 merchant-visible normalized text，不存 secret/raw provider payload；event 与 conversation projection 同 transaction。 | **C4-S1～C4-S8 全部适用**；B0-31/33/38（C4a §2.1 `:29-32`）。 |
| **CustomerConversationDraft** | 一个会话的共享可恢复草稿；normalized text、author 与 exact conversation/draft revisions，正文可能含 PII/商业内容（C4a §5.5 `:302-316`）。 | tenant-qualified Conversation/author relation；只允许 bounded text envelope，不含 provider request/receipt；永不充当 manifest/outbox 或直交 adapter。 | **C4-S1～C4-S8 全部适用**；B0-33/38（C4a §2.1 `:31-32`）。 |
| **CustomerMessageTemplate** | logical channel-scope template root；保存 tenant/channel scope、name/locale 与 local archive lifecycle，属于商家业务资料（C4a §5.6 `:318-330`）。 | tenant-qualified `ChannelScope` root；provider replacement 不换 root；archive 不删除 provider truth，也不推导 review/send authority。 | **C4-S1～C4-S8 全部适用**；B0-32/33（C4a §2.1 `:30-31`）。 |
| **CustomerMessageTemplateVersion** | 不可变 normalized template body、variables/sample、purpose/category、content hash 与 current review projection；正文/sample 可能含 PII/商业内容，external ref 仅 opaque（C4a §5.6 `:332-375`）。 | tenant-qualified Template/author relation；不存 provider DTO；仅 provider-neutral text definition，header/media/buttons 另走 bounded contract；review state 不等于 send approval。 | **C4-S1～C4-S8 全部适用**；B0-32/33（C4a §2.1 `:30-31`）。 |

本扩展只冻结上述 privacy 规则。Prisma/schema、migration/DB apply、provider/credentials/WABA/Meta、真实花费或
消息、D8 carrier 与 send/confirmation/outbox/receipt、production/deploy、CI-unavailable merge 均继续受 C4a
§14.1（`:740-753`）及 #372 hard exclusions 的独立 Founder gate；本表不授予其中任何一步。

### 未来扩展行组（D8 延后载体，本 gate 现在不判定，仅为完整性列出）

`DeliveryManifest`、provider-ingested reactive anchor、`ActionReceipt`、`actionId/actionRevision` minting、
confirmation attempt、outbox、receipt、lock/retry、retention 与 reconciliation 的完整 physical/runtime 合同
全部移到各自 native implementation/schema task（R-010 §4.3.3，`:248`）；在适用合同另获 Founder 批准、实现
并验证前，所有依赖它们的 reactive/D5 carrier、confirmation、automation、outbox、worker、receipt 与 send
path 保持 disabled/fail-closed 且不得作任何 user-facing availability claim（`:248`）。R-010 同时明示这些
载体的「详细 retention 归 B13/privacy implementation gate」（`:250`）——也就是说，**一旦**这些载体的物理形状
在各自 native task 中被冻结，它们必须重新纳入本矩阵（或其后继版本）才能通过 gate 6；在物理形状冻结之前，
本文档无法为它们填写任何一列（数据类别/保留期/删除/访问控制/raw payload/跨租户/法律依据），因为填写即等于
替 native task 发明尚不存在的 schema。这也是这些载体（含未来可能出现的 outbox 或 raw-evidence 内容存储
姿态，但不含上表已冻结的 C4 normalized product carriers）目前明确排除在本 gate 判定范围之外的原因——不是
遗漏，是依据 `:248` 的 deferral 边界。

### 未决 carrier 行组（quarantine/evidence 与 evidenceRef source system，本 gate 现在同样无法判定）

除上面 D8 延后载体外，R-010 还提到两类目前**没有冻结物理形状**的载体：quarantine/evidence 与
`evidenceRef` 指向的 source system（定义见下）。它们不属于 D8 deferral（不是「产品已批准、只差物理合同」），
而是 R-010 全文本身从未给出字段清单——本文档同样不能替它们发明 schema，只能列出功能性要求并标注 Unknown。
R-010 `:364` 逐字列举的 carrier 是 `ConsentEvent`、D5 载体与 provider refs，**并未点名**这两类载体；一旦
它们的物理形状被冻结，是否以及如何落入 `:364` 的逐 carrier privacy 要求范围，本身是一道尚未被回答的问题，
本文档不代为断言其已经或尚未在范围内：

1. **quarantine/evidence（未解决历史事实的隔离区）**：R-010 §4.4 fold 表把
   `unresolved + legacy_unknown + backfill + grant|revoke` 归为「effective state 不变；只进
   quarantine/evidence」（`:270`；proposal 同一表格 `:206`）；§4.6 进一步要求「`legacy_unresolved` 只在
   quarantine/report 存在，不写成 projection state；production 中任何不能安全表示的 known historical
   revoke……若非零，M5 前必须逐项解决，或另获 Founder 批准一条显式、可见、临时 legacy-block 规则」
   （`:356`；proposal `:250`）；§7 M3 表把「无法证明、unmapped、ambiguous、conflicting scope 或跨 owner
   异常」列为「必须 quarantine / 不得猜」的对象（`:469-473`）。R-010 全文只描述这个隔离区的**功能要求**
   （须可见、须阻止 M5、可另获临时规则），**没有冻结它的物理形状**——没有字段清单、没有表名、没有
   schema。因此本文档无法为它填写 §2 矩阵任何一列（数据类别/保留期/删除/访问控制/加密/跨租户/法律依据），
   填写即等于替 native task 发明尚不存在的 schema；quarantine/evidence 承载「无法验证归属」的历史个人数据
   片段，一旦它获得物理形状，是否落入 Q-1/Q-2/Q-3/Q-4/Q-7 的范围有待逐项确认，在此之前只能标注为
   Unknown（另见 §6）。
2. **`evidenceRef` 指向的 source system（原始证据的实际存放处）**：R-010 明确 `evidenceRef` 只
   保存 opaque ID/哈希引用本身，「source system 另按其 retention 控制」（`:363`）——也就是说，真正保存 raw
   message/邮件/电话/token 正文的系统，是 `evidenceRef` 之外的另一个 source system；R-010 全文没有点名这个
   source system 是什么（inbox provider？webhook 日志？第三方 BSP？），也没有定义它自己的 retention、加密、
   访问控制或跨租户隔离规则——这些完全交给「该 source system 自己的 retention 控制」，不在本文档矩阵物理
   范围内，但它是 Q-2/Q-3（擦除、导出）事实上绕不开的上游依赖：`ConsentEvent.evidenceRef` 本身如何擦除/
   导出被裁定之后，上游 source system 是否仍保留 raw 内容，本文档未核实，是另一道 Unknown。本文档不代为
   定义这个 source system 是什么，只如实标注这一依赖链缺口（另见 §6）；`ProviderRefusalEvent.receiptRef`
   是否同样对应某个 source system，R-010 `:363` 未提及，属于 Q-6 的范围，本文档不在此处代为假设。

## §3 Founder 决定题清单

以下每一题都是 §2 矩阵中至少一个格子标记为【待 Founder 裁决】的直接来源；每题只呈递问题与已知事实，不给出
唯一推荐答案（除非选项数量本身显然 ≤3 且彼此互斥）。

### Q-1：各表的保留期（retention period）

> **状态：已裁决**——[#356 D-Q1（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：permission
> 事件记录是商家资产；平台不设强制保留期限，不做任何平台发起的自动删除/清理/压缩；平台不代删，处置代理权归
> 商家。下面原问题文本保留，供历史追溯。

**【这是什么】** ConsentEvent、ContactDndEvent、ProviderRefusalEvent 这几张长期存证事件表（以及它们的读模型
投影），到底该保存多久？什么时候可以进入「终态压缩」（terminal compaction，把旧数据处理成更省空间的形态）？

**【现有说法】** R-010 明确把这题原样留给本文档：「具体 retention 期限与 terminal 处理由 B13/privacy
implementation gate 冻结，不是 D5 consent 行为或本 Draft Ready 的产品选择」
（`docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md:366`）；D8 决议同样写「retention 归
B13/privacy implementation gate」（`:34`）。也就是说 R-010 把这题指向本文档，本文档同样不能替 Founder 定案。

**【现实情况】** 这些表是 append-only 的长期 permission-fact truth（R-010 `:151-152`「event history 是长期
permission-fact authority」）；同时承载与顾客身份关联的个人数据（`contactId`）。R-010、proposal 与
Blueprint 均未给出具体保留年限、压缩规则，也未对是否存在保留期上限作出任何定性——本文档不代为补入法律
要求或论证方向；这些表的保留期该受什么法律约束、约束到什么程度，属于 Q-5 与独立 PDPA 姿态文件的范畴，本
题只问「保留多久」这一物理问题，不预判「为什么」。

**【可选方向（如显然存在，≤3 个）】**
1. 固定年限（例如「商家与该顾客关系结束后 N 年」）后触发匿名化/终态压缩；
2. 不设固定期限，只在顾客主张删除权（见 Q-2）时触发受控 erasure operation，其余时间无限期保留原始证据；
3. 按事件的 `evidenceStatus` 分级——`verified` 的事件保留期更长，`asserted`/`unresolved`
   的事件更早可清理（`docs/superpowers/specs/2026-07-16-r010-schema-authority-alignment.md:175` 定义了
   evidenceStatus 三态）。

### Q-2：删除权的物理落地方式——匿名化/去标识，还是硬删除

> **状态：已裁决**——[#356 D-Q2（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：第一期
> 只做 tag/提醒，不建任何删除/处置工具；物理 erasure 机制（匿名化 vs 硬删除）deferred，硬删除因破坏
> append-only 证据链被明确不倾向。触发条件=将来给商家做处置工具时另行一题呈批（台账 #359-2）。下面原问题
> 文本保留，供历史追溯。

**【这是什么】** 顾客主张 PDPA 下的删除/擦除权时，ConsentEvent 这类 append-only 事件表要不要真的物理删除那些
行；还是保留行本身（维持 append-only 结构与既有 fold 结果的完整性），只把里面能识别身份的字段（如
`contactId`、`evidenceRef`）替换成匿名化/去标识值。

**【现有说法】** R-010 §4.7 只冻结了原则性要求——「受控 privacy operation 必须独立授权、审计、幂等、可验证，
保留依法可保留且不改变 permission fold 的最小事实」（`:365`），没有说是删行还是抹字段。更早的 B2 数据契约
把这题原样列为待裁定并指向本文档：「append-only 观测/同意流与 PDPA/GDPR 擦除权相容（已知未爆点……）｜擦除
载体可为匿名化/去标识而非物删（待裁定）｜B13 隐私对表时正面裁定」
（`docs/superpowers/specs/2026-07-12-b2-data-contract.md:296`）。

**【现实情况】** append-only 表的设计初衷本身就是不可篡改，用来支撑 STOP fan-out 的 `operationId` 链条完整性
与 `(receivedAt, id)` 全序 replay 证据（R-010 `:258-275`）；如果物理删行，可能破坏这条链条或让 fold 结果
无法重放验证。如果只匿名化，个别更严格的 PDPA 读法可能要求「可识别信息不留任何痕迹」，这与「保留最小可
审计事实」之间存在张力，R-010 本身没有裁定这个张力怎么解。

**【可选方向（≤3 个）】**
1. 只匿名化/去标识：保留行结构与 fold 结果，抹去 `contactId`、`evidenceRef` 等可识别字段，用不可逆哈希或
   占位符替代；
2. 允许真正删行，但引入另一机制（如 tombstone 占位行）维持 `operationId`/`receivedAt` 序列完整性，使
   replay 不因缺行而产生歧义；
3. 按 `evidenceStatus` 分级处理——`verified` 事件默认走匿名化，`asserted`/`unresolved`
   事件允许物理删除。

### Q-3：删除/导出请求要覆盖到哪些副本

> **状态：已裁决**——[#356 D-Q3（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：商家=
> 数据主人/平台=保管人；导出=商家标准权利，随 CRM 功能正常排期建设（非隐私门阻塞项，台账 #359-3）；平台灾备
> 备份免费、仅用于灾难恢复、自动轮换过期，不构成独立数据用途；「历史/归档深度」作为将来的付费分层产品创意
> 另票停放（[#358](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/358)，台账 #359-5），不进隐私门；商家
> 关闭账号后的数据处置留待账号关闭功能设计时另行一题呈批（台账 #359-4）。下面原问题文本保留，供历史追溯。

**【这是什么】** 顾客发起删除请求，或行使「给我一份我的数据」（数据可携权/DSAR）时，这个操作要不要求同时
处理 primary 数据库之外的备份（backup）、只读副本（replica）、导出文件（export）、以及客服/支持工具里能
看到的数据。

**【现有说法】** R-010 §4.7 原文列出了这些副本类别本身（「覆盖 primary、backup、replica、export、receipt
与 support tooling」，`:365`）作为受控 privacy operation 必须覆盖的对象，但没有定具体机制——例如 backup
多久轮换掉旧数据、是否需要专门的 backup-purge 流程，还是允许靠 backup 自然过期覆盖删除效果。

**【现实情况】** backup/replica 的实际轮换周期、是否存在、保留多久，是运维层面的既有事实，本文档没有查询
这些事实（这类查询按 R-010 §9 production hard gate 的要求需要 SELECT-only 现场核验，`:518-528`，本文档不
在此列查这些）——**Unknown**，见 §6。

**【可选方向（≤3 个）】**
1. 要求 backup/replica 也必须在固定周期内清除被删除数据（需要运维专门配合）；
2. 只要求 primary/export/support tooling 立即清除，backup/replica 靠既有的自然轮换周期覆盖删除效果（实施
   成本更低）；
3. 按数据敏感度分级——只对能直接识别顾客身份的字段要求 backup 层面强制清除，其余匿名化后的历史事实不作
   backup 层强制清除要求。

### Q-4：谁能访问同意/DND/拒收历史与相关审计——租户内部 RBAC + 平台侧 support/privacy-operation 访问

> **状态：已裁决**——[#356 D-Q4（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：第一期
> 商家工作区内成员均可查看（现阶段=老板/极小团队）；平台侧沿用既有冒充模式（禁写+审计，F15）；细分 RBAC
> deferred，触发条件=「团队协作+市政厅 v2」街区动工时以真实协作模型为输入一并设计（台账 #359-6）。下面原
> 问题文本保留，供历史追溯。

**【这是什么】** 两部分合一的问题：(a) 一个商家账号（tenant）里，除了系统本身，谁——商家老板、商家的其它
员工席位、客服席位、Otto——能看到某个顾客的同意历史、DND 状态、供应商拒收记录；(b) 平台（FIKIRTIVE）自己
一侧，谁能以「support/admin」身份跨租户访问这些数据、谁被授权执行 R-010 `:365` 所说的受控 privacy
operation（擦除/去标识/导出的实际执行者）、谁能读取这些操作产生的审计记录，以及支持/客服工具（support
tooling）本身对这些数据的访问范围。

**【现有说法】** Blueprint 宪法第 7 条提到「租户 org 内部同样要阶级制度（用户侧 RBAC:创作席/审批席 + org
内角色，与团队协作/审批流同件设计）」（`docs/BLUEPRINT.md:66`），覆盖 (a) 的一般框架，没有专门就「谁能看
consent/DND/provider refusal 历史」表态。R-010 `:364` 把「access/export/DSAR」与「support access」列为
B13/privacy 矩阵必须覆盖的维度之一，`:365` 要求受控 privacy operation「必须独立授权、审计」且须覆盖
「primary、backup、replica、export、receipt 与 support tooling」，但没有给出谁被授权执行这类 operation、
谁能读取产生的审计记录的具体人选或角色——(b) 部分 R-010/proposal 全文都没有涉及。

**【现实情况】** 本文档未做代码级 RBAC 或平台 support 工具排查（超出 docs-only 任务边界），只核对了
R-010/proposal/Blueprint 的文本；(a)(b) 两部分目前都是尚未被任何冻结文档触碰过的空白。

**【可选方向（≤3 个，覆盖 (a)(b) 两部分）】**
1. (a) 复用既有的创作席/审批席通用 RBAC，把 consent/DND/provider refusal 历史归入「审批席」可见范围；
   (b) 平台侧 support/admin 访问走已有的内部运维审批流程（如存在），privacy operation 执行者限定为该流程
   内的授权角色，审计读者与执行者同一批人；
2. (a) 单列一个专属的最小可见范围（任何本来就有权访问该 Contact 档案的席位都能看到这些历史，不额外收紧
   也不额外放宽）；(b) privacy operation 执行者与审计读者是另一批经 Founder 单独批准的最小角色集合，与
   租户内部 RBAC 完全分离；
3. 留给 CRM RBAC 与 B13/privacy implementation gate 实现阶段一并设计，本 gate（Founder 决定题清单本身）不
   为 (a)(b) 任一部分单独定案。

### Q-5：各表处理个人数据的法律依据（legal basis）

> **状态：已裁决**——[#356 D-Q5（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：平台
> 采取受托处理方姿态（商家=数据的主人，平台只按商家指令处理），与 D-Q1/D-Q3 一致。法律依据的正式分类与对外
> 文本（隐私政策/ToS/数据删除回调）deferred 至 B13 法务面施工时随文本逐字呈批（台账 #359-17）。下面原问题
> 文本保留，供历史追溯。

**【这是什么】** PDPA 一般要求企业能说清楚「我们凭什么处理你的这份数据」。这道题问的是 ConsentEvent、
ContactDndEvent、ProviderRefusalEvent 这几张表各自处理顾客数据时，该归到哪一类法律依据；具体的法律依据
分类体系本身留给下面的独立 PDPA 姿态文件处理，本文档不在此处列举或预设分类。

**【现有说法】** R-010 与 proposal 全文都没有涉及法律依据分类。Route-B 总规划把「PDPA 姿态文件」列为独立于
本 gate 的交付物——「**B13** 发射台……法务面(隐私政策/ToS/数据删除回调——Meta App Review 硬前置,施工期完成
文本、founder 批) + PDPA 姿态」（`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:55`）；对应矩阵行 B0-93「PDPA
姿态文件」当前状态为 `absent`（`docs/ops/route-b/matrix/13-B13.md:16`）。

**【现实情况】** 这几张表在功能上并不同质：`ConsentEvent` 的核心目的是记录同意/撤回这个事实本身（R-010
`:151-152`「permission/grant 与 customer revoke……保留历史」「event history 是长期 permission-fact
authority」）；`ContactDndEvent`/`ProviderRefusalEvent` 的核心目的是发送安全护栏（R-010 `:333` 称 DND 与
provider refusal 为「这两条发送安全轴」）。这两类载体的**功能目的**不同，但 R-010/proposal 都没有触碰任何
法律依据分类判断；本文档也不推断哪一类更接近「同意」「合法利益」或其它 PDPA 分类——这类分类判断本身连同
其结论一并保持完全开放，留给下面的独立 PDPA 姿态文件处理，本文档不代为定性或倾向任何一种分类。

**【可选方向】** 不列选项——这道题的答案实质上就是「PDPA 姿态文件」（B0-93）本该覆盖的内容，是一整份独立
的法务姿态文本，不是三个互斥的技术选项。本题在这里的作用是标记「这是 gate 6 依赖但尚未存在的上游交付物」，
而不是把它拆成可勾选的选项——那样做等同于代替法务姿态文件本身下判断，超出本文档 docs-only、零发明的边界。

### Q-6：`ProviderRefusalEvent.receiptRef` 是否比照 `evidenceRef` 适用同一 raw payload 排除规则

> **状态：已裁决**——[#356 D-Q6（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：三处
> 统一——`receiptRef` 与 `evidenceRef` 及 State 表适用同一 raw-payload 排除规则：账本只存不透明引用，不复制
> 供应商原始材料；商家在界面照常看到联系人与拒发事实（联系人数据本就在其归属表）。下面原问题文本保留，供
> 历史追溯。

**【这是什么】** `ConsentEvent` 和 `ContactDndEvent` 都有 `evidenceRef` 字段，R-010 明确说它「只保存 opaque
ID/哈希引用，不得默认保存 raw message、email、phone、token 正文或 provider payload」（`:176`、`:363`）。
`ProviderRefusalEvent` 用的是名字不同的字段 `receiptRef`，R-010 没有对 `receiptRef` 说同一句话。

**【现有说法】** `ProviderRefusalState`（读模型，不是 Event 本身）明确写了「raw payload/PII 不进该表」
（`:344`），但这句话字面只覆盖 State 读模型；`ProviderRefusalEvent.receiptRef` 本身的内容边界，R-010 全文
没有单独定义（不像 `evidenceRef` 有「endpoint-validated opaque reference」这样的措辞，`:176`）。

**【现实情况】** 单看字段清单看不出 `receiptRef` 是否可能被端点塞入 provider 返回的完整报文；`receiptRef`
在设计意图上是「用于证明当时为何可 clear/expire 的可验证证据」（`:340-343` 的 clear/expire 规则都要求
「引用 active block 与可验证 receipt/evidence」），这类可验证性需求本身可能需要比纯 opaque 引用更丰富的
内容，与「排除 raw payload」之间可能存在张力，R-010 没有裁定这个张力怎么解。

**【可选方向（≤3 个）】**
1. 明确 `receiptRef` 比照 `evidenceRef` 适用同一 opaque-only 规则（最保守，但可能削弱 clear/expire 场景下
   的可验证性）；
2. `receiptRef` 允许保存比 `evidenceRef` 更完整的 provider 回执内容（因为这是「发送安全」证据链的一部分，
   需要更强可验证性），但需专门定义哪些字段允许、哪些明确排除（尤其是收件人 PII）；
3. 只允许 provider 侧的非 PII 状态信息（状态码、时间戳、policy 引用 ID），明确排除任何收件人可识别信息，
   介于前两者之间。

### Q-7：各表的加密/key scope（field-level 加密、密钥归属与轮换）

> **状态：已裁决**——[#356 D-Q7（2026-07-19）](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/356)：第一期
> 采用平台托管加密（Railway 托管 Postgres 存储加密 + 传输 TLS），不做字段级加密。企业级加密（字段级/自管
> 密钥）为未来必须项（Founder 明令，非可选），触发条件=企业级客户/分层产品设计时立项呈批（台账 #359-18）。
> **至此 Q-1～Q-7 全部裁毕**。下面原问题文本保留，供历史追溯。

**【这是什么】** R-010 `:364` 要求逐 carrier 隐私矩阵覆盖「加密/key scope」这一维度；C1 同样转述了这一
维度名称（`:432-434`）。两者都只给出维度的名字，没有拆分成具体子问题。本题照原文维度直接提问：
`ConsentEvent`、`ContactDndEvent`、`ProviderRefusalEvent` 这几张表（及其读模型投影）该 carrier 适用什么
加密/key scope？（是否需要额外的字段级加密而不只是数据库层默认的静态加密、加密密钥归谁管理、密钥多久
轮换——这些只是「加密/key scope」这一维度下可能出现的非穷尽例子，不是被拆分出的独立子问题。）

**【现有说法】** R-010 `:364` 只列出这一维度的名字，没有给出具体加密要求、密钥管理方案或哪些字段需要加密；
proposal（C1）同样只是转述该维度名称（`:432-434`），没有做实。

**【现实情况】** 本文档没有查询代码库现有的数据库层加密配置（是否已有 encryption-at-rest、字段级加密库），
也没有做基础设施层核验——这类核验超出本票 docs-only scope。目前没有任何冻结文档说明这几张表是否需要超出
数据库默认的额外加密层。

**【可选方向（≤3 个）】**
1. 依赖数据库层默认 encryption-at-rest，不为这几张表额外做字段级加密（加密由基础设施层统一保证，不在
   应用层重复实现）；
2. 对特定高敏字段（如 Q-6 若裁定 `receiptRef` 可存放更完整 provider 回执内容）额外做应用层字段级加密，
   密钥归属与轮换另立基础设施合同；
3. 留给 B13/privacy implementation gate 阶段，与 retention（Q-1）、擦除（Q-2）一并统一
   设计，本题此处不单独定案。

## §4 与 Meta App Review / PDPA 的衔接

Blueprint 边界四层表把「售前对话与成交促进」列为本体负责范围（`docs/BLUEPRINT.md:47`），而 Route-B 总规划
在此基础上把法务面单列为一个独立发射台工作块：

> 「**B13** 发射台(Fable 1c):生产割接(env 对账/迁移重放/备份+回滚/域名 SSL webhook/烟测) + 监控告警 +
> **法务面(隐私政策/ToS/数据删除回调——Meta App Review 硬前置,施工期完成文本、founder 批)** + PDPA 姿态」
> ——`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:55`（逐字引用）

同一文件把「数据信任合规(RBAC/tenant/审计/同意/保留删除导出/防注入/Otto 权限边界)」列为横切维度，明确并入
B10/B13 验收，不另立块：

> 「横切两块(Sol):数据信任合规(RBAC/tenant/审计/同意/保留删除导出/防注入/Otto 权限边界——含审计遗留:Otto
> 外部内容防注入标注)与生产运营就绪(SLO/DLQ 消费者/告警/成本与 ≥45% 数值证明)——并入 B10/B13 验收维度,
> 不另立块。」——`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:56`（逐字引用）

对应的 Route-B 矩阵行把这三件法务面产物列为独立于本 gate 的交付物，且当前状态均为「未建成」：

| 矩阵行 | 能力 | 现状 |
|---|---|---|
| B0-89 | 法务面三页（隐私政策/ToS/数据删除回调）——Meta App Review 硬前置 | `ui-shell`（现有 `/privacy` 等路由=旧文本，`docs/ops/route-b/matrix/13-B13.md:12`） |
| B0-93 | PDPA 姿态文件 | `absent`（`docs/ops/route-b/matrix/13-B13.md:16`） |

**衔接边界（本文档不代做的部分）**：本文档不写这三页的对外文本，不裁定 PDPA 姿态文件的法律依据分类
（见 Q-5），也不裁定隐私政策该怎么措辞。本文档只是这些交付物在动工之前，**上游**必须先解决的一道 schema/
数据层 gate——即：B0-89/B0-93 的文本施工需要引用本文档最终裁定的矩阵结果（哪些数据被收集、保留多久、
怎么删/导出、谁能访问），而不是相反；本文档的裁决进度反过来也不构成 B0-89/B0-93 已完成的证据。

**Meta App Review 时点须已存在什么（转述 Route-B 原文要求，不新增）**：按 `:55` 原文，隐私政策/ToS/数据
删除回调三页文本必须在「施工期完成、founder 批」，作为 Meta App Review 的硬前置条件；这意味着 B0-89 的
文本必须在申请 Meta App Review 之前就绪并经 Founder 批准，且现有 `/privacy` 等路由的旧文本（`:12` 标注为
`ui-shell`）不能视为已满足这一前置。本文档不判断 Meta App Review 的具体时间点，也不判断当前旧文本与新
文本之间的过渡策略——这些不在 #356 的 docs-only scope 内。

## §5 判定规则

本 gate（R-010 §11.2 gate 6）判定为 **PASS**，需要同时满足：

1. 本文档 §3 列出的 Q-1 至 Q-7，每一题都在 GitHub（issue 或对应 PR 的 Founder 评论）上取得 durable Founder
   Resolution——不是聊天记录、不是 session memory、不是本文档自己的推断；
2. §2 矩阵中原先标记【待 Founder 裁决 →Q-n】的每一个格子，都已依据对应 Q 项的裁决结果更新为具体、可执行
   的规则（不再是问题占位符）；
3. R-010 `:364` 逐字列举的全部 carrier（`ConsentEvent`、D5 source action/manifest/reactive
   anchor/confirmation/outbox/receipt、provider refs）都必须在本矩阵中有对应完成行；D5 各载体在其各自
   native implementation/schema task 中冻结物理形状之前，本 gate 就这部分 carrier 的判定范围保持
   **UNPASSED**（不是豁免或跳过），即使 §2 现有 carrier 的全部问题已裁决完毕（`:364`、`:656`）；
4. 若 Founder 裁决产生了新的物理合同（例如具体保留期数值、具体擦除机制选择），该合同本身仍须按 R-010
   §11.2 gate 1/gate 3 的既有路径另取 schema/migration 适用授权——gate 6 通过只解锁「可以开始」，不代替
   那些授权步骤（`:651`、`:653`）；
5. 若上述过程中发现某道 Q 项的裁决与 D1–D10 已批准的产品/authority 结果冲突，须按 R-010 §11.1 的既定纪律
   处理（不得把已决 authority 重新包装成新问题，`:632`），并在本文档或其后继版本中标注冲突而非静默调和。

### §5.1 本次判定（2026-07-19，依据上述标准逐项核对）

- 标准 1（Q-1～Q-7 均取得 durable Founder Resolution）：满足——#356 D-Q1～D-Q7 全部为 GitHub 评论记录的
  Founder Resolution（2026-07-19）。
- 标准 2（§2 矩阵原【待 Founder 裁决】格子均已回填为具体、可执行的规则）：满足——见本次更新后的 §2 矩阵，
  `ConsentEvent`、`ContactDndEvent`、`ProviderRefusalEvent`、`ConsentStateProjection`、`ProviderRefusalState`
  五行全部维度（保留期/删除与导出/访问控制与审计/raw payload 排除/跨租户隔离/法律依据/加密-key scope，以及
  以全表注形式适用于五行的备份/副本到期维度，见 §2 表后注）已
  冻结或已裁决或已登记延后触发（每处延后触发条件均已写入 §2 对应格子并链接台账 #359；备份轮换 cadence 的
  实施现状按 §6 保持 Unknown，属实施校验项而非未裁决政策）。
- 标准 3（R-010 `:364` 逐字列举的全部 carrier 均有完成行）：**不满足**——D5 source action/manifest/reactive
  anchor/confirmation/outbox/receipt 尚未在各自 native implementation/schema task 中冻结物理形状（见 §2
  「未来扩展行组」）；quarantine/evidence 与 `evidenceRef` source system（见 §2「未决 carrier 行组」）同样
  没有冻结物理形状。这部分 carrier 的判定范围**保持 UNPASSED**，不是豁免或跳过。
- 标准 4：满足前提——Founder 裁决未产生需要另取 schema/migration 授权的新物理合同（D-Q1～D-Q7 均为产品方向
  裁决，不是具体保留期数值或具体擦除机制的物理选择，见各 Q 项【现有说法】小节）；后续若 D-Q2 触发擦除
  工具立项，该物理合同仍须另取 R-010 §11.2 gate 1/gate 3 路径的授权。
- 标准 5：无冲突——本次裁决未与 D1–D10 已批准的产品/authority 结果冲突。

**判定结论**：gate 6 判定为 **scoped PASS**（scope = ConsentEvent、ContactDndEvent、ProviderRefusalEvent、
ConsentStateProjection、ProviderRefusalState 五行——全部维度已冻结或已裁决或已登记延后触发）；D5 延后载体与
隔离区/证据载体范围**保持 UNPASSED**，直至其物理形状冻结并补行（per §5 criterion 3 / R-010 `:364`、
`:656`）。

**本次判定当时解锁的下一步**：ConsentEvent/ContactDndEvent/ProviderRefusalEvent 批次（含
`ConsentStateProjection`/`ProviderRefusalState` 两投影）的 migration authoring 可以启动；模型/additive
migration/tenant guard/schema tests 后来由 PR #362（`49aca8f8`）合并，closed writers/fold/replay/projections
runtime 再由 PR #364（`83946443`）合并；PR #366（`1f8d8f26`）只完成 Contacts UI/actions/Otto vertical，未新增
schema/migration。这个历史结果不替代 C4 或任何其它任务的 schema/migration/production 授权。D5 延后载体、
quarantine/evidence 与 evidenceRef source system 相关的 implementation 仍保持 disabled/fail-closed，直至各自
物理形状冻结并补入本矩阵（§2「未来扩展行组」/「未决 carrier 行组」）。

**谁更新**：本文档不由自身自动判定 PASS。#356 D-Q1～D-Q7 的回填与 §5.1 判定已由 PR #360 合并生效；当前
#372 更新只新增下方 §5.2 的 C4b-M0 判定，且该扩展仍须本次 PR 合并后才生效。

### §5.2 C4b-M0 六 carrier 扩展判定（2026-07-20）

- **Authority**：满足——Founder 已批准 #372 的 C4b-M0 privacy package；#372 的 durable 勘误把 scope 对齐为
  C4a §5.1 已批的六个物理 carrier，且明确不是新产品决定。
- **逐行完整性**：满足——§2 的六行逐一覆盖 source/data class/PII 与 carrier-specific tenant/content boundary，
  并逐行纳入 `C4-S1`～`C4-S8`，从而覆盖 ownership/custodian、retention、delete/export、access/audit、tenant
  isolation、raw payload 排除、log/error/telemetry redaction、media、encryption/key scope、backup/PITR 与
  legal/product basis。
- **零发明与边界**：满足——六行逐字对应 C4a §5.1 物理 carrier；没有新增表、字段、runtime/provider behavior，
  production backup/PITR actual state/cadence 保持 Unknown。D5/D8 与 quarantine/evidence 的 UNPASSED 范围不变。

**判定结论**：C4b-M0 六 carrier 扩展为 **scoped PASS（proposed；仅在本次 PR 合并后生效）**。它只满足 C4a
M0 所要求的六行 privacy 前置，不改变 §5.1 已生效的原五 carrier scoped PASS，也不把 D5/D8 或未决
quarantine/evidence 范围判为通过。

**解锁边界**：本扩展生效后，下一张 bounded C4 schema/migration task 仍须在动作前取得 Founder 对
schema/migration 的单独授权；provider/credentials/Meta/真实花费或消息、D8、production/deploy 与
CI-unavailable merge 也都必须分别再获授权。本判定自身不授权任何这些动作。

## §6 Unknown/风险

- **B13 措辞的实际出处**：本票 mandate（issue #356 Authority 段）与任务描述都把「Blueprint B13 法务面」的
  措辞归给 `docs/BLUEPRINT.md`，但逐字检索 `docs/BLUEPRINT.md` 全文未发现「B13」「隐私政策」「ToS」「数据
  删除回调」「PDPA」等字样命中；这段措辞的实际逐字出处是
  `docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:55-56`（Route-B 总规划，而非 Blueprint 宪法本身）。本文档
  §4 按实际找到的出处引用，未按 mandate 描述强行嫁接到 Blueprint 行号；这是一处需要向 Founder/后续 session
  如实报告的来源标注差异，本文档不代为改写 mandate 或 Route-B 的文件归属关系。
- **`ContactDndEvent` 被纳入本矩阵的依据边界**：见 §1 末段——R-010 §4.7 字面未点名 `ContactDndEvent`，本
  文档按 #356 的当前 mandate scope 纳入，但这不等于 R-010 原文本身已裁定 DND 属于 gate 6 范围；若未来
  Founder 认为 DND 不该与 ConsentEvent/ProviderRefusal 同批裁决，需要另行拆分，本文档不预判。
- **B13/privacy 矩阵此前的整体现状——已解决**：proposal §7 此前如实记录「R-010 §4.7/§11.2 gate 6 要求逐
  carrier 隐私矩阵，但本文档未发现该矩阵已存在或已通过的证据」
  （`docs/superpowers/specs/2026-07-19-c1-identity-consent-schema-proposal.md:508-510`）。**本次更新后该
  Unknown 已变为 Known**：本文档即该矩阵，Q-1～Q-7 已全部裁决（#356 D-Q1～D-Q7），§2 矩阵已回填，§5.1 已
  给出 scoped PASS 判定（scope 见 §5.1；D5 延后载体与未决 carrier 行组仍 UNPASSED，不是本条 Unknown 的
  一部分，见下两条）——本条 Unknown 不再适用于本文档已裁定范围内的五个 carrier；§5.2 另对 C4 六 carrier
  给出 proposed scoped PASS，只有本次 PR 合并后才生效。
- **backup/replica 运维事实——政策已裁决，操作细节仍未查询**：#356 D-Q3（2026-07-19）已裁决政策层面，#372
  已把同一政策扩展到 C4 六 carrier——平台
  灾备备份免费、仅用于灾难恢复、自动轮换过期，不构成独立数据用途。但 Q-3 涉及的 backup/replica **实际**
  保留周期数值、轮换频率等运维细节，本文档仍未做 SELECT-only 现场核验（这类核验按 R-010 §9 生产硬闸的
  既定纪律，`:518-528`，需要另行 production 访问与授权，超出本票 docs-only scope）——**Unknown 范围已收窄
  为纯运维数值**，原样标注，不臆测。
- **`receiptRef` 内容边界——规则已裁决，本票不重审实现**：#356 D-Q6（2026-07-19）已裁决 `receiptRef` 比照
  `evidenceRef` 统一 raw-payload 排除；`ProviderRefusalEvent` 模型已随 PR #362（`49aca8f8`）合并。#372 只回填 C4 privacy
  matrix，不修改也不重新审计该五 carrier implementation；D-Q6 规则保持不变。
- **quarantine/evidence 与 evidenceRef source system 物理形状未定**：见 §2「未决 carrier 行组」——R-010 只对
  这两个载体给出功能性要求（`:270`、`:356`、`:363`、`:469-473`），没有冻结表名、字段清单或 schema；本文档
  因此无法为它们填写 §2 矩阵任何一列，按零发明纪律原样标注为 Unknown，不臆测其物理形状，也不预判它们
  最终会不会与现有五个 carrier 合并或独立建表。此载体的隐私维度已登记入台账 #359-15，触发条件=其物理形状
  冻结时补齐矩阵；这是 D-Q1～D-Q7 均未触碰的独立 Unknown，不因本次裁决而解决。
- **加密/key scope（Q-7）——第一期决定已裁决，既有基础设施配置未核查**：#356 D-Q7（2026-07-19）已裁决
  第一期姿态（平台托管加密，不做字段级加密）。本文档仍未核查代码库现有数据库层加密配置或基础设施加密
  姿态是否已实际落实该姿态（超出 docs-only scope）——**Unknown 范围已收窄为「现状是否已符合裁决」的核验
  缺口**，原样标注。
- **B2 契约中同类先例（AttributionEvent.anonymousKey）**：`docs/superpowers/specs/2026-07-12-b2-data-contract.md:444`
  记录了另一个字段（`AttributionEvent.anonymousKey`，不在本文档矩阵范围内）「隐私保留期（PDPA 姿态）→
  留 B13 对表」的同类先例，说明「retention 问题指向 B13 gate」是本仓库既有的重复模式，本文档的 Q-1 与
  该先例性质一致，但两者是不同的字段/表，本文档不把该先例的答案（若未来产生）自动套用到 ConsentEvent 系
  五表，仅作为背景参照记录。
