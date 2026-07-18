# R-010：CRM identity、consent 与 UTM schema authority 对齐

> **状态：DRAFT / FOUNDER-APPROVAL-PENDING / SPEC-ONLY**
>
> Issue：[R-010 #339](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339)
>
> 证据基线：live `main` `a61e3a855f3460f2166db08c64c0b9c4e7db340e`（2026-07-16）
>
> 本稿把 Founder 已批准的 D1–D7 产品结果翻译成一份**待批的字段级物理合同**。只有标为「已批准」的结果已经生效；表、字段、索引、枚举、折叠、迁移与回滚选择，在 Founder 合并本 PR 前都只是提案。
> 本 PR 不修改 Blueprint、Prisma schema、migration、产品代码、数据、global 配置或 provider；不授权 merge、deploy、production access、backfill、cleanup 或 spend。#339 与 #327/#328/#329 的硬停不因 Draft PR 打开而解除。

## 0. 读法与权威边界

本文只使用三种状态：

| 标记 | 含义 |
|---|---|
| **【已批准】** | Founder 已在 GitHub 留下 durable Resolution；本稿只能忠实表达，不能改写 |
| **【本 PR 提案】** | 建议采用的字段级/迁移合同；须经独立评审和 Founder 合并才成为实施输入 |
| **【Unknown】** | 当前没有足够证据；不得猜、回填、施工或宣称完成 |

Phase-1 exact Channel identity resolver / merge-lineage、consent transition/legacy、UTM derivation/path选择属于**blocking Unknown**：它们可留在Draft供讨论，但在变更为Ready、请求Founder合并或关闭#339前必须被本PR后续revision写成一个明确待批选择并逐项批准。D5 carrier是「可在全部相关路径保持 disabled/fail-closed 下延后」还是「合并本 Draft 前必须冻结物理形状」尚未由 Founder 选择；在该分类决议前，本 Draft 不得 Ready 或请求合并。

当前上位约束：

1. `docs/BLUEPRINT.md`：完整 Customer Engagement CRM、merchant autonomy、provider-neutral/可替换 connector、tenant isolation、人工与 Otto 共用同一动作层。
2. [D1 — Contact continuity](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992981271)：有可靠证据时，provider、connection、channel 改变不应丢失/重复顾客；不确定匹配必须商家确认。
3. [D2 — Consent history + unknown autonomy](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993054049)：permission/revoke history 是长期事实真源；`unknown` 不是 hard block；STOP、DND、provider refusal 各自独立。
4. [D3 — Link-time UTM](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993207403)：Campaign 一期只归组；可量测链接在生成时定案严格五键；事件保存当时快照；`utmBase` 不是长期权威。
5. [D4 — STOP / unsubscribe purpose scope](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4994091911)：无限定 STOP 原子撤回该 channel 全部主动非交易用途；purpose-bound unsubscribe 只撤回 token 指定用途；严格交易信息不得夹带营销。
6. [D5 — visible risk tag + two-confirm manual override](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998535600)：known consent risk 默认不自动接入主动发送；商家明确手工加入时，显示 tag/warning，并在两次独立人工确认后提交 exact frozen action；确认不制造 consent，也不给 Otto/connector/后台任务 standing override。
7. [D6 — continuity evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009216073)：同一verified stable logical Channel scope的exact identity复用；只有明确、可审计的 provider/FIKIRTIVE continuity proof 才可把新identity attach到唯一既有Contact，且不改变consent；普通资料只作suggestion，冲突、recycle/reassignment signal、多root或merchant split绝不auto-attach。
8. [D7 — respond.io Contact baseline](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009411743)；[precise correction](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009515955)：Phase 1 采用其成熟的 Contact 产品/UX行为基线，不复制其代码或 UI，亦不把未公开的内部身份语义当证据；保留 owner-scoped exact Channel identity、duplicate suggestion、merchant-controlled merge/unmerge 与 connector-neutral adapter。
9. B2 v1.2、B8/#314、现行 schema/migration/tests 是本次对齐证据，不因较早冻结、较晚合并或已有测试而自行成为最终 authority。

本稿不建立第二个 roadmap，也不扩大 Phase 1。它只闭合 R-010 的三个冲突面及为安全迁移不可缺少的共用边界。

## 1. 统一术语

| 术语 | 本文唯一含义 |
|---|---|
| `owner` / merchant | 一个 FIKIRTIVE tenant；所有数据访问从 authenticated session 取得 `ownerId` |
| `Contact` | merchant 范围内的一个 CRM 顾客档案；不是手机号、邮箱、PSID 或 provider account |
| `ContactIdentity` | Contact 与一个外部身份键的绑定；同一 Contact 可有多个 channel identity |
| `channel` | provider-neutral 协议/平台域，例如 WhatsApp、email、Instagram；不是 Gupshup、BSP、adapter、token 或 credential |
| `logical Channel scope` | provider-neutral、稳定的Channel-instance逻辑范围；它在BSP/adapter replacement后仍能识别同一merchant下的多个account/page/channel实例，并与external contact ID共同判同；其field/table/index carrier仍是blocking Unknown |
| `canonical Channel identity` | `(ownerId, channel, logicalChannelScope, externalId)` 的active精确身份；adapter 只把provider payload转成这些语义事实，不能成为core schema、UI或Otto的第二套身份真源 |
| `provider connection` | 可替换的接入与 credential 载体；不是顾客 identity authority |
| `exact-key reuse` | 同一verified stable logical Channel scope内同一active canonical Channel identity再次到达时幂等复用；不是跨渠道merge |
| `merge / unmerge` | 两个既有 Contact 经商家确认后合并/拆回；显式、可审计、可逆、不物删历史 |
| `permission fact` | 平台能追溯的 grant/revoke 事实；不是平台替商家作出的法律裁决 |
| `permission tuple` | `(ownerId, contactId, channel, purpose)` |
| `purpose class` | server-owned permission 分类；Phase 1 的 `marketing/review_request` 是 `proactive_non_transactional`，`transactional` 只容纳既有订单、付款、收据、配送或安全所必需的封闭内容 |
| `reactive_service_reply` | 独立 send class，不是 `transactional`、不是 ConsentEvent purpose、也不制造 grant；只表示一条可验证的顾客主动对话下的一对一回复资格 |
| `consent risk tag` | 从当前 permission facts 派生的可见 warning；不是 consent、不是 Contact identity，也不改变 fold |
| `manual consent override` | D5 下由同一获授权 merchant 对 exact frozen action 完成两次独立确认后的执行证据；不是 re-opt-in、standing waiver 或自动发送权 |
| `unknown` | 没有足够事件得出 verified grant 或 effective revoke；既不是 consent，也不是 hard block |
| `known negative` | 可验证的 customer STOP/unsubscribe、merchant DND/block，或真实 provider hard refusal；三者仍是不同事实 |
| `Campaign` | Phase 1 的活动意图与归组对象；不拥有可编辑 UTM authority |
| `effective UTM` | 某一可量测 TrackedLink 实际发出的严格五键对象 |
| `event-time snapshot` | 下游事件落账时复制的 effective UTM；历史报表不回读当前 Campaign |

## 2. 冲突结论与 supersedes

| 轴 | B2 v1.2 | B8 / current main | Founder 已批准的长期方向 |
|---|---|---|---|
| Identity | issuer/version、自动 attach/revive/reassignment 生命周期 | live partial `(ownerId, channel, externalId)` | D6/D7：语义exact key为owner + channel + stable logical Channel scope + external ID；exact reuse，或经明确可审计continuity proof attach到唯一root；其physical carrier仍Unknown |
| Consent | append-only `ConsentEvent`，按 channel × purpose 留 provenance | Contact 上 mutable `marketingConsent/consentSource/consentAt` | event history 为长期 permission-fact authority；Contact 只可作 derived compatibility/display；unknown 不 hard block |
| UTM | Campaign structured store + link effective value + event snapshot | `Campaign.utmBase`；已有 `TrackedLink.utmJson` 与 event snapshots | 不采 Campaign UTM store；link 是 effective authority；event 是历史 authority；`utmBase` stop-write 后留存 legacy |

若本 PR 经 Founder 合并，以下解释被明确 supersede：

- B2 的自动 cross-channel attach / recycle / reassignment lifecycle读法：D7 Phase 1 不建设自动 person inference、issuer lifecycle、reassignment epoch或auto-revive/quarantine。D6只允许同一verified stable logical Channel scope的exact reuse，或有明确可审计 provider/FIKIRTIVE continuity proof 时将新identity attach到唯一既有Contact；phone/email/profile/order/name/address/avatar等普通资料只suggestion。provider replacement仍由薄adapter解析回同一逻辑scope的canonical Channel identity，而不是另造provider-specific core；conflict、recycle/reassignment signal、多root或merchant split绝不auto-attach。
- B8 Contact 三个 consent 字段作为长期真源的读法，以及任何把 `unknown` 与 `opt_out` 合成同一个 send hard gate 的读法。
- B2 旧 fold 中让 `asserted + merchant + backfill` 的 grant/revoke 改变 effective state 的读法：这类 event 只保存 merchant assertion 与 provenance，**state-neutral**；它不能覆盖 verified customer stance，也不能把 `unknown` 升成 grant/revoke。
- B2 Contract 3 fold rule ③中任何 `customer + backfill + grant` 可建立有效 state 的读法：本稿闭合 writer matrix 不存在该组合，且 exhaustive fold 只允许已列组合改变 state；因此它不得写入、不得成为 backfill 或 re-opt-in 后门。
- B2「每个 transaction 永远只处理一个 permission tuple」的绝对读法：普通 event 仍只处理一个 tuple；唯一产品例外是 D4 定义的无限定 STOP（含 verified historical unqualified STOP）按 server-owned proactive-purpose 集合做原子 multi-tuple fan-out。STOP-derived purpose expansion 也必须沿用同一 fan-out/tuple 锁序，不能另开并发旁路。
- B2 对 `ConsentEvent.actorKind` 的旧/open-set读法：Phase 1 closed set 固定为 `customer / merchant / legacy_unknown`；`system` 不得写入 ConsentEvent。未来若确需 system permission fact，须另行冻结 source/action/evidence/fold 与迁移合同；本稿不预留实现者自行启用的枚举值。这里不影响 ProviderRefusalEvent 等其它 typed authority 明列的 system actor。
- B8 `Campaign.utmBase` 作为长期 authority 的读法。
- B2 Phase-1 Campaign-level editable structured UTM store 的读法；只保留 link-time effective value 与 event snapshot 原则。

未冲突的 B2/B8 合同继续是证据/下游输入；本稿不顺手重裁其它条款。

## 3. Identity authority

### 3.1 【已批准】产品不变量

1. provider/BSP/adapter replacement、reconnect 或新增 channel 本身不得把一个**可被可靠辨认**的顾客变成新 Contact。
2. 一个 Contact 可绑定多条 channel identity。
3. 同名、近似名、handle、模型相似分或其它模糊信号不能 auto-merge。
4. 不确定的跨渠道匹配只向商家建议；由商家确认 merge/unmerge，并留下审计。
5. D1 没有批准任何具体 normalizer、index、evidence class 或 tenant-FK 形状；D7 已明确 Phase 1 不建设 issuer/recycle/revive/reassignment lifecycle。

### 3.2 【已批准 D6/D7 / physical carrier blocking Unknown】exact Channel identity

| 字段 | 目标合同 |
|---|---|
| existing `id` | stable row ID |
| existing `ownerId` | authenticated tenant |
| existing `contactId` | 同 owner 的 Contact |
| existing `channel` | provider-neutral channel |
| logical `Channel scope` | stable、provider-neutral的Channel-instance语义范围；须在同一owner下区分多个account/page/channel实例，且在BSP/adapter replacement后保持连续；**不在此指定field/table/index carrier** |
| existing `externalId` | adapter 经单一 server-side canonicalization 输出的 Channel external ID；不是 display handle |
| existing `handle/label` | 只展示；不参与判同 |
| existing `createdAt/deletedAt` | 保留历史与 live-row 状态 |

Phase 1 的**语义**exact key是owner + channel + logical Channel scope + external contact ID；当前B8三段live partial index只是一项既有物理事实，不能声称足够或最终。logical scope及该四事实key的field/table/index carrier均是blocking Unknown；在获Founder physical-schema批准前不得写writer、替换index或以临时column/JSON/connector row补洞。

不引入 `IdentityIssuer`、issuer retire/reactivate/quarantine lifecycle、reassignment epoch、自动revive/recycle或历史assignment state machine。canonicalization 必须是单一 server-side rule，caller不得提交canonical value；每个channel的具体规则与continuity proof的physical evidence carrier仍是独立 Unknown，不能以本段静默决定。

### 3.3 【已批准 D7 / 本 PR 提案】共享 resolver、duplicate suggestion 与并发

UI、Otto、inbox、attribution、workflow、manual、CSV/import 和未来 connector 只能调用一个 shared identity action/repository（暂名 `resolveOrCreateContactIdentity`），不得直接 Prisma 旁路。

1. `requireOwner` 取得 `ownerId`；拒绝 client owner。
2. connector adapter只解析provider payload为canonical channel + verified stable logical Channel scope + external contact ID；adapter可替换，但core schema、UI与Otto不得依赖BSP/provider。scope的物理carrier尚Unknown，adapter或connector row不得被偷换成core authority。
3. owner-scoped按四事实语义exact key查active identity；同一verified stable scope命中则复用同一Contact。首次互动零命中时，只有在获批physical carrier可原子承载该语义时，才可在同一transaction创建Contact + ContactIdentity。
4. 新identity只有携带明确、可审计 provider/FIKIRTIVE continuity proof，且唯一既有Contact root无歧义时，才可attach到该Contact；该attach须有audit与idempotency，并不得改变ConsentEvent或consent fold。proof的physical evidence carrier仍Unknown，未获批前该路径fail-closed。
5. phone/email/profile/order/name/address/avatar、同名、handle或相似资料只产生merchant-visible duplicate/merge suggestion；不自动attach、不自动merge、不猜同一人。
6. conflict、recycle/reassignment signal、multiple roots或merchant split一律不auto-attach；跨渠道关系只可走可见merchant merge/unmerge。
7. 用户可移除已不相关的Channel identity；既有conversation history保留。该动作不触发issuer lifecycle、自动revive/recycle、reassignment或跨渠道person inference。
8. 并发insert的unique loser必须先让含speculative Contact的transaction完整rollback，再在fresh owner-scoped transaction以bounded retry等待winner commit、按完整四事实**语义**key重读同一root；不得向用户暴露裸P2002或再造Contact。physical unique contract未获批前不得将此段视为三段index实现授权。
9. 失败transaction不得留下orphan Contact、identity或audit。

### 3.4 【已批准 D7 / 本 PR 最小 lineage 提案】merchant merge / unmerge

普通 soft delete 与 merge 必须分开。建议：

- `Contact.mergedIntoContactId String?`、`mergedAt DateTime?` 只作可重建 redirect projection；
- append-only `ContactMergeEvent` 保存 `ownerId, kind, sourceContactId, targetContactId, reversesEventId, primaryFieldResolution, actorKind, actorId, idempotencyKey, createdAt`；
- append-only `ContactIdentityMoveEvent`只保存merchant确认的merge/unmerge所移动identity：`identityId, fromContactId, toContactId, mergeEventId, actorKind, actorId, idempotencyKey, createdAt`；它不是reassignment/revive或自动assignment历史机；
- 两表 `UNIQUE(ownerId, idempotencyKey)`，不接受 ordinary UPDATE/DELETE；generic `ActionEvent` 可镜像 UI/admin audit，但不能是唯一 unmerge 真源。

merchant在merge时选择保留的primary fields；`ContactMergeEvent`保存该次可见的选择与merge history。Merge先解两边root，再按`ownerId + stable Contact ID`全序构造tenant-qualified transaction locks，锁内复核roots、阻止cycle，并只移动本event明列identity。Unmerge只反转该event仍在预期target的identity；merge后新加identity不猜测性移回，亦不承诺完整时间倒流。merge/unmerge不创造consent，也不得覆盖STOP、DND或provider refusal。

本段确定 D7 所需产品/UX语义，但不单独解锁schema或实现。任何live merge/unmerge启用前，仍须在同一获批physical contract明确permission tuple、customer revoke、DND、post-merge re-opt-in、冲突grant/revoke与unmerge restoration如何跨lineage求值；在此之前相应写路径fail-closed，schema carrier也不等于功能已开启。

## 4. Consent authority

### 4.1 【已批准】产品不变量

1. permission/grant 与 customer revoke 按 Contact × channel × purpose 保留历史；新事实不抹旧事实。
2. event history 是长期 permission-fact authority；Contact 当前状态只能是 derived display/compatibility summary。
3. `unknown` 如实显示，但不是 hard send block，也不得被静默移出 merchant-selected audience。
4. explicit STOP/unsubscribe、merchant DND/block、真实 provider hard refusal分别执行；frequency suppression 仍是另一轴。
5. import、order、commerce 字段、普通 inbound message或 Contact 存在本身不能制造 customer opt-in。
6. `unknown` 可提示、提醒或提供 `verified only` optional filter；FIKIRTIVE 不把 unknown 声称为 legal consent，商家仍负责关系、permission claim 与最终名单。
7. D4：无限定 STOP 撤回该 channel 全部 `proactive_non_transactional` purposes（Phase 1 为 `marketing + review_request`）；purpose-bound unsubscribe只撤回token指定purpose；严格`transactional`不因STOP自动撤回，但不得夹带营销或评价邀请。
8. D5：consent risk对自动/无人确认的主动发送继续生效，但不成为获授权merchant手工发送的绝对禁令。平台显示tag与warning；merchant对exact frozen action完成两次独立人工确认后可提交。该override不改ConsentEvent/fold、不等于re-opt-in，也不能被Otto、connector、import、rule或background job自行取得或复用。

### 4.2 【本 PR 提案】ConsentEvent

建议以 `ConsentEvent` 作为唯一长期 permission-fact truth：

| 字段 | 提案语义 |
|---|---|
| `id` | stable sortable event ID（建议 ULID） |
| `ownerId` | authenticated tenant |
| `contactId` | 同 owner Contact |
| `channel` | provider-neutral closed taxonomy |
| `purpose` | code-validated closed set；Phase 1 为 `marketing / transactional / review_request`，每项必须有server-owned purpose class |
| `action` | `grant / revoke` |
| `actorKind` | server-derived `customer / merchant / legacy_unknown`；future `system`组合须另走合同演进 |
| `entryMode` | server-derived `interactive / backfill`；caller 不可传 |
| `sourceKind` | endpoint-bound closed set；caller 不可传 |
| `evidenceStatus` | server-derived `verified / asserted / unresolved`；caller 不可传，直接决定该 event能否改变 effective state |
| `evidenceRef` | endpoint-validated opaque reference；不得默认保存 raw message body 或不必要 PII |
| `operationId` | server-derived stable operation group；普通单tuple event可等于自身operation，D4 STOP fan-out各purpose共享一个值；caller不可传 |
| `idempotencyKey` | server 构造的稳定 business key |
| `occurredAt` | 外部声称的业务时间，只展示/审计 |
| `receivedAt` | server 赋予的规范 replay 顺序 |
| `createdAt` | DB 写入时间，不参与 fold |

约束提案：

- 无 ordinary `updatedAt/deletedAt`；普通产品路径不得 UPDATE/DELETE；
- `UNIQUE(ownerId, idempotencyKey)`；
- replay index `(ownerId, contactId, channel, purpose, receivedAt, id)`；
- `ownerId + contactId` 同租户由 writer fail-closed；composite FK 最终房规仍归 #317；
- privacy erasure/de-identification 是另一个受控 privacy operation，不能假装普通 event mutation。

### 4.3 【本 PR 提案】closed source/action matrix

| 写入端点/动作 | `sourceKind` | action / actor / mode / evidence | 规则 |
|---|---|---|---|
| 明确 inbox opt-in flow/keyword | `explicit_inbox_optin` | `grant / customer / interactive / verified` | flow须server-bind exact purpose；普通 reply不进此端点、不生成 event |
| unsubscribe link | `unsubscribe_link` | `revoke / customer / interactive / verified` | token与 Contact/channel/exact purpose由server验证；只写该purpose |
| re-subscribe link | `resubscribe_link` | `grant / customer / interactive / verified` | 必须是受控、purpose-bound re-opt-in动作 |
| STOP parser | `stop_keyword` | `revoke / customer / interactive / verified` | D4 server-derived non-transactional fan-out；原始 opaque message ID作 evidence |
| purpose-bound START parser | `start_keyword` | `grant / customer / interactive / verified` | 只有server可证明approved flow与exact purpose时写单tuple；无限定START不生成grant |
| double opt-in confirmation | `double_optin` | `grant / customer / interactive / verified` | 只有 verified confirmation |
| CRM manual assertion | `crm_manual` | `grant|revoke / merchant / backfill / asserted` | 只记录商家 claim；不能冒充 customer action或覆盖 verified stance |
| import/webhook backfill | `import` | `grant|revoke / merchant / backfill / asserted` | 只记录来源 claim；不能制造 verified customer fact |
| legacy Contact migration | `legacy_contact_snapshot` | `grant|revoke / legacy_unknown / backfill / unresolved` | 保留原 claim；actor/channel/purpose/evidence不猜 |
| verified historical purpose-bound revoke | `historical_verified_revoke` | `revoke / customer / backfill / verified` | server-only、revoke-only baseline；evidence须精确证明同owner/exact tuple的purpose-bound unsubscribe/revoke，且早于该tuple首个live interactive event；无限定STOP不得塞入此source |
| verified historical unqualified STOP | `historical_verified_stop` | `revoke / customer / backfill / verified` | server-only D4 fan-out；evidence须证明同owner/contact/channel的无限定customer STOP并生成稳定operationId，且早于各affected tuple首个live interactive event |
| approved new-purpose STOP expansion | `stop_purpose_expansion` | `revoke / customer / backfill / verified` | server-only、revoke-only；只在新proactive purpose启用前从同owner/contact/channel的verified `stop_keyword`或`historical_verified_stop` operationId确定性导出；无 grant 对偶端点 |

这是当前 writer组合全集。任何未列 `sourceKind × action × actorKind × entryMode × evidenceStatus` 一律拒写；新增组合属于本合同演进，不得由 endpoint 临时放宽。`action/actor/source/mode/status/channel/purpose` 均由 endpoint 推导或 server closed-validator决定，`evidenceRef` 必须证明属于同 owner、同 Contact与对应 tuple；client不能覆盖任何 provenance字段。

#### 4.3.1 【已批准 D4 / 本 PR 物理提案】purpose scope 与 STOP 原子 fan-out

- `marketing`与`review_request`归类为`proactive_non_transactional`；`transactional`只允许既有订单、付款、收据、配送或安全事件所必需的封闭内容；顾客主动服务对话按D5独立归为`reactive_service_reply`。营销、评价邀请、唤回、cross-sell或促销只要混入，就不得标为`transactional`。
- purpose及purpose class由shared action按server-owned closed registry推导，caller、connector、merchant payload与Otto参数都不可覆盖。未来purpose在明确分类与配套tests获批前不能上线；一旦归为`proactive_non_transactional`，自动加入无限定STOP的fan-out集合。启用前还必须按历史`stop_keyword`与`historical_verified_stop` operationId为该purpose写`stop_purpose_expansion`确定性revoke backfill并完成replay，使用`operationId/idempotencyKey = purpose-expand:<originalStopOperationId>:<newPurpose>`，使所有既有无限定STOP继续生效；该 writer 必须使用§4.3.4的同一 fan-out/tuple 锁序。在backfill与unresolved historical scope计数归零前该purpose fail-closed、零send。既有purpose改变class属于新的Founder产品决定，不能当registry编辑偷改。
- purpose-bound unsubscribe link只写token绑定的exact tuple，不fan-out。无限定STOP忽略caller提交的purpose，按本channel registry计算全部active `proactive_non_transactional` purposes；Phase 1恰为`marketing + review_request`。
- STOP writer按§4.3.4取得tenant-qualified fan-out lock与各tuple lock；在**一个DB transaction**内为每个affected purpose各写一条ConsentEvent、更新各projection/cursor。任何lock、insert、projection或cursor步骤失败都rollback全部，禁止half-revoked state。
- 同一STOP共享server-derived `operationId = stop:<channel>:<channelEventRef>:<opaqueMessageId>`；每条event使用`idempotencyKey = stop:<channel>:<channelEventRef>:<opaqueMessageId>:<purpose>`（`UNIQUE(ownerId,idempotencyKey)`）。`channelEventRef`是adapter验证的inbound event namespace，只用于receipt/dedupe，不是customer identity issuer或provider-specific core。message retry须返回同一semantic result且零新增event；各component须是validated opaque ID，不能塞raw message或PII。
- 已验证的历史无限定STOP使用独立`historical_verified_stop`，按同一D4原子fan-out与§4.3.4锁序写入，operationId由validated historical evidence稳定导出；已验证的purpose-bound历史撤回才使用`historical_verified_revoke`。无法证明scope的historical negative进入visible quarantine并阻止M5；未来proactive purpose在相关unresolved scope计数归零前保持零send。
- 每个affected tuple仍各自计算单调`receivedAt`；transaction按稳定purpose顺序锁定与赋值，offline replay按每tuple `(receivedAt,id)`得到同一结果。

#### 4.3.2 【已批准 D4 / 本 PR 物理提案】strict transactional eligibility

`transactional`不是caller可选标签，也不容纳一般客服对话。shared send action必须构造server-owned `TransactionalSendContext = { kind, subjectRef, triggerEventRef, templateVersionId, contextHash }`，并按以下closed matrix验证同owner、同Contact、同channel：

| `kind` | 必需的server-bound事实 | 允许的内容形状 |
|---|---|---|
| `order_confirmation` | 已存在的同tenant订单 + confirmed trigger event | immutable registered transactional template；只允许schema列明的订单变量 |
| `payment_receipt` | 已存在的同tenant付款/收据 + captured/issued event | immutable registered receipt template；只允许金额、币种、reference、时间等closed变量 |
| `delivery_update` | 已存在的同tenant fulfillment/delivery + status event | immutable registered delivery template；只允许状态、时间、tracking等closed变量 |
| `security_notice` | 已存在的同tenant security event | immutable registered security template；只允许事件与安全动作所需closed变量 |

这四类template version须有immutable content hash、`purposeClass=transactional`与closed variable schema；任意free-form body、merchant/Otto/connector自报`transactional`、缺/跨owner/跨Contact subject、generic send、broadcast、scheduled content、营销、评价邀请、唤回、cross-sell或promotion一律不能进入transactional path。classifier、subject validator与template registry是send hard gate：失败时拒绝本次send并给出可见reason，不能静默降级、绕到connector或靠caller改purpose。

每类使用`tx:<kind>:<triggerEventRef>:<contactId>:<channel>:<templateVersion>`稳定send idempotency key；provider retry不得新造logical send。每个send receipt保存`kind + subjectRefHash + triggerEventRefHash + templateVersion/contentHash + contextHash`，用于证明当时为何获transactional eligibility，不保存不必要PII。

#### 4.3.3 【已批准 D5 / 本 PR 物理提案】reactive reply 与 two-confirm manual override

`reactive_service_reply`是独立send class，不进入ConsentEvent的purpose taxonomy，也不能被包装成`transactional`。shared action构造server-owned `ReactiveReplyContext = { conversationId, contactId, channel, anchorInboundMessageId, channelEventRef, providerMessageIdHash, firstReceivedAt, serviceWindowRef, channelPolicyVersion, actorKind, contextHash }`：

- anchor必须由平台connector从真实provider inbound写入，带可验证provider message ID与平台首次接收时间；`UNIQUE(ownerId,channel,channelEventRef,providerMessageId)`保证同一provider event只对应一个immutable anchor。`channelEventRef`只承担adapter event dedupe，不是identity issuer。duplicate/retry/late redelivery必须返回原anchor与原`firstReceivedAt`，不得update时间、重建anchor或刷新window；provider自报时间不替代平台首次接收时间。API/import/人工补录不能铸造或延长reply资格；owner、Contact、channel与conversation必须完全一致；
- send time必须落在server按channel policy计算的active service window；已被parser识别为纯STOP/START/unsubscribe/HELP等control message的inbound本身不创建或刷新普通service window，混合语句规则在对应channel policy获批前保持Unknown；
- 只允许单recipient direct reply，recipient必须等于anchor Contact；人工merchant不加FIKIRTIVE自创的统一消息条数上限，只执行已验证的provider/channel规则；Otto必须走approved action，不能从一条inbound生成无人确认的连续追发链；
- 当Contact/tuple存在`unknown`、STOP、unsubscribe或其它适用consent risk时，Contact、composer、preview与final confirmation只显示一个server-derived `consent_risk` tag；detail使用closed reason set `consent_unknown / customer_stop / purpose_unsubscribe / evidence_unresolved`，多recipient按稳定计数/集合展示。tag不制造grant，也不隐藏该Contact；
- 系统、Otto、connector、rule、import与background job不得自动把该reply加入Campaign、Segment、Broadcast、Schedule、review request、offer/coupon、promotional attachment或automatic follow-up；
- 普通free-form direct reply的语义由merchant负责。平台只保证上述结构事实与audit，不声称能无误判断每句话是否含marketing/cross-sell，也不把“有audit”说成“正文已获平台审查”。

若获授权merchant仍明确手工加入或启动任一proactive element，该action退出`reactive_service_reply`，保留其真实`marketing/review_request`等purpose，并进入D5 `manual consent override`，而不是伪装成transactional或改写consent：

1. shared action先materialize immutable delivery manifest：固定recipient或稳定排序的audience snapshot，并为每个recipient绑定tenant-qualified `contactId + contactIdentityId + channel + destinationRefHash`，并固定sender Channel binding；connector/connection可替换，但只能继续解析到同一canonical Channel identity。manifest同时固定最终provider-bound payload bytes、personalization/merge inputs、tracked links、template/content version与attachment object version/content hash，以及**channel、purpose、schedule**。`deliveryManifestHash`覆盖全部身份与payload字段；确认后禁止adapter、worker或renderer再做会改变语义payload或destination的enrichment，变化只能产生新revision/hash；
2. server重读consent authority，生成覆盖每个recipient规范cursor与risk code的`consentRiskSnapshotHash`；同时生成覆盖operator capability/version、sender/recipient identity assignment、DND cursor、exact provider-refusal scope cursor、frequency-suppression scope/cursor、security/provider-policy version的`executionGateSnapshotHash`。再用versioned、field-ordered、length-delimited canonical encoding计算`actionHash = H(hashVersion, ownerId, actorId, actionId, actionKind, channel, purpose, deliveryManifestHash, consentRiskSnapshotHash, executionGateSnapshotHash, warningContractVersion, schedule, actionRevision)`。任一authority、action、identity、payload、audience、warning contract或consent事实变化都改变hash。`actionRevision`只有一个穷尽的canonical predicate：immutable `DeliveryManifest` 的bytes/fields发生变化，当且仅当由authoritative action source铸造新revision；其字段包括content、audience/recipient、destination、purpose/channel、schedule、personalization、attachment与identity binding。同一action lineage中，只要`DeliveryManifest` byte-identical，任何其它`actionHash` input或contract-authority input漂移——包括consent cursor/state、risk reasons、execution-gate snapshot、`warningContractVersion`及hash-contract/canonicalization version——都保持同一`actionRevision`，同时把既有attempt作废并创建全新immutable `confirmationAttempt`。`actionRevision`不是确认轮数；
3. 每轮确认是一个immutable、server-minted `confirmationAttempt`，由一条新的override attempt承载。first-confirm endpoint显示risk tag/reasons、channel/purpose、recipient count或frozen audience与action summary；一次独立authenticated request只能把该attempt以CAS从`DRAFT`推进到`FIRST_CONFIRMED`，在独立DB transaction提交属于同一attempt的`firstConfirmationId/requestId/confirmedAt/actionHash`后，由server签发该attempt专用的one-time `secondChallengeId`（只持久化nonce hash）。同一request/transaction不得同时生成second confirmation；旧attempt的confirmation/challenge不得被新attempt读取或消费；
4. second-confirm必须是随后另一条authenticated request，由同一owner/operator提交本attempt尚未使用的server challenge；server重新读取action、delivery manifest、consent与全部execution-gate authorities并重算hash，只有first transaction已commit、两个request/confirmation ID不同、challenge属于本attempt且hash未漂移时，才以attempt-scoped CAS从`FIRST_CONFIRMED`推进到`FINAL_CONFIRMED`。challenge一次使用；duplicate request只返回本attempt原semantic result，不能生成新确认、跨attempt复用或submission；
5. submission claim使用§4.3.4唯一canonical gate-lock protocol；锁内重读全部authority并重算两个snapshot与`actionHash`。只有完全相同、所有non-consent hard gate仍通过且runtime suppression仍未生效，才在**同一DB transaction**内以本attempt为CAS scope从`FINAL_CONFIRMED → SUBMITTING`并为每个recipient插入唯一send outbox；然后释放lock，由worker在commit后使用stable provider idempotency key外呼。任一revoke/role loss/identity binding变化/DND/provider block/frequency suppression先提交则hash漂移或gate失败、零outbox；outbox transaction先提交时才算既有in-flight send，后到变化只影响future action并写适用audit。hash或contract authority漂移把当前attempt原子转为terminal `INVALIDATED`、零submission；`INVALIDATED`永远不能转回任何live state。重新确认必须新建一个更高、immutable的`confirmationAttempt`，生成全新的override、first/final confirmation与challenge rows；旧attempt全部保留可审计。immutable `DeliveryManifest`任一byte/field变化时且仅此时，先由authoritative action source铸造新`actionRevision`，再为新revision创建attempt；若`DeliveryManifest` byte-identical但任何其它`actionHash`或contract-authority input漂移，则保持原`actionRevision`并为该revision创建fresh attempt；
6. 两次确认只授权该hash对应的单次send、finite batch、campaign launch或scheduled action。未来recurrence、下一批、重新生成内容或新增recipient必须重新两次确认；不存在account-wide、transferable或standing waiver；
7. Otto/connector/job不能点击、伪造或继承确认。Otto free-form reactive draft必须由merchant逐条看到并批准exact rendered content hash，不能用routine/autopilot直接发送；若手工加入proactive element，再额外进入本two-confirm state machine。job只可在两次人工确认后幂等执行该exact proactive action；execution retry复用同一action/override/provider idempotency key，不能扩展scope；
8. ActionReceipt evidence至少要能证明`override attempt/confirmationAttempt + actionId/actionRevision/actionHash + deliveryManifestHash + owner/actor + warning version + 两个snapshot + 两次confirmation/challenge + submission/provider result`属于同一attempt。正文与manifest保存在原action authority；override/receipt只存必要hash/ref，不能复制不必要PII；ActionReceipt的最终物理carrier仍受下方blocking Unknown约束；
9. 成功override不写ConsentEvent、不改`effective_revoke`、不生成verified grant，也不授权future auto-send。provider结果不明确时进入`may_have_applied/reconciliation`，禁止盲重试造第二个logical send；receipt必须分别报告`submitted / provider_refused / failed / delivery_unknown / delivered`等真实结果，不能把第二次确认说成保证送达；
10. tenant isolation、operator permission、identity正确性、security gate、merchant DND、provider hard refusal与active frequency suppression仍是独立不可绕过边界；外部法律或provider规则若真实禁止submission，两次确认也不能使其变成可提交。

以下是D5 carrier的**最低逻辑约束**，不是已批准物理schema，也不是ConsentEvent：

- 每个`ManualSendOverride` row只代表一个immutable `confirmationAttempt`，逻辑上绑定`ownerId + actionId + actionRevision + confirmationAttempt + actorId + actionHash`；closed status为`DRAFT / FIRST_CONFIRMED / FINAL_CONFIRMED / SUBMITTING / SUBMITTED / INVALIDATED / PAUSED_RECONCILIATION / MAY_HAVE_APPLIED / FAILED`。attempt discriminator在同一`ownerId + actionId + actionRevision`内唯一且不可改；任一时刻至多一个nonterminal/live attempt。所有transition只由shared action以`overrideId + confirmationAttempt + expected old state`做CAS；`INVALIDATED`是不可逆terminal。**不得存在**跨attempt的`UNIQUE(ownerId,actionHash,actorId)`或等价约束；它会阻止authority后来回到旧hash时创建fresh attempt。attempt约束只能是attempt-scoped；同一hash未来也只能通过新attempt重新确认，绝不复活旧row；
- append-only `ManualSendConfirmation`必须tenant-qualified引用exact override attempt；`UNIQUE(ownerId,overrideId,step)`、`UNIQUE(ownerId,requestId)`，first/final IDs必须不同，challenge只属于该attempt；无ordinary UPDATE/DELETE。新attempt必须生成新confirmation/request/challenge rows，不能update、copy或re-parent旧rows；
- `ManualSendOutbox(id, ownerId, overrideId, actionRevision, recipientId, contactIdentityId, destinationRefHash, channel, payloadHash, providerIdempotencyKey, status, createdAt)`；所有identity refs须tenant-qualified；`UNIQUE(ownerId,overrideId,actionRevision,recipientId)`与`UNIQUE(ownerId,providerIdempotencyKey)`；它只引用frozen manifest payload/identity binding，不能现场重算、换identity、换附件或因adapter切换漂到另一canonical Channel identity；
- confirmation表是两次human action的durable authority，Override/ActionReceipt只是state与projection；删cache、重跑worker或rollback都不能重造confirmation、重置challenge或消费同一override第二次。

**【Unknown / blocks implementation】** 本稿不为下列缺口臆造table/column/index/FK；它们必须在另一次Founder schema review中冻结物理carrier、tenant relation、immutability/idempotency、privacy与rollback后才可施工：

1. `DeliveryManifest` 的authoritative row/object carrier、version/immutability边界、canonical bytes/hash来源，以及payload/attachment/destination如何最小化、加密与retention；
2. provider-ingested reactive anchor的authoritative carrier、provider-event dedupe key、`firstReceivedAt`铸造者、conversation/Contact/Channel identity关系与control-message window规则落点；
3. `ActionReceipt` 的authoritative carrier、append/projection边界、provider result/reconciliation关系、export/erasure与terminal retention；
4. `actionId`与`actionRevision`各自唯一authoritative mint/source：谁创建、何时递增、如何tenant-qualified引用、重放/rollback如何保持同一值。这里只冻结`actionRevision`严格遵循上述穷尽predicate：immutable `DeliveryManifest` bytes/fields变化iff新revision；Manifest byte-identical时，任何其它hash/contract-authority input漂移都保留revision并新建attempt。它不是confirmation round；本稿不替实现者选择物理来源。

上述任一项未冻结时，所有依赖它的`reactive_service_reply`、D5 first/final confirmation、submission/outbox/worker与receipt path保持disabled/fail-closed；不得用临时JSON、cache、connector row、request ID或`actionRevision`代替authoritative carrier。

#### 4.3.4 【已批准 D4/D5 结果 / 本 PR 物理提案】唯一 canonical lock order

STOP、`historical_verified_stop`、`stop_purpose_expansion`与D5 submission不得各自发明锁序。所有writer共用以下**总顺序**，只跳过本动作不需要的class，绝不能取得较后class后再回头取得较前class：

1. owner/operator capability（row lock或同transaction version CAS）；
2. sender Channel binding；
3. Contact / ContactIdentity assignment；
4. consent fan-out scope：tenant-qualified `(ownerId, contactId, channel)`；
5. consent tuple：tenant-qualified `(ownerId, contactId, channel, purpose)`；
6. Contact DND；
7. provider-refusal exact scope；
8. frequency-suppression exact scope；
9. override attempt / outbox。

每个class内部先完整计算所有tenant-qualified key，再按同一canonical byte/lexicographic key稳定排序取得；multi-recipient D5不得逐recipient穿插class。D5即使只发送一个purpose，也必须先取得该Contact/channel的第4类fan-out lock，再取第5类tuple lock，才能与并发无限定STOP串行化。live/historical STOP取得第4类后按purpose稳定排序取得全部第5类；purpose expansion对每个original STOP work unit同样先取得第4类再取新增purpose tuple。policy/version不能row-lock时，在其所属class位置使用同transaction CAS，不能移到transaction外。

任一key无法可靠导出、lock/CAS失败、authority漂移、event/projection/cursor/outbox insert失败，都使**整个该operation transaction** rollback并零partial event/零partial outbox；retry只能复用原semantic idempotency。锁争用只能bounded retry或visible fail-closed，不能通过换序、少锁或先写后补来“成功”。

### 4.4 【本 PR 提案】deterministic fold

每个 permission tuple按 `(receivedAt, id)` 全序 replay。允许的 transition 穷尽如下：

| Incoming event class | 任何旧状态后的新状态 |
|---|---|
| `verified + customer + interactive + revoke` | `effective_revoke` |
| `verified + customer + interactive + grant` | `verified_grant`（也是唯一可解除 customer revoke 的 re-opt-in） |
| `verified + customer + backfill + historical_verified_revoke` | 只有尚无任何 verified interactive event时把 `unknown` 变成 `effective_revoke`；已有interactive stance则只留历史、不覆盖较新的live stance |
| `verified + customer + backfill + historical_verified_stop` | 按D4 fan-out；每个affected tuple无verified interactive stance时变成`effective_revoke`，已有较新live stance则只留历史 |
| `verified + customer + backfill + stop_purpose_expansion` | 新purpose上线前从原verified STOP导出 `effective_revoke`；只写此前不存在、尚无interactive stance的new purpose |
| `asserted + merchant + backfill + grant|revoke` | effective state不变；只在 history显示 merchant assertion |
| `unresolved + legacy_unknown + backfill + grant|revoke` | effective state不变；只进 quarantine/evidence |
| 未列组合 | 写入时拒绝，不进入 replay |

没有可改变状态的 verified event时为 `unknown`。因此每个affected tuple内的STOP→purpose-bound START、unsubscribe→re-subscribe按接收顺序可重放；manual/import/legacy永不覆盖 customer stance。`historical_verified_revoke` 不是补写 opt-in 的后门：它只能在无较新interactive stance时建立 revoke baseline；evidence无法证明其早于首个live interactive event时进入visible quarantine并阻止M5，不能借 `occurredAt` 猜顺序。`legacy_unresolved` 不是 permission state，也不能成为隐藏 global block。DND、provider refusal、frequency suppression不进入 fold。

`receivedAt` 冻结为 `Timestamptz(6)`，tick = 1μs。普通event transaction恰处理一个tuple；唯一例外是§4.3.1获批的STOP fan-out，它在同一transaction按稳定顺序处理闭合集合。每个tuple都取tenant-qualified lock，读取自身前一最大值，再赋 `max(clock_timestamp() at storage precision, previous + 1 tick)`；insert、projection fold与cursor更新同 transaction。offline replay必须与online result等价；`occurredAt`不决定胜负。

建议 `ConsentStateProjection` 作为可重建读模型，而非第二真源：

| 字段 | 语义 |
|---|---|
| `ownerId/contactId/channel/purpose` | 唯一 permission tuple |
| `state` | `unknown / verified_grant / effective_revoke` |
| `lastEventId/lastReceivedAt` | fold已消费到的规范cursor |
| `stateActorKind/stateSourceKind/evidenceStatus` | UI显示当前状态的来源/理由 |
| `updatedAt` | cache维护时间，不参与authority |

projection无独立mutation API；每次event同transaction维护，清空后全量replay必须得到同一semantic state。

### 4.5 【本 PR 提案】发送资格的分轴

```text
selectedByMerchant = contact ∈ approved audience snapshot

consentRisk =
  consentState != verified_grant

nonConsentHardBlock =
  merchantDnd OR providerHardRefusal

runtimeSuppressed = frequencySuppression

candidateForUnconfirmedAutomaticProactiveSend =
  selectedByMerchant
  AND NOT consentRisk
  AND NOT nonConsentHardBlock
  AND NOT runtimeSuppressed

candidateForMerchantManualProactiveSend =
  selectedByMerchant
  AND NOT nonConsentHardBlock
  AND NOT runtimeSuppressed
  AND (NOT consentRisk OR exactD5TwoConfirmOverride)
```

`strict transactional`与`reactive_service_reply`分别按§4.3.2/§4.3.3判断，不借这两个proactive公式绕路。这也不替代精确send approval、账号/模板规则、余额、provider capability或其它既有gates。

这里的`unconfirmed automatic`指没有human-bound D5 receipt的后台决策；已对exact hash完成两次确认的finite batch/scheduled action由job执行时，必须携带并重新验证该override，按`candidateForMerchantManualProactiveSend`的同一结果执行，不能因执行actor变成job而丢失或扩大authority。

- `unknown`：保留在商家名单；显示risk tag/filter option；不因平台缺evidence而移除。主动manual action按D5两次确认后可提交，不能被后台静默自动发送。
- `verified_grant`：不自动加入 Campaign，也不绕过 DND/provider/frequency/approval。
- `effective_revoke`：对Otto、connector、import、rule与无人确认background action仍是hard stop；merchant只有按D5对exact frozen action完成两次确认后才可提交，且state仍为`effective_revoke`。只有后续verified customer re-opt-in能改变state。
- D4 STOP成功后，当前Phase-1的`marketing`与`review_request`tuple都为`effective_revoke`；严格`transactional`tuple不因STOP改变，`reactive_service_reply`按独立上下文判定。二者都不能被caller用来伪装营销；主动营销若由merchant坚持发送，只能显式走D5 override并保留真实purpose。
- DND：Contact 独立轴；清除 DND 不制造 grant。
- DND当前物理 scope明确为 **Contact-wide、覆盖全部 customer channels/purposes**；未来 channel-scoped DND是新产品/schema决定。
- provider refusal的normalized taxonomy至少分：`permanent_recipient`（hard block affected connection/channel/recipient，直到verified clear）、`transient`（429/5xx/timeout，只重试/backoff，不写长期Contact block）、`account_level`（暂停该connection/account，不污染其它provider/channel）。provider更换不改consent history，也不得把旧connection refusal静默提升为新connector的全局事实。
- frequency suppression是临时 runtime state；到期只解除suppression，permission/DND/provider facts不变。
- 每次 send receipt保存 `consentStateAt = {receivedAt, id}`。revoke到库后若发现更早cursor的已发送/在途记录，写 `consent.late_revoke` audit；不虚构在途窗口为零。

#### 4.5.1 DND 与 provider refusal 的物理 authority

generic `ActionEvent.payload` 只可镜像 UI/admin audit，不能充当这两条发送安全轴的唯一真源。

建议 append-only `ContactDndEvent`：`id, ownerId, contactId, action(set|clear), actorKind(merchant|otto|legacy_migration), actorId?, sourceKind(crm_ui|otto_approved_action|legacy_contact_snapshot), evidenceRef?, idempotencyKey, receivedAt, createdAt`。closed matrix固定为：`crm_ui × merchant × set|clear`；`otto_approved_action × otto × set|clear`；`legacy_contact_snapshot × legacy_migration × set`。未列组合拒写。要求 `UNIQUE(ownerId,idempotencyKey)`、tenant-qualified Contact relation、按 `(ownerId,contactId,receivedAt,id)` replay、无 ordinary UPDATE/DELETE；shared action在同一 transaction写 event并维护 `Contact.doNotDisturb` compatibility projection。legacy `true` 生成一条确定性 migration `set`；legacy `false` 等于无 active set。clear 只改变DND fold，不制造 consent grant。Otto 只能经既有可见审批/动作层调用同一 shared action。

建议 append-only `ProviderRefusalEvent`：`id, ownerId, scopeKey, providerConnectionId, channel?, contactIdentityId?, kind(permanent_recipient|transient|account_level), action(block|observe|clear|expire), actorKind(provider|system), actorId?, providerCode, receiptRef, reversesEventId?, idempotencyKey, receivedAt, expiresAt?, createdAt`。`scopeKey`是server-derived non-null key（account=`account:<connectionId>`；recipient=`recipient:<connectionId>:<channel>:<identityId>`），避免nullable-column unique漏网。closed validator要求：

- `permanent_recipient` 必须完整指向同 tenant 的 connection + channel + ContactIdentity；只允许`block|clear`，**禁止expire**；clear须有同scope verified provider/recipient evidence并引用active block；
- `account_level` 必须只有同 tenant connection scope，不能污染其它 connection/channel/Contact；允许`block|clear`，只有原block带provider/account policy可验证的finite `expiresAt`时才允许system `expire`；
- `transient` 只能 `observe`，零长期 block projection；
- `clear`与获准的account-level `expire`必须引用同scope active block与可验证 receipt/evidence，并以 `UNIQUE(ownerId,idempotencyKey)` exactly-once；`scopeKey`必须由字段重算验证，caller不可传或覆盖；
- account-level `expiresAt`只作受控system任务的调度证据，reader不得因wall clock越过它而隐式解除block。到期时system必须在同scope lock内append `expire` event，引用active block与原verified expiry evidence，并使用`refusal-expire:<blockEventId>:<expiresAt>`稳定idempotency key；event未成功落账前block继续生效；
- 可重建 `ProviderRefusalState` 以 `UNIQUE(ownerId,scopeKey)`只保存 exact scope、`blocked`、`lastEventId/lastReceivedAt`，无独立 mutation API；send reader按本次实际 connection/identity读取；raw payload/PII不进该表。

两类 event 都使用 tenant-qualified scoped lock与 `(receivedAt,id)` deterministic fold。删除generic audit、清 projection或更换provider adapter均不能改变 authority；projection可由event全量replay恢复。

### 4.6 【本 PR 提案】Contact compatibility projection

现有 `Contact.marketingConsent/consentSource/consentAt` 在迁移期可保留，但不再留下 implementation自行选语义：

1. compatibility projection **只映射 `whatsapp × marketing`**；其它 channel/purpose不得读写这三个字段。
2. 第一条 live `whatsapp × marketing` event起，event insert与compatibility projection同transaction更新；send consent-state reader同时直接/可靠读取event authority并产生D5 risk disposition，不能只等M5。
3. 字段级映射固定为：`unknown → (marketingConsent="unknown", consentSource=null, consentAt=null)`；`verified_grant → ("opt_in", "consent_event:<stateSourceKind>", stateEvent.receivedAt)`；`effective_revoke → ("opt_out", "consent_event:<stateSourceKind>", stateEvent.receivedAt)`。时间一律取决定current state的规范 `receivedAt`，不取可伪造/迟到的 `occurredAt`。
4. asserted/unresolved或已被较新interactive stance盖过的historical baseline是state-neutral：不得改变三个compatibility bytes。只有在证明无effective event且零unresolved legacy opt-out后，受控reconcile才可把legacy bytes定案为`unknown/null/null`。
5. `legacy_unresolved` 只在quarantine/report存在，不写成 projection state。production中任何不能安全表示的known historical revoke（含无tuple legacy `opt_out`）若非零，M5前必须逐项解决，或另获Founder批准一条显式、可见、临时 legacy-block规则；不能隐藏global block，也不能静默丢失。
6. cutover后禁止independent direct write；M5后所有business readers停止读取三个旧字段，只读per-tuple projection/event。
7. 所有 readers/exports/Otto/report切换后，旧字段才可进入另一次 destructive-removal approval。
8. `doNotDisturb`不属于待淘汰consent projection；它在DND event启用后只作compatibility projection，不再是可旁路直写的独立authority。

### 4.7 【本 PR 提案】privacy boundary

- `evidenceRef`只保存opaque ID/哈希引用，不默认复制raw message、email、phone、token正文或provider payload；source system另按其retention控制。
- D5的source action、immutable delivery manifest、reactive anchor、`ManualSendOverride/Confirmation/Outbox`、ActionReceipt与provider receipt refs全部进入同一privacy authority；不能因它们“不属于ConsentEvent”而绕开retention、access/export、erasure、backup或support-tool限制。
- personalized manifest/provider-bound payload、destination与identity assignment属于敏感customer data：只在受控action/outbox authority保存执行所需的最小加密版本；Override/Confirmation/receipt默认只存versioned hash/ref与必要审计字段，日志、telemetry和support UI不得复制raw payload或destination。terminal后是否保留、缩减为hash或de-identify必须由逐carrier retention matrix决定。
- schema implementation前必须冻结逐 `sourceKind` 的最小字段、retention、access/export权限与删除/去标识动作；未冻结则保持硬停。
- D5 implementation前还必须逐carrier冻结：authorized reader/writer、encryption/key scope、payload与destination retention、confirmation/override audit retention、export/DSAR形状、erasure/pseudonymization、terminal compaction、provider receipt最小化、backup/replica expiry与support access；任一Unknown都阻断全部D5 carrier与send path，不能只停ConsentEvent。
- Contact erasure不能靠普通event UPDATE/DELETE假装完成。受控privacy operation须把subject/evidence引用pseudonymize或re-point到non-identifying tombstone，同时保留依法可保留的action/time/tenant audit；具体legal retention仍需Founder/legal输入。
- backup、replica、export、receipt与support tooling必须进入同一erasure/retention矩阵；不得只清primary row。
- privacy rewrite必须独立授权、审计、幂等、可验证，且不能改变permission fold含义或跨tenant。

**【Unknown / blocks implementation】** 各source与D5 carrier的具体retention期限、可保留audit facts、payload/destination terminal处理、pseudonymous subject载体、support/export权限与backup expiry。它们可在本spec PR review中冻结，或由native dependent B13/privacy ticket先闭合；在此之前不得批准ConsentEvent或任何D5 carrier/send-path implementation。

## 5. UTM authority

### 5.1 【已批准】产品不变量

1. Campaign 在 Phase 1 只负责意图与归组，不保存可编辑 UTM string/JSON。
2. 只有需要量测的 outbound link 才在生成时定案严格五键 `{source, medium, campaign, content, term}`。
3. `TrackedLink.utmJson` 是该链接实际发出值的 authority；值改变时新建链接，不改旧链接的历史意义。
4. `AttributionEvent.utmSnapshot` 及其它获准来源记录保存 event-time snapshot；报表不回读当前 Campaign。
5. UTM 使用 FIKIRTIVE provider-neutral channel taxonomy；provider/BSP/adapter identity 不得进入。
6. `Campaign.utmBase` 实施后 stop-write；现有列/legacy rows 原样保留，另经 inventory/approval 才可迁移或删除。
7. merchant 不编辑 query string、JSON 或内部 taxonomy。

### 5.2 【本 PR 提案】严格五键对象

```ts
type EffectiveUtm = {
  source: string;
  medium: string;
  campaign: string;
  content: string | null;
  term: string | null;
};
```

- JSON 恰好五键；缺键、额外键和第六个 `v` 均拒绝。
- `source/medium/campaign` 非空并经过确定性规范化；`content/term` 键存在，无值为 `null`。
- URL 只序列化非 `null` 值为标准 `utm_*` 参数；payload 外的 validator/taxonomy version 可存在于代码 metadata，但不进五键对象。
- **建议** `campaign = immutable Campaign.id`；UI/report 用 `campaignId` 显示可变 name。若 Founder 要人类可读 slug，必须另批不可变 tracking key 与 migration，不从可变 name 临时生成。
- **建议** Phase 1 `term = null`；`content` 只用 path-specific stable post/creative identifier，不用自由文本。
- measurable `targetUrl`已含任一保留`utm_*`参数时，只能二选一：writer fail-closed，或server用本link immutable `utmJson` canonical values原子替换；原query不得被原样保留成第二authority。最终策略待Founder批准。

**【Unknown】** exact `source/medium` mapping、stable `content` source、non-Campaign link 的 grouping key、merchant/Otto override、哪些 ScheduledPost/Broadcast/CRM/QR paths 必须量测。Phase-1真实量测path所需的这些选择属于blocking Unknown；未冻结时本PR保持Draft，未列path保持“不量测/不宣称归因”。

### 5.3 【本 PR 提案】TrackedLink 与 snapshot

- `TrackedLink.utmJson = null`：本提案定义为不是本合同的可量测UTM link；此null语义须列入Founder批准，不可由实现者默认。
- 非 null：只能由一个 server-side materializer 生成；创建后 write-once。改变任一 key → 新 link；旧 link可保留或 revoke。
- `campaignId` 非空时，materializer验证 Campaign 与 link 同 owner。
- redirect只读 `TrackedLink.utmJson`；不得读 `Campaign.utmBase/name/provider config` 重新解释。
- link/QR 产生的 scan、click 或 source association，在 event write transaction 复制完整五键到 `AttributionEvent.utmSnapshot` / `SourceTag.utmSnapshot`。
- 没有 link authority 的 event 不猜 UTM，可为 `null`。
- snapshot append-only；Campaign rename、link revoke、taxonomy升级都不重写历史。

### 5.4 【本 PR 提案】utmBase compatibility

1. 不修改已合并 `20260714100000_b8_phase1_campaign_crm` migration 或 checksum。
2. cutover 前只读 inventory `Campaign.utmBase`、`TrackedLink.utmJson`、`AttributionEvent.utmSnapshot`、`SourceTag.utmSnapshot` 的非空数、key/type/异常形状。
3. legacy `utmBase` 原样保留；不被新 writer/report消费；不静默 parse/backfill。
4. `{platform}`、重复参数、未知参数、错误编码只进诊断报告；任何转换另获批准且逐行可追溯。
5. 既有 link、snapshot 与已发布内容不批量重写。
6. 删除 `utmBase` 是独立 destructive cleanup，不属于本 spec 或首个 alignment migration。

## 6. 共用 tenant、动作层与审计不变量

**现在就成立的宪法/产品不变量**；DB具体composite-FK形状仍由#317决定：

1. 任何identity/consent/Campaign/link/event/source-tag关联只能连接同owner对象。
2. `ownerId`只来自authenticated session；不信client owner/org。
3. unique-key、nested write、raw SQL、replay、import与merge不能依赖现有tenant guard的blind spots；每条路径显式owner-bound。
4. 每个writer/read/replay/import/merge有two-org negative tests；跨owner零字节、零行变化、零orphan audit。
5. UI与Otto调用同一shared action；不建connector-specific schema、UI或Otto workflow分叉。
6. provider replacement不改变consent history或UTM taxonomy，不重复外写。

**Phase 1 Channel identity 不变量**：

1. `ContactIdentity.ownerId == Contact.ownerId`，且每个active语义exact key（owner + channel + logical Channel scope + external contact ID）只指向一个Contact；logical scope的physical carrier/key/index仍Unknown，当前三段index不构成充分或最终合同。
2. connector adapter只可把provider payload解析为canonical channel + verified stable logical Channel scope + external contact ID；它不得把provider/BSP/token/connection row变成core identity authority。
3. provider replacement/reconnect只要仍解析到同一verified stable logical Channel scope的canonical identity，即复用同一Contact；明确可审计 provider/FIKIRTIVE continuity proof 只可attach到唯一既有root并写audit/idempotency、不改变consent。跨渠道或重复phone/email/profile/order/name/address/avatar一律只suggestion；conflict、recycle/reassignment signal、多root或merchant split不得auto-attach，等待merchant merge/unmerge。
4. `ConsentEvent.ownerId == Contact.ownerId`；Campaign/link/event/source-tag同样owner一致。

#339 不借本稿裁定全 repo composite FK 房规；#317 也不能成为暂时允许跨租户裸写的理由。

## 7. Legacy / migration / cutover

所有执行都需要另行 Founder schema/migration/production 授权。本稿只冻结建议顺序。

### M0 — Reconcile before mutation

- pin exact deployed web/worker source SHA 与 image digest；
- SELECT-only 核 production migration ledger、shared checksums、rollback chronology、physical catalog/index/constraint、row counts/value distributions；
- inventory 全部 identity/consent/utm readers、writers、raw SQL、imports、workers、redirect/report paths；
- 产出无 PII dry-run mapping/collision report；
- 建立并 restore-test 可识别 backup/PITR point；
- 在 production snapshot clone rehearsal。

### M1 — Expand before behavior change

- 新 migration，不改旧 migration；
- Phase 1 identity不新增issuer/version/reassignment lifecycle表或index；semantic exact key所需stable logical Channel scope与四事实key的physical carrier仍是blocking Unknown，当前三段live partial index不得声称充分/最终，也不得在未获Founder schema批准前替换、补造或旁路。ConsentEvent、ContactDndEvent、ProviderRefusalEvent与候选 projections additive；不新增 Campaign UTM store。D5所需provider-ingested reactive anchor、DeliveryManifest、ManualSendOverride/Confirmation/Outbox与ActionReceipt只有在§4.3.3列明的physical carrier及`actionId/actionRevision` authoritative mint/source另获Founder schema批准后才可additive落地；本稿不得用占位JSON/nullable columns臆造缺失authority；
- 获批后的D5 expand须先具备tenant-qualified relations、provider-message unique、attempt-scoped confirmation/challenge/CAS、at-most-one-live-attempt约束、outbox/provider-idempotency unique、immutable manifest/payload hash与privacy-approved encryption/access/retention constraints；先通过empty DB、production-like clone、duplicate/replay、attempt re-arm、cache-loss/restart与rollback migration tests，所有D5 reader/writer/worker仍保持disabled；
- 现有三段live partial identity index在新physical contract获批、验证及原子切换前只能按既有兼容事实保留；它不得被写作D6/D7 exact identity的final implementation。任何承载logical scope、continuity proof、semantic key或改变canonical Channel identity的schema/index仍须独立批准。Contact consent fields与`utmBase`仍保留；
- 加 tenant coverage、index/constraint 与 isolated migration/rollback tests；
- reader/writer 行为尚不切换。

### M2 — Single writer seams

- identity、consent、DND、provider refusal、UTM 各建立唯一 shared action/materializer；UI/Otto/connectors 共用；
- static/runtime tests阻止 direct legacy writes；
- 新identity只经shared resolver在获批的physical carrier上写active semantic exact Channel identity；同一verified stable logical scope exact reuse。明确可审计 provider/FIKIRTIVE continuity proof 仅可attach到唯一既有root，须具audit/idempotency且不改consent；其evidence carrier未获批前fail-closed。phone/email/profile/order/name/address/avatar只生成suggestion，任何merchant merge/unmerge走§3.4最小lineage；
- consent先dark-launch/shadow。任何live consent endpoint启用时，必须在同一exact release同时具备：event insert + `whatsapp × marketing` compatibility projection同transaction，以及send consent-state reader从第一条live event起可见并能区分automatic hard stop、visible risk tag与exact D5 override；禁止“只写event、旧send reader看不到”的窗口；
- STOP endpoint启用前还必须证明§4.3.1的`marketing + review_request`同transaction fan-out、共享operationId、per-purpose idempotency与两tuple consent-state readers全都在同一exact release生效；自动/无人确认send为零，merchant manual action只能进入D5 two-confirm path；
- D4 transactional exemption启用前，§4.3.2 closed context matrix、same-owner subject validators、immutable template registry与receipt context hash必须覆盖全部transactional path；任何旧generic/free-form/connector path不得自报transactional；
- D5启用前，§4.3.3的四项blocking physical carrier/mint-source合同必须先获批；随后provider-ingested idempotent reactive anchor、risk tag、no-auto-attachment、two-request/attempt-scoped confirmation与re-arm state machine、tenant/identity-binding immutable manifest、§4.3.4 canonical lock/version CAS + outbox claim、single-use/finite action idempotency、consent不变与receipt evidence必须在同一exact release覆盖UI、Otto、connector、job与retry。缺任一项时整个affected path保持disabled/fail-closed，不得退回absolute silent send、临时carrier或把一次确认当standing waiver；
- 任何live DND/provider refusal endpoint同样要求typed event + compatibility/state projection + send hard-negative reader在同一exact release可见；禁止产生reader看不见的新block；
- 新可量测link只写五键；
- production可shadow其它reads，但known STOP/revoke一旦live写入就不能shadow-only。

### M3 — Honest backfill

| 轴 | 可安全处理 | 必须 quarantine / 不得猜 |
|---|---|---|
| Identity | 只有可验证为同一stable logical Channel scope的active semantic exact identity可stable idempotent处理 | scope或continuity proof carrier缺失、跨owner异常、重复/不确定identity、conflict、recycle/reassignment signal、多root或merchant split一律不auto-attach/merge；只出merchant suggestion或quarantine |
| Consent | `unknown`不生成event；verified purpose-bound historical revoke写`historical_verified_revoke`；verified unqualified historical STOP按D4写`historical_verified_stop`原子fan-out | 模糊opt-in不升级verified；无法证明purpose-bound vs unqualified STOP scope、tuple或顺序的known negative进visible quarantine，M5前必须归零或另获显式temporary-block批准 |
| DND / provider refusal | legacy DND `true`写确定性set event；可验证provider block/clear按exact scope迁移 | DND actor/scope不明、provider scope/receipt不明不得猜；只进visible quarantine |
| UTM | 只读 report；已结构化且合法的 link/snapshot原样保留 | `utmBase` placeholder/duplicate/malformed不自动 parse；不重写已发 link/event |

Backfill重跑必须 byte/semantic idempotent；原始值、batch/hash 与结果可追溯，idempotency key 不塞 raw PII。

### M4 — Shadow read and compare

- new projection与legacy behavior同时计算，但只标一个authority；live STOP/revoke的consent-state reader已按M2双读/直读event，不能等M5；
- identity比较verified stable scope下的roots/collisions、continuity-proof attach audit/idempotency与零auto-attach；consent比较 tuple state，特别验证unknown不被移出名单、known revoke不被自动放行、D5 manual override只放行exact frozen action，并分别比较transactional closed context与reactive anchor/window证据；UTM比较 link/event snapshots；
- 所有差异分类、可解释；零 unexplained drift 才请求 cutover。

### M5 — Authority cutover

- identity writer/read使用获批carrier承载的active semantic exact Channel key；首次互动创建Contact，同一verified stable logical scope exact reuse；明确可审计 provider/FIKIRTIVE continuity proof只可attach到唯一root并有audit/idempotency、consent不变；普通资料只suggestion，merchant merge/unmerge只走最小lineage；不得恢复issuer-aware、recycle/revive、reassignment或自动person inference路径；
- ConsentEvent成为唯一permission-fact truth；writer、consent-state reader、projection与receipt cursor按一个controlled cutover切换；Contact三字段退出business reads，只作待删legacy；所有不能安全表示/排序的known historical revoke必须为零或已有单独Founder规则；
- transactional eligibility只由§4.3.2 shared classifier与validated context决定；generic/caller-labelled path为零，receipt context证据可重放；
- reactive eligibility与manual consent override只由§4.3.3 shared actions决定；override receipt可重放且不能改变permission fold，legacy一次确认/connector bypass/standing waiver路径为零；
- ContactDndEvent与ProviderRefusalEvent分别成为DND/refusal authority；`doNotDisturb`只作compatibility projection，generic ActionEvent只作镜像；
- `utmBase` stop-write/stop-read，TrackedLink定案、events抄表；
- receipts保存必要 identity/consent/transactional/reactive/manual-override/UTM cursor与evidence，使“当时知道什么、为何可发、由谁确认、提交了什么、provider实际返回什么”可重放；
- 不在 cutover 同时 drop旧列/index/table。

### M6 — Contract / destructive cleanup

- 所有 readers、exports、Otto、reports、workers 与 tests 已脱离 legacy authority；
- production verification、backup restore、rollback/forward-fix rehearsal 与 independent review全通过；
- 另取 Founder destructive approval 后才 drop旧 identity index、Contact consent fields或 `utmBase`；
- DND 与历史 events/links/snapshots不随 legacy字段删除。

## 8. Rollback 与 forward-fix

1. M1–M4：只可关闭尚未live的new path并保留additive data。若已经接收任何live consent event，rollback仍必须保持event consent-state reader与compatibility projection，不能退回“看不见STOP”的旧reader；D4上线后还必须保留transactional closed classifier/subject/template gate，不能回到caller-labelled exemption；D5上线后必须keep-forward DeliveryManifest/Override/Confirmation/Outbox/receipt schema、risk tag、no-auto-attachment、two-confirm exact-action与no-consent-mutation语义。rollback可停止创建新override，但不得删carrier、清cache当authority、回到silent send/absolute merchant hard block/一次确认standing waiver。`DRAFT/FIRST_CONFIRMED/FINAL_CONFIRMED`与future scheduled rows由兼容worker继续在原gate下执行，若无法安全执行则原子转`PAUSED_RECONCILIATION`并向merchant显示；`SUBMITTING/MAY_HAVE_APPLIED`及已建outbox必须继续drain/reconcile到terminal，禁止盲重投或遗失。任一gate不可证明时只暂停affected new path；若已经接收任何live DND/provider typed block，rollback同样必须保持对应typed hard-negative reader与compatibility/state projection，不能让已落账block消失。
2. M5后identity：若resolver异常，停止相关identity mutation；从获批的semantic exact identity、continuity-proof attach audit/idempotency与merge/move audit重建projection，不允许回到provider-specific key、三段key假设或猜merge。不得以soft-delete、号码回收、recycle/reassignment signal或connector变更推断同一人；只能forward-fix或暂停affected identity path。
3. M5后consent：projection drift时暂停受影响mutation并replay events；若不能证明known revoke是否存在，暂停该affected tuple的send；不得把全体unknown错误hard block。rollback不得关闭已live的STOP/revoke或historical revoke baseline读路径。
4. M5后DND/provider：projection drift时只暂停affected Contact或exact connection/recipient scope并replay typed events；不得回退到可旁路直写的bool/generic JSON，也不得把旧connection block带到新provider。
5. M5 后 UTM：materializer异常时暂停新可量测 link生成，继续安全服务既有 link；不得恢复 `utmBase` 双写。
6. writer rollback不能让 legacy字段重新成为独立 authority。M6 destructive action只能走另一次批准；此前 rollback不需要 drop。
7. 每次 rollback验证 event/link/identity/manifest/override/confirmation/outbox counts、每个nonterminal/terminal status、provider idempotency、tenant boundary、known blocks、merchant audience与history snapshots均无漂移；重启与cache全失后仍得同一结果，并留下 forward-fix ticket与receipt。

## 9. Production hard gate

[#336 Gate 10 evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336#issuecomment-4992312427) 只证明：production ledger 有 64 个 completed unique migration names，current main 有 72 个，缺 8 个（含 B8）；zero active failed rows；两个 historical rolled-back rows共用旧 migration name。

以下仍是 **【Unknown】**：exact running web/worker Git SHA 与 image bytes、physical schema parity、64 个 shared checksum、out-of-band DDL、row data、lock/table size、B8 table/index 是否真实存在。

`apps/web/Dockerfile:38-41` 会在 web boot 前执行 `prisma migrate deploy`。因此 current-main deploy/restart 可能顺带执行所有 pending migrations；不得用 web boot 当 R-010 migrator。

任何 schema/data/production action 前必须：

1. pin artifact/image/source；
2. refresh SELECT-only ledger/checksum/timestamp/steps/rollback facts；
3. diff `pg_catalog` 与 exact 64-migration baseline；
4. inventory rows、collisions、legacy values、lock/table risk；
5. backup + restore rehearsal；
6. snapshot clone 跑 8 个 pending migrations + alignment migration + rollback/forward-fix；
7. controlled one-shot/expand-first migrator；
8. separate Founder schema、production、deployment授权；
9. post-migrate 核 ledger/checksum/catalog/artifact/application health。

## 10. 最低验收矩阵

### Identity

R-010验 D7 Phase 1 exact Channel identity 与merchant-controlled merge/unmerge的最低合同；schema/implementation仍须另获批准。merge lineage未冻结前，其写路径保持fail-closed，不能拿本矩阵反推功能已开启。

| ID | 场景 | 必须结果 |
|---|---|---|
| ID-01 | 100并发相同 active semantic owner + channel + logical Channel scope + external contact ID create | 一条live identity、一个Contact；全部返回同root；无裸P2002；不以现有三段index冒充该合同 |
| ID-02 | 首次互动，owner内不存在active semantic exact identity | 获批scope carrier后，同一transaction创建一个Contact + ContactIdentity；无orphan |
| ID-03 | provider replacement/reconnect仍由adapter解析到同一verified stable logical Channel scope的canonical identity | 复用原Contact；core/UI/Otto不读provider/BSP身份 |
| ID-04 | 新identity有明确可审计 provider/FIKIRTIVE continuity proof，且唯一既有Contact root无歧义 | attach到该Contact；audit/idempotency完整；ConsentEvent/fold零变更 |
| ID-05 | phone/email/profile/order/name/address/avatar、同名、handle或相似资料 | 只产生可见duplicate/merge suggestion；零silent attach、cross-channel merge或person inference |
| ID-06 | conflict、recycle/reassignment signal、multiple roots或merchant split | 零auto-attach；只可suggestion或merchant-controlled merge/unmerge |
| ID-07 | merchant确认merge并选择primary fields | append-only `ContactMergeEvent`与选择记录完整；只移动该event列明identity；不创造consent |
| ID-08 | merchant unmerge旧event | 只反转该event仍在预期target的identity；保留history，不承诺完整时间倒流 |
| ID-09 | obsolete Channel identity被merchant移除 | identity不再active；既有conversation history仍可见；零issuer lifecycle、自动revive/reassignment |
| ID-10 | merge/unmerge遇STOP、DND、provider refusal或冲突consent | lineage physical contract获批前写路径fail-closed；启用后不得覆盖任何独立事实 |
| ID-11 | A owner identity / Contact → B owner Contact，或跨owner merge | 拒绝；零字节/零写/零孤儿event |
| ID-12 | 并发merge或merge后unmerge | tenant-qualified全序锁、零cycle；不猜测性移动merge后新identity |
| ID-13 | semantic-key unique loser | speculative tx全rollback；fresh tx bounded re-read winner/root |

### Consent

| ID | 场景 | 必须结果 |
|---|---|---|
| C-01 | 无 event | `unknown`；不因 unknown移出merchant audience或hard block |
| C-02 | explicit customer grant | tuple为 `verified_grant`；不自动加入Campaign |
| C-03 | 无限定STOP / purpose-bound unsubscribe | STOP原子撤回`marketing + review_request`；unsubscribe只撤回token purpose；retry零新增event |
| C-04 | revoke后 purpose-bound verified customer re-opt-in | 只恢复获验证的exact purpose；其它revoked tuple不变 |
| C-05 | revoke后 manual/import grant | revoke不被覆盖 |
| C-06 | ordinary inbound message | 不生成 grant |
| C-07 | caller伪造 action/actor/source/mode/status/channel/purpose/class/operation/evidence或跨Contact evidence | type/runtime拒绝；零event |
| C-08 | same Contact, different channel/purpose | 除D4明确STOP fan-out外状态互不污染；unsubscribe与re-opt-in保持exact purpose |
| C-09 | DND set/clear + duplicate/replay | typed event exactly-once；Contact-wide projection一致；clear后恢复原permission，不造grant；generic ActionEvent不可替代 |
| C-10 | provider permanent/transient/account-level + clear/expiry | permanent只verified clear且expire被拒；account-level只有verified finite expiry才可event-driven expire；transient不成长期block；wall clock不隐式解封；旧connection不污染新provider |
| C-11 | frequency suppress/expiry | 临时生效/解除；ConsentEvent与DND不变 |
| C-12 | duplicate webhook / two owners same external key | same owner exactly-once；different owners独立 |
| C-13 | 并发、NTP前跳/回拨、精度碰撞 | Timestamptz(6)下online fold = `(receivedAt,id)` replay |
| C-14 | clear projection并全量replay | current state semantic equivalent |
| C-15 | legacy unknown/ambiguous opt-in/opt-out | 不造verified fact；visible quarantine；unresolved opt-out阻止M5 |
| C-16 | direct Contact consent update / ConsentEvent UPDATE/DELETE | cutover后均拒绝ordinary mutation |
| C-17 | merchant selected unknown | 仍保留在audience；显示risk tag；exact manual action两次确认后可提交且consent仍unknown；无人确认auto-send为零 |
| C-18 | M2/M4/M5/rollback期间STOP | affected `marketing + review_request`自动/无人确认send均为零；严格transactional与合格reactive reply不被误停；merchant只有exact D5 two-confirm action可提交且consent仍revoke；reader不存在不可见窗口 |
| C-19 | send后late revoke / 两次确认后但submission前出现新revoke | 已发送receipt cursor可追溯并写late-revoke audit；未提交action的risk snapshot漂移使旧override失效，须重新两次确认；future unattended send为零 |
| C-20 | approved privacy de-identification rehearsal | 无可识别PII泄漏；fold、tenant与audit语义不变 |
| C-21 | verified historical purpose-bound revoke / unqualified STOP跨M3/M5/rollback | 前者只exact tuple、后者原子fan-out；无较新interactive stance时block；较新verified re-opt-in不被迟到baseline覆盖；scope/顺序不明者阻止M5 |
| C-22 | source有STOP、DND、冲突grant/revoke或merge后re-opt-in时尝试merge/unmerge | lineage spec批准前全部fail-closed且原状态byte/semantic不变；零redirect/identity/event副作用 |
| C-23 | compatibility三字段映射与asserted/unresolved event | grant/revoke/unknown精确映射；`consentAt=stateEvent.receivedAt`；state-neutral event不改三个bytes |
| C-24 | 清空DND/refusal projection并replaytyped events | exact semantic state恢复；跨tenant/connection/recipient零污染 |
| C-25 | M2/M4 后已有live DND/provider block再rollback | block继续被send reader看见；projection可replay；零不可见窗口、零跨scope扩大 |
| C-26 | STOP fan-out第二条insert/projection故障、duplicate或并发delivery | 两purpose全rollback或全commit；一个operationId、per-purpose deterministic keys；零half revoke/duplicate |
| C-27 | 四类transactional正例 + caller把客服free-form/营销/generic/跨owner subject标transactional | 仅closed context+immutable template通过；reactive reply不冒充transactional；其余shared action拒绝且零send；receipt context可重放 |
| C-28 | 新proactive purpose上线 | live与historical unqualified STOP都按operationId确定性backfill/replay；scope unresolved归零前该purpose零send；重跑零duplicate；既有purpose改class须另走Founder决定 |
| C-29 | D4上线后M2/M4/rollback移除classifier/template/subject gate | transactional path暂停而非caller-labelled放行；marketing/review STOP继续可见；自动旁路send为零，D5 exact override不受误分类 |
| C-30 | 相同历史资料分别证明unqualified STOP / purpose-bound unsubscribe / scope不明 | 分别atomic fan-out / exact tuple / quarantine+M5 hard stop；零scope猜测 |
| C-31 | reactive composer遇`unknown`/STOP/unsubscribe | Contact/composer/preview/final显示同一risk tag；Contact不被隐藏；系统/Otto/connector/job零自动Campaign/Segment/Broadcast/Schedule/review/offer/coupon/follow-up attachment |
| C-32 | authorized merchant手工加入proactive element并完成两次确认 | 两个独立confirmation均绑定同owner/operator、同confirmation attempt与同actionHash；exact frozen action幂等提交；ConsentEvent/projection bytes不变；receipt如实记录provider结果 |
| C-33 | 只有一次确认、同一request/transaction尝试造两步、相同confirmation ID、未commit first、challenge replay、Otto/connector/job伪造、跨operator或复用旧attempt/override | attempt-scoped state/CAS/unique约束拒绝；零outbox/submission；visible reason；零consent/action scope mutation |
| C-34 | 两次确认之间或之后改变immutable DeliveryManifest任一byte/field（含content、audience/recipient、destination、purpose/channel、schedule、personalization、attachment、identity binding），或在manifest byte-identical时改变任何其它actionHash/contract-authority input（含consent cursor/state、risk reasons、execution-gate snapshot、warningContractVersion、hash-contract/canonicalization version） | 当前attempt原子`INVALIDATED`且永不复活；manifest变化iff mint新`actionRevision`再建fresh attempt；manifest byte-identical的任何其它漂移保持原revision但仍建fresh attempt；两者都使用全新confirmations/challenge，旧attempt零outbox/send |
| C-35 | finite campaign/batch/scheduled action确认后出现next run/new batch/new recipient/新内容 | 只执行原exact action；未来concrete action不得继承确认，须重新两次确认 |
| C-36 | provider-ingested customer inbound / 同provider message retry或迟到redelivery / API-import-manual fake inbound / pure control keyword | 第一项只建一个anchor；retry返回原anchor/firstReceivedAt且不延窗；后两项不开窗不延窗；ordinary reply不造grant；human无平台自创统一条数上限 |
| C-37 | D5 override同时遇跨tenant/无operator permission/DND/provider hard refusal或真实channel prohibition | 全部继续拒绝；两次确认不改变这些独立边界，也不把submission说成delivery |
| C-38 | STOP writer与confirmed scheduled/batch dispatch并发 | 两者按§4.3.4同一总序取得fan-out再tuple locks：STOP先commit则override invalid/零outbox；outbox transaction先commit才成为in-flight并写late-revoke audit；零旧cursor事后建outbox |
| C-39 | same attachment ref换bytes、personalization或adapter post-confirm enrichment | deliveryManifestHash漂移并拒绝；只允许原canonical provider-bound payload；零同hash异内容send |
| C-40 | STOP后Otto生成一条free-form reactive reply或连续追发 | 无逐条human exact-content approval则零send；有proactive element还须D5两次确认；routine/autopilot不能代替human |
| C-41 | concurrent final-confirm、duplicate job retry与`delivery_unknown` | attempt-scoped confirmation/outbox unique + CAS只产生一个logical provider attempt；unknown进入reconciliation，不盲重投，也不提前re-arm第二个live attempt |
| C-42 | final confirm后、outbox claim前并发撤销operator role、ContactIdentity binding变更、DND set、provider block、frequency suppression或security-policy change | 按§4.3.4共用总序与gate version CAS；变化先commit则当前attempt invalid/零outbox；outbox先commit才成为in-flight；未来action读取新state |
| C-43 | two owners same recipient key、confirmed后ContactIdentity被移除/改绑或adapter不再解析到同一canonical Channel identity | 跨owner或identity binding变化一律invalid；adapter只有继续解析回同sender/recipient canonical Channel identity才可替换；零错tenant/错账号/错身份send |
| C-44 | D5 privacy matrix，或DeliveryManifest/reactive anchor/ActionReceipt/`actionId-actionRevision` mint-source任一physical contract Unknown | 全部affected reactive/D5 carrier、confirmation/outbox/worker/send path零implementation/enablement；不能用临时JSON/cache/connector row补洞，也不能只停ConsentEvent |
| C-45 | D5 M1 expand、rollback/restart/cache全失时存在FIRST/FINAL/SUBMITTING/MAY_HAVE_APPLIED/scheduled/INVALIDATED attempts | constraints先于behavior；attempt/carrier/count/status不丢；INVALIDATED不复活；pre-outbox安全执行或visible pause；outbox drain/reconcile到terminal；零重复provider attempt |
| C-46 | attempt因hash漂移invalidated后re-arm、两个并发re-arm，或authority后来恢复到旧hash | 旧attempt与confirmations/challenge永久只读可审计；只有一个新live attempt获胜并创建fresh rows；旧hash相等也不复用旧attempt；`actionRevision`不充当round |
| C-47 | live/historical STOP、purpose expansion与multi-recipient D5交错并注入任一class lock/CAS/insert故障 | 全部严格按§4.3.4总序、class内稳定排序；无deadlock换序旁路；每个operation全commit或全rollback，零half revoke/partial outbox |

### UTM

| ID | 场景 | 必须结果 |
|---|---|---|
| U-01 | five-key validator | exact五键通过；缺键、额外键、`v:1`拒绝 |
| U-02 | deterministic materializer | 相同获准输入产生byte-equivalent payload |
| U-03 | provider switch | UTM不变；provider名不进入payload |
| U-04 | cross-owner Campaign/link | fail closed |
| U-05 | update effective UTM | 拒绝；改变只能新建link |
| U-06 | optional null serialization | `content/term=null`仍保留JSON keys、URL不输出对应query参数 |
| U-07 | event snapshot | 等于link-time值；Campaign rename/link revoke后历史不变 |
| U-08 | Campaign grouping-only | 除原样保留且明确non-authoritative的legacy `utmBase`外，schema不新增任何Campaign UTM string/JSON/五键字段；legacy列仍存在直到独立destructive approval；UI/Otto/API无UTM编辑入口 |
| U-09 | stop-write/read | web actions、UI/Otto、connectors/imports、raw SQL、ScheduledPost/Broadcast/CRM/QR、worker、redirect、report都不把`utmBase`当authority；只允许受控legacy inventory读取 |
| U-10 | legacy preservation | old `utmBase`/links/snapshots byte-identical |
| U-11 | path inventory | 每条声明“可量测”的outbound path只走统一materializer；未列路径不假装归因 |
| U-12 | snapshot direct mutation/replay | AttributionEvent与SourceTag分别拒绝改写；重复replay幂等；taxonomy upgrade后byte-identical |
| U-13 | report authority | 只读event-time snapshot，不回读Campaign或当前link重算历史 |
| U-14 | existing ordinary query/fragment | 正确编码并保留；无UTM duplicate |
| U-15 | reserved `utm_*` conflict | **pending Founder choice**；只可reject或由immutable `utmJson` canonical replace；raw preserve禁止 |

### Migration / rollback

| ID | 场景 | 必须结果 |
|---|---|---|
| M-01 | empty DB从零跑current-head全部migrations | forward全通过；schema diff为零 |
| M-02 | exact production 64-migration baseline | 只跑8个pending + alignment；shared checksum不变 |
| M-03 | production-like snapshot clone | collision/quarantine报告可解释；零silent coercion |
| M-04 | backfill重跑 | counts、events、projection、links不变 |
| M-05 | M5 rollback | 新facts与D5 attempt/carrier/count/status保留、INVALIDATED永不复活且re-arm只建fresh attempt、nonterminal outbox由兼容worker drain/reconcile、legacy不恢复为双真源、known risks/audience/transactional/reactive/D5 override语义不漂移；无silent auto-send、absolute merchant hard block、一次确认standing waiver、duplicate provider attempt或`utmBase` writer/authority reader；既有link继续按原`utmJson`服务，两类snapshot byte-identical |
| M-06 | two-org end-to-end | identity/consent/DND/provider refusal/UTM跨租户零读写 |

## 11. Independent review 与 approval gates

### 11.1 【已批准】D1–D7 行为结果；不得重新呈问

以下 Founder Resolutions 已 durable 生效，本 PR、reviewer 与后续实现只能忠实落地，不得把底层 carrier/index/enum/lock 细节重新包装成产品问题要求 Founder 再批：

1. **D1**：可靠证据可维持 Contact continuity；模糊或不确定匹配只建议、由merchant确认，provider/connector不是identity authority。
2. **D2**：permission/revoke history是长期事实；`unknown`如实显示但不是merchant hard block；STOP、DND、provider refusal与frequency各自独立。
3. **D3**：Campaign只归组；UTM在link-time定案严格五键，event保存当时snapshot，`utmBase`不再是长期authority。
4. **D4**：无限定STOP原子撤回该channel全部proactive non-transactional purposes；purpose-bound unsubscribe只撤exact purpose；strict transactional不得夹带营销。
5. **D5**：risk tag可见且不自动接入；merchant手工坚持时，对exact frozen action完成两个独立human confirms后可提交；不制造consent、不形成standing override，Otto/connector/job不能代确认。
6. **D6**：semantic exact identity是owner + broad channel + verified stable logical Channel scope + external contact ID；同scope exact reuse。只有明确、可审计的provider/FIKIRTIVE continuity proof才可把新identity attach到唯一既有Contact，须有audit/idempotency且不改变consent；phone/email/profile/order/name/address/avatar只suggestion，conflict、recycle/reassignment signal、多root或merchant split绝不auto-attach。
7. **D7**：Phase 1 使用 respond.io Contact 的产品/UX行为基线，不复制代码/UI、不假设未公开内部语义；D6 semantic exact identity、duplicate suggestion与merchant-controlled merge/unmerge，connector/provider可替换；不建设IdentityIssuer retire/reactivate/quarantine、reassignment epoch、auto-revive或assignment state machine。

只有发现与上述Resolution真正冲突、或出现无法从其推导且会改变direction/scope/user behavior/acceptance的新选择时，才另开一题；schema reviewer提出“carrier尚未定义”本身不是重问D1–D7的理由。

### 11.2 【待批】只剩物理 schema、migration 与 retention 合同

下列Founder-only gate仍合法保留；它们批准的是**如何安全承载既有行为**，不重新裁决行为本身：

1. Identity physical contract：承载semantic owner + channel + logical Channel scope + external contact ID exact key的scope carrier、key/index、canonicalization boundary、continuity-proof audit/idempotency carrier、connector-neutral adapter与tenant-qualified relations；当前三段partial unique不得声称充分/最终；不授权issuer retire/reactivate/quarantine、recycle/revive/reassignment lifecycle或assignment state machine；
2. D7 merge physical contract：redirect、append-only `ContactMergeEvent`/`ContactIdentityMoveEvent`、primary-field resolution、lineage与lock/FK形状；获批前live merge/unmerge继续disabled；
3. Consent physical contract：`ConsentEvent`字段/index/check、closed source/action/actor matrix、state-neutral backfill、receivedAt cursor/fold/projection与D4 multi-tuple atomic implementation；
4. D5 physical contract：`ManualSendOverride/Confirmation/Outbox`的attempt-scoped constraints，以及§4.3.3列明仍Unknown的DeliveryManifest、provider-ingested reactive anchor、ActionReceipt、`actionId/actionRevision` authoritative mint/source；
5. typed DND/provider-refusal physical authority：scope keys、event/projection lifecycle、verified clear/expiry与tenant relations；
6. UTM physical contract：严格五键validator/storage、materializer derivation、link/snapshot write-once wiring、reserved-query冲突、legacy `utmBase` stop-read/write与report reader；
7. migration/production/retention contract：M0–M6 expand/backfill/cutover/rollback、known-negative quarantine解清、逐carrier privacy/access/export/erasure/backup/terminal retention与production hard gates。

若其中某个物理选择仍需Founder裁决，只能一题一次呈现该schema/migration/retention取舍，并明确引用它服务的已批准D1–D7结果；不得把“批准整份PR”当沉默授权，也不得再次询问已批准产品原则。

**D5 classification remains unresolved:** Founder 尚未选择 D5 physical carrier 是否可在所有相关路径保持 disabled/fail-closed 的前提下延后，或必须在本 Draft 合并前冻结完整shape。因此本节不授任何schema approval，Draft也不得 Ready 或请求合并。

### 11.3 Review evidence 与 merge boundary

- internal bounded lanes分别核过 identity、consent、UTM evidence；它们不是 cross-family PASS；
- D3 consultation与[D5前的bounded FABLE5 reactive-reply consultation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998494183)只覆盖各自范围，不等于完整spec review；
- [完整 spec FABLE5 review](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/342#issuecomment-4993893418) 在exact commit `3f8cc8f9`为0 P0 / 1 P1 / 4 P2 / FAIL；后续revision不能继承该旧head verdict；
- [exact `3754e4fc` follow-up evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5005496273) 为0 P0 / 0 P1 / 4 P2 / PASS；该PASS只属于其exact bytes；
- [exact `a13fdbde` FABLE5 follow-up](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009003221) 经[reconciliation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009022397)为0 P0 / 0 P1 / 3 P2 / PASS。当前revision已改变该head，不能继承`a13fdbde`的PASS，仍须按当前merge gate取得new exact-head review；
- 未解决P0/P1或缺少适用的exact-head evidence时不得请求Founder merge。Founder合并本spec PR也只批准物理合同，不授权Prisma/migration/code/data/production；implementation另开task/claim/PR并逐项获批。

## 12. Ticket terminal 与后续边界

本文件创建、commit、push 或 Draft PR 打开都不代表 #339 完成。只有：

1. 所有Phase-1 blocking Unknown已被exact字段/规则/path选择取代；未来Unknown都有明确fail-closed边界；**特别是 semantic logical Channel scope与continuity-proof的physical carrier/key/index仍须获批，且Founder必须先选择D5 physical carrier可否延后或须在合并前冻结。任一选择未作出时，本Draft明确为NOT READY，且不暗示任何schema approval；**
2. 本spec在exact head完成独立cross-family review且无unresolved P0/P1；
3. Founder按一题一次批准§11.2仍待的physical schema/migration/retention合同，并在 D5 分类已明示后明确合并这张schema-authority alignment PR；D1–D7行为结果不再重呈；
4. live `main`验证文件与批准head一致，并把durable evidence写回#339；

才可把 #339 的**合同冲突**判为闭合。是否解锁 #327/#328/#329 由 live GitHub dependency/Founder instruction决定，不能由本文件自动推断。

schema、migration、writer、backfill、production reconcile与destructive cleanup仍是后续独立任务；每项重新取得 task-linked claim、Founder authority和适用 review/test gate。

## Evidence pointers

- `docs/BLUEPRINT.md` — tenant、双模/动作层、完整 CRM、merchant autonomy、provider-neutral connector
- `docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:62,135-175`
- `docs/superpowers/specs/2026-07-12-b2-data-contract.md:95-242,284-308`
- `docs/superpowers/specs/2026-07-14-b8-phase1-campaign-crm.md:67-152,200-227,259-323`
- `packages/db/prisma/schema.prisma:1208-1289,1411-1440,1516-1541,1553-1588`
- `packages/db/prisma/migrations/20260714100000_b8_phase1_campaign_crm/migration.sql:45-77,98-107`
- `packages/db/src/__tests__/b8-phase1-schema.test.ts:102-125,153-210`
- `packages/core/src/segment-rules.ts:325-334`
- `packages/db/src/tenant-guard.ts:3-59`
- `apps/web/lib/schedule-service.ts:53-74`
- `apps/worker/src/jobs/publish.ts:375-383,428-460`
- `apps/web/Dockerfile:38-41`
- [#339 full read-only comparison](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992730224)
- [#339 D1](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992981271) · [D2](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993054049) · [D3](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993207403) · [D4](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4994091911) · [D5](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998535600)
- [#339 full-spec FABLE5 result](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993896369) · [PR evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/342#issuecomment-4993893418)
- [#339 D5-scoped FABLE5 consultation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998494183)
- [#336 production Gate 10](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336#issuecomment-4992312427)
