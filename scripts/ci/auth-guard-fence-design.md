# Auth guard fence：双契约设计

`scripts/verify-auth-guards.mjs` 对每个可达敏感操作证明以下两种契约之一。敏感操作包括
Prisma/原始 SQL、队列发送，以及一层同 package 的敏感调用；无法静态解析的动态分派
仍然 fail closed。

## 1. ENTRY 契约

ENTRY 是身份从请求进入系统的边界。结构信号采用闭集：

- `app/api/` 下的 route；
- 文件顶层 directive prologue 含 `"use server"`；
- 文件名为 `*-gateway.ts(x)`。

ENTRY 的每一条敏感路径必须先把受信 resolver 返回的 principal（或其派生值）带入
敏感操作的参数树。仅引用、`void`、日志记录或在 resolver 调用上接 `.catch()` 都不算。
每个敏感操作都必须在自己的参数树中保留这条 principal 数据流；较早的 owner-scoped
操作不会给后续无关操作一张通行证。调用者传入 `ownerId` 不能替代 resolver，因此
ENTRY 不能申报 INTERNAL。受信 resolver 仍只按
「精确模块路径 + 精确 export」认定；本轮现场复核没有发现需要扩充的 resolver 模块，
当前集合仍为 `apps/web/lib/auth-guard.ts` 中的 `requireSession`、`requireRole`、
`requireAdmin`、`requireOwner`。本地 `resolvePrincipal` wrapper 会被解释执行，不按名字
直接放行。完整生产扫描中已独立分析的 ENTRY gateway 可作为薄 UI wrapper 的受信边界；
gateway 自身若无法证明 principal 作用域，仍会在自己的逐 export verdict 中失败。

动态 `import("@fikirtive/db")` 与 `require("@fikirtive/db")` 也进入同一 Prisma alias
跟踪。可静态绑定的 `prisma` 解构或 module identifier 正常分析；无法绑定的动态加载直接
`unprovable`，不能因为同文件有另一个 clean export 而消失。export 参数的默认值初始化器
在函数 body 之前分析，避免敏感调用藏在参数列表。

## 2. INTERNAL（parameterized-principal）契约

非 ENTRY 的 export 可按 export 独立证明 INTERNAL：

1. 签名携带 required principal；optional、默认值或可为 `null`/`undefined` 的参数不合格。
2. 每个敏感操作的参数树都引用该 owner 身份，可以直接引用，也可以引用由它派生且受
   control-flow 支配的 local。参数只是出现、记录日志，或敏感调用完全不用它，都会失败。
3. service/port factory 返回的方法也逐个展开检查。只有所有可达敏感 export 都满足契约，
   文件才没有 finding；混合文件按 export 分别得到 `PASS` 或 `INTERNAL-PASS`。

现场配置中的 scalar idiom 是 required `ownerId: string`。对象参数名包括
`principal`、`gate`、`owner`、`context`、`args`、`input`、`req`，但名字本身不授信；
对象必须有 required `ownerId`，或类型精确属于：

- `CanvasJobPlacementInput`
- `CustomerBroadcastPrincipal`
- `CustomerBroadcastReportPrincipal`
- `CustomerInboxPrincipal`
- `CustomerWorkflowPrincipal`
- `CustomerWorkflowWorkerContext`
- `DraftScheduledPostArgs`
- `MemberDirectoryPrincipal`
- `NormalizedInboundMessageInput`
- `OrchestrateArgs`

`CustomerWorkflowWorkerContext` 经本地 `requireWorker(context)` 派生 `ownerId`，是当前唯一
登记的 owner derivation idiom。配置项定义在 checker 顶部，新增形状必须先有现场证据。

## 3. 例外与输出

principal-less authority 只写入 `scripts/ci/auth-guard-exemptions.txt`。匹配键为精确
`path + export + reason`，每行必须写一条可读的 authority 理由；finding 消失后该行会
成为 `STALE` 并使 fence 失败。被审核的 principal-less export 在被其他模块调用时沿用
同一精确 ledger identity，避免在每个调用者重复豁免。

逐文件 verdict 为 `PASS`、`INTERNAL-PASS`、`EXEMPT` 或 `FINDING`。每个诊断以
`origin path + export + reason + implementation path + line` 去重，所以同一 export
同一 reason 的多个敏感 site 会全部保留。`FINDING` 与 `EXEMPT` 都打印实际
implementation 的 `file:line`；跨模块时同时打印 origin export。

