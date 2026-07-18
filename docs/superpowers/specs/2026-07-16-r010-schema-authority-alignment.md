# R-010：CRM identity、consent 与 UTM schema authority 对齐

> **状态：DRAFT / FINAL-CONVERGENCE-REVIEW-PENDING / SPEC-ONLY**
>
> Issue：[R-010 #339](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339)
>
> 证据基线：live `main` `2a2c57113a4de65db7640f4b850e40b1d76faa35`；PR #342 merge base `a61e3a855f3460f2166db08c64c0b9c4e7db340e`；remote head与本轮uncommitted diff base `1a9467c672879448103304cef112005284986f59`（2026-07-18）
>
> 本稿把 Founder 已批准的 D1–D10 产品与 authority 结果翻译成一份有界合同。D9 已冻结最小 `ChannelScope` 物理语义，D10 已冻结 outbound tracking truth；其它标为「本 PR 提案」的物理合同仍须经独立评审与 Founder 合并。D8 明确延后的 carrier/runtime 只归 native implementation gate，不再是本 Draft 的产品选择。
> 本 PR 不修改 Blueprint、Prisma schema、migration、产品代码、数据、global 配置或 provider；不授权 merge、deploy、production access、backfill、cleanup 或 spend。#339 与 #327/#328/#329 的硬停不因 Draft PR 打开而解除。

## 0. 读法与权威边界

本文只使用三种状态：

| 标记 | 含义 |
|---|---|
| **【已批准】** | Founder 已在 GitHub 留下 durable Resolution；本稿只能忠实表达，不能改写 |
| **【本 PR 提案】** | 建议采用的字段级/迁移合同；须经独立评审和 Founder 合并才成为实施输入 |
| **【Unknown】** | 当前没有足够证据；不得猜、回填、施工或宣称完成 |

D1–D10 的产品/authority 选择均已有 durable Resolution；旧稿对D5分类、scope carrier与tracking path政策的待决读法全部被D8–D10取代，不再是Founder产品blocker。未在R-010冻结的schema名称、migration、runtime、逐路径taxonomy与报告/UI/privacy实现，转为明示的downstream implementation gate：在适用合同获批、实现并验证前，对应writer、confirmation、outbox、worker或send branch必须disabled/fail-closed且不得声称可用；tracking只停未冻结的tracked-generation branch，social明确opt-out仍可保留original URL并以untracked/Unknown继续其原发布路径。本文从Draft变为Ready仍须current exact-head完整本地workflow与独立cross-family P0/P1=0；Ready不等于merge、implementation或Phase-1 CRM完成。

当前上位约束：

1. `docs/BLUEPRINT.md`：完整 Customer Engagement CRM、merchant autonomy、provider-neutral/可替换 connector、tenant isolation、人工与 Otto 共用同一动作层。
2. [D1 — Contact continuity](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992981271)：有可靠证据时，provider、connection、channel 改变不应丢失/重复顾客；不确定匹配必须商家确认。
3. [D2 — Consent history + unknown autonomy](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993054049)：permission/revoke history 是长期事实真源；`unknown` 不是 hard block；STOP、DND、provider refusal 各自独立。
4. [D3 — Link-time UTM](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993207403)：Campaign 一期只归组；可量测链接在生成时定案严格五键；事件保存当时快照；`utmBase` 不是长期权威。
5. [D4 — STOP / unsubscribe purpose scope](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4994091911)：无限定 STOP 原子撤回该 channel 全部主动非交易用途；purpose-bound unsubscribe 只撤回 token 指定用途；严格交易信息不得夹带营销。
6. [D5 — visible risk tag + two-confirm manual override](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998535600)：known consent risk 默认不自动接入主动发送；商家明确手工加入时，显示 tag/warning，并在两次独立人工确认后提交 exact frozen action；确认不制造 consent，也不给 Otto/connector/后台任务 standing override。
7. [D6 — continuity evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009216073)：同一verified stable logical Channel scope的exact identity复用；只有明确、可审计的 provider/FIKIRTIVE continuity proof 才可把新identity attach到唯一既有Contact，且不改变consent；普通资料只作suggestion，冲突、recycle/reassignment signal、多root或merchant split绝不auto-attach。
8. [D7 — respond.io Contact baseline](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009411743)；[precise correction](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009515955)：Phase 1 采用其成熟的 Contact 产品/UX行为基线，不复制其代码或 UI，亦不把未公开的内部身份语义当证据；保留 owner-scoped exact Channel identity、duplicate suggestion、merchant-controlled merge/unmerge 与 connector-neutral adapter。
9. [D8 — D5 physical carriers defer + fail-closed](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009826812)：D5/reactive carrier与runtime可延后到native implementation/schema task；全部依赖路径在合同获批、实现、验证前保持disabled/fail-closed/no availability claim，并须在任何对应live send与Phase-1 CRM completion前闭合；D5行为不变，retention归B13/privacy implementation gate。
10. [D9 — minimal lifecycle-free ChannelScope authority](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010061305)：冻结最小provider-neutral `ChannelScope`、四事实active exact authority、server-only canonicalization与安全backfill；明确禁止status/TTL/issuer epoch/recycle/quarantine/revive/auto-merge等生命周期 machinery。
11. [D10 — provider-neutral first-party outbound tracking authority](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010639846)：FIKIRTIVE first-party tracking facts与external analytics enrichment分离，冻结`Tracked-Redirect`/`Tagged-Direct`、逐路径政策、reserved `utm_*`二选一、fail-open/closed与truthful reporting边界。
12. B2 v1.2、B8/#314、现行 schema/migration/tests 是本次对齐证据，不因较早冻结、较晚合并或已有测试而自行成为最终 authority；D8–D10高于本稿更早的Unknown/提案措辞。

本稿不建立第二个 roadmap，也不扩大 Phase 1。它只闭合 R-010 的三个冲突面及为安全迁移不可缺少的共用边界。

## 1. 统一术语

| 术语 | 本文唯一含义 |
|---|---|
| `owner` / merchant | 一个 FIKIRTIVE tenant；所有数据访问从 authenticated session 取得 `ownerId` |
| `Contact` | merchant 范围内的一个 CRM 顾客档案；不是手机号、邮箱、PSID 或 provider account |
| `ContactIdentity` | Contact 与一个外部身份键的绑定；同一 Contact 可有多个 channel identity |
| `channel` | provider-neutral 协议/平台域，例如 WhatsApp、email、Instagram；不是 Gupshup、BSP、adapter、token 或 credential |
| `ChannelScope` / logical Channel scope | D9冻结的最小provider-neutral稳定Channel-instance记录；至少含`id/ownerId/channel/scopeKey/createdAt`，以`UNIQUE(ownerId,channel,scopeKey)`判同，在BSP/adapter replacement后仍区分同merchant的多个account/page/channel实例 |
| `canonical Channel identity` | `(ownerId, channel, ChannelScope, canonical externalId)` 的active精确身份；adapter只提交raw verified facts给server chokepoint，不能成为core schema、UI或Otto的第二套身份真源 |
| `provider connection` | 可替换的接入与 credential 载体；须reference同一`ChannelScope`，但不是顾客 identity authority |
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
| `first-party tracking fact` | FIKIRTIVE拥有的provider-neutral事实：tracked-link identity、generation-time严格五键、适用的redirect/click、event-time attribution snapshot与matched conversion；connector替换不得破坏 |
| `external analytics enrichment` | GA、Meta等provider-native metrics；必须标源分列，不能覆盖、回填、混入或汇总成FIKIRTIVE first-party truth |
| `Tracked-Redirect` | canonical五键 + FIKIRTIVE redirect + first-party click event的模式；redirect交付fail-open、event async/best-effort |
| `Tagged-Direct` | canonical五键直接进入destination、不得插FIKIRTIVE redirect的模式；FIKIRTIVE click truth为`Unknown` |
| `effective UTM` | 某一适用outbound link在generation-time实际定案的严格五键对象 |
| `event-time snapshot` | 下游事件落账时复制的 effective UTM；历史报表不回读当前 Campaign |

## 2. 冲突结论与 supersedes

| 轴 | B2 v1.2 | B8 / current main | Founder 已批准的长期方向 |
|---|---|---|---|
| Identity | issuer/version、自动 attach/revive/reassignment 生命周期 | live partial `(ownerId, channel, externalId)` | D6/D7/D9：最小`ChannelScope`承载stable logical scope；active exact authority为owner + channel + scope + canonical external ID；exact reuse，或经明确可审计continuity proof attach到唯一root |
| Consent | append-only `ConsentEvent`，按 channel × purpose 留 provenance | Contact 上 mutable `marketingConsent/consentSource/consentAt` | event history 为长期 permission-fact authority；Contact 只可作 derived compatibility/display；unknown 不 hard block |
| UTM | Campaign structured store + link effective value + event snapshot | `Campaign.utmBase`；已有 `TrackedLink.utmJson` 与 event snapshots | D3/D10：FIKIRTIVE拥有provider-neutral first-party fact layer；按path固定Tracked-Redirect或Tagged-Direct；link是effective authority，event是历史authority；external analytics只作分列enrichment；`utmBase` stop-write后留存legacy |

若本 PR 经 Founder 合并，以下解释被明确 supersede：

- B2 的自动 cross-channel attach / recycle / reassignment lifecycle读法：D7 Phase 1 不建设自动 person inference、issuer lifecycle、reassignment epoch或auto-revive/quarantine。D6只允许同一verified stable logical Channel scope的exact reuse，或有明确可审计 provider/FIKIRTIVE continuity proof 时将新identity attach到唯一既有Contact；phone/email/profile/order/name/address/avatar等普通资料只suggestion。provider replacement仍由薄adapter解析回同一逻辑scope的canonical Channel identity，而不是另造provider-specific core；conflict、recycle/reassignment signal、多root或merchant split绝不auto-attach。
- B8 Contact 三个 consent 字段作为长期真源的读法，以及任何把 `unknown` 与 `opt_out` 合成同一个 send hard gate 的读法。
- live Route-B §七·甲 E「已知STOP/退订、DND/block与provider硬限制必须fail closed抑制」中，把known STOP/退订解释为**merchant exact manual action也绝对hard suppress**的冲突部分：D5只让automatic enrollment/send继续hard stop；获授权merchant可对exact frozen action完成两次独立人工确认后提交，consent仍不变。DND、provider、security与法律/channel hard blocks继续不可绕。相关CRM恢复施工前，Route-B措辞须经separate Founder-approved plan-alignment对齐；本PR不修改Route-B，也不以本段自动恢复施工。
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
5. D1 没有批准具体normalizer或continuity-proof evidence class；D9已冻结最小`ChannelScope`物理语义与四事实active exact authority，exact migration/implementation仍须另批。D7/D9明确Phase 1不建设issuer/recycle/revive/reassignment lifecycle。

### 3.2 【已批准 D6/D7/D9】最小 lifecycle-free ChannelScope 与 exact Channel identity

| carrier / 字段 | 冻结合同 |
|---|---|
| `ChannelScope.id` | stable scope row ID |
| `ChannelScope.ownerId` | authenticated tenant；任何reference都须tenant-qualified |
| `ChannelScope.channel` | provider-neutral broad channel |
| `ChannelScope.scopeKey` | 单一server chokepoint产出的canonical stable key；caller/client/connector不得提交或覆盖canonical值 |
| `ChannelScope.createdAt` | immutable creation fact |
| scope uniqueness | `UNIQUE(ownerId, channel, scopeKey)` |
| `ChannelConnection` reference | connection映射/reference同owner、同channel的`ChannelScope`；credential/provider connection不得成为identity authority |
| `ContactIdentity` reference | 同owner、同channel地reference该`ChannelScope`，并保存server-canonical external contact ID；handle/label只展示 |
| active identity authority | active `(ownerId, channel, ChannelScope, canonical externalId)`唯一指向一个Contact；exact constraint naming与soft-delete表达可在implementation contract规范化，但不得退回三事实authority |

Phase 1不得给`ChannelScope`添加status、TTL、issuer、retirement/reactivation、assignment epoch、recycle/reassignment automation、quarantine、auto-revive、automatic person inference、auto-merge或其它lifecycle machinery。当前B8三事实partial index只是一项既有物理事实；在D9 migration/implementation另获Founder批准、安全backfill完成且四事实writer/index原子启用前，它不能冒充final authority。

canonical scope与canonical external ID只由一个server-side chokepoint从已验证raw facts导出。unmapped、ambiguous、conflicting scope或caller-supplied canonical value一律fail-closed：不走exact attach/create、不猜identity，只给merchant-visible suggestion/action。continuity proof的physical evidence carrier属于D8允许延后的implementation contract；未获批、实现并验证前，该attach writer保持disabled/fail-closed。

### 3.3 【已批准 D7/D9 / 本 PR implementation contract】共享 resolver、duplicate suggestion 与并发

UI、Otto、inbox、attribution、workflow、manual、CSV/import 和未来 connector 只能调用一个 shared identity action/repository（暂名 `resolveOrCreateContactIdentity`），不得直接 Prisma 旁路。

1. `requireOwner` 取得 `ownerId`；拒绝 client owner。
2. connector adapter只提交provider payload中的已验证raw scope/external facts；单一server chokepoint产出canonical channel + `ChannelScope` + external contact ID。adapter可替换，但core schema、UI与Otto不得依赖BSP/provider，connection row也不得替代`ChannelScope`。
3. owner-scoped按四事实active exact key查identity；同一verified stable scope命中则复用同一Contact。首次互动零命中时，只有D9 migration/implementation另获批准并证明scope映射唯一，才可在同一transaction创建Contact + ContactIdentity；unmapped/ambiguous/conflicting scope零create/attach。
4. 新identity只有携带明确、可审计 provider/FIKIRTIVE continuity proof，且唯一既有Contact root无歧义时，才可attach到该Contact；该attach须有audit与idempotency，并不得改变ConsentEvent或consent fold。proof physical evidence carrier按D8转入downstream implementation contract，未获批、实现并验证前该writer disabled/fail-closed。
5. phone/email/profile/order/name/address/avatar、同名、handle或相似资料只产生merchant-visible duplicate/merge suggestion；不自动attach、不自动merge、不猜同一人。
6. conflict、recycle/reassignment signal、multiple roots或merchant split一律不auto-attach；跨渠道关系只可走可见merchant merge/unmerge。
7. 用户可移除已不相关的Channel identity；既有conversation history保留。该动作不触发issuer lifecycle、自动revive/recycle、reassignment或跨渠道person inference。
8. 并发insert的unique loser必须先让含speculative Contact的transaction完整rollback，再在fresh owner-scoped transaction以bounded retry等待winner commit、按完整四事实active key重读同一root；不得向用户暴露裸P2002或再造Contact。D9 implementation未获批前不得将此段视为三段index实现授权。
9. 失败transaction不得留下orphan Contact、identity或audit。

### 3.4 【已批准 D7/D8 / 本 PR 最小 lineage 合同】merchant merge / unmerge

普通 soft delete 与 merge 必须分开。建议：

- `Contact.mergedIntoContactId String?`、`mergedAt DateTime?` 只作可重建 redirect projection；
- append-only `ContactMergeEvent` 保存 `ownerId, kind, sourceContactId, targetContactId, reversesEventId, primaryFieldResolution, actorKind, actorId, idempotencyKey, createdAt`；
- append-only `ContactIdentityMoveEvent`只保存merchant确认的merge/unmerge所移动identity：`identityId, fromContactId, toContactId, mergeEventId, actorKind, actorId, idempotencyKey, createdAt`；它不是reassignment/revive或自动assignment历史机；
- 两表 `UNIQUE(ownerId, idempotencyKey)`，不接受 ordinary UPDATE/DELETE；generic `ActionEvent` 可镜像 UI/admin audit，但不能是唯一 unmerge 真源。

merchant在merge时选择保留的primary fields；`ContactMergeEvent`保存该次可见的选择与merge history。Merge先解两边root，再按`ownerId + stable Contact ID`全序构造tenant-qualified transaction locks，锁内复核roots、阻止cycle，并只移动本event明列identity。Unmerge只反转该event仍在预期target的identity；merge后新加identity不猜测性移回，亦不承诺完整时间倒流。merge/unmerge不创造consent，也不得覆盖STOP、DND或provider refusal。

本段保留D7所需minimum merge/unmerge lineage/audit，不单独解锁schema或实现。continuity-proof carrier与full merge runtime可按D8延后；任何live merge/unmerge启用前，仍须在获批physical contract明确permission tuple、customer revoke、DND、post-merge re-opt-in、冲突grant/revoke与unmerge restoration如何跨lineage求值并完成验证。在此之前相应writer保持disabled/fail-closed/no availability claim，schema carrier也不等于功能已开启。

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

#### 4.3.3 【已批准 D5/D8 / implementation-deferred】reactive reply 与 two-confirm manual override

D5行为不变：`reactive_service_reply`是独立send class，不进入ConsentEvent purpose，也不能伪装成`transactional`；`unknown`/STOP/unsubscribe等risk在Contact、composer、preview与confirmation可见但不隐藏Contact。系统、Otto、connector、rule、import与background job不得自动把reply接入Campaign、Segment、Broadcast、Schedule、review request、offer/coupon或automatic follow-up。普通free-form reply只可由获授权merchant逐条批准exact content；一旦加入proactive element，就保留真实`marketing/review_request` purpose并进入D5 two-confirm，不得改写consent。

D5 exact-action contract只冻结以下行为边界，不在R-010选择table/column/index/state-machine形状：

1. server materialize一个tenant-qualified、immutable的exact action，固定sender/recipient identity、audience、destination、content/payload、personalization、attachments、tracked links、channel、purpose与schedule；任一authority或action变化使旧确认失效；
2. 同一获授权merchant必须以两次独立authenticated human requests确认同一个exact frozen action；一次request、一次确认、旧challenge、Otto/connector/job或standing waiver均不能代替第二次确认；
3. 两次确认只授权该single/finite action；recurrence、next batch、新recipient、新content或变化后的action必须重新两次确认；
4. submission前须重读consent、operator、identity、DND、provider refusal、frequency与security/provider policy；任何先提交的authority变化使旧确认失效并产生零outbox/send；
5. 成功override不写ConsentEvent、不改变`unknown/effective_revoke`、不制造grant，也不授权future auto-send；provider submission/delivery分别如实回执，`delivery_unknown`不得盲重投；
6. tenant isolation、operator permission、identity binding、DND、provider hard refusal、frequency、security、法律与channel prohibition仍不可绕过。

按D8，`DeliveryManifest`、provider-ingested reactive anchor、ActionReceipt、`actionId/actionRevision` minting、confirmation attempt、outbox、receipt、lock/retry、retention与reconciliation的完整physical/runtime合同全部移到各自native implementation/schema task。在适用合同另获Founder批准、实现并验证前，**所有依赖它们的reactive/D5 carrier、first/final confirmation、automation、submission、outbox、worker、receipt与send path保持disabled/fail-closed且不得作任何user-facing availability claim**；不得用临时JSON、cache、connector row、request ID、standing waiver或其它替代authority补洞。

该deferral不是scope cut，且有明确到期点：上述合同与flow必须在任何对应live send path启用前、并在Phase-1 Customer Engagement CRM completion可被接受前完成冻结、实现与验证。详细retention归B13/privacy implementation gate；它不重开D5 consent行为，但未通过时不得开始任何依赖的ConsentEvent/D5 implementation。

#### 4.3.4 【D4 原子性最低不变量 / D5 downstream 候选】concurrency boundary

D4已批准结果只要求：同一STOP的全部active proactive-purpose tuple在一个tenant-qualified transaction内以稳定顺序串行化；任一lock、event、projection或cursor步骤失败则整个operation rollback，零half revoke，retry复用原semantic idempotency。`historical_verified_stop`与`stop_purpose_expansion`沿用同一D4 fan-out/tuple并发边界。

D5 submission如何与operator、sender binding、Contact/Identity、consent fan-out/tuple、DND、provider refusal、frequency、override/outbox共同串行化，属于D8延后的native physical/runtime contract。先前九class总序仅是downstream候选，不是D5已冻结implementation；native task须另获Founder批准并证明tenant-qualified稳定排序、authority re-read、零deadlock换序旁路、零partial outbox与exactly-once retry。在该合同获批、实现并验证前，全部dependent D5 confirmation/outbox/worker/send path保持disabled/fail-closed。

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

以下公式冻结D5未来实现必须保持的行为，不表示D5 path已可用。按D8，在§4.3.3列明的native carrier/runtime/privacy gates全部通过前，`exactD5TwoConfirmOverride`不可被铸造或消费，全部dependent confirmation/outbox/worker/send path保持disabled/fail-closed/no availability claim。

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

### 4.7 【D8 downstream gate】privacy boundary

- `evidenceRef`只保存opaque ID/哈希引用，不默认复制raw message、email、phone、token正文或provider payload；source system另按其retention控制。
- ConsentEvent、D5 source action/manifest/reactive anchor/confirmation/outbox/receipt与provider refs都必须进入B13/privacy逐carrier矩阵：authorized reader/writer、最小字段、加密/key scope、retention、access/export/DSAR、erasure/pseudonymization、terminal compaction、backup/replica expiry与support access。
- Contact erasure不能靠普通event UPDATE/DELETE假装完成；受控privacy operation必须独立授权、审计、幂等、可验证，保留依法可保留且不改变permission fold的最小事实，并覆盖primary、backup、replica、export、receipt与support tooling。
- 具体retention期限与terminal处理由B13/privacy implementation gate冻结，不是D5 consent行为或本Draft Ready的产品选择；但该gate未通过前，任何依赖的ConsentEvent/D5 implementation与send path不得开始或启用。

## 5. UTM authority

### 5.1 【已批准 D3/D10】first-party authority 与 enrichment 隔离

1. FIKIRTIVE拥有provider-neutral first-party outbound tracking fact layer：tracked-link identity、generation-time canonical五键、适用的redirect/click facts、event-time attribution snapshots、matched-conversion facts与truthful receipts/reports。connector移除或替换不得破坏这些事实。
2. GA、Meta与其它external analytics只作source-labelled enrichment；provider-native impressions、spend、frequency等必须分列显示，不能覆盖、backfill、混入、相加或成为FIKIRTIVE tracking/attribution/receipt/compliance/report authority。provider discrepancy保持可见，不静默调和。
3. Campaign在Phase 1只负责意图与归组，不保存可编辑UTM string/JSON；`Campaign.utmBase`实施后stop-write，legacy原样保留到独立inventory/destructive approval。
4. outbound link只在适用path的generation-time定案严格五键；link是effective authority，event保存当时snapshot，历史报表不回读当前Campaign。
5. merchant、Otto、client与connector均不能直接编辑raw query、UTM JSON或内部taxonomy。

### 5.2 【已批准 D10】link mode 与 path policy

`Tracked-Redirect` = canonical五键 + FIKIRTIVE redirect + first-party click facts；`Tagged-Direct` = canonical五键直接进入destination、不插FIKIRTIVE redirect，FIKIRTIVE first-party click truth为`Unknown`。mode由server-owned path policy固定，不由caller选择：

| outbound path | 冻结政策 |
|---|---|
| CRM Campaign / Broadcast / WhatsApp outbound marketing | tracking required；默认`Tracked-Redirect` |
| QR / short-link / review-request | tracking required；`Tracked-Redirect`；绝不放宽D4 STOP/unsubscribe或send eligibility |
| Social schedule/direct | tracking default on；merchant可per-post明确opt out；平台不能安全接受redirect时以`Tagged-Direct`如实fallback；opt-out/direct-only click truth均为`Unknown` |
| Reminder posting pack | 只有实际存在measurable outbound link时按Campaign规则；该path inventory完成前不得声称tracking或量测 |
| Meta Ads | 必须`Tagged-Direct`；禁止插入FIKIRTIVE redirect；Meta metrics只作分列enrichment |
| Inbound import URL、product/media/research reference、internal `SharePreviewToken` | 不属于outbound marketing measurement；不得rewrite或计入tracking |
| Customer Email | future scope，须独立gate；本Resolution不启用、不作current tracking claim |

任何尚未冻结逐path implementation contract的required/default-on **tracked-generation branch**都保持disabled/fail-closed/no measurement claim；不因此停用该path的获准untracked branch。尤其social per-post opt-out保留original URL并以untracked/Unknown继续原发布路径。这不把redirect domain、bot/dedupe、report UI或privacy实现塞进R-010。

### 5.3 【已批准 D3/D10 truth / downstream field contract】五事实与 reserved-query truth

- D3/D10冻结generation-time canonical五事实`{source, medium, campaign, content, term}`与provider-neutral单一server materializer；provider/BSP/adapter identity不得进入。Campaign ID vs immutable slug、各path exact source/medium/content/term value mapping与non-Campaign grouping key属于后续逐path implementation contract，不是Founder产品blocker。
- `content/term`是否nullable/optional、JSON是否要求键存在、URL何时省略参数、具体normalization/encoding与physical storage都未由D10批准；下游contract须明确后才能启用该path的tracked-generation branch。未冻结时只停该branch并fail-closed/no claim，不影响social明确opt-out保留original URL的untracked发布。
- target URL已含任一reserved `utm_*`时，必须给merchant一次可见确认且只有两项：默认**整体替换全部reserved `utm_*`为FIKIRTIVE canonical五键，同时保留全部ordinary query与fragment**；或**URL完全原样保留并明确标为untracked/excluded from FIKIRTIVE attribution**。禁止silent replace、hard reject、per-key mix与raw UTM/query/JSON editing。
- required-tracking branch generation fail-closed：不能send/publish half-materialized或non-canonical tracked link。redirect delivery fail-open：优先到merchant destination；click/event异步best-effort，记录失败不得阻断delivery。

### 5.4 【已批准 D10 truth / physical storage deferred】link、snapshot 与 reporting truth

- tracked-generation branch成功materialize后，当时的canonical fact set是effective authority；历史event保存当时snapshot且不得因Campaign rename、link revoke或taxonomy upgrade重写。具体write-once carrier、更新/换link机制与snapshot storage由下游contract冻结。
- 任何被系统表示为untracked、没有FIKIRTIVE first-party click、missing或证据不足的情形，truth都只能是`Unknown`/no attribution claim，绝不表示0 click、0 conversion或已归因。D10没有批准以`utmJson=null`或任何单一null/enum/table形状作为唯一physical编码；storage另由bounded contract冻结。
- 没有link authority的event不猜UTM；conversion report只报告matched conversions。untracked period、missing event、redirect gap、unmatched identity/conversion与provider unavailable都显示`Unknown`，永不显示为0。
- `Tracked-Redirect` redirect只可读取当时link authority；不得从`Campaign.utmBase/name/provider config`重算。`Tagged-Direct`没有FIKIRTIVE click fact，不得借provider click补写first-party truth。
- 不修改已合并migration/checksum；只读inventory `utmBase`、link与snapshots。legacy `utmBase`/异常值/既有link/snapshot/已发布URL原样保留，不静默parse、backfill或批量rewrite；删除`utmBase`另走destructive approval。
- exact schema/table/field、nullability/serialization、redirect infrastructure/domain、bot classification、click/conversion dedupe、report UI、privacy/retention与provider ingestion均归后续授权；R-010只冻结truth authority。任何依赖未冻结implementation contract的tracked-generation branch保持disabled/fail-closed/no availability or attribution claim；social opt-out的original untracked URL与发布branch不受此停线。

## 6. 共用 tenant、动作层与审计不变量

**现在就成立的宪法/产品不变量**；DB具体composite-FK形状仍由#317决定：

1. 任何identity/consent/Campaign/link/event/source-tag关联只能连接同owner对象。
2. `ownerId`只来自authenticated session；不信client owner/org。
3. unique-key、nested write、raw SQL、replay、import与merge不能依赖现有tenant guard的blind spots；每条路径显式owner-bound。
4. 每个writer/read/replay/import/merge有two-org negative tests；跨owner零字节、零行变化、零orphan audit。
5. UI与Otto调用同一shared action；不建connector-specific schema、UI或Otto workflow分叉。
6. provider replacement不改变consent history或UTM taxonomy，不重复外写。

**Phase 1 Channel identity 不变量**：

1. `ContactIdentity.ownerId == Contact.ownerId == ChannelScope.ownerId`，且每个active四事实exact key（owner + channel + `ChannelScope` + canonical external contact ID）只指向一个Contact；`ChannelScope`至少含D9五字段与`UNIQUE(ownerId,channel,scopeKey)`，当前三事实index不构成充分或最终合同。
2. connector adapter只可提交verified raw scope/external facts；单一server chokepoint生成canonical `scopeKey/externalId`。`ChannelConnection`与`ContactIdentity`都reference同一tenant/channel的`ChannelScope`；provider/BSP/token/connection row不得成为core identity authority。
3. provider replacement/reconnect只要解析到同一`ChannelScope`与canonical external identity，即复用同一Contact。unmapped/ambiguous/conflicting scope零exact attach/create。明确可审计 provider/FIKIRTIVE continuity proof 只可attach到唯一既有root并写audit/idempotency、不改变consent；其carrier未获批前writer disabled/fail-closed。跨渠道或普通资料一律只suggestion；conflict、recycle/reassignment signal、多root或merchant split不得auto-attach，等待merchant merge/unmerge。
4. `ConsentEvent.ownerId == Contact.ownerId`；Campaign/link/event/source-tag同样owner一致。

#339 不借本稿裁定全 repo composite FK 房规；#317 也不能成为暂时允许跨租户裸写的理由。

## 7. Legacy / migration / cutover

所有执行都需要另行 Founder schema/migration/production 授权。本稿只冻结建议顺序。

### M0 — Reconcile before mutation

- pin exact deployed web/worker source SHA 与 image digest；
- SELECT-only 核 production migration ledger、shared checksums、rollback chronology、physical catalog/index/constraint、row counts/value distributions；
- inventory 全部 identity/consent/UTM readers、writers、raw SQL、imports、workers、每条outbound path、redirect/report与external analytics ingestion；Reminder只有证明存在实际link path后才进入tracking inventory，证明前no claim；
- 产出无 PII dry-run mapping/collision report；
- 建立并 restore-test 可识别 backup/PITR point；
- 在 production snapshot clone rehearsal。

### M1 — Expand before behavior change

- 新 migration，不改旧 migration；
- Phase 1 identity只additive建立D9最小`ChannelScope(id,ownerId,channel,scopeKey,createdAt)`、`UNIQUE(ownerId,channel,scopeKey)`、同tenant/channel的`ChannelConnection`/`ContactIdentity` references与active四事实unique；exact命名/constraint表达可规范化，但不得新增status/TTL/issuer epoch/recycle/quarantine/revive/auto-merge lifecycle。任何migration/schema仍须另获Founder批准；
- 现有三事实rows/index只按legacy事实保留，先做tenant-qualified verified scope backfill；无法证明scope的row保持disabled/quarantined from exact path。四事实writer/index在backfill验证与原子切换前不得启用，也不得用connection/provider surrogate补洞；
- `ConsentEvent`及其projection只有在本PR物理合同获批**且**§4.7/B13逐carrier privacy gate通过后才可additive；缺任一项不得启动migration或implementation。`ContactDndEvent`、`ProviderRefusalEvent`与其projections仍须本PR对应物理合同批准；不新增Campaign UTM store。D8延后的reactive/D5 manifest/anchor/confirmation/outbox/receipt/runtime不得在R-010占位落地，native contract未获批前全部dependent implementation/path disabled；
- 加 tenant coverage、index/constraint 与 isolated migration/rollback tests；
- reader/writer 行为尚不切换。

### M2 — Single writer seams

- identity、consent、DND、provider refusal、UTM各建立唯一shared action/materializer；UI/Otto/connectors共用；scope/external canonicalization只有一个server chokepoint；
- static/runtime tests阻止 direct legacy writes；
- 新identity只经shared resolver在获批D9 carrier上写active四事实Channel identity；unmapped/ambiguous/conflicting scope零exact attach/create。同一`ChannelScope` exact reuse；continuity proof carrier未获批前attach writer fail-closed。普通资料只生成suggestion，merchant merge/unmerge走§3.4最小lineage；
- consent先dark-launch/shadow。任何live consent endpoint启用时，必须在同一exact release同时具备：event insert + `whatsapp × marketing` compatibility projection同transaction，以及send consent-state reader从第一条live event起可见并能区分automatic hard stop、visible risk tag与exact D5 override；禁止“只写event、旧send reader看不到”的窗口；
- STOP endpoint启用前还必须证明§4.3.1的`marketing + review_request`同transaction fan-out、共享operationId、per-purpose idempotency与两tuple consent-state readers全都在同一exact release生效；自动/无人确认send为零，merchant manual action只能进入D5 two-confirm path；
- D4 transactional exemption启用前，§4.3.2 closed context matrix、same-owner subject validators、immutable template registry与receipt context hash必须覆盖全部transactional path；任何旧generic/free-form/connector path不得自报transactional；
- D8延后的reactive/D5 contract必须先在native task冻结、实现并验证，且同一exact release覆盖UI、Otto、connector、job、outbox/worker/retry与truthful receipt；缺任一项时全部dependent confirmation/automation/send path disabled/fail-closed/no availability claim。该gate在任何对应live send与Phase-1 CRM completion前到期；
- 任何live DND/provider refusal endpoint同样要求typed event + compatibility/state projection + send hard-negative reader在同一exact release可见；禁止产生reader看不见的新block；
- D10 required/default-on path只经统一materializer按固定mode生成strict五键；逐path contract未冻结时generation fail-closed。reserved `utm_*`只走可见整体替换或原样untracked二选一；
- production可shadow其它reads，但known STOP/revoke一旦live写入就不能shadow-only。

### M3 — Honest backfill

| 轴 | 可安全处理 | 必须 quarantine / 不得猜 |
|---|---|---|
| Identity | 现有三事实row只有在同tenant/channel的stable `scopeKey`可验证时才backfill到D9 `ChannelScope`，并幂等建立references | 无法证明、unmapped、ambiguous、conflicting scope或跨owner异常保持disabled/quarantined from exact path；不得猜、silent merge或用connection/provider surrogate；continuity proof缺失只suggestion |
| Consent | `unknown`不生成event；verified purpose-bound historical revoke写`historical_verified_revoke`；verified unqualified historical STOP按D4写`historical_verified_stop`原子fan-out | 模糊opt-in不升级verified；无法证明purpose-bound vs unqualified STOP scope、tuple或顺序的known negative进visible quarantine，M5前必须归零或另获显式temporary-block批准 |
| DND / provider refusal | legacy DND `true`写确定性set event；可验证provider block/clear按exact scope迁移 | DND actor/scope不明、provider scope/receipt不明不得猜；只进visible quarantine |
| UTM | 已结构化合法link/snapshot原样保留；现有任何untracked/legacy/missing表示只按Unknown/no-attribution truth处理，不在R-010统一物理编码 | `utmBase` placeholder/duplicate/malformed不自动parse；不重写已发link/event，不把任何null/missing表示转成0/attributed |

Backfill重跑必须 byte/semantic idempotent；原始值、batch/hash 与结果可追溯，idempotency key 不塞 raw PII。

### M4 — Shadow read and compare

- new projection与legacy behavior同时计算，但只标一个authority；live STOP/revoke的consent-state reader已按M2双读/直读event，不能等M5；
- identity比较D9 scope/root/collision/backfill quarantine与零auto-attach；consent比较tuple state，特别验证unknown不被移出名单、known revoke不被自动放行；D5尚未通过native gate时只验证dependent path全停。UTM比较link/event snapshots、path mode、Unknown truth与provider enrichment分列；
- 所有差异分类、可解释；零 unexplained drift 才请求 cutover。

### M5 — Authority cutover

- identity writer/read只使用D9 `ChannelScope`与active四事实key；三事实row须完成verified tenant-qualified backfill，否则保持disabled/quarantined。首次互动只在scope唯一映射后创建Contact，同scope exact reuse；continuity-proof/full merge runtime未获批时writer disabled；不得恢复issuer/status/TTL/recycle/revive/reassignment/quarantine或automatic person inference/merge；
- ConsentEvent成为唯一permission-fact truth；writer、consent-state reader、projection与receipt cursor按一个controlled cutover切换；Contact三字段退出business reads，只作待删legacy；所有不能安全表示/排序的known historical revoke必须为零或已有单独Founder规则；
- transactional eligibility只由§4.3.2 shared classifier与validated context决定；generic/caller-labelled path为零，receipt context证据可重放；
- reactive eligibility与manual consent override只有在D8 native carrier/runtime/privacy gates全部通过后才可由§4.3.3 shared actions启用；否则全部dependent path保持disabled/fail-closed/no claim。启用后receipt可重放且不改变permission fold，legacy一次确认/connector bypass/standing waiver路径为零；
- ContactDndEvent与ProviderRefusalEvent分别成为DND/refusal authority；`doNotDisturb`只作compatibility projection，generic ActionEvent只作镜像；
- `utmBase` stop-write/stop-read；D10逐path固定`Tracked-Redirect`/`Tagged-Direct`，tracked-link fact set在generation-time定案、events保存当时snapshot；required tracked-generation branch fail-closed，redirect delivery fail-open/event async；Unknown不显示0，matched conversions与provider enrichment分列；
- receipts保存必要 identity/consent/transactional/reactive/manual-override/UTM cursor与evidence，使“当时知道什么、为何可发、由谁确认、提交了什么、provider实际返回什么”可重放；
- 不在 cutover 同时 drop旧列/index/table。

### M6 — Contract / destructive cleanup

- 所有readers、exports、Otto、reports、workers与tests已脱离legacy authority；provider enrichment与FIKIRTIVE first-party facts继续分列且connector removal不破坏后者；
- production verification、backup restore、rollback/forward-fix rehearsal 与 independent review全通过；
- 另取 Founder destructive approval 后才 drop旧 identity index、Contact consent fields或 `utmBase`；
- DND 与历史 events/links/snapshots不随 legacy字段删除。

## 8. Rollback 与 forward-fix

1. M1–M4：只可关闭尚未live的new path并保留additive data。若已接收live consent/DND/provider block，rollback必须keep-forward对应typed authority、reader与projection，不能退回“看不见STOP/block”的旧reader；D4上线后必须保留transactional classifier/subject/template gate。D8 deferred reactive/D5 path在native gates未通过时本来就保持disabled；若未来依完整合同启用，rollback必须保留其durable carrier、two-confirm exact-action/no-consent-mutation与reconciliation，不得删carrier、以cache代authority、回到silent send/一次确认standing waiver或盲重投。
2. M5后identity：若resolver异常，停止affected mutation；从D9 `ChannelScope`、active四事实identity及获批的continuity/merge audit重建projection，不允许回到provider-specific/三事实key或猜merge。无法证明scope的legacy row继续disabled/quarantined；不得以soft-delete、号码回收、recycle/reassignment signal或connector变更推断同一人。
3. M5后consent：projection drift时暂停受影响mutation并replay events；若不能证明known revoke是否存在，暂停该affected tuple的send；不得把全体unknown错误hard block。rollback不得关闭已live的STOP/revoke或historical revoke baseline读路径。
4. M5后DND/provider：projection drift时只暂停affected Contact或exact connection/recipient scope并replay typed events；不得回退到可旁路直写的bool/generic JSON，也不得把旧connection block带到新provider。
5. M5后tracking：required path materializer异常时generation fail-closed，既有`Tracked-Redirect`仍fail-open到destination并异步记event，既有`Tagged-Direct`保持原URL；不得恢复`utmBase`双写、把Unknown显示为0、以provider enrichment补写first-party truth或跨mode静默改写。
6. writer rollback不能让 legacy字段重新成为独立 authority。M6 destructive action只能走另一次批准；此前 rollback不需要 drop。
7. 每次rollback验证event/link/`ChannelScope`/identity counts与references、tenant boundary、known blocks、merchant audience、history snapshots、first-party/provider分列均无漂移；若D5 downstream carriers已存在，再验证manifest/confirmation/outbox/status/provider idempotency。重启与cache全失后仍得同一结果，并留下forward-fix ticket与receipt。

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

R-010验D7/D9 Phase 1 `ChannelScope`、exact Channel identity与merchant-controlled merge/unmerge最低合同；schema/migration/implementation仍须另获批准。continuity-proof/full merge runtime未冻结前，其writer保持disabled/fail-closed，不能拿本矩阵反推功能已开启。

| ID | 场景 | 必须结果 |
|---|---|---|
| ID-01 | 100并发相同active owner + channel + `ChannelScope` + canonical external ID create | 一条live identity、一个Contact；全部返回同root；无裸P2002；不以现有三事实index冒充该合同 |
| ID-02 | 首次互动且不存在active exact identity | 只有scope唯一映射、D9 implementation获批后才同transaction创建Contact + ContactIdentity；无orphan；否则零create/attach |
| ID-03 | provider replacement/reconnect仍canonicalize到同一`ChannelScope`与external ID | 复用原Contact；connection reference同scope；core/UI/Otto不读provider/BSP身份 |
| ID-04 | 新identity有明确continuity proof且唯一root无歧义 | carrier/runtime未获批前writer disabled；启用后attach、audit/idempotency完整且ConsentEvent/fold零变更 |
| ID-05 | phone/email/profile/order/name/address/avatar、同名、handle或相似资料 | 只产生可见duplicate/merge suggestion；零silent attach、cross-channel merge或person inference |
| ID-06 | conflict、recycle/reassignment signal、multiple roots或merchant split | 零auto-attach；只可suggestion或merchant-controlled merge/unmerge |
| ID-07 | merchant确认merge并选择primary fields | append-only `ContactMergeEvent`与选择记录完整；只移动该event列明identity；不创造consent |
| ID-08 | merchant unmerge旧event | 只反转该event仍在预期target的identity；保留history，不承诺完整时间倒流 |
| ID-09 | obsolete Channel identity被merchant移除 | identity不再active；既有conversation history仍可见；零issuer lifecycle、自动revive/reassignment |
| ID-10 | merge/unmerge遇STOP、DND、provider refusal或冲突consent | lineage physical contract获批前写路径fail-closed；启用后不得覆盖任何独立事实 |
| ID-11 | A owner identity / Contact → B owner Contact，或跨owner merge | 拒绝；零字节/零写/零孤儿event |
| ID-12 | 并发merge或merge后unmerge | tenant-qualified全序锁、零cycle；不猜测性移动merge后新identity |
| ID-13 | semantic-key unique loser | speculative tx全rollback；fresh tx bounded re-read winner/root |
| ID-14 | 同owner/channel两个scopeKey；caller提交canonical value；unmapped/ambiguous/conflicting scope | 前者生成两个独立`ChannelScope`；其余server chokepoint拒绝exact attach/create，只给可见suggestion/action |
| ID-15 | 既有三事实rows backfill | 只有verified stable scope可tenant-qualified幂等迁移；无法证明者保持disabled/quarantined；零猜测、silent merge或connection/provider surrogate |

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
| C-17 | merchant selected unknown | 仍保留在audience并显示risk tag；D8 native gates未通过时manual path disabled；通过后exact action两次确认才可提交且consent仍unknown；无人确认auto-send为零 |
| C-18 | M2/M4/M5/rollback期间STOP | affected `marketing + review_request`自动/无人确认send均为零；strict transactional不被误停；reactive/D5 native gate未通过时全停，通过后merchant也只有exact two-confirm action可提交且consent仍revoke；reader无不可见窗口 |
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
| C-31 | reactive composer遇`unknown`/STOP/unsubscribe | Contact/composer/preview/confirmation显示同一risk tag；Contact不隐藏；系统/Otto/connector/job零自动proactive attachment或follow-up |
| C-32 | authorized merchant手工加入proactive element | 只有同一exact frozen action的两次独立authenticated human confirmation后才可提交；ConsentEvent/projection不变；一次确认/standing waiver/automation均为零send |
| C-33 | 两次确认之间action、recipient、identity、consent或其它hard gate变化 | 旧确认失效、零outbox/send；变化后的finite action须重新两次确认；future batch/recurrence不得继承 |
| C-34 | D8 deferred carrier/runtime/privacy任一未获批、未实现或未验证 | 全部affected reactive/D5 carrier、confirmation、automation、outbox、worker、receipt与send path disabled/fail-closed/no availability claim；禁止临时authority补洞 |
| C-35 | 尝试在native gate前开启live reactive/D5 send，或在相关carrier未完成时宣称Phase-1 CRM complete | 拒绝；D8 gate必须在任何对应live send与Phase-1 CRM completion acceptance前到期 |
| C-36 | D5 override遇跨tenant、无operator permission、identity drift、DND/provider refusal/frequency/security/channel prohibition | 全部继续拒绝；两次确认不改变独立边界，也不把submission说成delivery |
| C-37 | downstream D5启用后的retry/rollback/unknown provider result | exact action exactly-once；durable audit/receipt可重放；unknown进入reconciliation、不盲重投；consent仍不变 |

### UTM

| ID | 场景 | 必须结果 |
|---|---|---|
| U-01 | canonical five-fact contract | 只冻结`source/medium/campaign/content/term`五事实；exact mapping、nullability、key presence、URL omission与physical encoding由逐path downstream contract决定，未冻结时tracked-generation branch fail-closed |
| U-02 | deterministic server materializer / provider switch | 相同获批path input产生semantic-equivalent canonical facts；exact byte serialization另由downstream contract冻结；provider/BSP不进入facts，connector替换不破坏first-party history |
| U-03 | CRM Campaign/Broadcast/WhatsApp outbound marketing | tracking required，默认`Tracked-Redirect`；逐path contract未冻结时generation fail-closed/no claim |
| U-04 | QR/short/review-request | tracking required且`Tracked-Redirect`；不放宽STOP/unsubscribe/send gate |
| U-05 | social direct/schedule | default tracking；merchant per-post opt-out可原样untracked；redirect不安全时`Tagged-Direct`；click truth为Unknown而非0 |
| U-06 | Reminder posting pack | 只有inventory证明实际measurable link才按Campaign规则；此前no tracking/measurement claim |
| U-07 | Meta Ads | 只用`Tagged-Direct`；零FIKIRTIVE redirect；Meta metrics独立标源分列 |
| U-08 | inbound import、product/media/research、SharePreviewToken | URL原样，不rewrite、不计tracking |
| U-09 | Customer Email | future separate gate；零current enablement/claim |
| U-10 | target含任一reserved `utm_*` | 一次可见确认仅有：canonical五键整体替换并保留ordinary query/fragment，或URL完全原样且untracked；零silent replace/hard reject/per-key mix |
| U-11 | required path generation失败 | fail-closed；零half-materialized/non-canonical send/publish |
| U-12 | redirect event store失败 | destination delivery fail-open；event async/best-effort；记录失败不阻断delivery |
| U-13 | 任一physical表示的untracked/no-first-party-click/missing、redirect gap或unmatched result | 显示Unknown/no attribution claim；绝不显示0或attributed；不把任一null/enum/table形状冒充D10唯一编码 |
| U-14 | conversion/provider reporting | 只报matched conversions；FIKIRTIVE first-party facts与provider metrics标源分列，零覆盖/回填/混合/相加/静默调和 |
| U-15 | effective facts或event snapshot变化 | 历史snapshot保持event-time truth且不因Campaign rename/link revoke重写；更新/换link与physical write-once机制由downstream contract冻结 |
| U-16 | Campaign ID vs slug、exact source/medium/content/term mapping/nullability/serialization、redirect domain、bot/dedupe/report UI/retention未冻结 | 归后续逐path bounded contract；不是Founder产品blocker；只停affected tracked-generation branch并fail-closed/no claim，social original-URL opt-out仍可untracked发布 |

### Migration / rollback

| ID | 场景 | 必须结果 |
|---|---|---|
| M-01 | empty DB从零跑current-head全部migrations | forward全通过；schema diff为零 |
| M-02 | exact production 64-migration baseline | 只跑8个pending + alignment；shared checksum不变 |
| M-03 | production-like snapshot clone | D9 scope mapping/collision/quarantine与UTM path/untracked-missing inventory可解释；零silent coercion/guess/rewrite |
| M-04 | backfill重跑 | `ChannelScope`/references、events、projection、links/snapshots counts与bytes不变；unprovable三事实rows仍disabled/quarantined |
| M-05 | M5 rollback | D9四事实identity不退回三事实/provider authority；legacy不恢复双真源；D8未启用path仍全停，已启用downstream carrier则keep-forward并reconcile；required tracking generation fail-closed、redirect delivery fail-open、Unknown/report分列不漂移；零silent send/UTM rewrite/duplicate provider attempt |
| M-06 | two-org end-to-end | identity/consent/DND/provider refusal/UTM跨租户零读写 |

## 11. Independent review 与 approval gates

### 11.1 【已批准】D1–D10 行为与 authority 结果；不得重新呈问

以下Founder Resolutions已durable生效；本PR、reviewer与后续实现只能忠实落地，不得把已决authority或downstream carrier/index/taxonomy/runtime细节重新包装成Founder产品问题：

1. [**D1**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992981271)：可靠证据可维持Contact continuity；模糊或不确定匹配只建议、由merchant确认，provider/connector不是identity authority。
2. [**D2**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993054049)：permission/revoke history是长期事实；`unknown`如实显示但不是merchant hard block；STOP、DND、provider refusal与frequency各自独立。
3. [**D3**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993207403)：Campaign只归组；UTM在link-time定案严格五键，event保存当时snapshot，`utmBase`不再是长期authority。
4. [**D4**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4994091911)：无限定STOP原子撤回该channel全部proactive non-transactional purposes；purpose-bound unsubscribe只撤exact purpose；strict transactional不得夹带营销。
5. [**D5**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998535600)：risk tag可见且不自动接入；merchant对exact frozen action完成两个独立human confirms后可提交；不制造consent、不形成standing override，Otto/connector/job不能代确认。
6. [**D6**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009216073)：exact authority为owner + channel + stable logical scope + external ID；continuity proof只可attach唯一root且不改变consent；普通资料只suggestion，冲突、多root等绝不auto-attach。
7. [**D7 baseline**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009411743) / [**precise correction**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009515955)：Phase 1采用respond.io Contact产品/UX行为基线；保留exact identity、suggestion、merchant merge/unmerge与connector-neutral adapter，不建设issuer/recycle/revive/reassignment lifecycle。
8. [**D8**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009826812)：D5/reactive carriers与runtime可延后，但dependent paths全停且不得声称可用；deferral在任何对应live send与Phase-1 CRM completion前到期；minimum merge lineage保留，retention归B13/privacy implementation gate。
9. [**D9**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010061305)：最小lifecycle-free `ChannelScope`至少五字段与`UNIQUE(ownerId,channel,scopeKey)`；connection/identity共同reference；active四事实authority、server chokepoint与safe backfill冻结，lifecycle machinery明确禁止。
10. [**D10**](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010639846)：FIKIRTIVE first-party facts与external enrichment隔离；两种link mode、逐路径政策、reserved-query二选一、generation/redirect failure truth、Unknown与matched-conversion/report边界冻结。

只有发现与上述Resolution真正冲突、或出现会改变direction/scope/user behavior/acceptance的新选择时，才另开一题；carrier、naming、taxonomy、migration或runtime尚待下游冻结本身不是重问D1–D10的理由。

### 11.2 R-010 merge 与 downstream implementation gates

下列gate只管**如何安全承载/上线既有authority**，不重新裁决产品：

1. D9已冻结`ChannelScope`最小语义；exact table/field/constraint naming、tenant-qualified relations、verified三事实backfill、四事实index/writer cutover与rollback仍须独立Founder schema/migration批准。未批准/验证前legacy rows保持disabled/quarantined from exact path；
2. D8允许continuity-proof carrier与full merge runtime延后；§3.4 minimum lineage/audit保留。未获批、实现、验证前相应attach/merge/unmerge writer disabled/fail-closed/no claim；
3. 本PR仍以bounded physical proposal呈Founder批准`ConsentEvent`、closed writer/fold/projection、D4 atomic STOP以及typed DND/provider-refusal authority；这不重写D2/D4/D5行为；
4. D8 deferred reactive/D5 manifest、anchor、confirmation/outbox/receipt、lock/retry/reconciliation与retention归native tasks；它们不再阻止本Draft变Ready，但必须在任何对应live send及Phase-1 CRM completion前闭合，期间dependent paths全停；
5. D10已冻结tracking truth authority与path policy；Campaign ID vs slug、exact source/medium/content/term mapping/nullability/serialization、physical storage、redirect domain/infrastructure、bot/dedupe、report UI与privacy/retention归后续逐path bounded contract。未冻结时只停tracked-generation branch并fail-closed/no claim；social original-URL opt-out仍可untracked发布；
6. B13/privacy逐carrier矩阵不是本Draft Ready的产品选择，但未通过前不得开始依赖的ConsentEvent/D5 implementation；
7. live Route-B §七·甲 E的绝对STOP/退订hard-suppress冲突措辞须在相关CRM恢复施工前经separate Founder-approved plan-alignment按D5收窄；本PR不修改该计划，也不解除当前施工硬停；
8. M0–M6、production reconcile、destructive cleanup与deploy各自仍须Founder授权、current evidence与适用review/test gate。

D8已完成旧稿的D5时序分类：本Draft可在上述deferral/expiry边界写清后进入exact-head Ready review；Ready、Founder合并、schema implementation与Phase-1 CRM completion仍是四个不同gate。

### 11.3 Review evidence 与 merge boundary

- internal bounded lanes分别核过 identity、consent、UTM evidence；它们不是 cross-family PASS；
- D3 consultation与[D5前的bounded FABLE5 reactive-reply consultation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998494183)只覆盖各自范围，不等于完整spec review；
- [完整 spec FABLE5 review](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/342#issuecomment-4993893418) 在exact commit `3f8cc8f9`为0 P0 / 1 P1 / 4 P2 / FAIL；后续revision不能继承该旧head verdict；
- [exact `3754e4fc` follow-up evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5005496273) 为0 P0 / 0 P1 / 4 P2 / PASS；该PASS只属于其exact bytes；
- [exact `a13fdbde` FABLE5 follow-up](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009003221) 经[reconciliation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009022397)为0 P0 / 0 P1 / 3 P2 / PASS。当前revision已改变该head，不能继承`a13fdbde`的PASS，仍须按当前merge gate取得new exact-head review；
- 2026-07-18 live `main`为`2a2c57113a4de65db7640f4b850e40b1d76faa35`；PR #342 merge base为`a61e3a855f3460f2166db08c64c0b9c4e7db340e`；remote head与本轮uncommitted diff base为`1a9467c672879448103304cef112005284986f59`。PR仍Draft，本working diff已改变remote-head bytes，任何旧head FABLE PASS都不可继承；
- 新exact head仍须按current workflows与`docs/runbooks/local-ci.md`完成full local workflow，并取得独立cross-family review且unresolved P0/P1=0。缺任一exact-head evidence不得请求Founder merge；Founder合并本spec也不授权Prisma/migration/code/data/production。

## 12. Ticket terminal 与后续边界

本文件创建、commit、push 或 Draft PR 打开都不代表 #339 完成。只有：

1. D1–D10 inventory、D9最小`ChannelScope`、D10 tracking truth/path policy与D8 deferral/expiry全部忠实落入本spec；未冻结implementation细节都有明确fail-closed/no-claim边界，tracking只停tracked-generation branch且不阻断social original-URL opt-out，不再被列为Founder产品blocker；
2. 本spec在new exact head完成full local workflow，并取得独立cross-family review且unresolved P0/P1=0；
3. Founder明确合并这张schema-authority alignment PR，批准本PR仍标为bounded physical proposal的Consent/STOP/DND/provider-refusal与minimum lineage合同；D1–D10行为/authority不再重呈，D8/D10 deferred implementation不因merge自动获批；
4. live `main`验证文件与批准head一致，并把durable evidence写回#339；

才可把 #339 的**合同冲突**判为闭合。是否解锁 #327/#328/#329 由 live GitHub dependency/Founder instruction决定，不能由本文件自动推断。

schema、migration、writer、backfill、continuity/full merge runtime、D5/reactive carrier、tracking infrastructure、privacy/retention、production reconcile与destructive cleanup仍是后续独立任务；每项重新取得task-linked claim、Founder authority和适用review/test gate。任何相关live send或Phase-1 CRM completion claim必须满足D8 expiry；任何tracking claim必须满足D10 path contract与truth边界。

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
- [#339 D1](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4992981271) · [D2](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993054049) · [D3](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993207403) · [D4](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4994091911) · [D5](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998535600) · [D6](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009216073) · [D7](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009411743)
- [#339 D8](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5009826812) · [D9](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010061305) · [D10](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-5010639846)
- [#339 full-spec FABLE5 result](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4993896369) · [PR evidence](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/342#issuecomment-4993893418)
- [#339 D5-scoped FABLE5 consultation](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339#issuecomment-4998494183)
- [#336 production Gate 10](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336#issuecomment-4992312427)
