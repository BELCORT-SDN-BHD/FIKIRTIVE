# C4a 共享 Inbox + WhatsApp 首渠道物理合同

> **状态：docs-only PROPOSAL；等待 Founder 对本文唯一 schema 方向作决定**
>
> 本文只冻结 C4a（B0-31/32/33/38）的领域、provider-neutral 接口、拟议物理载体、共享动作、UI 状态、
> D8 fail-closed 边界与验证合同。本文不修改 Prisma/schema/migration，不连接 Gupshup/WABA，不配置凭证，
> 不调用 Meta，不花费，不发送真实消息，不实现 D8，不部署 production。
>
> 证据基线：live `main` `1f8d8f26bdafcb6b93f32fe2456bac22a4e19c93`（2026-07-19）。
>
> 连续性：[#368](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/368) 是本票唯一 authority；
> [#359 handoff](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/359#issuecomment-5014856944)
> 只作后台账证据，不授予实现权。上位范围来自 #345 / merged PR #346 的
> `docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md` §8。

## §1 一句话结果

C4a 建一套独立于 Otto `ChatThread/ChatMessage`、独立于社媒发布 `Channel` 接口的顾客会话域：核心只认识
`ChannelScope`、`ContactIdentity` 与 provider-neutral adapter；Gupshup 只是 WhatsApp 的首个可替换实现。
在 D8、C5、C6 的 native carriers 未获批、实现并验证前，C4a 可以保存/读取收件箱、分派、草稿、模板草稿与
可见 takeover 事实，但**任何发送、确认、outbox、worker、provider result、receipt 与自动恢复路径都不存在可用性**。

## §2 Authority、范围与不做

### §2.1 C4a 只承接四行

| B0 | 本合同承接 | 验收边界 |
|---|---|---|
| B0-31 | 共享 Inbox、历史、搜索、分派；WhatsApp 首个真实顾客渠道的 provider-neutral 边界 | 顾客 Conversation/Message 是新域；不复用内部 Otto Chat |
| B0-32 | 消息模板库、不可变本地版本、Meta review 状态边界 | 当前只可写草稿/合同；真实送审另取 Founder 授权 |
| B0-33 | 防误发单一 chokepoint、可见禁用理由、Otto 措辞纪律 | 当前 chokepoint 必须返回 unavailable；不准直连 adapter |
| B0-38 | 人与 Otto 同台、可见 takeover/handoff、人工介入即停 | 恢复须新指令/明确动作；刷新、分派、旧确认都不能恢复 |

### §2.2 明确不吸收

- C5 B0-43/44/45/46：Broadcast、permission/STOP、DND、provider refusal、frequency 与最终 send eligibility；
- C6 B0-41/42：provider receipt、delivery/read/failure truth、reconciliation 与统一报告；
- C7 Workflows；B0-34/35/36/37/39；完整 service desk、voice、email、公开评论、knowledge/RAG；
- Gupshup/WABA 凭证、商家 embedded signup、Meta App Review、真实 template submission、真实 webhook、真实 send；
- `DeliveryManifest`、reactive anchor、两次确认、outbox、worker、`ActionReceipt`、lock/retry/reconciliation；
- schema/migration/DB apply/backfill、production/deploy、provider spend、CI-unavailable merge。

售后消息若从同一 WhatsApp identity 到达，可作为 normalized history 如实显示，但 C4/Otto 不把它自动分类、处理或关闭为
service-desk ticket；只能在未来获批的 `read → trigger → handoff → receipt` 合同下明确交接，不能因 Inbox 已存在而扩权。

### §2.3 当前事实

- `Contact` / `ContactIdentity` / `ChannelScope` / `ChannelConnection` 与 typed consent/DND/provider-refusal
  底座已在 live main；
- production 没有顾客 `CustomerConversation`、`CustomerMessage`、Inbox、message template 或 Gupshup adapter；
- `apps/web/lib/channels/types.ts` 是 organic publishing 接口（post/target/publish/insights），不是顾客 messaging
  接口；不得把 C4 方法塞进去；
- `ChatThread/ChatMessage` 是 Project 内 Otto 对话，只承载商家与 Otto 的工作流，不是顾客消息 authority；
- Northstar Inbox 只是 prototype/design evidence，不能成为 runtime、状态或数据 authority。

## §3 领域边界与不变量

### §3.1 固定词义

1. **Customer conversation**：一个 Org 与一个 exact `ContactIdentity` 的稳定顾客线程。Phase 1 同一
   `(ownerId, contactIdentityId)` 只存在一个 live thread；open/close 是该 thread 的工作状态，不制造第二身份。
2. **Customer message**：会话内一条规范化的 inbound/outbound item。消息行不等于 provider receipt；没有 C6
   provider evidence 时，UI 不得显示 sent/delivered/read。
3. **Assignment**：谁负责处理，不是数据 ownership、发送权限、approval 或 consent。
4. **Takeover/handoff**：谁控制回复。人工介入是 hard stop；assignment 与 control 分离。
5. **Message template**：绑定 logical channel scope 的版本化内容。draft、submitted、approved 都不等于一次 send
   获准。

这些词同时写入根目录 `CONTEXT.md`。代码/UI 必须显式使用 Customer conversation/message；`Chat` 只指 Otto Chat。

### §3.2 核心不变量

- `ownerId` 只从 authenticated session、verified server route 或 trusted worker context 得到；浏览器、Otto 参数、
  connector payload 都不能提交或覆盖；
- 每个 owner-scoped relation 都 tenant-qualified；所有新 owner models 出生即登记 `TENANT_MODELS`；
- 新会话只能从同 owner、已有非空 `ChannelScope` 的 exact `ContactIdentity`，或由同一个 C1 identity resolver
  对空闲四事实 key 原子新建的 Contact + Identity 建立；unmapped/ambiguous/conflicting identity 不猜、不
  auto-attach/merge，只给可见 suggestion；
- 在 §5 的 scoped FK hardening 真正 migration 并验证前，任何 C4 resolver、Inbox read 或 Contact drawer 都不能信任/直接
  traverse 现有裸 `ContactIdentity.contact` relation；必须在 server 同次查询重验
  `Identity.ownerId = Contact.ownerId = ChannelScope.ownerId`，任一 mismatch 均零读、零写、零 provider call；
- 核心 schema、UI 与 Otto action 不出现 `gupshup*` 字段、表名、状态或分支；adapter 的 provider DTO 不越界；
- raw webhook/provider payload、token、secret、签名材料不进入 C4 tables、日志、ActionEvent 或 UI；
- 草稿、assignment、takeover、local approval、outbox start（未来）均不是 delivery truth；
- UI 与 Otto 只调同一 shared action；任何直接 Prisma/provider bypass 都是 P0；
- 人工 takeover 或实际人工回复意图必须先原子暂停 Otto，再允许后续流程；旧 revision/旧确认立即失效；
- 当前所有 external ports 默认 disabled；missing capability/health/privacy/carrier/permission 一律 fail closed。

## §4 Provider-neutral messaging port

现有 publishing `Channel` 保持不变。C4 新建独立的 server-only port；以下是语义合同，不是本票代码授权：

```ts
interface CustomerConversationAdapter {
  readonly channel: string;

  capabilities(ref: ServerResolvedConnectionRef): Promise<MessagingCapabilities>;
  health(ref: ServerResolvedConnectionRef): Promise<MessagingConnectionHealth>;

  verifyAndNormalizeWebhook(candidate: CandidateConnectionRef, raw: RawWebhookRequest): Promise<
    | { ok: true; events: readonly [VerifiedMessagingEvent, ...VerifiedMessagingEvent[]] }
    | { ok: false; reason: "invalid_signature" | "malformed" | "unsupported" }
  >;

  submitTemplateReview?(request: FrozenTemplateSubmission): Promise<ExternalAcknowledgement>;
  submitReply?(request: FrozenReplySubmission): Promise<ExternalAcknowledgement>;
  reconcile?(ref: ServerResolvedConnectionRef, cursor: OpaqueCursor): Promise<NormalizedProviderFacts>;
}
```

`ServerResolvedConnectionRef = { ownerId, channelScopeId, connectionId }` 只能在 server 由 authenticated owner 或
验签后的 channel account claim 解出。`MessagingCapabilities` 与 `MessagingConnectionHealth` 是可见 truth；不支持、
expired、degraded、unknown 或未连接时，相关 external action 显示原因并保持 disabled。shared read action 只能返回已存的
server-verified projection/cache 与 freshness evidence；adapter `health()` 若会发 live probe，就是 provider call，须先取得对应
Founder authorization，不能借 `read/internal` 分类绕过。

`CandidateConnectionRef` 只含 server route/opaque webhook binding 解出的 candidate `connectionId`，用于读取验签 secret；
它不是 verified owner authority。provider 若只给 untrusted account hint，route 只能用该 hint 找 bounded candidates，zero/multiple
一律拒绝。验签成功后才把 candidate 提升为完整 `ServerResolvedConnectionRef` 并做 owner-scoped product lookup；invalid
request 只得到统一响应，不泄漏 connection/tenant 是否存在。

Phase 1 registry 以 `channel="whatsapp"` 选择一个 adapter；Gupshup 是 registry 后面的首实现，不给 core 增
provider enum/column/branch。未来换 Meta Cloud API 或第二 BSP，保持同一 `ChannelScope`、Conversation、Message、
actions 与 UI；只换 adapter/credential implementation。若未来确实需要一位商家同时使用多个 BSP，那是新的
bounded schema decision，不能现在预埋。

### §4.1 Verified fact bundle 与路由

adapter 验签并规范化后，只能产生 closed fact union 的非空 bounded list。同一 provider item 可以产生多个领域事实；
例如 text `STOP` 必须同时产生 C4 `conversation_message` 与 C5 `permission_changed`/STOP，而不是二选一：

| Normalized event | 本域 writer | Authority owner |
|---|---|---|
| `conversation_message` | C4 `CustomerMessage` shared writer | C4 |
| `template_review_changed` | 交 C6 receipt writer；C4 只消费其 verified projection | C6 → C4 read projection |
| `permission_changed` / STOP | 不由 C4 写；交 typed consent writer | C5 |
| `provider_refusal` | 不由 C4 写；交 typed refusal writer | C5 |
| `delivery_changed` / provider failure | 不由 C4 写；交 receipt/reconciliation spine | C6 |

普通 inbound reply 不能自动变成 opt-in。`permission_changed` 只有命中 R-010 closed writer matrix 才可生成
`ConsentEvent`；任意不明事实只进已获批 quarantine，不写产品 truth。每个 normalized fact 各自持有含 `eventKind` 的
namespaced source key/hash；不能拿整包 request ID 让一个事实替另一事实去重。

### §4.2 Webhook 顺序、幂等与冲突

1. 先从 server-owned opaque route binding（或 bounded untrusted account hint）取 candidate connection/secret；除这次
   credential lookup 外，不做 owner-scoped product lookup；
2. adapter 验签；失败统一拒绝、零产品写；验签成功后从 verified account claim 找唯一 `ChannelConnection` 与
   `ChannelScope`，zero/multiple/mismatch 拒绝；
3. adapter 按 versioned canonicalization 为每个 fact 产出含 `channelScopeId + eventKind` namespace 的 server-derived
   `sourceEventKey`、`sourcePayloadHash` 与 opaque external refs；caller 不可传；
4. conversation message 先调用唯一 C1 identity resolver：按 verified
   `(ownerId, channel, channelScopeId, canonicalExternalId)` exact reuse；若 key 空闲，原子创建不带 consent 的
   Contact + Identity；若 unmapped/ambiguous/conflicting，零 attach/merge/Conversation；之后 C4 shared writer 才在
   同一 transaction 建/取唯一 conversation、写 message、推进 projection；template/provider result 交 C6 receipt
   writer，再投影回 C4 read model；
5. 同 `(ownerId, sourceEventKey)` + 同 `sourcePayloadHash` 是 no-op replay；同 key + 不同 hash 是冲突，零覆盖、
   零第二行；
6. concurrent first-contact/Conversation/message insert 的 expected unique loser 必须让**整笔 transaction rollback**，再从
   新 transaction bounded retry：重读 winner Identity/Conversation 后只补自己的 distinct message；不得留下 orphan
   Contact/Identity，也不得把第二条不同 inbound 当 duplicate 丢掉；已有 conversation 上两个 distinct message 的 aggregate
   revision CAS loser 同样整笔 rollback/re-read/retry；同 source replay 则 no-op 且不推进 revision。超出已识别 constraint 或
   retry cap 即 fail closed；
7. provider `occurredAt` 只展示；规范顺序以 server `receivedAt` + stable row ID 决定；迟到事件不倒写较新 projection；
8. ingress coordinator 只有在整包每个 fact 都 durable accepted、deduped，或进入已批准 quarantine 后才 ack；中途失败
   不得 half-ack/drop，允许 provider 整包重送，各 fact 靠自己的 key/hash 独立 no-op；
9. outbound/template response loss/timeout 只能进入 `unknown` + reconciliation-needed；不得宣称成功或盲重投。

第 9 点只指 outbound/template 等已经尝试的 external effect，由 C6 持有 unknown/reconciliation truth。inbound webhook
若在 DB commit 后丢失 HTTP response，provider 重送只按同 source key/hash 走 no-op replay；C4 不另造 `unknown inbound`
产品状态，也不能因 ack 丢失重复建 message。未识别 inbound event 则进入 M4 所要求的隔离/可重放 operational carrier，
在其 privacy/ownership 合同冻结前整个 real endpoint 仍关闭。

recognized fact bundle 的默认实现必须让 C4/C5/C6 tx-aware writers 共用一个 bounded DB transaction，全部成功/去重才
commit。若某 provider 的 bundle 无法安全放进单 transaction，M4 前须另获批一个 durable normalized ingress envelope：
先持久化整包与逐 fact progress，并在全部 fact terminal 前 hard-block 该 exact scope/identity 的任何 send。不能用“HTTP
未 ack”替代产品内的 permission safety，也不能在当前六个 carriers 里偷塞通用 raw JSON inbox。

真实 endpoint、signature secret、provider mapping 与任何外部调用须在动作前另取 Founder authorization。

## §5 拟议物理合同（当前唯一 Founder 决定对象）

### §5.1 总览

本提案是一个不可拆分的 C4a package：新增六个 owner-scoped carriers、把现有 `ContactIdentity → Contact` 一处 seam
收紧为 tenant-qualified relation，并以 team-level `Needs reply` 取代 per-member unread cursor。三者一起决定，不能只批准
carrier 而保留可跨 tenant 的 relation，也不能无声预埋另一套 unread 模型。其余复用现有 `ChannelScope`、
`ChannelConnection`、`Membership`：

| Carrier | 唯一职责 | 不是 |
|---|---|---|
| `CustomerConversation` | 一个 exact channel identity 的稳定 Inbox thread/current projection | Otto Chat、ticket、send authority |
| `CustomerMessage` | 规范化会话历史 | provider receipt、raw webhook |
| `CustomerConversationEvent` | assignment/control/open-close 的 append-only visible history | generic ActionEvent、approval |
| `CustomerConversationDraft` | 一个会话的共享可恢复草稿 | manifest、outbox、待发消息 |
| `CustomerMessageTemplate` | logical channel-scope template root | provider-specific template |
| `CustomerMessageTemplateVersion` | 不可变本地内容版本 + current review projection | send approval |

`Organization` 增六条 back-relations；六表全部加入 `TENANT_MODELS`。为 tenant-qualified assignee/actor FK，
`Membership` 另加 redundant-but-required `UNIQUE(id, orgId)`；不改其业务语义。

现有 `ContactIdentity.contact` 仍是裸 `contactId → Contact.id`，会让 C4 的 tenant chain 留洞。本提案请求把这一处现有
relation 纳入 C4 scoped direction：下一张 C4b 可在另获 schema/migration 授权后，用同一 additive batch 把它改为
`(contactId, ownerId) → Contact(id, ownerId)`（目标 composite unique 已存在），并先证明 live cross-owner anomaly=0；
否则 migration/real ingress 不得启动。Founder 批准本文，只解除这一条 C4 seam 的**方向**，不替 #317 决定全仓所有旧
FK 的房规，也不授权实际 schema/migration。若整个 package 未获批准，#368 停在 proposal，不能创建 C4b 或把其中任何
部分当成已获架构授权。

六表的 taxonomy 延续 CRM house style：DB 存 String、shared code 走 closed validator，不增 PostgreSQL enum。历史关系
默认 `onDelete: Restrict`；Org/Contact/Identity/Member archive 不级联抹掉会话事实。所有 partial unique 由新 migration
的 raw SQL 建立并有 schema/migration drift test；不得假装 Prisma annotation 能表达。

### §5.2 `CustomerConversation`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org；FK `Organization.id` |
| `contactIdentityId` | tenant-qualified FK `(contactIdentityId, ownerId) → ContactIdentity(id, ownerId)`；writer 另验 `channelScopeId != null` |
| `status` | code-validated `open / closed`；不是 provider state |
| `assigneeMembershipId` | nullable tenant-qualified FK `(id, ownerId) → Membership(id, orgId)` |
| `automationState` | code-validated `disabled / otto_active / paused_by_human`；初始 `disabled`，`otto_active` 在 D8 与 O-01+O-06/B0-34 gates 前不可写 |
| `revision` | aggregate monotonic CAS integer；每次 assignment/control/status mutation 及每条 accepted non-replay message 都 +1 |
| `lastMessageAt` | nullable projection；只由 accepted message writer 更新 |
| `lastActivityAt` | list sort projection；message/control event 事务内更新 |
| `createdAt/updatedAt` | row lifecycle；不代表 provider time |

约束/索引：

- `UNIQUE(id, ownerId)` 供 tenant-qualified references；
- `UNIQUE(ownerId, contactIdentityId)`：Phase 1 一个 exact channel identity 一个稳定 thread；
- index `(ownerId, status, lastActivityAt, id)`；
- index `(ownerId, assigneeMembershipId, status, lastActivityAt, id)`。

Assignment 是 human responsibility，automationState 是 reply control；二者可以并存且不得互相暗改。被 revoke/suspended
的 Membership 仍可作为历史 actor，但不能成为新 current assignee；shared action 每次写前重验 active membership。
Phase 1 明确采用 team-level attention，不建 per-member unread/read cursor，也不加多 writer mutable column。read model
确定性派生：open + latest accepted message=inbound → `needs_reply`；open + latest C6-verified outbound message →
`waiting_on_customer`；closed/no message → `none`。每条 accepted non-replay inbound/outbound message 都在同 transaction
推进 aggregate revision；inbound 若撞上 closed thread，还须在同 transaction reopen 并写 visible `opened` event。因此新顾客
回复不能被 closed/none 隐藏，旧 conversation/draft revision 也不能继续保存。draft、typing、local approval、outbox/worker
start 都不能算“已回复”。
性能若日后需要 projection，只能由一个 materializer + monotonic cursor 维护，须另走 contract。

### §5.3 `CustomerMessage`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId/conversationId` | tenant-qualified FK `(conversationId, ownerId) → CustomerConversation(id, ownerId)` |
| `direction` | `inbound / outbound`；outbound writer 在 D8/C6 gate 前 disabled |
| `actorKind` | server-derived `customer / merchant_member / otto / system` |
| `actorMembershipId` | nullable tenant-qualified human actor；customer/Otto/system 时必须 null |
| `kind` | code-validated normalized kind；initial live set `text / unsupported`，新增 media kind 先过 privacy/storage gate |
| `contentJson` | bounded normalized envelope；text 或 safe unsupported metadata；不存 raw provider payload/secret/remote signed URL |
| `searchText` | bounded derived plain text for owner-scoped search；不含 hidden raw payload |
| `contentHash` | versioned canonical normalized message-content hash，用于内容完整性；不代替 source-event conflict proof |
| `sourceEventKey` | inbound 时必填、含 exact `channelScopeId` namespace 的 server-derived stable key；outbound semantics 留给 D8 native contract |
| `sourcePayloadHash` | verified normalized event envelope（排除 signature/arrival 等 volatile bytes）的 versioned canonical hash；检测同 key 异 semantic payload |
| `canonicalizationVersion` | closed adapter-contract version；hash/key 规则改变必须新版本兼容读，不能重解释旧行 |
| `externalMessageRef` | nullable opaque ref；不是 provider receipt |
| `occurredAt` | nullable provider-claimed time，仅展示 |
| `receivedAt` | server canonical order，`Timestamptz(6)` |
| `createdAt` | DB insert time |

约束/索引：

- inbound partial unique `(ownerId, sourceEventKey) WHERE sourceEventKey IS NOT NULL`；
- index `(ownerId, conversationId, receivedAt, id)`；
- 不设 `updatedAt/deletedAt/deliveryStatus`；content correction/redaction/retention 须由后续 privacy contract 明定；
- 初版 search 必须 owner-bound、cursor-bound、limit-bound；不得为了搜索保存第二份 raw payload。若日后加
  trigram/full-text index，须先证明多语行为、extension availability 与 migration rollback，本文不预埋。

初版 `contentJson` 不是任意 JSON bucket，只允许两种 versioned shape：

```ts
type CustomerMessageContentV1 =
  | { schemaVersion: 1; type: "text"; text: string }
  | { schemaVersion: 1; type: "unsupported"; channelType: string };
```

所有 string 有 server limits/control-character validation；unsupported 不保存 raw payload。新增媒体/interactive shape 属于
contract + privacy/storage 扩展，不得让 adapter 临时塞字段。

### §5.4 `CustomerConversationEvent`

| 字段 | 合同 |
|---|---|
| `id/ownerId/conversationId` | stable ID + tenant-qualified conversation relation |
| `revision` | 与同 transaction 更新后的 Conversation revision 相同 |
| `kind` | `assigned / unassigned / takeover / handoff / automation_resume_requested / automation_resumed / opened / closed` |
| `actorKind/actorMembershipId` | server-derived actor；human membership tenant-qualified |
| `from/toAssigneeMembershipId` | nullable tenant-qualified assignment transition |
| `from/toAutomationState` | visible control transition；assignment 不得隐式改此值 |
| `note` | nullable bounded merchant-visible handoff note；不得存 secret/raw provider payload |
| `idempotencyKey` | server-derived business key |
| `createdAt` | canonical event time |

约束/索引：`UNIQUE(ownerId,idempotencyKey)`、`UNIQUE(ownerId,conversationId,revision)`、index
`(ownerId,conversationId,createdAt,id)`。Conversation projection 与 event insert 必须同 transaction；任一步失败全 rollback。

### §5.5 `CustomerConversationDraft`

| 字段 | 合同 |
|---|---|
| `ownerId/conversationId` | 一会话一个共享 draft；tenant-qualified relation；组合主键 |
| `revision` | CAS；旧 revision 保存返回 conflict，不覆盖别人 |
| `conversationRevision` | 最后成功保存时绑定的 exact Conversation revision；每次 save 同时校验 current conversation revision |
| `authorKind/authorMembershipId` | `merchant_member / otto`，human actor tenant-qualified |
| `contentJson/contentHash` | bounded normalized draft；不含 provider request/receipt |
| `updatedAt` | 保存时间 |

Draft 永远不能直接交给 adapter。human 与 Otto save 都必须同时提交 `conversationBaseRevision + draftBaseRevision`；
任一 mismatch 拒绝。未来 D8 只能从 exact frozen conversation+draft revision 产生其 native manifest/action；不得把本表
改名或临时当 outbox。初版 draft content 只允许 `{ schemaVersion: 1, type: "text", text }`，与 message envelope
共用同一 validator；不是任意 JSON。

### §5.6 `CustomerMessageTemplate` + `CustomerMessageTemplateVersion`

`CustomerMessageTemplate`：

| 字段 | 合同 |
|---|---|
| `id/ownerId` | stable root + tenant |
| `channelScopeId/channel` | tenant/channel-qualified FK 到 `ChannelScope(id,ownerId,channel)`；provider replacement 不换 root |
| `name/locale` | logical template identity；WhatsApp naming/locale validator 由 channel capability 层提供 |
| `createdAt/archivedAt` | local library lifecycle；archive 不删除 provider truth |

约束：`UNIQUE(id,ownerId)`；live partial unique `(ownerId,channelScopeId,name,locale) WHERE archivedAt IS NULL`；
index `(ownerId,channelScopeId,archivedAt,name)`。

`CustomerMessageTemplateVersion`：

| 字段 | 合同 |
|---|---|
| `id/ownerId/templateId` | tenant-qualified root relation |
| `revision` | per-root monotonic integer；每次 content save 新增一行，旧内容不改 |
| `purposeClass/category` | server/channel-validated strings；不能让 free-form/caller 自报 transactional |
| `definitionJson/contentHash` | immutable normalized components/variables + canonical hash；不存 provider DTO |
| `submissionState` | C4 read projection：`draft / submitting / submitted / submission_failed / unknown` |
| `reviewState` | C4 read projection：`not_submitted / in_review / approved / rejected / unknown` |
| `availabilityState` | C4 read projection：`unavailable / available / paused / disabled / flagged / unknown` |
| `reviewRevision` | 三轴 projection 的 CAS cursor；external transition 只由 C6 verified receipt materializer 推进 |
| `externalTemplateRef` | nullable opaque projection；不含 provider name/secret，不是 receipt authority |
| `frozenAt/submittedAt/reviewedAt` | nullable truth timestamps |
| `createdByMembershipId/createdAt/updatedAt` | tenant-qualified author + local lifecycle |

约束：`UNIQUE(id,ownerId)`、`UNIQUE(ownerId,templateId,revision)`、index `(ownerId,templateId,revision)`。

初版 `definitionJson` 只允许 provider-neutral text template：

```ts
type CustomerMessageTemplateDefinitionV1 = {
  schemaVersion: 1;
  body: string;
  variables: Array<{ key: string; sample: string }>;
};
```

变量 key 唯一、sample 只供 human preview/provider review，均受 server limits 与 privacy gate；adapter 只能确定性映射到
channel payload。header/media/buttons 等新增 capability 另走 bounded contract，不由 provider DTO 穿透。

三轴状态规则：

- `submissionState: draft → submitting` 只由 `submitTemplateReview` 在明确 human approval 后原子冻结，并由未来 C6 external-effect
  carrier 持有 stable submission key；当前 gate 下 action 返回 unavailable；
- C6 读到 provider 明确接受 request 的 verified evidence 才投影 `submissionState=submitted` 与
  `reviewState=in_review`；verified review evidence 才投影 `reviewState=approved/rejected`；
- `reviewState=approved` 仍不代表可用；只有 verified provider availability/quality evidence 才投影
  `availabilityState=available`，paused/disabled/flagged 立即使 external use fail closed；
- C6 证明 external call 前失败才投影 `submissionState=submission_failed`；call 后 response 丢失必须投影
  `submissionState=unknown`；任何未识别 provider status 投影 `reviewState/availabilityState=unknown` + unavailable；
- `unknown` 不自动重投，只能经 C6 reconcile；rejected/approved content 要改就新建 version；appeal/reinstatement
  仍由 C6 verified facts 推进三轴，不发明本地成功；
- Meta approved 也只代表该 template version 可被未来 send gate 考虑，不代表任何收件人/消息获准。

### §5.7 为什么不新增其它表

- 不新增 provider/Gupshup table：credential 继续走 encrypted `ChannelConnection`，adapter identity 由 server registry 管；
- 不新增 generic inbound-event JSON table：C4 message writer 与未来 C6 receipt writer 各自持有 durable idempotency
  key + hash；raw evidence carrier 的 retention 尚未通过 privacy gate，不能借机发明；
- 不新增 template-review truth、receipt/status/outbox/confirmation：external truth 全属 D8/C6；C4 template fields 只是
  从 C6 verified facts 重建的 read projection；
- 不新增 unread/read-cursor、internal comment、snooze、custom inbox、team queue、media blob：不是 B0-31/32/33/38
  最小验收，未来按真实需求另开 bounded task；
- 不改 `ChatThread/ChatMessage`、publishing `Channel` 或 consent fold。

## §6 Shared actions 与 Otto parity

### §6.1 唯一 shared action surface

所有动作先 `requireOwner()`，再按 owner re-read 每个 referenced ID；客户端/Otto 不传 owner。`requireOwner()` 只确定
tenant，不等于当前 member 获得动作权限。C4 的 creator/approver/org-role capability matrix 尚无 Founder-approved physical
contract；在该合同与 B13 carrier access row 冻结前，所有 C4 mutation（含 assign/takeover/template）默认 unavailable，
Unknown 一律 deny。external write 还必须经过该动作独立 approval/authority gate，不能把 active membership、assignee 或
template creator 当成 approver。拟议接口：

| Action | 类别 | 当前 gate |
|---|---|---|
| `listConversations/getConversation/searchConversations/getHistory` | read/internal | schema+implementation 后可启用 |
| `getConversationPreflight` | read/internal | 读各 authority；缺任一项即 unavailable，不授予 send |
| `listTemplates/getMessagingConnectionHealth` | read/internal | 只读 stored evidence；live probe 属 provider-call gate；health 不得伪造成 connected |
| `saveConversationDraft` | write/internal | Conversation + draft 双 CAS；draft only |
| `assignConversation` | write/internal | exact membership + CAS |
| `takeOverConversation` | write/internal | 原子 `paused_by_human` + event；旧 revision 失效 |
| `handOffConversation` | write/internal | 显式目标 + event；不能隐式 resume |
| `setConversationStatus` | write/internal | CAS open/close + event；blocked/send state 不由此绕过 |
| `requestAutomationResume` | write/internal | 只记录新指令；gates 未齐仍保持 disabled/paused |
| `createMessageTemplate/createMessageTemplateVersion` | write/internal | logical root + immutable local version |
| `submitTemplateReview` | write/external | human approval + separate Founder Meta/provider authorization；当前 unavailable |
| `submitConversationReply` | write/external | **D8/C5/C6 native gate 未齐时不存在可用实现** |

mutation 返回统一 `{ ok, resource, change: { id, revision, kind, actor } }` 或稳定 error code。CAS conflict 要求重读；
不得 last-write-wins 覆盖 assignment/takeover/draft。

当 `automationState=otto_active`，human composer 只显示 **Take over**，不可编辑/保存。任何绕过 UI 的 human
`saveConversationDraft` 都返回 `TAKEOVER_REQUIRED`；只有 `takeOverConversation` 原子写
`paused_by_human + takeover event + new revision` 后才可用新 revision 保存。这样“开始人工写”不会与 Otto continuation
双跑，也不会靠隐式 draft mutation 偷改 control state；Otto continuation 也因 conversation revision 变化而不能再写旧 draft。

### §6.2 防误发 chokepoint

UI、Otto、connector、job 未来只能进入同一个 `submitConversationReply`；它不得放在 adapter。该 action 必须在
对应 native contract 中依序做到：

1. authenticated owner + Founder-approved action capability + exact conversation/draft/action revision；
2. D8 manifest/reactive anchor/two-confirm carriers 存在且可重放；
3. 重新读取 current identity、connection、conversation control revision；
4. 调 C5 的 consent/STOP、DND、provider refusal、frequency 与 exact approval hard gates；
5. 原子 enqueue/outbox、stable logical submission id、provider idempotency；
6. adapter submission；结果交 C6 receipt/reconciliation，不回写假的 C4 delivery status。

现在 2–6 的 carriers/authority 未齐，因此 action 只能返回明确 `SEND_PATH_UNAVAILABLE`，并证明 zero provider call。
禁止 UI button、Otto skill、connector 或 worker 另造快捷路径。

Preflight 不把所有 negative 混成同一种 override：只有 R-010 D5 的 **consent risk** 可在 exact frozen action 上走两次
独立 human confirms，且不改变 consent、不形成 standing waiver；DND、permanent/account provider refusal、frequency、
operator/role、security、legal/channel prohibition、connection/capability 与 stale action revision 都是不可由 D5 绕过的
hard block。角色/能力 Unknown 也是 hard block；Otto、connector、job 不能代任何 confirm。

### §6.3 Otto skills / Parity Manifest

后续 implementation 的最小 skill 集：

- `readInbox`：`free/read/internal`；list/get/search/history/template status/connection health；
- `manageInbox`：`free/write/internal`；save draft、assignment、takeover/handoff、open/close、explicit resume request；
- `manageMessageTemplates`：`free/write/internal`；create root/version、读取 version diff、起草 text template；
- `submitTemplateReview`：`free/write/external` + machine-derived `needsApproval=true`；当前返回 gated/unavailable；
- real reply skill：不在 C4a 宣称；D8/C5/C6 native contract 后才命名/登记。

每个 human action/read 在 `parity-manifest.ts` 有一条对应记录，Otto context port 调同一 action，不直查 Prisma、不直调
adapter。连接/OAuth/credential lifecycle 继续 `ACCOUNT_SECURITY` exemption；inbound webhook 不是 Otto 能力。

Otto 措辞纪律：merchant UI 内把 Otto 定性为该商家的营收员工/增长 OS 能力，不自称通用 AI 助手/chatbot；
Otto draft 对 merchant 可见标记，不能伪装成已人工审核、已发送或真人身份；顾客对话只使用该 merchant 的业务上下文，
不做开放闲聊。

## §7 UI/read-model 与 live reflection

### §7.1 Inbox 基本结构

1. list：`All / Mine / Unassigned / Needs reply`；Contact 名称/identity、channel、open/closed、assignee、
   attention/control state、last message/time；
2. conversation：完整 owner-scoped history + visible control/assignment event timeline；
3. composer：共享 draft + exact revision；Otto active 时先 Take over；所有 external gates 未齐时发送控件 disabled；
4. preflight panel：逐轴显示 `connection / D9 identity / D8 carrier / member role-capability / consent-STOP / DND /
   provider refusal / frequency / exact approval / current revision` 的 authority source、
   `pass / block / risk / unknown / unavailable`、
   reason 与 checked time；C4 只读 C5/D8 状态，配置入口链接到其 owner，不在 C4 复制 policy；
5. template library：logical template、版本、submission/review/availability 三轴及 reason/time；不能把 local state
   画成 Meta truth；
6. Contact drawer 只读链回既有 CRM Contact；不另建第二 Contact profile。

### §7.2 必须区分的页面状态

| State | UI truth |
|---|---|
| loading | skeleton；不先画空列表 |
| empty | 已成功读取且真无会话 |
| search-empty | query 成功但无匹配；保留 query/filter 与清除入口，不冒充全 Inbox empty |
| disconnected | 无 channel connection；给安全 connect 下一步，不显示 0 当成功 |
| denied | 当前 member 无权限；不泄漏 resource existence |
| degraded | connection/capability 有明确受限；可读历史，禁用受影响 external action |
| stale | server freshness policy 判定 evidence 过期；标各时钟与 retry，不冒充 live |
| partial-error | 历史可读但 health/preflight/template 子读失败；逐块标错，不清空成功数据 |
| error | authority read 失败；保留 header/filter，显示 retry 与稳定 error code |
| ready | 显示真实数据与 server-supplied freshness evidence |

Control badges 固定语义：`Manual only`（automation disabled）、`Otto handling`（未来 gates 后）、`Human took over ·
Otto paused`。刷新、重新分派、打开页面都不能改变 badge。`requestAutomationResume` 在 gate 不齐时显示“已记录请求，
自动回复仍关闭”，不能乐观画成 active。

### §7.3 Live reflection

shared mutation 成功后返回 authoritative revision/event；human action 立即刷新同一 query，Otto action 另触发一次现有
coral sweep + 单条 narration。推送优先、bounded short poll 可兜底，但 transport 不在本票冻结。read model 分开返回
`lastProviderEventAt`、`lastHealthCheckedAt`、`lastDataLoadedAt` 与 server freshness disposition；缺值是 unknown/degraded，
不得拼成一个假的 `lastSyncedAt`。任何 stale/newer revision 以 server truth 为准；草稿跨视图保留，CAS conflict 显示
重读选择，不静默覆盖。

## §8 D8 / C5 / C6 fail-closed matrix

| Surface | C4a 可定义/保存 | 未有 native carriers 时必须 disabled / 不得声称 | 最终 owner |
|---|---|---|---|
| Inbox/history/search/assignment | owner-scoped thread、normalized inbound history、internal control/draft | real provider ingress 仍须 credential/webhook authorization；不得复用 Otto Chat | C4 |
| Template library | local root/version + C6-driven read projection | Meta submission、submitted/approved/available provider truth | C4 library/projection + C6 truth |
| Existing consent/DND reads | 可显示 typed projection | merchant assertion 当 verified opt-in、DND clear 当 consent | C5 |
| STOP/unsubscribe | 只路由到 typed writer boundary | ordinary reply 当 opt-in、partial STOP fan-out | C5 |
| Provider refusal | 只路由 boundary | C4 自写 block、伪造 receiptRef | C5 |
| Broadcast/workflow | draft only | automation/schedule/recurrence/send | C5/C7 |
| Human/Otto takeover | visible event + paused state | 人工后 Otto 继续、refresh/assignment/旧确认恢复 | C4 |
| Reactive/D5 reply | 只保留 draft | manifest、anchor、action/revision、两确认、override、outbox、worker、send | D8 native task（未分配） |
| Message result | C4 可显示消息本体 | draft/outbox/worker-start 画 sent/delivered/read | C6 |
| Reconciliation | adapter seam 可声明 capability | blind retry、local guess、fake success | C6 + D8 |

D8 hard rule：native contracts 未获批、实现、验证前，所有 dependent confirmation/automation/outbox/worker/retry/
receipt/send path 都是 disabled/fail-closed/no availability claim。JSON、cache、`ChannelConnection` row、request ID、旧确认或
standing waiver 都不能替代 authority。

C5 负责“此刻是否允许尝试发送”；C6 负责“provider 实际发生了什么”；C4 只负责“对话/草稿/模板/控制事实是什么”。
跨三域的 D5 `actionId/actionRevision → two confirmations → eligibility re-read → outbox/worker → provider →
reconciliation → ActionReceipt` 由后续 Founder-approved native task 分配，本文不静默抢归属。

## §9 Privacy、security 与 retention gate

### §9.1 已知

- customer message、draft、handoff note、searchText 都可能含 PII/商业内容；
- current B13 scoped PASS 只覆盖 `ConsentEvent`、`ContactDndEvent`、`ProviderRefusalEvent` 及两个 projection，
  **不覆盖本合同六个 carriers**；
- current house policy 是 DB/storage platform-managed encryption at rest + TLS in transit；本提案沿用作候选，不声称
  已批准 Customer Inbox privacy；
- raw provider payload 不进 C4 产品表；opaque ref/hash 不能塞 raw phone/message/token。

### §9.2 schema implementation 前必须补齐

B13/privacy 必须逐一给六表新增 row，冻结：source、data class、merchant ownership、read/export/delete、retention、
backup cadence、encryption、日志/telemetry redaction、media policy。当前提案建议 Phase 1：

- merchant-owned normalized text/history；平台不自动 retention delete/compact；
- Contact archive 不级联删 conversation/message；删除/导出走后续正常 privacy capability；
- message body/searchText 依 DB at-rest encryption + tenant boundary，不做不可搜索的 ad-hoc field crypto；
- 只支持 text + safe unsupported placeholder；customer media blob/storage 在单独 privacy gate 前不持久化；
- production backup/PITR 实际 cadence 仍是 Unknown，不能在本文宣称。

Founder 对本文 §5 的 schema 方向若批准，也**不等于**上述 B13 rows 已通过；privacy gate 仍在 migration 前独立到期。

## §10 Migration、activation 与 rollback 提案

所有步骤都是顺序合同，不是当前执行授权：

### M0 — authority/gates

- Founder 批准本文唯一 schema 方向；
- 新 issue 取得 schema/migration 明确授权；
- 六个 carrier 的 B13/privacy rows 获批；
- 不可拆分 package 中的 scoped `ContactIdentity → Contact` hardening 与 team-level attention 已明确获批；
- live main、dependencies、claim、branch/worktree/PR 重新查询；production backup/clone 另取 production authorization。

### M1 — additive storage only

- 先用 owner-qualified anomaly query 证明现有 `ContactIdentity.ownerId != Contact.ownerId` 为零；非零即停并另开修复决定；
- 新 migration 增六表、FK/unique/index、Organization back-relations、Membership composite unique，并把
  `ContactIdentity.contact` 改成 `(contactId, ownerId) → Contact(id, ownerId)`；
- 六表加入 `TENANT_MODELS`，coverage/static migration/rollback tests；
- 不改旧 migration，不开 route、worker、adapter、UI availability；所有 external path仍 zero-call。

### M2 — shared domain/actions with fake adapter

- C4 action-specific creator/approver/org-role matrix 与 B13 read/write access row 先获 Founder 批准；Unknown/default deny；
- 实现 owner-qualified repositories、CAS、event+projection transactions、inbound idempotency；
- UI/Otto 只经 shared actions；fake adapter/fixture/clock 完成 contract tests；
- send/template external ports 仍 hard-disabled。

### M3 — internal Inbox UI

- 接 list/history/search/assignment/draft/takeover/template local versions；
- honest loading/empty/disconnected/degraded/stale；
- 不接真实 webhook、provider、submission 或 send。

### M4 — real inbound WhatsApp（另取 authorization）

- Founder 批准 credentials/WABA/Gupshup、real webhook 与任何 spend；
- B0-89 隐私政策、ToS、数据删除回调已按实际 C4 数据流更新、经 Founder 批准并 live-verified；旧 shell 文本不算；
- D9 active four-fact identity authority、exact resolver 与 safe backfill/cutover 已另获批并验证；否则 real ingress 保持 disabled；
- 验签、scope mapping、new-contact-no-consent、text ingress、idempotency/2-org/security/privacy evidence 全绿；
- multi-fact ingress 使用同一 bounded transaction；若做不到，durable normalized envelope + per-fact progress +
  pending-scope send block 的 exact carrier/privacy/ownership 先另获批、实现、验证；
- 同一 provider webhook 可能混送普通 text（含 STOP）、permission/refusal、delivery 与 template-review facts；在 C5
  typed consumers、C6 receipt consumer 以及 unknown-event quarantine/replay privacy carrier 未与 C4 于同一 exact release
  可用前，**整个 real endpoint 保持 disabled**。只有 provider 官方合同证明 event endpoints 可物理隔离，且测试证明被关
  类别不会 ack/drop/遗失，才可另获 Founder 批准分期开 ingress；本合同默认不作该假设。

### M5 — template review（另取 authorization）

- Founder 批准真实 Meta submission；先证明 stable submission key、unknown/reconcile、zero blind retry；
- provider ack/webhook 先写 C6 verified external-effect/receipt truth，再推进 C4 review projection；不启用 send。

### M6 — outbound/live completion（D8/C5/C6 后）

- D8 carriers/privacy/runtime、C5 eligibility、C6 receipt/reconcile 全部另获批、实现、验证；
- 每个可能收费的 provider action/计费单位都先完成 costing；价格只来自 config，毛利地板与透明直传已验证；通道费只走
  `ChannelFeeWallet/ChannelFeeLedger` 独立账道并进入消费明细，绝不混 credits、绝不旁路账本；
- exact-head CI + independent review + deployment authorization；之后才可启用 real reply，才可把 B0-31 视为真实双向完成。

Rollback：

- M1–M3 未接 live data：关闭 feature flag；drop 仍是 destructive migration，须另取 Founder approval；
- M4 起已有真实 inbound：disable ingress 后 keep-forward 数据/reader；不得退回 Otto Chat、raw webhook 或 provider row；
- M5 有 external unknown：保留 C6 receipt truth 与 C4 version projection，reconcile；不得删除后重投；
- M6 若未来启用：rollback 必须保留 manifest/outbox/receipt/idempotency truth，不能回到一次确认或假 sent；
- 任一步 tenant/idempotency/privacy 不明时只停 affected path，留下可见 reason 与 forward-fix ticket。

## §11 Acceptance 与 adversarial tests

### §11.1 schema/domain

- 六表 ownerId coverage、每条 relation tenant-qualified、Membership/Conversation/Template composite keys 存在；
- `ContactIdentity.contact` 是 `(contactId,ownerId)` composite FK；migration preflight 对 cross-owner anomaly 非零 fail closed；
- `ChatThread/ChatMessage` 与 publishing `Channel` 零修改、零引用；schema/core 零 `gupshup` identifier；
- one exact identity → one conversation；legacy/unmapped identity 无法建 thread；
- verified new four-fact key 原子创建 Contact + Identity + Conversation，且 consent 保持 unknown；collision/conflict
  零 auto-attach/merge、零第二 Contact；
- inbound message duplicate same key+same hash no-op；same key+different hash conflict；template review 由 C6 receipt
  自己去重，C4 projection 重放不改变最终三轴 truth；
- migration deploy/rollback/Prisma generate/tenant guard tests isolated 通过（仅未来 authorized implementation）。

### §11.2 tenant/security

- 两 Org 互换 conversation/message/identity/scope/membership/template IDs：统一 not-found/denied，零泄漏、零写、零 provider call；
- 构造 A-owner Identity 指向 B-owner Contact 的 legacy/adversarial fixture：Inbox list/history/search/Contact drawer/resolver
  均零数据、零写、零 provider call；不能仅靠新 Conversation FK 掩盖旧 seam；
- invalid signature、valid signature + unknown account、scope/channel mismatch：零 product row；
- 单条 `STOP` text 同时 durable 写 C4 message 与 C5 STOP fact；重复整包投递两边都零新增；任一 writer/quarantine
  中途失败都不 ack、不 drop，重投后补齐且不能留下可发送的 stale permission window；
- raw webhook、secret、access token、signed media URL 不进 DB/log/error/telemetry/UI；
- 未批准/Unknown role-capability 与 impersonation/read-only mode 的所有 write 拒绝；需要 approval 的 action 对非 approver
  拒绝。assignee/active member 不自动获得 takeover、template submission 或 reply 权限。

### §11.3 concurrency/takeover

- 两成员同 revision assign/takeover：一方成功、一方 CAS conflict；
- 人工回复意图与 Otto continuation 同时发生：pause/event 先提交，Otto stale revision 拒绝；
- accepted inbound 与 human close 同 revision 竞态：若 inbound 先提交，close 因 stale revision 拒绝；若 close 先提交，
  inbound 在同 transaction reopen + `opened` event，最终进入 Needs reply；
- accepted inbound 与 draft save 同 revision 竞态：一方推进 aggregate revision 后，另一方旧 conversation revision 拒绝；
- refresh/reassign/reopen 不 resume；new explicit resume 在 gates 未齐仍 disabled；
- 未通过 O-01+O-06/B0-34 对客 AI 测试/护栏 gate 时 `otto_active` 写入拒绝，auto-reply zero-call；
- draft stale revision 不覆盖 newer human/Otto draft。

### §11.4 template/provider truth

- `submitting` 前失败 → `submission_failed`；call 后 timeout → `unknown`；两者不混；
- C6 verified provider ack 才投影 `submitted`，verified review receipt 才投影 `approved/rejected`；乱序不倒退 projection；
- approved 后收到 paused/disabled/flagged/unknown evidence 必须立即 unavailable；旧/乱序 evidence 不能恢复 available；
  appeal/reinstatement 只有 C6 verified newer fact 才能恢复对应三轴；
- capability/connection degraded 时 external action disabled；fake adapter proves zero real network；
- approved template 不绕过 consent/DND/frequency/D8 confirmation。

### §11.5 D8/C5/C6

- current-head test 证明 UI/Otto/connector/job/outbox/worker 没有可达 send path；
- provider cost 没有独立通道费 reserve/settle/refund、stable idempotency、config costing 或毛利证据时，real reply
  zero provider call、zero charge；credits ledger 与 channel-fee ledger 零共享 finalizer；
- draft、local approval、outbox creation、worker start（未来）都不生成 delivery receipt；
- unknown provider result 不画 sent/delivered，不 blind retry；
- STOP 原子 fan-out、DND clear 不 grant consent、provider refusal exact-scope、frequency hard gate 由 C5 tests；
- crash before/after enqueue/provider response/receipt persistence 的 exactly-once/reconcile 由 D8/C6 native tests；缺失即不激活。

### §11.6 UI/Otto

- loading/empty/search-empty/disconnected/denied/degraded/stale/partial-error/error/ready 的 desktop/mobile
  snapshot/interaction tests；`search-empty` 保留 query/filter，`partial-error` 保留已成功数据，`error` 保留 retry；
- human 与 Otto actions 每项有同一 shared action + Parity Manifest record；
- Otto narration/coral sweep 不重复，human action 不冒 coral；
- copy 不出现“已发送/已送达/已批准”除非对应 authority 已读到；Otto 不自称通用 assistant/chatbot。

## §12 respond.io comparison anchor（2026-07-19 官方文档锚）

本轮未登录 respond.io workspace、未做截图式实机走查；以下只冻结公开官方文档版本，后续 design-ready/verified
仍须按 applicable environment 做 desktop/mobile 真实走查。

Primary benchmark pages（页面标示更新日）：

- [Managing Conversations in Inbox](https://respond.io/help/inbox/managing-conversations-in-inbox)（2026-03-17）：conversation list、
  status/channel/unread/last message、history/composer 与 provider-backed message status；
- [Assigning and Closing a Conversation](https://respond.io/help/inbox/assigning-and-closing-a-conversation)（2026-06-05）：manual
  assignment/unassignment、open/close 与 visible conversation event；
- [Managing Contacts in Inbox](https://respond.io/help/inbox/managing-contacts-in-inbox)（2026-07-10）：Contact 与跨/单一
  conversation message search；
- [Getting Started with AI Agents](https://respond.io/help/ai-agents/getting-started-with-ai-agents)（2026-04-30）：human Takeover
  立即停 AI，重新 assign 给 AI 前不再回复；
- [WhatsApp Message Templates](https://respond.io/help/whatsapp/whatsapp-message-templates)（2026-07-17）：template create/edit/review、
  Meta review 状态与 messaging-window 限制。
- [Mobile App Overview](https://respond.io/help/mobile-app/mobile-app-overview)（2026-04-29）：mobile All/Mine/Unassigned、
  conversation events/search/open-close 与 composer 基线。

C4a 的上市地板是：list/history/search/assignment、WhatsApp text ingress、local template library/review truth、可见
human/Otto takeover 全齐，且 UI/Otto 双入口同一 actions。刻意不抄 custom inbox、snooze、calls、comments、voice、
Workflows、Broadcasts、advanced reports、media storage 与 per-member unread；FIKIRTIVE 以 `Needs reply` team attention
替代 per-user unread，这些排除项不是本票缺项。

差异化硬线：FIKIRTIVE 把 provider 换成 adapter、把 Otto 放在全产品 shared action 层，并把“人工介入立即停、明确
resume 才恢复”做成数据/并发 hard rule；不是靠 prompt 建议。真实 sent/delivered/read 仍须 C6 evidence，不能为了视觉
追平 respond.io 而造假。

走查阈值：

| B0 | Desktop human journey | Mobile human journey | Otto journey | 通过阈值 |
|---|---|---|---|---|
| B0-31 | All/Mine/Unassigned/Needs reply → search → history → assign/open-close | 同四队列、search/history、assign/open-close | read/list/search/assign/open-close 同 actions | 关键步骤 100% 完成；0 跨租户/错联系人、0 duplicate ingress |
| B0-32 | create text template/version → view three axes → gated submit | read status；真实 submission 可保持 desktop-only | draft same version；submit 走同 gated action | local journey 100%；0 fake submitted/approved/available |
| B0-33 | composer preflight 逐轴 reason → disabled safe next step | 同一 authoritative preflight 的 compact view | read same preflight；无 bypass | 各 gate 100% 可解释；0 未批准/重复发送 |
| B0-38 | Otto active → Take over → draft；explicit resume request | 同 takeover/handoff/control badge | read/control same actions | takeover race 100% hard-stop；0 silent resume |

四行合计的 hard-zero：0 mock authority、0 cross-tenant、0 wrong-contact、0 unapproved/duplicate send、0 fake receipt。
任何一项非零或关键步骤不完整即未通过；mobile 允许 compact layout，不允许缺失安全动作/truth。

## §13 六级状态与 evidence contract

按 `docs/ops/route-b/B0-CONTRACT.md`：

| B0 | 当前 live 状态 | 本 PR 合并后 | 后续到期条件 |
|---|---|---|---|
| B0-31 | `listed / absent` | 仍 `listed / absent` | schema/privacy、internal UI、real inbound、D8/C5/C6 后才 code-complete/verified |
| B0-32 | `listed / absent` | 仍 `listed / absent` | template schema + separate Meta authorization + provider truth |
| B0-33 | `listed / absent` | 仍 `listed / absent` | shared chokepoint + zero-bypass tests；send gate未齐仍 unavailable |
| B0-38 | `listed / absent` | 仍 `listed / absent` | event/CAS/UI/Otto parity + race tests |

`B0-CONTRACT.md` 当前把 `spec-ready` 绑定“所属块 spec 冻结”。C4a 只冻结 B5 四行而非整个 B5，因此即使本文经
Founder schema direction 批准并 merged，也不预支 `spec-ready`。只有未来 Founder 明确认定 C4a 可作为这四行的
所属块 spec（或完整 B5 spec 冻结），且 matrix 写入 exact PR/SHA/benchmark anchor，才可另票升级。PR ready、
tests/review、ticket close、mock 或 UI screenshot 都不能单独升级状态。

每个后续 head 必须依 current workflows + `docs/runbooks/local-ci.md` 重跑适用 jobs，发布 exact commit evidence；
独立 cross-family review unresolved P0=0/P1=0。CI unavailable 不是 green，任何 merge 前另取 Founder 明示批准。

## §14 Gates、Unknowns 与当前唯一决定

### §14.1 后续 Founder-only gates（均不由本文授权）

| 动作 | 何时单独问 |
|---|---|
| schema/migration implementation 或 DB apply | 对应 C4b issue 首次动作前 |
| B13/privacy rows、retention/encryption/export/delete | 六 carrier migration 前 |
| C4 tenant RBAC（creator/approver/org role）与 carrier access | action/UI 启用前；Unknown/default deny |
| Gupshup/WABA credentials、embedded signup、permissions | 读取/创建/改变真实 credential 前 |
| provider/Meta call、真实花费、template submission | 每个对应动作前 |
| B0-89 隐私政策/ToS/数据删除回调 | Meta App Review 前；Founder 批准并 live-verify |
| channel-fee costing、独立账道与 money-safety review | 任何会产生 provider cost 的 real reply 前 |
| D8 native carriers 与跨 C4/C5/C6 ownership | native issue 建立/实施前，且任何 live send 前必须闭合 |
| production/backfill/reconcile/deploy | 每个 production 动作前 |
| CI-unavailable merge | merge 前；本地复现不替代 Founder approval |

### §14.2 当前 Unknown（不偷偷填）

- production backup/PITR 实际 cadence；
- 顾客 message/draft/review carriers 的最终 retention/export/delete 与 media storage policy；
- unknown-event quarantine/replay operational evidence 必须存在；其独立 carrier exact shape、owner、retention 与 replay authority 未定；
- D8 cross-cutting native task 的最终归属与 exact tables；
- C4 creator/approver/org-role 的 exact capability matrix；未决期间所有 mutation default deny；
- 真实 Gupshup/WABA account、credentials、capabilities、Meta review/price/法律状态；
- WhatsApp/provider 的真实 per-message 成本、独立通道费产品配置与 margin evidence；
- future multi-BSP-per-owner 是否真实需要；当前不预埋。

### §14.3 只向 Founder 呈这一题

> **是否把 §5 作为一个不可拆分的 C4a package 批准：六个 tenant-qualified、provider-neutral carriers；仅针对
> `ContactIdentity → Contact` 这一处 C4 seam 的 composite tenant-FK hardening；以及 team-level `Needs reply`
> （不建 per-member unread cursor）？这不构成 #317 所问的全仓 FK 房规。**
>
> 批准的含义仅是：允许本文在通过 exact-head review 后合并，并允许下一张 bounded C4b issue 以这套 shape
> 准备 schema/migration 实施申请。批准**不授权**修改 Prisma/migration、连接 provider、配置 credentials、Meta
> submission、花费、live send、D8、RBAC、B0-89 法务面、production、deploy 或 CI-unavailable merge。

建议：**批准**。它是满足 B0-31/32/33/38 的最小完整 carrier set，并只封住 C4 实际会 traverse 的一处既有 tenant
seam，不替全仓作架构决定；顾客 conversation 与 Otto Chat 分离，provider
可替换，assignment/control 可重放，草稿不会冒充 outbox，template review projection 不会冒充 C6 receipt 或 send，
且所有 D8 dependent path 继续 fail closed。