## 4. Round 5：principal-derived query result（Rule A）

Round 4 的「每个敏感操作自己的 authority 参数树必须引用 principal」不变。Round 5
只补上可证明的数据流：一条 Prisma read 的 `where` 已引用 principal 时，该 read 的
result 才成为 `principal-derived`。从这个 result 取得的 property、destructure local、
连续 `const` alias，以及传入同文件 helper parameter 的值继续保留 taint；同文件/一层
package call 仍受既有深度限制。Round 7 已撤销早期对 `.map(...)` call result 的推断：
collection callback 的整体返回值不再自动带 taint。owner-scoped `create` 中由服务端生成的
`data.id` 也保留同一来源，供 transaction return、队列 payload 与后续状态更新使用。

result 本身不要求额外 null check：若后续操作直接用 `job.id`，来源已经由前一条
owner-scoped read 决定。另一个更窄的常见形状——先以 `{ id, ownerId }` 查到 row，
在成功分支继续使用原始 `id`——只有在 result 的 truthy 分支被控制流证明后才登记。

反洗白规则保持 fail closed：

- non-principal-scoped read 的 result 不带 taint；
- Prisma 的 derived taint只在 operation authority subtree 生效：read/update/delete 的
  `where`，create/createMany 的 `data`；
- `where: { id: attackerId }` 即使 `data` 或其他 sibling 引用 derived 值也不能放行；
- shorthand key 与普通 property assignment 使用同一判定。

因此 Rule A 是来源传播，不是「文件中曾经有一次 owner query」的全局通行证。

## 5. Round 5：staff/admin surface（Rule B）

现场复核 `apps/web/lib/auth-guard.ts` 后，唯一实际存在的 staff/admin resolver 是
operator-RBAC 的 `requireRole(section, action)`；本轮没有把不存在的 `requireAdmin`
加入 admin waiver 集合。认定仍要求从受信 auth-guard 模块进行精确 value import，
同名本地函数或其他模块的 export 不合格。

Rule B 按 export 判定，不按文件判定。只有 `requireRole` 支配该 export 的每一条敏感
路径，且返回值已被消费，才免除 per-operation principal-in-args；`"error" in gate`
的拒绝分支算有效消费，丢弃 resolver result 仍失败。通过 waiver 的 export 显示为
`ADMIN-PASS`，所以同一文件中 admin 与非 admin export 可以得到不同 verdict。这个
waiver只表达 staff/admin 操作本来就是跨 tenant/global，并不放松 Round 1 的 resolver
支配规则。

前瞻风险：`ADMIN_GUARD_EXPORTS` 目前会让任何成功消费 `requireRole(section, action)` 的
export 取得跨 tenant waiver，而不区分该 export 的层级；今天之所以可接受，是因为
`requireRole` 的外层仍由 founder staff allowlist 封住。若未来有 export 用它保护
tenant-facing（非 staff-console）操作，这个 waiver 会错误放行；reviewer 必须在新增
`requireRole` 调用点时确认其仍是 staff/admin surface，不能把租户操作带进该集合。

## 6. Round 5 收敛与人工 ledger

Round 4 基线为：

`PASS=36 INTERNAL-PASS=32 EXEMPT=11 FINDING=17`，共 97 个 finding、62 个 reviewed
exemption site。

Round 5 最终为：

`PASS=41 INTERNAL-PASS=31 ADMIN-PASS=2 EXEMPT=22 FINDING=0`，96 个 covered file，
0 个 finding、81 个 reviewed exemption site、0 个 stale entry。相对 Round 4：
`PASS +5`、`INTERNAL-PASS -1`、新增 `ADMIN-PASS +2`、`EXEMPT +11`、
`FINDING -17`；finding site `97 → 0`。

新增 ledger 共 10 个精确 `path + export + reason` identity，覆盖 19 个 site：

- 17 个 `unprovable` site：递归 retry/纯 `stableJson` recursion、Otto port factory
  超过一层分析深度，以及 nested nullish fallback read 与 truthy update 的关联限制；
- 1 个已审核 global authority site：`PostingTimeSeed` 是共享静态 craft seed，不是
  tenant data；
