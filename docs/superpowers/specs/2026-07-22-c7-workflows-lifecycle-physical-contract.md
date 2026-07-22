# C7 Workflows / Lifecycle 物理合同

> **状态：docs-only PROPOSAL；等待 Founder 对规则文件/数据库表示、七个拟议载体、Routine 预授权方向与 E5-06/07 wiring 归属作决定。**
>
> 本文只冻结 C7（B0-40/47/48/49/98）的领域边界、O-09 规则文件形态、拟议物理载体、模拟era 执行合同、
> C4/C5/C6/consent/Otto 复用边界、exactly-once 与 fail-closed 验收。本文不修改 Prisma/schema/migration，
> 不建 provider adapter，不配置凭证，不调用 Meta，不发真实消息，不写真实回执，不花费，不碰 production/deploy，
> 也不把本地 Northstar mock 当实现。
>
> 证据基线：用户指定 live `main` `f2adffac090280d312fa242a051ff467de418b29`。当前编排 worktree 的本地
> `main` ref 落后该基线，不作 current truth。因本任务明确禁止 `gh` 与网络，issue #414 的 GitHub native dependency、
> open/closed、PR 与 hosted CI 状态均为 **Unknown**，不得补写成已解锁或绿色。
>
> 连续性与 authority：[#414](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/414) 是本票唯一 issue identity；
> live GitHub 内容本轮未查询，故不引用未核实 comment 作为授权。上位范围来自
> `docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md` §4/§8、
> `docs/ops/route-b/B0-CONTRACT.md`、B5/B7 matrix、`docs/BLUEPRINT.md` 宪法 4/6/7/10 与第六章、
> `docs/research/GRILL-VERDICTS-2026-07-03.md` 的 O-02/O-05/O-09 判决。邻接物理合同为 C5 与 C6；
> 它们及指定 main 上的实现事实只被复用，不被本文重写。

## §1 一句话结果

C7 把「一条可读规则如何获得有界 standing authority、如何为某联系人推进多步 journey、如何在崩溃/重试下只执行一次」
冻结成同一套 Workflow → Routine → RoutineRun → ContactJourneyState → WorkflowStepExecution 脊柱。人工与 Otto 编辑的是
同一份 O-09 **规则文件**，不是节点画布；收件箱 recipes 与营业时间自动回复只是这套脊柱的入口/具名原语，不建第二引擎。
C7 是 simulated-era product phase 的最后一柱；本 docs-only M0 只冻结该柱合同，不把「最后一柱已写 spec」冒充 Phase 完工。

任何 workflow 对顾客产生的动作都必须委托既有 C4 `submitConversationReply` 或 C5 `submitBroadcastRun`，并在执行点调用
**同一个** `packages/db/src/send-eligibility.ts` 四轴 evaluator；C7 不复制 consent/DND/provider-refusal/frequency policy，
不新增发送入口，不自己写 frequency，不自己写 receipt。Routine 是 standing authorization，但对自动发送仍以
`callerClass=unconfirmed_automatic` 求值：unknown/effective revoke 不因预授权而放行，DND/provider refusal/frequency 永不可绕。
模拟era 只编译、调度、推进状态并记录诚实的 simulated/unavailable 结果：零 provider、零真实外部效果、零真实 delivery truth、
零 credits 或 channel-fee spend。

## §2 Authority、范围与不做

### §2.1 C7 只承接五行

| B0 | 本合同承接 | 验收边界 |
|---|---|---|
| B0-40 | Customer Engagement Workflows / Inbox recipes；复用 B7 journey/routine 的动作与权限边界 | recipe 安装只生成同一 Workflow carriers；默认 disabled；对客动作走 C4/C5 + C5 四轴 |
| B0-47 | Routine/RoutineRun standing authorization：范围、预算、kill switch、事后摘要字段化 | **【须 Founder 过目后方可动工实现】**；scope/hash/budget/revocation 不可由 prompt 或 worker 自报 |
| B0-48 | O-09 rules/Workflow editor：可读规则文件 + 开关；Otto 与人工同一动作层 | 无节点画布、无任意脚本、无第二 runtime；source 编译为确定性 canonical artifact |
| B0-49 | per-contact 多步 journey 执行面 | revision pin、CAS、wait/due、终态与 step idempotency；不重复宣称 B0-60 的档案展示 |
| B0-98 | 营业时间自动回复具名原语 | IANA 时区 + weekly windows；缺事实 fail closed；触发的 reply 仍走 C4/C5 四轴、零 direct send |

`docs/design/route-b/2026-07-18-b8-full-map-crm-coverage.md` §4.1 的 Phase-1 CRM 原子总数仍是 28；C7 恰承接上述
5 个原子。本文不新增 B0 ID，也不把 B0-50/B0-99 或其它邻行带入。

### §2.2 明确不吸收

- **第二 app / 第二 workflow spine**：只有同一 FIKIRTIVE app、同一 C7 carrier 集与同一动作层。`inbox/recipes`、
  `automation/rules`、`automation/routines` 是三个入口，不是三个引擎。
- **节点画布 / 任意脚本**：规则域永久不做 drag-node canvas；不提供 JavaScript、SQL、AMPscript、模板求值器、任意网络请求、
  动态 import 或用户自建 agent。创作 Canvas 不受本文影响。
- **第二发送入口**：C7 不建 send/adapter/provider client；会话动作只能委托 C4 `submitConversationReply`，群发动作只能委托
  C5 `submitBroadcastRun`。两者当前真实路径均 `SEND_PATH_UNAVAILABLE`，本文不把它改成 available。
- **第二四轴/consent writer**：C7 只调用 C5 `evaluateSendEligibility`；consent/DND/refusal 的唯一 writer 仍是
  `packages/db/src/consent-runtime.ts`，frequency 的唯一 writer 仍是 C5 `recordSendFrequencyEvent`。
- **D8 / C6 载体**：`DeliveryManifest`、confirmation-outbox、provider-message binding、worker send、`ActionReceipt` 等归 D8；
  `MessageDeliveryEvent/State` 与报告真相归 C6。`WorkflowStepExecution` 不是它们的替身。
- **真实 provider / 外部效果**：WABA、Meta Tech Provider、Embedded Signup、webhook、credential、App Review、真实 send、
  真实 receipt、production migration/deploy 全在最终连接与上线阶段逐项另批。
- **钱路**：模拟era 的 C7 action set 只准 $0/internal 或 zero-effect simulation。任何未来会烧 credits、产生 channel fee、
  发起生成或其它 provider cost 的 step 都是 Founder-gated money path，必须 costing + `money-safety-review` + 对应账道 exactly-once；
  **不属于 M1–M3，也不因 Routine 预授权自动获准实现。**
- **E5-06/07 authority**：六张量测原语与 redirect 的数据 authority 始终归 B2；§9 只呈 wiring ownership 两方案，
  C7 不建第二 `AttributionEvent` 或短链表。
- **未批准 recipe/trigger/action**：本文不把 prototype 的欢迎、生日、弃单、N 天跟进等 mock 卡片升格为 Phase-1 catalog。

### §2.3 指定 main `f2adffac` 的当前事实

- C4b 六个 Inbox carriers 已存在：`CustomerConversation` / `CustomerMessage` / `CustomerConversationEvent` /
  `CustomerConversationDraft` / `CustomerMessageTemplate` / `CustomerMessageTemplateVersion`。`CustomerConversation` 有
  `automationState` 与 CAS `revision`；人工 takeover 会 append event 并暂停 Otto。`submitConversationReply` 是唯一会话
  chokepoint，但当前恒 `SEND_PATH_UNAVAILABLE`。
- C5 三个 carriers 已存在：`BroadcastRun` / `BroadcastAudienceMember` / `ContactSendFrequencyEvent`；
  `evaluateSendEligibility` 分立读取 consent-STOP/DND/provider-refusal/frequency；C5 模拟 executor 会执行前重读四轴，
  只在 `simulated_sent` transition 经 sole writer exactly-once 计频。真实 `submitBroadcastRun` 仍 unavailable。
- consent runtime 的五个 facts/projections 与 closed writers 已存在；C7 无权写它们。C6 `MessageDeliveryEvent/State`、
  reconciliation 与 report read surface 已存在；模拟发送的 delivery truth 仍为 `unknown`。
- Otto 新能力必须用 `defineOttoSkill`，身份从 context 注入，`cost/effect/reach` 缺项取最危险值，spend skill 必带幂等键。
  指定 main 尚无 C7 port/skill/registry entry。
- 指定 main **没有** production `WorkflowDefinition`、`WorkflowRevision`、`Routine`、`RoutineRun`、
  `ContactJourneyState`、`WorkflowStepExecution`、`BusinessHoursPolicy` model，也没有 C7 service、scheduler/worker 或真实
  `automation/rules` / `automation/routines` / `inbox/recipes` 页面。Northstar 对应页面与 client store 是 mock/stub，只作历史原型证据。
- B13 privacy 文档当前覆盖 consent 五 carrier、C4b 六 carrier、C6 两 carrier；未覆盖 C7 七个拟议 carriers，且 C5 三表的
  privacy 扩展也不是 C7 可代批的事项。

## §3 固定词义与核心不变量

### §3.1 固定词义

1. **Workflow definition（工作流定义）**：一个商家拥有的稳定规则对象；它只负责身份、来源与当前 revision 指针，
   不是授权、不是运行、不是发送。
2. **Workflow rule file（工作流规则文件）**：O-09 人工/ Otto 共同读写的可读 source；UI 把它呈成一份虚拟
   `.workflow.yaml` 文件。运行时真源是 DB 中 immutable revision + canonical compiled JSON + hash，**不是仓库文件**。
3. **Routine authorization（例程预授权）**：用户对一个 exact workflow revision、dependency manifest、范围、预算和摘要策略的
   immutable standing-authorization envelope；kill switch 随时收回。它是授权对象，不是 cron config，也不是 consent/send eligibility。
4. **Routine run（例程运行）**：一次确定 trigger occurrence 对 Routine 的执行记录；持有 frozen authorization hash、
   revision、状态、步骤游标与摘要，不扩大权限。
5. **Contact journey state（联系人旅程状态）**：一个 contact 在一个 pinned workflow revision 上的当前步骤/等待/终态；
   它不复制 Contact 档案、不保存 consent、不选择跨渠道身份。
6. **Workflow step execution（工作流步骤执行）**：先于 downstream action 落库的 exactly-once 步骤账；只记录 action hash、
   四轴快照、delegation ref 与本地结果。它不是 send job、outbox、provider receipt 或 delivery truth。
7. **Business-hours policy（营业时间策略）**：tenant-owned、IANA-timezone 的 weekly window primitive；只回答此刻 inside/outside/
   unavailable，外发仍归 C4/C5。

这些词随本文追加到根 `CONTEXT.md` 的「Customer engagement 顾客互动」段；旧 C4/C5/C6 词义不改。

### §3.2 核心不变量

- `ownerId` 只来自 authenticated session、verified server action 或 trusted worker context；规则文件、Otto 参数、浏览器、
  trigger payload、queue payload 都不能提交/覆盖。所有 relational FK tenant-qualified；JSON dependency refs 不是 FK，必须在 compile、
  authorize 与 dependent-step execution 各以 `(id,ownerId)` 重解并比 hash。七个新 model 出生即进 `TENANT_MODELS`。
- `workflowRevisionId`、`authorizationHash`、`purpose`、`callerClass`、exact contact identity、logical action key 都由 server
  resolve/derive。规则文件不得自称「已批准」「已 opt-in」「merchant_manual」「reactive」或「四轴已过」。
- **Workflow/Routine 不是 send authority**：任何 customer-facing step 在 dispatch 的同一受控事务边界重读 Routine、
  revision、kill switch 与 live C5 四轴；冻结/旧 PASS 只作审计，不授权发送。
- **自动始终是自动**：Routine 预授权不把后台 action 伪装成 `merchant_manual`。所有 workflow background send 以
  `unconfirmed_automatic` 求值；consent state `unknown/effective_revoke` 均 block，D5 two-confirm override 不向 C7 开放。指定 main
  的 C5 `reactive_service_reply` 会跳过 consent/frequency，故 C7 **不得使用该现有例外**；在 C5 sole evaluator 获批 strict workflow
  classification 前，B0-98 customer action 必须 unavailable，而不是在 C7 另写一套 consent check。
- **四轴永远四轴**：任何轴非 `pass`（含 `risk/unknown/unavailable`）即不 delegated；C7 不合成 suppression list，
  不以 recipe/routine/playbook 绕过 DND、provider refusal 或 frequency。
- **一入口、一 writer**：C4/C5 chokepoint、C5 evaluator/frequency writer、consent-runtime writer、C6 receipt writer 各自唯一；
  C7 只 orchestration/delegation。静态检查须证明 C7 无 provider import、无 consent/refusal/frequency direct create、无第二 send API。
- **规则确定性**：相同 source + exact dependency versions/hashes + compiler version 产相同 canonical JSON/hash；未知 key/type、
  无界循环、任意表达式或编译错误一律
  invalid + 不可发布，不能让 LLM 在 runtime 猜含义。
- **revision pin**：Routine、Run、journey 与 step 全部指 exact immutable WorkflowRevision；compiled dependency manifest 同时 pin exact
  business-hours policy revision/template version及其 hash。规则文本、scope、budget、dependency、schedule 或 compiler release 变化会
  产生新 hash；旧 authorization 不自动转移。
- **exactly-once 是 DB 合同**：先建 Run/Step 行再 dispatch；run、step 与 customer action 各有 stable semantic occurrence key，均
  **不含** authorization/policy revision 或 payload hash，另存 comparison hash；same-key/same-hash no-op，same-key/different-hash hard
  conflict。queue 的 at-least-once delivery 不得因重授权、改营业时间、跨 workflow replay 或改 action payload 变成重复 customer action。
- **kill switch fail closed**：每个 step 在 delegation 前于 transaction 内锁/重读 Routine；block 条件以 §5.2 的 canonical
  enumeration 为唯一清单；命中任一条件即该 step 记 blocked，零 downstream call。已到 provider 的 external effect 由 D8/C6
  reconcile，不伪装成可撤回。
- **模拟诚实**：M1–M3 无 provider/credential/webhook/spend；`simulated` 不是 sent/delivered/read。C6 delivery truth 仍 unknown。
- **missing = unavailable**：缺 rule revision、authorization、scope、budget rule、timezone、identity、C5 axis、queue lease、D8/C6
  dependency 都 fail closed，不拼 optimistic green。

## §4 O-09 规则文件合同（PROPOSED）

### §4.1 文件/DB 表示选择

**【设计选择，待 Founder 批准】** 商家看到、下载与编辑的是虚拟路径
`/workflows/<slug>.workflow.yaml`；它不是 Git/部署 filesystem 文件。保存时 shared action 把 source 存入
`WorkflowRevision.rulesSource`，用安全 YAML parser 校验后确定性编译为 `compiledRuleJson`，以 versioned canonicalization
生成 `contentHash`。DB revision 是 runtime 真源；YAML 是同一 revision 的 human-readable source，不另建 shadow truth。

选择理由：O-09 冻结的是「人看得懂、改得动的规则文件」，而租户 runtime 需要 DB tenant boundary、CAS、审计、revision pin 与
并发控制；把 merchant rule 放进 repo 会把 deploy 权与商家编辑权混在一起。YAML 只作受限声明格式，不获得脚本能力。

### §4.2 Phase-1 最小 envelope

```yaml
version: fikirtive-workflow/v1
name: Outside-hours reply
trigger:
  type: customer_message
conditions:
  - type: outside_business_hours
    policyRef: bhp_opaque
steps:
  - key: reply_once
    action:
      type: conversation_reply
      templateVersionRef: tmplv_opaque
  - key: finish
    action:
      type: complete
```

本 envelope 只冻结结构：`version/name/trigger/conditions/steps[].key/action`、opaque refs 与显式 step key。
**建议**的最小 trigger set 是 `manual / schedule / customer_message / journey_due`；最小 action set 是
`conversation_reply / broadcast_run / wait / complete`；condition 至少含 `outside_business_hours`。这些 closed sets 随本 M0
交 Founder 决定，未批准前仍是 proposal；不得从 mock catalog 补更多类型。`broadcast_run` 对 single-contact journey 的最终
delegation shape（one-member run 或后续 shared envelope）仍是 §14 Unknown，未决时 disabled。

安全解析要求：拒绝 duplicate keys、anchors/aliases、custom tags、merge keys、任意 expression、循环/递归、未登记版本、
超出大小/step 数上限与非 opaque ref；compiler 只产 closed typed JSON。rules source 不得包含 phone、token、credential、raw
provider payload；消息正文复用 `CustomerMessageTemplateVersion`，不在 C7 复制。compiler 在 tenant 内把 `policyRef`、
`templateVersionRef` 等 opaque source refs resolve 为 exact IDs/revisions/hashes，写入 immutable `dependencyManifestJson`；manifest hash
进入 revision `contentHash` 与 Routine authorization hash。entry 是 closed
`{kind,resourceId,resourceRevision?,contentHash}`，Phase-1 kind 只含 `business_hours_policy / customer_message_template_version`；不能
放 raw URL/phone/content。source ref 必须选 exact immutable policy row/template version，禁止 `latest/current` alias。compile、
publish/authorize 与每个使用该 dependency 的 step 都以 server-derived owner 重查 exact row/hash；
resolve 不到、跨 tenant、hash drift 或 dependency invalid 均 unavailable，绝不能只信 JSON。

### §4.3 revision / activation

- 每次有 material change 的 save 生成新 immutable `WorkflowRevision`；exact same-content/idempotent replay 返回既有 revision，
  不能 in-place 改旧 source/compiled artifact/hash。
- preview/validate 不授权执行；publish 只更新 `WorkflowDefinition.currentRevision` CAS 指针。
- 已 active Routine 仍 pin 旧 revision；要采用新 revision，必须重算 authorization hash 并重新明确批准，不能 silent upgrade。
- catalog upgrade 同理：只生成新 draft revision，不修改 tenant 的 active Routine。
- compiler version 不兼容时该 revision `unavailable`；必须 deterministic recompile + 新 hash + reauthorization，不能 runtime 猜。

### §4.4 editor switch 映射（PROPOSED）

B0-48 的人工「开关」不映射 `WorkflowDefinition.status`，也不直接写一个裸 Boolean：

- OFF 必须走同一 Routine shared action，立即 engage kill switch 并阻止新 Run/Step；历史不删；
- ARCHIVE 与 OFF 不同：`WorkflowDefinition` archive 前必须证明其所有 revisions 被 active Routine 引用数为 0；若仍有 N 条，
  acknowledgment step 必须逐条原样列出这些 Routine 的 `routineKey`/`id`，并逐字显示
  `Archiving does not stop these N active Routines`；human 必须对每条先 kill 或显式确认继续运行，archive 方可提交；archive
  本身不 kill/stop 任一 Routine；
- ON 若无 exact authorized Routine，必须打开四件套授权书，明确 human confirm 后才能 active；
- ON 若已有同 hash 的 paused Routine，是否可直接 resume 或须重新确认是 Founder gate；任何 revision/dependency/scope/budget drift
  一律不得 resume，必须创建新 authorization envelope；
- Otto 与人工看到同一状态。Otto 能否通过同一 authenticated action执行 fail-safe OFF/kill，留 §14 Founder 决定；
  Otto 永不能代签 ON/authorize/reauthorize/resume confirmation。

## §5 Routine / RoutineRun 授权模型（PROPOSED）

### §5.1 宪法边界

> **【须 Founder 过目后方可动工实现】**
>
> 本节细化 Blueprint 宪法 4 例外②：审批不是消失，而是在 Routine 创建/激活时发生。只有 exact revision + exact scope +
> exact budget + kill switch + summary policy 被明确确认后，重复执行才免逐次批准。本文批准、M0 合并、M1 schema 授权、
> UI toggle 或 Otto draft 都不能互相替代；Founder 未过目，本节所有 implementation 必须停。

Routine 的 `authorizationHash` 以 versioned canonicalization 覆盖：`ownerId`、`routineKey`、workflow definition/revision/contentHash、dependency hash、
`scopeJson`、per-run/monthly credit cap、expiry、summary policy 与 authorization revision。任何一项变化都必须新 hash + 新明确批准。
一次 human authorization 后，该 envelope 字段永久 immutable；重授权创建一行新 Routine，以 `supersedesRoutineId` 串起历史，并
pause/revoke 旧行，不 in-place 覆盖旧批准。Routine 不能授权规则文件之外的 action、不能扩 target/channel/contact scope、不能给
自己加预算、不能授权 money-in，不能代替 C5 四轴或 D8/C6 live-send gates。

### §5.2 scope、预算、kill、摘要

- `scopeJson` 是 closed schema，至少绑定允许的 action kinds、channel scopes、contact/segment boundary、max actions/recipients；
  exact vocabulary 与上限值由 Founder gate 决定。Unknown field = deny。
- channel/provider-connection identity binding 位于 `scopeJson` 的 channel-scope vocabulary 内，因此随 `scopeJson` 纳入
  `authorizationHash`；dispatch channel 或 provider connection 超出已授权 channel scope 时，必须产生新 hash并取得新的 human authorization。
- `maxCreditsPerRun` / `maxCreditsPerMonth` 是非负整数；`0` = 不允许 credit spend，不是 unlimited。模拟era 恒 0 且不接 ledger。
  真 spend 前须复用 Credit ledger reserve→settle/refund、scoped lock 与 money-safety；channel-fee 是独立账道，不能塞进 credits cap。
- **canonical fail-closed enumeration**：`killSwitchEngaged=true`、`status!=active`、expired、hash drift 或 budget unavailable 任一命中即
  block。kill 不删除历史。
- 每个 terminal RoutineRun 必须有 bounded `summaryJson` 或明确 `summary_unavailable` reason；摘要不能含 raw phone/message/provider
  payload。摘要是事后可见性，不是 receipt。
- `authorizationRevision` 在同一 `routineKey` 内由 transaction 单调分配；它是 immutable envelope 的序号，不是允许原地编辑的
  row revision。`status/kill/rowRevision` 可变，revision/scope/budget/dependency/summary/authorizer/authorizedAt 不可变。

### §5.3 调度与执行

schedule/event ingress 先以 server-derived **trigger occurrence key**（owner + Definition + stable routineKey + trigger kind + exact
occurrence ref）创建 RoutineRun，
再向共享 pg-boss worker dispatch；该 key
不含 authorization revision/hash 或 payload hash；这些另存为 comparison facts。故同一 occurrence 在重授权后 replay 仍撞同一行，
same key/different trigger/hash 只会 hard conflict，不会新跑。遵守 row-before-dispatch；scheduler tick 重复只得到同一 run。
worker claim 后在 transaction 中锁 Routine/Run，重验 authority；
每个 step 又独立重验 kill/hash/四轴。missed-run 的 skip/catch-up/coalesce 政策、lease/fencing 与具体 cadence grammar 尚未获批，
列 §14 Unknown；缺规则时不得自动补跑。

## §6 Journey、营业时间、recipes 与 exactly-once

### §6.1 per-contact journey

一个 enrollment 生成一行 `ContactJourneyState`，pin exact workflow revision/routine/contact；若 exact channel identity 未获 server
确定性解析，customer-facing step unavailable，绝不猜 phone/handle。`currentStepKey` + CAS `rowRevision` 控制推进；wait step 只写
`nextEligibleAt` 并递增一次 `waitGeneration`，due scheduler 以两项事实创建下一 RoutineRun。终态后是否允许 re-entry、版本迁移、
人工 pause/resume、merge/unmerge
联系人时如何处理均是 Founder product decision，未决 default deny/paused，不偷偷选择。

人接管 C4 conversation 时，既有 `paused_by_human` 是硬事实：与该 conversation 相关的 C7 action 立即 block；恢复必须走既有
explicit resume action 和重新验 authority，不可由 timer 自动恢复。

### §6.2 营业时间自动回复 primitive

`BusinessHoursPolicy` 只持 IANA timezone 与 canonical weekly windows。窗口以当地星期 + minute-of-day 表示，`start` inclusive、
`end` exclusive；overnight 必须在 canonicalization 时拆成两段；同日窗口排序且不可 overlap。IANA timezone 库负责 DST；不得把
UTC offset 当永久 timezone。缺/非法 timezone、当天无可解释 schedule、clock unavailable 或 revision mismatch →
`business_hours_unavailable`，零自动回复。

自动回复只可锚定 verified **customer inbound** `CustomerMessage.sourceEventKey`；merchant outbound/self echo 不能开/续 service
window，也不能触发 reply loop。reply occurrence key = owner + conversation + inbound source event + channel +
`business_hours_auto_reply`，并作为 `actionIdempotencyKey`；它刻意不含 policy/workflow/authorization revision。那些版本/hash 另存
comparison facts，故同一 inbound
在配置或重授权后 replay 只能 no-op 或 conflict，不能第二次回复。

指定 main 的 C5 evaluator 对 `reactive_service_reply` 直接把 consent/frequency 两轴判 pass；这与本票「workflow 不绕 consent/频控」
更严格的边界不相容，所以 C7 不得自报或使用该 purpose。B0-98 customer action 要等 C5 owner + Founder 批准一个仍要求 verified
consent 与 frequency 的 closed strict-workflow classification，并在**同一个** evaluator 内实现；此前 Step=`unavailable`、零 C4 call。
若内容夹带 proactive element 或窗口不成立，也必须 server-side 分类，绝不能借 reactive 名称绕 gate。

B0-98 本身不决定 holidays/special closure/跨午夜编辑 UX、locale fallback 或 away-template catalog；这些是 §14 Unknown。Phase-1
若 Founder 不批准 exception 模型，就只支持 weekly windows，并在 UI 明示，不伪装支持节假日。

### §6.3 Inbox recipes

**【设计选择】** 不建 `InboxRecipe` 表。server-owned、versioned `INBOX_RECIPE_CATALOG` config 保存 recipe metadata/template；
tenant 点击安装后只生成 `WorkflowDefinition(originKind=inbox_recipe)` + immutable revision + **disabled** Routine draft。B0-98 是 catalog
里唯一由现有 atom 具名保证的 primitive；其它 recipe key/list 仍 Unknown。catalog entry 至少含：

| 字段 | 合同 |
|---|---|
| `recipeKey` | server-owned stable key；不可复用 |
| `catalogVersion` | immutable release version |
| `displayName/description` | UI English sentence case；不含执行 authority |
| `ruleTemplateSource` | 受 §4 parser/compiler 同约束 |
| `parameterSchemaVersion` | closed input schema；Unknown/default deny |
| `templateHash` | versioned canonical hash；升级不 silent apply |
| `defaultEnabled` | 恒 `false`；安装不等于授权/启用 |

人工 recipe UI 与 Otto 只调用同一 workflow shared actions；Otto 可起草/解释/提交 approval request，不可替用户激活 Routine。

### §6.4 step exactly-once 与 recovery

1. 在任何 downstream call 前 insert `WorkflowStepExecution(status=reserved)`；step semantic key 吸收重复 worker/tick；customer-facing
   action 另有可跨 run 去重的 `actionIdempotencyKey`。
2. 同 step/action key + 同 `actionPayloadHash` = 返回现有行并继续 reconcile；任一同 key + 不同 hash =
   `IDEMPOTENCY_CONFLICT`，零第二 action/零 call。
3. customer-facing step 在 delegation 前重读 live C5 四轴；任一非 pass 写 `blocked` + stable reason，零 C4/C5 call。
4. C4 path 必须在其**同一个** `submitConversationReply` 补 stable logical action key/模拟 seam 后才可用；C5 path 把同一个
   `actionIdempotencyKey` 传给 `BroadcastRun.creationIdempotencyKey`。当前缺口下写 `unavailable`，不得由 C7 直写
   message/frequency 补洞。
5. crash after delegation before settle：retry 仍用同 key并从 downstream ref/事实 reconcile；不换 key、不盲重投。真实 provider
   reached 状态最终由 D8/C6 收敛，C7 不猜。
6. `simulated` step 只说明本地模拟分支完成；若 C5 模拟 broadcast 真正进入 `simulated_sent`，frequency 仍只由 C5 sole writer 计数；
   C7 不写 counter。模拟 conversation reply 不写 `CustomerMessage` 冒充顾客已收到。

## §7 拟议物理合同（M1 preview；全部 PROPOSED）

### §7.1 总览

七个 owner-scoped additive carriers 沿用 C4b/C5/C6 house pattern：`ownerId` 无默认、Organization back-relation、tenant-qualified
composite FK、closed taxonomy String + code validator、historical refs `onDelete: Restrict`、stable unique/index、必要 partial unique
用 raw SQL + drift test、全部加入 `TENANT_MODELS`。

| Carrier | 唯一职责 | 不是 |
|---|---|---|
| `WorkflowDefinition` | stable workflow identity/origin/current revision pointer | rule content、Routine、send authority |
| `WorkflowRevision` | immutable readable source + compiled artifact/hash | mutable script、runtime guess、approval |
| `Routine` | exact standing authorization + kill switch | cron-only config、consent、send eligibility |
| `RoutineRun` | one trigger occurrence/run cursor/summary | provider job、receipt、ledger authority |
| `ContactJourneyState` | per-contact pinned current journey state | Contact shadow、consent state、audience list |
| `WorkflowStepExecution` | row-before-dispatch step idempotency/recovery ledger | outbox、send job、ActionReceipt、delivery truth |
| `BusinessHoursPolicy` | IANA timezone + weekly-window primitive | scheduler、template library、send entry |

### §7.2 `WorkflowDefinition`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org；FK `Organization.id`，`onDelete: Restrict` |
| `slug` | tenant-local stable path segment；normalized server-side；archive 前不可复用 |
| `name` | bounded merchant-visible name；不是 execution prompt |
| `definitionKind` | code-validated `rule / journey` |
| `originKind` | code-validated `custom / inbox_recipe` |
| `recipeKey / recipeCatalogVersion` | nullable；origin=recipe 时 required，引用 server config，不是 tenant authority |
| `currentRevision` | nullable integer；publish 后指本 definition 的 exact revision；draft 可 null |
| `rowRevision` | monotonic CAS；pointer/status mutation +1 |
| `status` | code-validated `draft / published / archived`；执行开关在 Routine，不复制；archive 必须满足 §4.4 active-Routine 盘点/确认门 |
| `createdByMembershipId` | tenant-qualified FK `(id, ownerId) → Membership(id, orgId)` |
| `archivedAt` | nullable；archive 不删除 history |
| `createdAt / updatedAt` | row lifecycle |

约束：`UNIQUE(id, ownerId)`；live partial unique `(ownerId, slug) WHERE archivedAt IS NULL`；`currentRevision` 非 null 时 composite FK
`(ownerId,id,currentRevision) → WorkflowRevision(ownerId,workflowDefinitionId,revision)`；index `(ownerId,status,updatedAt,id)`。

### §7.3 `WorkflowRevision`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `workflowDefinitionId` | tenant-qualified FK `(workflowDefinitionId,ownerId) → WorkflowDefinition(id,ownerId)` |
| `revision` | definition 内从 1 单调递增；transaction/lock 分配 |
| `formatVersion` | 当前 proposal=`fikirtive-workflow/v1`；closed validator |
| `rulesSource` | bounded UTF-8 YAML source；不含 raw PII/provider secret |
| `compiledRuleJson` | deterministic closed typed artifact；runtime 只读它 |
| `dependencyManifestJson / dependencyHash` | exact tenant-resolved policy revision/template version/其它 approved refs + hashes；immutable、无 raw content |
| `compilerVersion` | exact compiler release；不可写 `latest` |
| `contentHash` | source canonicalization + compiled artifact + dependencyHash + compiler version 的 versioned hash |
| `validationState` | code-validated `valid / invalid / unavailable` |
| `validationErrorsJson` | bounded stable codes + source locations；无 raw customer data |
| `createdByMembershipId` | tenant-qualified author FK |
| `createdAt` | immutable revision time；无 `updatedAt/deletedAt` |

约束：`UNIQUE(id,ownerId)`；供下游 composite FK 的 candidate key
`UNIQUE(id,ownerId,workflowDefinitionId)`；`UNIQUE(ownerId,workflowDefinitionId,revision)`；
`UNIQUE(ownerId,workflowDefinitionId,contentHash)` 使同内容 save replay 不重复；index
`(ownerId,workflowDefinitionId,revision,id)`。source/content/compiled/dependency/hash immutable；pointer rollback 只改 Definition CAS，
不改 revision。

### §7.4 `Routine` — **【须 Founder 过目后方可动工实现】**

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `workflowDefinitionId` | tenant-qualified FK to Definition |
| `workflowRevisionId` | composite FK `(workflowRevisionId,ownerId,workflowDefinitionId) → WorkflowRevision(id,ownerId,workflowDefinitionId)` |
| `routineKey` | Definition 内 server-issued stable logical automation identity；重授权换 row 但沿用，绝不复用给另一 automation |
| `supersedesRoutineId` | nullable composite self-FK；指同 owner/routineKey/definition 的上一个 immutable authorization envelope |
| `status` | code-validated `draft / active / paused / revoked / expired` |
| `scopeJson` | closed canonical authorization scope；Unknown field deny |
| `scopeHash` | versioned canonical hash of scope |
| `maxCreditsPerRun / maxCreditsPerMonth` | non-null Int `>=0`；0=no credit spend；绝无 null/unlimited 语义 |
| `summaryPolicyJson` | required closed policy，至少声明 after-each-run visibility destination；不是 receipt |
| `authorizationRevision` | routineKey 内 transaction 分配的 monotonic immutable envelope 序号；重授权建新 Routine row |
| `authorizationHash` | §5.1 exact canonical hash；active 时 required |
| `authorizedByMembershipId / authorizedAt` | nullable until explicit human authorization；tenant-qualified member FK |
| `expiresAt` | nullable explicit expiry；null 的产品允许条件仍须 Founder 决定 |
| `killSwitchEngaged` | non-null Boolean；true 即所有新 step fail closed |
| `killedByMembershipId / killedAt / killReasonCode` | nullable kill facts；reason 为稳定 code、无正文 |
| `rowRevision` | monotonic CAS；授权前 draft mutation，授权后只容许 status/kill mutation |
| `createdByMembershipId` | tenant-qualified creator FK；creator 不自动等于 authorizer |
| `createdAt / updatedAt` | row lifecycle |

约束：`UNIQUE(id,ownerId)`；candidate keys `UNIQUE(id,ownerId,workflowDefinitionId)`、
`UNIQUE(id,ownerId,workflowRevisionId)`、`UNIQUE(id,ownerId,routineKey,workflowDefinitionId)`、
`UNIQUE(id,ownerId,workflowDefinitionId,workflowRevisionId)` 与
`UNIQUE(id,ownerId,routineKey,workflowDefinitionId,workflowRevisionId)`；为 Run 冻结 proof 再建 candidate key
`UNIQUE(id,ownerId,routineKey,workflowDefinitionId,workflowRevisionId,authorizationRevision,authorizationHash)`；
`UNIQUE(ownerId,workflowDefinitionId,routineKey,authorizationRevision)`；`supersedesRoutineId`
以 `(supersedesRoutineId,ownerId,routineKey,workflowDefinitionId) → Routine(id,ownerId,routineKey,workflowDefinitionId)` composite bind，
index `(ownerId,status,expiresAt,id)`；index `(ownerId,workflowDefinitionId,status,id)`。partial unique 必须保证同一 `routineKey`
同时最多一个 `active` envelope；一个 Definition 是否可有多个不同 `routineKey` active，随 Founder 决定。
DB/check validator 禁负预算、active 却缺 authorization fields、engaged kill 却仍新建 Run；authorized envelope fields 用
DB trigger/closed writer 防 update。任何预算 reserve 实现另过 money gate。

### §7.5 `RoutineRun`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated/trusted worker Org |
| `routineId` | tenant-qualified FK `(routineId,ownerId) → Routine(id,ownerId)` |
| `routineKey` | frozen logical automation identity；跨 reauthorization envelope 不变 |
| `workflowDefinitionId` | frozen Definition identity |
| `workflowRevisionId` | tenant-qualified pinned Revision；须等于 Routine 授权 revision |
| `contactJourneyStateId` | nullable tenant-qualified FK；per-contact journey run 时 required |
| `triggerKind` | code-validated proposal `manual / schedule / customer_message / journey_due` |
| `triggerOccurrenceRef` | non-null server-derived stable occurrence identity；按下方 kind mapping，绝不含 authorization/payload hash |
| `triggerEventRef` | nullable opaque verified source ref；customer_message 时 required；不含 raw payload |
| `scheduledFor` | nullable `Timestamptz(6)` canonical occurrence；schedule trigger required |
| `runIdempotencyKey` | server-derived key：owner+Definition+routineKey+triggerKind+triggerOccurrenceRef；不含 Routine row/auth/payload hash |
| `triggerPayloadHash` | versioned canonical hash of trusted trigger envelope；不含 raw payload；同 semantic key 漂移时 hard conflict |
| `authorizationRevision` | frozen Routine envelope revision；与 snapshot/hash 一起证明本 run 起点 authority |
| `authorizationHash` | start-time frozen hash；每 step 对 live Routine 重验 |
| `authorizationSnapshotJson` | bounded canonical frozen envelope（exact revision/dependency/scope/budgets/expiry/summary）；无 raw customer data |
| `status` | code-validated `queued / running / waiting / completed / blocked / cancelled / failed` |
| `currentStepKey` | nullable exact rule step key |
| `rowRevision` | monotonic CAS；claim/step/status mutation +1 |
| `simulated` | M1–M3 恒 true；真实 external action 全 disabled |
| `reservedCredits / settledCredits` | non-null Int，模拟era恒 0；只作摘要，不是 ledger authority |
| `creditReservationRef` | nullable opaque ledger ref；真实 spend gate 前永远 null |
| `summaryJson` | bounded normalized summary；无 raw phone/message/provider payload |
| `blockReason / errorCode` | nullable stable code；不写 raw exception/PII |
| `startedAt / finishedAt / createdAt / updatedAt` | server times；`finishedAt` 仅 terminal |

约束：`UNIQUE(id,ownerId)`；供下游/反向 pin 的 candidate keys
`UNIQUE(id,ownerId,workflowRevisionId)`、`UNIQUE(id,ownerId,contactJourneyStateId)`、
`UNIQUE(id,ownerId,workflowRevisionId,contactJourneyStateId)`；`UNIQUE(ownerId,runIdempotencyKey)`；
composite FK
`(routineId,ownerId,routineKey,workflowDefinitionId,workflowRevisionId,authorizationRevision,authorizationHash) →
Routine(id,ownerId,routineKey,workflowDefinitionId,workflowRevisionId,authorizationRevision,authorizationHash)`；
closed writer/DB trigger 另断言 canonical `authorizationSnapshotJson` hash 恰等于 `authorizationHash`；journey run 再以
`(contactJourneyStateId,ownerId,routineId,workflowRevisionId) → ContactJourneyState(id,ownerId,routineId,workflowRevisionId)` 绑定；
index `(ownerId,routineId,status,createdAt,id)` 与 `(ownerId,status,scheduledFor,id)`。same occurrence key + different trigger payload 或
authorization envelope = conflict；worker 不得 UPDATE 已 terminal run 重跑。

`triggerOccurrenceRef` closed mapping/conditional checks：`manual=manual:<server action operation id>`；
`schedule=schedule:<canonical UTC scheduledFor>`；`customer_message=message:<verified CustomerMessage.sourceEventKey>`；
`journey_due=journey:<ContactJourneyState.id>:<waitGeneration>:<nextEligibleAt>`。manual operation id 来自 shared action idempotency，
schedule 必有 `scheduledFor`，customer_message 必有 verified `triggerEventRef`，journey_due 必有 journey FK/waitGeneration/due instant；
多余或缺失组合 invalid。由此重授权换 Routine row 不会换 occurrence identity。

### §7.6 `ContactJourneyState`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `contactId` | tenant-qualified FK `(contactId,ownerId) → Contact(id,ownerId)` |
| `contactIdentityId` | nullable；若 pinned，triple FK `(id,contactId,ownerId)` 保证 exact identity 属该 contact |
| `workflowDefinitionId / workflowRevisionId` | composite FK to Revision 的 exact definition；revision 不 silent migrate |
| `routineId` | 与 workflowRevisionId 一起 composite FK to Routine；该 journey 的 exact standing authority |
| `enrollmentIdempotencyKey` | server-derived from owner+definition+contact+verified trigger/enrollment occurrence |
| `status` | code-validated `active / waiting / paused / completed / exited / blocked / failed` |
| `currentStepKey` | nullable；必须存在于 pinned compiled rule |
| `nextEligibleAt` | nullable `Timestamptz(6)`；waiting 时 required |
| `waitGeneration` | non-null monotonic integer；每次进入新的 wait +1，作为 journey_due occurrence identity；retry 不加 |
| `stateJson` | bounded closed engine state；opaque refs/stable codes only，不存 Contact shadow/consent |
| `lastRoutineRunId` | nullable tenant-qualified FK；只作 cursor/ref |
| `rowRevision` | monotonic CAS；每 transition +1 |
| `enrolledAt / terminalAt / createdAt / updatedAt` | truth timestamps；terminalAt 只用于 terminal state |

约束：`UNIQUE(id,ownerId)`；candidate keys `UNIQUE(id,ownerId,workflowRevisionId)` 与
`UNIQUE(id,ownerId,routineId,workflowRevisionId)`；`UNIQUE(ownerId,enrollmentIdempotencyKey)`；
`(workflowRevisionId,ownerId,workflowDefinitionId) → WorkflowRevision(id,ownerId,workflowDefinitionId)`，
`(routineId,ownerId,workflowRevisionId) → Routine(id,ownerId,workflowRevisionId)`；`lastRoutineRunId` 以
`(lastRoutineRunId,ownerId,id) → RoutineRun(id,ownerId,contactJourneyStateId)` 保证 run 属本 journey。建议 partial unique
`(ownerId,workflowDefinitionId,contactId) WHERE status IN (active,waiting,paused)`，是否允许并行同定义 enrollment 由 Founder 决定；
index `(ownerId,status,nextEligibleAt,id)` 与 `(ownerId,contactId,updatedAt,id)`。

### §7.7 `WorkflowStepExecution`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated/trusted worker Org |
| `routineRunId` | tenant-qualified FK to RoutineRun |
| `contactJourneyStateId` | nullable tenant-qualified FK；per-contact step required |
| `workflowRevisionId` | tenant-qualified pinned Revision |
| `contactId / contactIdentityId` | customer-facing 时 required；triple tenant/contact identity bind；internal step 为 null |
| `channel / providerConnectionId` | customer-facing 时 frozen server-resolved closed channel + nullable tenant-qualified ChannelConnection ref |
| `stepKey` | exact closed step key from compiled artifact |
| `actionKind` | code-validated proposal `conversation_reply / broadcast_run / wait / complete` |
| `actionPayloadHash` | versioned canonical action hash；不存 message正文 |
| `stepIdempotencyKey` | server-derived semantic key：owner+run+journey/none+stepKey；刻意不含 payload hash，才能检测同 key 漂移 |
| `actionIdempotencyKey` | customer-facing 时 required server-derived semantic occurrence key；exact closed mapping 见下；可跨 run 去重 |
| `status` | code-validated `reserved / blocked / simulated / delegated / unavailable / failed` |
| `purpose / callerClass` | customer-facing 时 required frozen server-derived C5 closed values；caller 恒 `unconfirmed_automatic` |
| `eligibilityInputHash` | exact owner/target/channel/connection/purpose/caller inputs 的 versioned hash；不可由 rule/client 提交 |
| `eligibilityVerdictJson / eligibilityVerdictHash` | nullable；customer-facing action 时 required；四轴分立快照，仅审计 |
| `downstreamKind` | code-validated `none / conversation_reply / broadcast_run` |
| `downstreamRef` | nullable opaque C4/C5 action ref；不是 provider ref/receipt |
| `simulated` | M1–M3 恒 true；`simulated` 不等于 delivered |
| `reasonCode / errorCode` | nullable stable code；无 raw PII/exception |
| `reservedAt / delegatedAt / settledAt / createdAt / updatedAt` | server canonical times |

`actionIdempotencyKey` closed mapping/conditional checks：
`journey_step=ownerId+workflowDefinitionId+contactJourneyStateId+stepKey`；
`scheduled_routine=ownerId+workflowDefinitionId+routineKey+schedule+canonical UTC scheduledFor+stepKey`；B0-98 的 customer-inbound 专用 case
继续使用 §6.2 已冻结的
`business_hours_auto_reply=ownerId+conversationId+CustomerMessage.sourceEventKey+channel+business_hours_auto_reply`。
三式都不含 Routine row、authorization revision/hash、workflow/policy revision 或 action payload hash；`actionPayloadHash`、
`eligibilityInputHash` 与 verdict hash 继续作为 key 外的 comparison facts。journey case 必有 exact journey FK，scheduled case 必有
`triggerKind=schedule` 与 canonical `scheduledFor`。

【澄清 2026-07-22,M2 施工裁决】customer-facing 执行在 target 绑定前即被阻断时，其 occurrence key 必须从上述适用的 §7.7 家族派生；customer-message 缺失的 conversationId/channel 分量使用固定 sentinel `target:none`，manual occurrence 则用 `ownerId+workflowDefinitionId+routineKey+manual triggerOccurrenceRef+stepKey+target:none`。

约束：`UNIQUE(id,ownerId)`；`UNIQUE(ownerId,stepIdempotencyKey)`；customer-facing partial unique
`(ownerId,actionIdempotencyKey) WHERE actionIdempotencyKey IS NOT NULL`；
`(routineRunId,ownerId,workflowRevisionId) → RoutineRun(id,ownerId,workflowRevisionId)`；journey step 另以
`(routineRunId,ownerId,workflowRevisionId,contactJourneyStateId) → RoutineRun(id,ownerId,workflowRevisionId,contactJourneyStateId)` 与
`(contactJourneyStateId,ownerId,workflowRevisionId) → ContactJourneyState(id,ownerId,workflowRevisionId)` 双重绑定；contact identity 用
`(contactId,ownerId) → Contact(id,ownerId)` 及
`(contactIdentityId,contactId,ownerId,channel) → ContactIdentity(id,contactId,ownerId,channel)`；non-null connection 用
`(providerConnectionId,ownerId,channel) → ChannelConnection(id,ownerId,kind)`。M1 因此须在既有 `ContactIdentity` 与
`ChannelConnection` 分别 additive 增加安全 candidate key `UNIQUE(id,contactId,ownerId,channel)` 与 `UNIQUE(id,ownerId,kind)`；
两者均以已 unique id 为前缀，不改变 live identity/connection uniqueness 语义。建议 partial unique
`(ownerId,downstreamKind,downstreamRef) WHERE downstreamRef IS NOT NULL`；index `(ownerId,routineRunId,status,id)` 与
`(ownerId,contactJourneyStateId,createdAt,id)`。reserved row 与 downstream call 遵 §6.4；不得存 provider receipt/lifecycle。

### §7.8 `BusinessHoursPolicy`

| 字段 | 合同 |
|---|---|
| `id` | server-issued stable sortable ID |
| `ownerId` | authenticated Org |
| `policyKey` | tenant-local stable policy identity；同一 policy 的 revisions 共用，不可复用 |
| `revision` | policyKey 内 transaction 分配、从 1 单调递增的 immutable content revision |
| `supersedesPolicyId` | nullable composite self-FK，指同 owner/policyKey 的上一 revision |
| `name` | bounded merchant-visible revision name |
| `timeZone` | required canonical IANA zone；fixed offset 禁止 |
| `weeklyWindowsJson` | closed array：ISO weekday 1–7 + sorted non-overlap `{startMinute,endMinute}`；start<end |
| `status` | code-validated `draft / published / archived`；execution enable 在 Routine，不复制；archive gate 见下 |
| `rowRevision` | monotonic CAS，仅 status/archive mutation +1；不是 content revision |
| `contentHash` | timezone+canonical windows 的 versioned hash；不含 reply template |
| `createdByMembershipId` | tenant-qualified author FK |
| `archivedAt / createdAt / updatedAt` | row lifecycle；archive 不删 run history，也不 stop active Routine |

BusinessHoursPolicy archive mirror §4.4：archive exact policy revision 前，必须证明 pinned WorkflowRevision dependency manifest
引用它的 active Routine 为 0；若仍有 N 条，acknowledgment step 必须逐条原样列出这些 Routine 的 `routineKey`/`id`，并逐字显示
`Archiving does not stop these N active Routines`；human 必须对每条先 kill 或显式确认继续运行，archive 方可提交；archive 本身不
kill/stop 任一 Routine。

约束：`UNIQUE(id,ownerId)`；candidate key `UNIQUE(id,ownerId,policyKey)`；
`UNIQUE(ownerId,policyKey,revision)`；`UNIQUE(ownerId,policyKey,contentHash)` 吸收 exact-content replay；`supersedesPolicyId` 以
`(supersedesPolicyId,ownerId,policyKey) → BusinessHoursPolicy(id,ownerId,policyKey)` 绑定。published 后 `timeZone`、
`weeklyWindowsJson`、`contentHash`、`policyKey`、`revision` immutable；编辑会 insert 新 revision。index
`(ownerId,policyKey,revision,id)` 与
`(ownerId,status,updatedAt,id)`。WorkflowRevision dependency manifest pin exact policy id/revision/contentHash；reply template 只在 rule
action 的 exact `CustomerMessageTemplateVersion` ref，故没有第二 template truth。缺 pinned policy/template 或非法 local-time mapping →
unavailable/零 reply。holidays/exceptions 未批准，M1 不预埋假字段。

### §7.9 为什么不新增其它表

- 不建 `InboxRecipe`：catalog 是 server config，tenant install 落同一 Workflow carriers（§6.3）。
- 不建 `WorkflowSend/WorkflowReceipt/WorkflowOutbox`：发送/外部效果/回执分别归 C4/C5、D8、C6。
- 不建 suppression/consent/frequency 表：复用 C5 evaluator + consent-runtime + C5 frequency event。
- 不建 rule file filesystem store：DB revision 是租户 runtime 真源，虚拟文件只是人工面。
- 不建 journey member list：`ContactJourneyState` 是 per-contact state，Segment/audience authority 仍归 CRM/C5。
- 不建 attribution 表：E5-06/07 authority 仍是 B2（§9）。

## §8 Shared action wiring 与 fail-closed matrix

### §8.1 唯一 workflow service seam

人工 UI、Otto skills、scheduler 与 worker 只能调用一个 C7 shared service（暂名 `workflowLifecycleService`）做 definition/revision、
Routine、Run、journey 与 step mutation；Otto port 只注入该 service，skill 内不得 import Prisma/C4/C5/provider。所有 C7 skill 都由
`defineOttoSkill` 声明；read skill free/read/internal，draft mutation free/write/internal。activate/authorize/reauthorize/resume
confirmation 明确 human-only，不得被普通 Otto skill 代签；kill 本身是 fail-safe mutation，
Otto 是否可经同一 authenticated shared action执行由 §14 Founder gate 决定，未决时 default deny。Parity Manifest 同时登记 human
action ↔ Otto read/draft action与获批的 kill parity；明确的 human-only approval 不伪装成债。

customer action dispatch：

1. server resolve owner/member/Routine/revision/contact/exact identity；
2. row lock + kill/hash/scope/budget recheck；
3. create/replay StepExecution reserved row；
4. derive/freeze real target/channel/provider scope/purpose/callerClass + input hash；调用 shared C5 evaluator，要求四轴全 pass；
5. conversation → C4 `submitConversationReply`；broadcast → C5 `submitBroadcastRun`；
6. downstream stable key/ref settle到 StepExecution；真实结果只由 D8/C6 收敛。

在 C4 尚无 idempotent simulated reply seam、C5 真实 submit unavailable、D8/C6 live gates 未齐时，受影响 step 必须
`unavailable`；不能直写 `CustomerMessage`、`BroadcastAudienceMember` 或 provider adapter 补洞。

### §8.2 fail-closed matrix

| Surface | C7 可定义/保存 | 必须 disabled / 不得声称 | 最终 owner |
|---|---|---|---|
| rules editor/compiler | readable source、compiled JSON、hash、revision | node canvas、arbitrary code、runtime LLM 猜规则 | C7 |
| Routine authorization | exact scope/budget/hash/kill/summary facts | implicit approval、unlimited、Otto self-authorize、旧 hash 复用 | C7 + human gate |
| scheduler/run/journey | idempotent run、CAS state、wait/due、summary | missing schedule 自动补跑、跨 tenant、并行重复推进 | C7 |
| workflow step ledger | row-before-dispatch、action hash、四轴快照、downstream ref | send/outbox/receipt/delivery status | C7（orchestration only） |
| consent/DND/refusal | 只读 C5 axis | C7 write/clear/grant、合并 suppression list | consent-runtime 写 / C5 读 |
| frequency | 读 C5 axis；delegation 后由现有 send layer计数 | C7 direct counter write、playbook bypass | C5 |
| conversation action | 委托同一 C4 chokepoint | second reply API、direct CustomerMessage 假发出 | C4 + C5 gates |
| broadcast action | 委托同一 C5 chokepoint | one-member shape 未决时自造 sender、direct adapter | C5 |
| external effect / receipt | 只存 opaque downstream ref；模拟标识 | sent/delivered/read、fake receipt、blind retry | D8 / C6 |
| business-hours reply | inside/outside/unavailable + verified inbound ref | self-trigger loop、固定 UTC offset、missing→outside | C7 primitive / C4 send |
| attribution | 依 §9 选择只 wiring 到 B2 facts | second AttributionEvent/redirect authority | B2 |
| spend/channel fee | 模拟era恒 0/null | credits/channel fee/provider cost | Credit ledger / channel-fee ledger + money gate |

## §9 E5-06/07 attribution wiring ownership — 两方案，中立待 Founder

数据 authority 已知且不因选择改变：E5-06 六原语与 `AttributionEvent`、E5-07 redirect 属 B2；C6 只消费报告事实；C7 只可能
拥有「哪个 workflow/run/step ref 传给 B2 writer」的 wiring。以下两项互斥，本文**不推荐、不预选**：

| 方案 | 归属 | 好处 | 代价 / 风险 | 若选中何时到期 |
|---|---|---|---|---|
| **A — 折进 C7** | C7 M2/M3 同站把 `workflow/run/step` stable refs 接到既有 B2 writer/read surface；B2 仍唯一事实 owner | journey 从触发到 action/attribution 一票闭环；少一次跨票 wiring；M3 可同步验收 | 扩大最后一柱 scope；强依赖 E5 privacy/redirect/D10 gate；C7 engine 与 reporting 同时受阻；审查面更大 | M2 engine 前 Founder 选 A，并先闭合 B2 writer/privacy/redirect prerequisites |
| **B — 独立小 station** | C7 只冻结 stable refs；另开 bounded attribution-wiring station 接 B2/C6 | C7 schema/engine/UI 更小、边界清楚；E5 风险独立复审；C7 无需等待 redirect | 多一站与一次授权；在小站完成前 workflow attribution 必须显示 unavailable；端到端闭环较晚 | C7 M3 前或后由 Founder 排期；未完成不得宣称 attribution complete |

两方案共同硬线：不建第二 attribution table；`AttributionEvent.idempotencyKey` 继续由 B2 exactly-once；source/step refs 只用 opaque
ID/hash，不塞 rule/message/phone；未选择前 UI/报告显示 `attribution_unavailable`，不得补零或猜归因。

## §10 Privacy、security 与 retention gate

### §10.1 诚实分类

- `ContactJourneyState` 直接引用 Contact，`WorkflowStepExecution` 可引用 journey/contact action，`RoutineRun` 可由 customer event
  触发；三者是 **PII-adjacent execution metadata**。
- `WorkflowDefinition/Revision`、`Routine`、`BusinessHoursPolicy` 主要是 merchant-owned business/config data，但会引用
  Membership、template、segment/channel/contact scope，source/summary 若失控也可含个人数据；不能因「配置」而跳过 privacy gate。
- C7 表禁止 raw phone/name/message/provider payload/token/signature。message content 复用 C4 template；trigger、downstream、receipt
  只存 opaque ref；reason/error/validation 只存 stable code/安全 source location。
- 指定 main 的现有 B13 scoped rows **不覆盖这七表**。C5 三表的未闭 privacy 也不由 C7 代办。

### §10.2 M1 前必须逐 carrier 冻结

B13/privacy matrix 必须给七表逐行冻结：source/data class、merchant ownership、authorized reader/writer、tenant RBAC/support/impersonation、
export/delete/DSAR、retention/terminal compaction、backup/replica expiry、at-rest/TLS/key scope、log/error/telemetry redaction。
当前仅提出边界，不填政策：

- rules source/summary 的保留期、archive 后处置、Contact 删除/merge 对 journey/run/step 的处理均 Unknown；
- `onDelete: Restrict` 是防误删 proposal，不等于 retention 决定；
- platform-managed at-rest encryption + TLS 可作为现有候选，不声称 C7 已获 privacy 批准；
- production backup/PITR 实际 cadence、support access 与 tenant capability matrix 均 Unknown/default deny。

Founder 批准 §4/§7 的 schema direction 也**不等于** B13 rows 通过；缺逐表 privacy gate，M1 migration 不得开始。

**2026-07-22 更新（#416）**：七表 B13 rows 与 retention 方向已依 Founder Resolution
（[#416 issuecomment-5044757427](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/416#issuecomment-5044757427)）
冻结，落地于 `docs/superpowers/specs/2026-07-19-b13-privacy-carrier-gate.md` §2（本 PR 新增七行）。冻结随本 PR
生效——本 PR **OPEN，尚未合并**；M1 schema/migration 仍须等待本 PR 合并后，schema PR 才依「本 PR 合并顺序」
开动，本条不构成本 PR 合并前的 M1 授权。

## §11 M-station、activation 与 rollback 提案

每一站**另取 Founder 授权**；本任务没有可核实的「多站一次性授权」。

### M0 — physical contract（本票）

- Founder 过目并决定本文核心方向，尤其 §4 file/DB、§5 Routine 与 §7 七载体；
- 单独选择 §9 A/B；M1 前批准七表 B13 rows 与 schema/migration issue；
- 重新 live query main/dependencies/claim/worktree/PR/CI；本轮 Unknown 不可沿用为已验。

### M1 — additive storage only（另取 schema/migration 授权）

- additive migration 建七表、composite FK/unique/index/partial unique、Organization back-relations、`TENANT_MODELS`、code validators、
  migration drift/rollback/static coverage；
- 只为 Step 的 channel bind 在既有 `ContactIdentity` / `ChannelConnection` additive 加 §7.7 两个 candidate keys；不改现有列、writer、
  identity/connection uniqueness 或 send behavior；
- 不开 parser/compiler/service/queue/route/skill/UI/send；所有 Routine inactive，表为空；
- **验收**：tenant-qualified relations、每条 Definition→Revision→Routine→Run→Journey→Step composite pin、immutable authorization/policy/
  workflow revision、occurrence key 与 comparison hash 分离、negative budget/check constraints、
  migrate deploy/rollback/generate；零第二 send/outbox/receipt/attribution/consent/frequency 表。

### M2 — compiler + engine + shared-action simulation（另取 engine 授权）

- 安全 parser/compiler、revision publish、Routine draft/explicit authorize/kill、row-before-dispatch scheduler/worker、Run/journey/step engine；
- Otto read/draft skills 全用 `defineOttoSkill` + injected C7 port + Parity Manifest；activate authorization 人工 gate；
- C5 evaluator wiring；B0-98 还须 C5 owner批准 strict workflow classification（不得复用 current reactive consent/frequency 例外）；
  C4/C5 single chokepoint 只在其 owner contract允许的 simulated seam工作。缺 classification/seam 一律 unavailable；
- fake clock/queue/DB fixtures 验 deterministic compile、DST/boundary、CAS、double tick、crash recovery、kill race、四轴 hard block；
- **不做**：任何真实 provider/webhook/send/receipt、D8 carrier、credits/channel-fee spend、production、未选 E5 wiring。

### M3 — rules/routines/recipes/journey UI（另取 UI 授权）

- `automation/rules` 文件编辑器（非节点 canvas）、`automation/routines` 授权书/kill/run history/summary、`inbox/recipes` catalog/install、
  contact journey read surface 与 B0-98 business-hours config；同一 carriers/actions；
- rules switch 严格映射 §4.4 Routine kill/authorization flow；不能以 Definition publish 或 client Boolean 伪装启用；
- loading/empty/invalid/unavailable/paused/killed/stale/conflict/partial-error/error/ready，desktop/mobile，coral Otto action reflection；
- Founder 认证走查；benchmark evidence 按 §13 补齐；
- **不做**：真实外部效果、真实 delivery 绿灯、花费、隐式 recipe enable、node canvas。

### A-station — E5 attribution wiring（方案依 §9，另取授权）

- 选 A：并入 M2/M3 acceptance；选 B：另开小站；
- 两者都只把 stable workflow refs 接既有 B2 writer/read/C6 report，不改 B2 authority；
- E5 privacy、redirect domain/dedupe/report contract 未闭前保持 unavailable。

### M4 — final connection / real external effects（另取每项 authorization）

- 只有 C4/C5 real chokepoint、D8 manifest/outbox/provider binding、C6 receipt/reconcile、provider connection/capability、B13、
  exact money/channel-fee gate 全部获批实现验证后，C7 才可委托真实 action；
- 每次真实 action 仍重读 Routine + exact revision + live C5 四轴；automatic caller class 不变；
- provider/credential/App Review/production migration/deploy/real spend 各自 Founder-only，不由 M0-M3 推导。

Rollback：M1–M3 关闭 feature flag/engage kill，保留 definitions/runs/journey/step facts；drop migration 属 destructive，另批。
规则 revision 回滚只移动 current pointer并要求 reauthorize，不 in-place 改历史。M4 后先 disable delegation，keep-forward D8/C6 external
truth 并 reconcile；绝不删事实后重投。任何 tenant/idempotency/privacy/authority 不明，只停 affected path并留稳定 reason。

## §12 Acceptance 与 adversarial tests

### §12.1 schema/domain（M1）

- 七表 `ownerId` coverage、每 relation tenant-qualified、`TENANT_MODELS` 命中；所有 unique/index/check/partial unique 与 raw SQL drift test；
- WorkflowRevision source/compiled/dependency/hash immutable；Definition pointer composite bind exact own revision；逐条 composite FK 证明
  Routine 的 definition+revision、Run 的 Routine envelope、Journey 的 Routine+revision、Step 的 Run+journey+revision、lastRun 的反向归属
  均不串；Routine authorized envelope 与 published BusinessHoursPolicy content 不可原地改；
- Run authorization revision/hash composite bind exact Routine row，snapshot 重算同 hash；Step contact identity channel 与 non-null
  ChannelConnection kind 都由 DB composite bind；
- static no-new-table 断言：无 InboxRecipe/send/outbox/receipt/suppression/attribution shadow；C4b/C5/C6/consent schema 零偷改。

### §12.2 compiler/revision/tenant（M2）

- same source+dependencies+compiler → same canonical JSON/hash；duplicate key/alias/tag/script/unknown type/oversize invalid，零 publish/run；
- policy/template ref 在 tenant 内 resolve 成 exact dependency manifest；改营业时间或 template 生成新 dependency/content hash + reauthorize，
  旧 Routine/Run 不 silent adopt；compile/authorize/step 每次按 `(id,ownerId)` 重解并比 hash；BusinessHoursPolicy 不持第二 template truth；
- old Routine pin old revision；publish new revision 不迁 active run/journey；content/scope/compiler drift 使旧 hash block；
- 两 Org 互换 definition/revision/routine/run/contact/identity/journey/step/policy IDs → uniform not-found/denied，零泄漏、零 downstream call；
- rule/client/Otto 自报 owner/purpose/callerClass/eligibility/authorization ignored/rejected，server-derived 值生效。

### §12.3 Routine authority / exactly-once（M2）

- draft/paused/revoked/expired/killed/missing hash/missing scope/budget unavailable 各一 → zero run/step dispatch；
- double scheduler tick/event replay 同 run key → exactly one RoutineRun；same key/different semantic hash → conflict/零第二行；
- manual/schedule/customer_message/journey_due 各有 required occurrence ref；缺/多余组合 invalid；journey wait retry 不增
  `waitGeneration`，新 wait 才 +1；
- 同一 trigger occurrence 在 Routine reauthorization 后 replay 仍撞原 key；不会因新 Routine row/hash 多跑一次；Routine 历史 envelope
  即使从未产生 Run 也可重建，已有 Run 冻结 authorization revision/snapshot/hash；
- double worker/step retry → exactly one StepExecution；crash before dispatch 可安全 resume；crash after delegation 重用同 downstream key，
  不盲重投；
- kill 与 worker 并发：delegation transaction 重读后，kill 先提交则零 call；外部 effect 已提交则不伪称撤销，交 D8/C6 reconcile；
- per-run/monthly budget 两并发争最后额度时恰一 reserve；此测试只在 money path获批后到期，模拟era 断言恒 0/null/零 ledger call；
- terminal Run 不重开；每个 terminal 有 bounded summary 或 explicit unavailable reason。

### §12.4 journey / business-hours（M2/M3）

- enrollment replay 零重复；CAS 冲突零双推进；wait 只在 exact `nextEligibleAt` due 后建一个 run；终态不自动 re-enter；
- exact identity missing/mismatch/cross-owner → unavailable、零 send；Contact shadow/consent 不进 journey state；
- IANA timezone + DST forward/backward、weekday boundary、start inclusive/end exclusive、overnight canonical split；缺/非法 timezone/schedule
  绝不被当 outside 后自动回复；
- same inbound provider fact 在 policy/workflow/reauthorization change 后 replay 仍 at most one reply occurrence；merchant outbound/self echo
  不触发；current C5 `reactive_service_reply` 例外对 C7 hard-disabled；strict workflow classification 未获批/实现即 unavailable，不能借
  reactive 绕 consent/frequency；
- human takeover 后 related automation block，timer 不自恢复。

### §12.5 four-axis / shared action / simulation（M2/M3）

- workflow background caller 恒 `unconfirmed_automatic`：verified grant 才可 proactive candidate；unknown/effective revoke block；
  D5 two-confirm 不可用于 C7；DND/provider refusal/frequency 任一 block 永不被 Routine/recipe override；
- eligibility risk/unknown/unavailable 任一 → Step blocked、零 C4/C5 call；execution 前改变 consent/DND/refusal/frequency 使旧快照失效；
- 每个 customer-facing Step 冻结 target identity、channel/connection、purpose、`unconfirmed_automatic` caller、input hash 与四轴分立
  verdict；rule/client/Otto 不可提交这些 authority inputs；
- static reachable-path proof：conversation only C4 `submitConversationReply`，broadcast only C5 `submitBroadcastRun`；C7 无 provider import、
  无 direct CustomerMessage/BroadcastAudienceMember/frequency/consent/refusal write；
- 模拟 broadcast 的 frequency 只由 C5 exactly once 计；模拟 conversation 不造 outbound message/receipt；C6 lifecycle remains unknown；
- 0 provider call、0 external effect、0 spend、0 假 receipt、0 跨租户、0 未批准/重复 send、0 STOP 绕过。

### §12.6 UI / Otto parity（M3）

- 人工可完整查看/编辑/validate/publish rule、查看 Routine 授权四件套、kill、run summary、journey state、business hours；
- editor switch OFF 经 shared action engage kill；ON 无 exact authority 时打开 human authorization，不直改 client flag；resume/kill Otto
  parity 按 Founder 决定的 closed capability 验收；
- WorkflowDefinition/BusinessHoursPolicy archive 在 active Routine 引用为 0 时可直接提交；N>0 时确认面逐条原样列出
  `routineKey`/`id` 并逐字显示 `Archiving does not stop these N active Routines`，且每条先 kill 或显式确认继续运行后方可 archive；
  archive 本身不改变 Routine active/kill 状态；
- Otto read/draft 使用同 action，不直 DB；身份参数在 schema 中被 `defineOttoSkill` 拒绝；Otto 不能 activate/authorize/代 human confirm；
- rules page 无 node/edge/canvas builder；recipe install default disabled；catalog upgrade 不 silent apply；
- loading/empty/invalid/unavailable/paused/killed/stale/conflict/partial-error/error/ready desktop/mobile snapshot+interaction；界面秒级反映 kill/run state。

### §12.7 attribution（选 A 或 B 后）

- stable workflow/run/step ref 同 key replay 在 B2 只产生一个 AttributionEvent；cross-owner/ref mismatch 零写；
- 未 wiring 时报告显示 unavailable，不补 0；C7 无第二 attribution table/writer；C6 只读消费，不回写 C7。

## §13 Benchmark、六级状态与 evidence contract

### §13.1 benchmark 诚实缺口

Blueprint 点名 Klaviyo、HubSpot Workflows、Salesforce Journey Builder 为生命周期标杆，并已决定 FIKIRTIVE 的差异化是
WhatsApp-first + readable rule files，不复制节点画布。本 M0 因禁网且未登录任何 workspace，**未做**这些产品的当日 docs/desktop/
mobile 实机走查，不捏造 URL、版本或通过阈值证据。M3 前须在 issue 中补：同任务 journey（recipe install→edit→authorize→run→
pause/kill→history）并排证据、版本/日期、desktop/mobile、Founder 认证走查；O-09 的「非节点画布」是既定边界，不因竞品有 canvas 而重开。

### §13.2 状态

| B0 | 指定 main 当前 | 本 docs-only patch 合并后 | 后续到期 |
|---|---|---|---|
| B0-40 | `listed / absent` | 仍 `listed / absent` | M1 carriers + M2 engine/shared actions + M3 recipes UI + benchmark |
| B0-47 | `listed / absent` | 仍 `listed / absent` | Founder 过目 authorization + M1/M2/M3 + budget/kill/summary adversarial tests |
| B0-48 | `listed / absent` | 仍 `listed / absent` | safe compiler + rules editor + Otto parity，零 node canvas |
| B0-49 | `listed / absent` | 仍 `listed / absent` | per-contact state + multi-step engine/UI + CAS/idempotency/recovery |
| B0-98 | `listed / absent` | 仍 `listed / absent` | business-hours policy + verified inbound simulation + timezone/loop tests |

`B0-CONTRACT.md` 把 `spec-ready` 绑定冻结 spec + benchmark anchor。本文尚待 Founder direction、§9 A/B 与 M3 benchmark，故不预支
升级；mock、schema、unit test、PR ready/merge 都不能单独升级。后续每个 exact head 按 current workflow +
`docs/runbooks/local-ci.md` 复现适用 jobs；CI unavailable 不是 green；独立跨族复审 unresolved P0=0/P1=0 方可进入允许的 merge gate。

## §14 Gates、Unknowns 与当前决定

### §14.1 后续 Founder-only gates（本文均不授权）

| 动作 | 何时单独问 |
|---|---|
| **Routine/RoutineRun authorization model 全节**（scope、预算、kill、summary、expiry、authorizer） | **任何 §5/§7.4/§7.5 implementation 前；【须 Founder 过目后方可动工实现】** |
| rule source=`.workflow.yaml` + DB canonical artifact、compiler envelope/closed types | M1 schema 与 M2 compiler 前 |
| 七 carrier schema/migration/DB apply、partial unique/check 方向 | M1 首次动作前 |
| 七 carrier B13 rows、retention/export/delete/encryption/backup/support access | M1 migration 前 |
| C7 tenant RBAC/capability matrix（read/draft/publish/authorize/kill） | 任一 mutation/UI/skill 启用前；Unknown/default deny |
| scheduler/queue/lease/reaper/missed-run policy | M2 queue/worker 前 |
| C4 idempotent simulated reply seam、C5 workflow broadcast delegation shape | M2 customer-facing simulation 前；缺即 unavailable |
| C5 strict workflow purpose/classification（B0-98 仍要求 verified consent + frequency） | M2 B0-98 simulation 前；current `reactive_service_reply` 例外不得复用 |
| rules editor ON/OFF→Routine authorize/kill/resume exact mapping；Otto kill parity | M3 mutation/skill 前；未决时 ON/kill Otto 均 default deny |
| E5-06/07 方案 A 或 B + B2 writer/redirect/privacy gates | M2 wiring 前；未选即 attribution unavailable |
| D8 manifest/outbox/provider binding/ActionReceipt 与 C6 live ingestion | 任何真实 customer action 前 |
| credits spend、generation、channel fee、costing/pricing/账道、`money-safety-review` | 任一可能花费的 workflow action 设计/实现/验证前；模拟era OUT |
| provider/WABA/credential/Embedded Signup/App Review/webhook/真实 send | 每个真实外界动作前 |
| production migration/backfill/reconcile/deploy/cleanup | 每个 production/destructive 动作前 |
| **M1 / M2 / M3 / A-station / M4** | **逐站另取 Founder 授权；无一次性授权推定** |
| CI-unavailable merge | merge 前；本地复现不替代 Founder 明示批准 |

**七 carrier B13 rows 现状（2026-07-22）**：上表「七 carrier B13 rows、retention/export/delete/encryption/
backup/support access」一行已依 Founder Resolution
（[#416](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/416#issuecomment-5044757427)）冻结，落地于
`docs/superpowers/specs/2026-07-19-b13-privacy-carrier-gate.md` §2。本 PR **OPEN，尚未合并**——冻结在本 PR
合并前不生效；schema/migration 仍受上表「七 carrier schema/migration/DB apply、partial unique/check 方向 |
M1 首次动作前」一行门控，schema PR 须在本 PR 合并之后按合并顺序另开，本条不构成 M1 授权。

### §14.2 当前 Unknown（不偷偷填）

- issue #414 live dependency unlock、GitHub open/PR/current-head CI 状态；本轮禁网，均 Unknown；
- rule format最终是否接受本提案 YAML、文件大小/step 数、exact trigger/action/condition closed sets、compiler release/rollback；
- Routine exact authorizer/RBAC、scope vocabulary、per-run/monthly credit 数值、expiry/null 允许、renew/revoke、一个 definition 可否多 active；
- Routine resume 是否需重新确认、Otto 是否可执行 fail-safe kill、C5 strict workflow purpose 的 exact name/axis semantics；
- channel-fee budget 的独立单位/上限/账道接法；不得混进 credits；
- scheduler cadence grammar、DST missed-run 的 skip/catch-up/coalesce、lease/fencing/reaper 时限；
- journey concurrent enrollment、re-entry、version migration、manual pause/resume、Contact merge/unmerge/archive、identity repin 语义；
- business-hours holidays/exceptions/special closure/locale/template fallback、无 schedule 的产品展示；
- Inbox recipe catalog 除 B0-98 外的 exact keys、参数、升级/定制政策；
- single-contact proactive action 应使用 one-member `BroadcastRun` 还是未来由 C5 冻结的 shared envelope；未决时 disabled；
- E5-06/07 wiring A/B、event taxonomy/key、redirect activation 与 privacy；
- 七 carrier retention/export/delete/terminal compaction、production backup/PITR cadence；
- real provider/credential/legal/capability、D8/C6 live readiness、credits/channel fee cost、production/deploy facts。

### §14.3 当前只向 Founder 呈核心方向题

> **是否批准 C7 的核心 physical direction：以 DB 持久化 immutable `WorkflowRevision` 为 runtime 真源、以虚拟
> `.workflow.yaml` 作为 O-09 人工/Otto 共同编辑面；新增七个 tenant-qualified additive carriers（Definition/Revision、
> Routine/Run、ContactJourneyState、WorkflowStepExecution、BusinessHoursPolicy）；所有 customer-facing workflow step
> 只委托既有 C4/C5 chokepoint并重读同一 C5 四轴；Routine 以 exact scope/budget/kill/summary + authorization hash 作 standing
> authorization；模拟era 零 provider、零外部效果、零 spend、C6 delivery truth 仍 unknown？**
>
> 若核心方向批准，§9 的 E5 wiring **仍须 Founder 另选 A 或 B，本文不预判**。批准仅允许本 docs-only contract 经适用 review/CI
> 后进入合并流程，并允许下一张 M1 issue 以这套 shape 准备 schema/migration 申请；不授权任何 Prisma/migration、Routine 实现、
> queue/worker、UI/skill、B13/RBAC、attribution wiring、D8/C6、provider、credential、send、receipt、spend、production、deploy 或
> CI-unavailable merge。

建议：**批准核心方向；E5 A/B 保持中立另决。** 核心方案把 O-09 的人话规则面、宪法 4 例外②的 standing authority、
per-contact journey 与 exactly-once 恢复落成一条可审计脊柱，同时把 consent/frequency/send/receipt/money 各自留给既有唯一 owner；
因此不会用「自动化」名义私拉第二发送、电闸或账道。