- 2 个 admin export/file verdict 由 Rule B 透明显示为 `ADMIN-PASS`，不进入 ledger；
- 1 个真正缺口：`softDeleteEntity(entityId)` 在 owner-scoped entity update 验证之前，
  先以客户端 `entityId` 执行 `shotEntityRef.count`。该项明确登记为 #458 append
  candidate；本轮没有修改 app code，也没有把它描述成安全路径。

## 7. Round 7：表达式传播必须 default deny

`principalExpressionKind` 的永久不变量是 **default deny**：只有明确建模了“该 AST 节点
的结果值来自哪个 operand”的形状才传播 principal taint；函数末尾必须是 `return null`。
禁止恢复“递归遍历所有 child，只要 subtree 某处出现 tainted name 就授信”的 fallback。
那个 fallback 会把“参数里出现过正确 owner”误当成“调用结果就是该 owner”，所以任何
新语法形状都会默认成为 false PASS。

唯一允许传播结果值的 node kind 是：

- `Identifier`：直接查当前 binding/object/derived 状态；
- `PropertyAccessExpression`、`ElementAccessExpression`：只从已带 provenance 的
  receiver 传播；principal object 只允许精确的 `.ownerId` / `["ownerId"]`；
- 值不变 wrapper：`ParenthesizedExpression`、`AsExpression`、
  `TypeAssertionExpression`、`NonNullExpression`、`SatisfiesExpression`；
- `AwaitExpression`：只传播其 operand；
- `ConditionalExpression`：两个结果 branch 都有 taint 才传播；
- `BinaryExpression`：仅 `||`、`??`、`&&`，且左右 operand 都有 taint才传播；
  comma、算术、拼接、比较和其他 operator 一律不传播。

所有其他表达式，包括普通 call、array/object literal、template literal、spread、
`new`、tagged template、arrow/function expression，一律返回 `null`。object literal
只会在 Prisma `where`/`data` 的 authority container 检查中逐 property 读取，不会
因此成为可任意复用的 tainted value。普通 call 也绝不能因某个 argument tainted 而
获得 taint。唯一例外是既有 bounded local/import call following：checker 实际分析
callee body，且每个正常 return 都证明同一 principal value 或 owner-scoped object；
throw/abrupt exit 不伪装成返回值。现场需要的两个窄模型是：

- 两个 branch 都 owner-neutral 的 conditional spread，或两个 branch 都带同一
  owner authority 的 conditional filter；
- checker 实际跟进的 local helper 返回 top-level `ownerId` object，且 ordered spread
  检查证明后面没有未知 override。

这些是 operation authority 的显式模型，不是 generic subtree taint。对应 positive
fixtures 是 `default-deny-allowlist.ts` 与 `modeled-owner-objects.ts`。

## 8. Round 7：object identity 与失效规则

principal-derived object 的 taint 属于对象 identity，不属于某个变量名。直接 whole-object
alias（例如 `const alias = job`）把所有名字连入同一个 alias group；callee parameter
若由 checker 实际跟进，也加入同一 group。以下任一事件会从当前位置起使整个 group
失效：

- 任一 alias 的 property/element 被直接、compound、`++`/`--` 或 `delete` 写入；
- object 被传给 checker 没有完整建模的任意 call，包括 `Object.assign`；
- object 被 spread/rebuild 进一个新 object/array，或以嵌套 carrier 逃逸。

失效会清除 group 中每个名字的 object、derived 和 operation-authority 状态，并从已分析
callee 传播回 caller。即使现场写入的是看似无害的 sibling property，也不能继续依赖
旧 taint；这是有意的保守边界。标量 `ownerId` 传给未知 validator 不按 object mutation
失效，但未知 call 的 return 仍是 default-deny `null`。空 derived collection 只有通过
显式循环和只接收 derived item 的 `.push()` 才保留集合 provenance；`.map()` 等普通
call 不传播整体结果。

Round 7 的六个 adversarial fixture 都因此失败：

- call-argument laundering：call result 不看 arguments；
- comma：非 allow-list binary operator；
- array + index：array literal 不传播；
- alias mutation：member write 失效整个 alias group；
- `Object.assign`：未知 call 的 object argument 失效；
- spread rebuild：新 object 不传播，且旧 object escape 后失效。

## 9. Round 7 收敛与人工 ledger

Round 6 基线为：

`PASS=41 INTERNAL-PASS=31 ADMIN-PASS=2 EXEMPT=22 FINDING=0`，96 个 covered file，
81 个 reviewed exemption site；fixtures 为 36 个 bypass fail、16 个 positive pass。

严格 default-deny 首次扫描暴露 221 个 site、23 个 finding file（101 个 export/reason
identity）。只加入上述有证明的窄模型后，仍有 78 个 site、13 个 finding file；没有
重新放宽 fallback。最终审计又确认“在敏感 call 内直接 spread”也必须立即失效；该次
收紧另暴露 63 个 site。现场已复核但静态不可证明的路径最终登记为 53 个精确
`path + export + diagnostic reason` identity，覆盖 107 个 Round 7 reviewed site。ledger
第三栏继续保存 checker 的精确失败原因以维持 exact-match/stale 检测；每条
justification 以 `Round 7 unprovable:` 明示人工处置及 analyzer limitation。

53 个新增 identity 的完整清单如下（同一 export 的 `missing` 与 `unused` 是两个精确
identity）：

- template/advisory-lock 或关联的 branch-merged id：
  `actions.ts#deleteProject`、`canvas-node-placement.ts#placeCanvasJobNode`、
  `canvas-node-placement.ts#tombstoneCanvasNode`、`cowork-actions.ts#coworkDeleteThread`、
  `customer-workflow-service.ts#workflowLifecycleService.createRoutineDraft`、
  `gen-actions.ts#startCanvasGen`、`#startCoworkGen`、`#startGen`、
  `otto-actions.ts#deleteCoworkThread`、`research-actions.ts#approveResearch`，
  以及 `storyboard-gate1-actions.ts` 的五个 export 各一条 `missing`；
- collection callback return：
  `actions.ts#saveShotPrompt`、`cowork-actions.ts#coworkVaryCard`、
  `schedule-actions.ts#updateScheduledPost`；
- prior-read / validated-id correlation：
  `actions.ts#getTranscript`，以及 `storyboard-gate1-actions.ts` 的五个 export
  各一条 `unused`；
- mutable owner filter：
  `customer-inbox-service.ts#createCustomerInboxService.listConversations`、
  `schedule-actions.ts#listScheduledPosts`；
- nested principal carrier：
  `customer-inbox-service.ts` 的 `assignConversation`、`takeOverConversation`、
  `handOffConversation`、`setConversationStatus`、`requestAutomationResume`；
- opaque scalar normalizer return：
  `customer-inbox-service.ts#createCustomerInboxService.writeNormalizedInbound`；
- injected worker resolver：
  `customer-workflow-service.ts` 的 `createWorkflowRun`、
  `evaluateWorkflowBusinessHours`、`dispatchWorkflowStep`；
- multi-factory Otto carrier：
  `otto-client-actions.ts#ottoApprove`；
- direct spread/rebuild 或 member-call object escape：
  `app/api/otto/stream/route.ts#POST`、
  `crm-identity.ts#findContactDuplicateSuggestions`、
  `customer-inbox-service.ts#createCustomerInboxService.writeNormalizedInbound`
  的额外 `missing` identity、`customer-workflow-service.ts` 的 `listRoutines`、
  `listRoutineRuns`、`getContactJourneyStates`、`listBusinessHoursPolicies`、
  `factory-batch.ts#orchestrateBatch`、`otto-actions.ts#ottoTurn`、
  `refgen-actions.ts` 的 `startRefGen`、`setBaseAsset`、`createVariant`、
  `regenerateVariant`、`deleteVariant`，以及 `renameVariant` 的 `unused` 与 `missing`
  两条 identity、`segment-actions.ts#buildSegment`。

把底层 `factory-batch.ts#orchestrateBatch` 与 `otto-actions.ts#ottoTurn` 登记后，相关
thin wrapper 不再重复产生 finding；一个原有的
`otto-client-actions.ts#ottoTurn:unprovable` ledger identity（4 个 site）因此变成
stale 并已删除，所以 reviewed site 的净增量是 `+103`。

最终扫描为：

`PASS=36 INTERNAL-PASS=26 ADMIN-PASS=2 EXEMPT=32 FINDING=0`，96 个 covered file，
0 个 finding、184 个 reviewed exemption site、0 个 stale entry。相对 Round 6：
`PASS -5`、`INTERNAL-PASS -5`、`ADMIN-PASS ±0`、`EXEMPT +10`、`FINDING ±0`，
reviewed site `81 → 184`。fixtures 为 42 个 bypass fail、18 个 positive pass。
