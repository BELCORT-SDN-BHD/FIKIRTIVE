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

## 10. Round 8：callback boundary 的 caller-state 失效

传给 checker 无法完整跟进之 call 的 inline function/arrow callback，仍以 caller state
的 clone 分析 callback 内部；Round 8 另外保留 callback 的全部正常/abrupt exit state。
callback 中 property/element/compound write、`++`/`--`、`delete` 或未知 mutating call
一旦使 captured principal alias group 失效，call boundary 会在分析 caller 后续语句前，
把 `invalidatedPrincipalAliases` 合并回 caller continuation。合并只传播失效，不传播
callback return taint，也不把普通 call result 洗成 principal-derived。

内层未知 callback 先把失效合并到外层 callback state，所以一层 nested callback 会继续
传回原 caller；`.then()` 与 collection callbacks 使用同一规则。checker 实际跟进的
local/import helper 仍由 `invokeFunction` 在 callee exit → caller base 的既有 merge
传播失效；`$transaction` inline callback 则在 transaction boundary 显式做同一 merge。

## 11. Round 8：immutable const owner spread

object spread 只对以下全部成立的 binding 保留 owner authority：

1. binding 由 `const` 声明；
2. initializer 是 object literal，且每个 value 只能是 literal、principal scalar 或
   principal-derived scalar；
3. enclosing analyzed function 内没有 reassignment、property/element write、
   compound write、`++`/`--` 或 `delete`；
4. binding 没有 whole-object alias/return/call escape，也没有作为 member-call receiver，
   包括 nested callback 内的这些事件。

资格在 declaration 处登记到 flow state；静态证明采用更窄的充分条件：该 binding 的
每一个后续 reference 都必须是精确 object spread `...binding`。因此任何 alias、
property read/write、call/return、array spread 或 callback mutation 都自动失格。spread
只保护该精确 identifier；任一条件失败仍走 Round 7 invalidate-on-spread。普通 unknown
call 与 nested carrier 没有取得新豁免。另一个独立窄模型只认零参数
scalar-property `.trim()` 为 read-only；
它不失效 parent object，但 call return 仍是 default-deny。`.push()`、`.set()` 与其他
未列 member call 继续失效 parent alias group。

## 12. Round 8 收敛与 ledger

fixture 收敛为 46 个 bypass fail、20 个 positive pass：新增 `.forEach()`、`.then()`、
一层 nested callback、traced local callback 与 mutating member-call red coverage，以及
immutable `OWNED` spread 和 read-only property `.trim()` green coverage。

ledger identity 从 80 降为 72（净减 8）。删除 10 个 stale identity：8 个 immutable
spread、`refgen-actions.ts#renameVariant:missing` 的 callback-boundary identity，以及
`crm-identity.ts#findContactDuplicateSuggestions:missing` 的 read-only member-call
identity。移除底层 `otto-actions.ts#ottoTurn:unused` 后，薄 server-action wrapper 会消耗
one-module budget，故新增 2 个精确且已审核的
`otto-client-actions.ts#ottoTurn` wrapper identity（`unprovable`、`missing`）；direct
`ottoTurn` 本身已由 full-tree 分析证明。

最终扫描为：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。

## 13. Round 9：named callback 与不可解析 callback

untraced call 的 callback argument 不再只认 inline function/arrow。identifier 若解析到
当前 module 内未 reassignment 的 function declaration 或 function-like initializer，
checker 会用 caller state 分析同一函数体，并把 callback exit 的 alias invalidation
合并回 caller。identifier 经已跟进 local wrapper 传入 function parameter 时，callback
target 也随 parameter mapping 传递，所以 wrapper 内的 `.forEach(callback)` 不会丢失
原 callback body。

以下 target 不冒充可分析：imported mutator、function-typed/明确 callback 形状的 parameter、
factory call return，以及被 reassignment 的 function binding。在 untraced callback
boundary，checker 对这些形状 fail closed：使当前 state 中所有 tainted binding 失效。
普通 data identifier 不因 `unknown`/`any` type 自动被当成 callback；只有 function type、
callback/mutator 等明确 binding 形状，或 `.map()`/`.forEach()`/`.then()` 等 callback
consumer 才进入这条 default-deny 路径。全局 `Boolean`/`Number`/`String` 是窄的已建模
pure callback；同名 local/import binding 会先被 lexical resolution 截获，不能借此
allowlist 洗白。named recursive callback 由独立 recursion stack 截断重复展开；外层
callback body 仍完整分析，避免无限递归和 state 爆炸。

factory fixture 另外锁住既有 escape 规则：`makeCallback(job)` 若 factory call 本身无法
跟进，`job` 作为 argument 在 factory boundary 已失效；后续 callback 使用不能恢复 taint。

## 14. Round 9：Prisma boolean combinator

Prisma `where` 内的 authority recursion 采用以下语义：

| 结构 | authority 规则 | 原因 |
|---|---|---|
| ordinary object / outer `ownerId` | 同层字段 AND-combine；direct outer authority 足够 | 外层条件约束整个 subtree |
| `AND: [...]` | 任一 element owner-scoped 即计入 authority | AND 只会收窄结果 |
| `OR: [...]` | array 每个 element 都分别 owner-scoped 才计入 authority | 任一无 owner 分支都会扩大到跨租户结果 |
| `NOT: ...` | subtree authority 永不计入 | NOT 会反转 owner 条件 |
| computed combinator / non-literal OR / spread OR element | 不计入 OR authority | 无法静态证明 every-branch invariant |

规则递归组合：`AND: [{ OR: [...] }]` 先按 OR 的 every-branch 规则判定；
`OR: [{ AND: [...] }, ...]` 则要求每个 OR sibling 的 AND subtree 都能证明 authority。
`{ ownerId, OR: [...] }` 继续通过，因为 direct outer `ownerId` 与整个 OR 做 AND；
OR 内部 owner authority 只有 sibling 全部 scoped 才能独立成立。

## 15. Round 9 收敛、real tree 与 ledger

fixtures 为 52 个 bypass fail、23 个 positive pass；Round 8 的 46 个 red 与 20 个 green
全部保留。新增 callback red 覆盖 named mutation、untraced factory return、imported
mutator through wrapper；新增 Prisma red 覆盖 partial OR、NOT-only authority、AND 内 nested
unscoped OR；green 覆盖 outer owner + OR、all-branches-owned OR、owner-scoped AND。

real tree 有 18 个 textual `OR:` site（16 production、2 test）；Round 9 没有新增 finding。
production site 均由同层 outer owner authority 或已证明 owner-scoped filter 与 OR 做 AND，
不是 #458 candidate。最终扫描与 Round 8 相同：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0；full-tree runtime 1.76 秒。

## 16. Round 10：callback shape、ordered spread 与 derived key

已知 callback consumer 现在按 argument position 判定 callback：collection/promise
consumer 的 callback 位，以及 timer 的第一个参数，才进入 callback resolution。
property access、element access、factory/bind call 与 conditional 若出现在该位置但无法
解析，统一 fail closed 并失效当前 tainted state；`reduce` initial value、`forEach`
`thisArg` 等普通 data 位不再被误判成 callback。对象参数中直接传入的 arrow property
会沿同文件 wrapper 映射到 `input.mutate(...)` 之类的调用点，继续分析 callback body 与
captured alias invalidation；arrow 的 lexical `this` 不会被误当成可改写 carrier。

Prisma authority object 改为按 property 顺序解释 last-write-wins。每条 authority 保留
其顶层 key；后续已知 spread 只覆盖同名 key，unknown/untrusted spread 因可能覆盖任意
authority key 而清空此前证明。相反，unknown spread 在前、明确 authority 在后可通过；
known neutral literal、immutable owner object 与由 principal-derived identity scalar
重建的 immutable owner object也保留证明。

principal-derived row 不再让任意 property 获得 authority。来源 property 必须是 `id`、
`*Id` 或 `*Ids` 的 identity naming 形状；object destructure 使用同一规则。Prisma
`where`/`data` 的目标路径也必须落在 identity key，或在 nested relation/logical
container 中最终落到 identity key。于是 `status: job.status` 与 `status: job.id` 都不能
替 unsafe OR 洗白，而 `id: job.id`、`projectId: project.id`、`id: { in:
job.generationIds }` 仍可证明。real-tree 审计确认合法 Rule-A 路径均可由该 identity
invariant、直接 `ownerId` 或既有 validated-client-id 规则证明。

对象 callback carrier 首次收紧时曾暂时暴露 `campaign-actions.ts` 的四个 false positive：
shared helper 在调用 `input.mutate(...)` 后仍使用直接来自 `gate.ownerId` 的
`input.ownerId`。arrow property mapping 证明该 callback 不改写 carrier；structured
callback 内不携带 principal 的纯 recursive canonicalizer只截断重复展开，携带 principal
的 recursion 仍保持 fail closed。没有修改 app code，也没有新增 exemption。

## 17. Round 10 收敛、real tree 与 ledger

fixtures 为 57 个 bypass fail、25 个 positive pass。新增 red 覆盖 property/element/bound
callback、trailing untrusted spread，以及 incidental derived property/非 identity 目标
key；新增 green 覆盖 callback data 位、object callback wrapper、spread ordering、
known-neutral spread 与 immutable principal-derived owner spread。

最终扫描仍为：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0；full-tree runtime 1.21 秒。

## 18. Round 11：正向 filter、assignment pattern 与 callback carrier

principal-derived identity 只有在 Prisma filter 对结果集施加可证明的正向约束时才算
authority。direct equality，以及 identity filter 内的 `equals`、`in`、`has`、
`hasSome` 保留证明；`not`、`notIn`、`gt`、`gte`、`lt`、`lte`、`isNot`、`none`、
`every`、`hasEvery` 不提供 authority（`*Every` 对空集合可 vacuous true）。identity
scalar/list filter 内的未知
operator 同样 fail closed，不能仅因 operand 来自 owned row 就洗白。relation 的 `is` /
`some` 仍须由 nested positive identity 或 `ownerId` 证明，反向/全称量词本身不算证明。

Prisma compound unique key 不是 filter operator。形如
`ownerId_broadcastRunId_contactIdentityId: { ownerId, ... }` 的 `_` 分隔 identity key
object 继续按内部 identity 字段分析，避免把合法复合唯一键误判为未知 scalar operator。
真实代码树第一次扫描暴露的唯一 finding 即属此类；加入该语义区分与 positive fixture
后恢复 0 finding，没有修改 app code 或 exemption ledger。

赋值流现在收集 Object/Array assignment pattern 中所有实际写入的 binding root。无论是
`({ id } = body)`、`[id] = body.ids`、nested/default/rest target，旧的 principal、
derived、authority、owner-neutral 与 alias 状态都在写入后失效；同一 root 也进入
reassignment 索引，不能让 callback resolver 回看已经被覆写的旧 initializer。未知
destructure source 不尝试恢复 trust。

已知 callback consumer 的 callback argument 若是 `SpreadElement`，即使 spread 内容看似
tuple，也不能静态保证 runtime callback 位置与 target，统一按 unresolved callback
fail closed。structured object carrier 则扩展到 method shorthand、function expression
与 shorthand property：静态可解析者分析真实 function body 并合并 captured alias
invalidation；conditional/import/spread/computed 等无法解析的 property 在
`input.mutate()`（含静态 element access）被调用时失效当前 tainted state。普通未调用
data property 不受影响。

## 19. Round 11 收敛、real tree 与 ledger

fixtures 为 61 个 bypass fail、27 个 positive pass。新增 red 覆盖 11 类
negative/relational/quantified/unknown Prisma operator、Object/Array destructuring
reassignment、callback-position spread，以及 method/function/shorthand/unresolved
structured callback carrier；新增 green 覆盖 `equals`/`in`/`hasSome`、compound unique
identity object 与三种静态 structured callback form。

最终扫描仍为：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0；本轮 full-tree runtime 1.24 秒。

## 20. Round 12：default assignment target 与 recursive carrier

assignment target root 收集现在把 assignment `BinaryExpression` 解释为写入其 left
target。于是 object alias default `({ source: id = fallback } = body)` 不会因静态分析
default 分支时暂时从 derived `fallback` 恢复 trust；outer assignment 最终仍会按 runtime
可能写入的 `id` 清除旧 principal/derived/authority/alias。规则递归覆盖 nested object、
array default 与 object/array rest；只作用于 assignment target 与 reassignment 索引，
不把合法 variable/binding declaration 当成运行时覆写。

structured callback 内的无 principal recursive call 不再无条件 `return states`。在截断
recursive function body 前，checker 先检查 recursive argument 中的 object callback
carrier：method、function/arrow 与可解析 shorthand 会按真实 callback body 分析，并把
captured alias invalidation 合并回 caller；callback-shaped conditional/import/reference
或 spread/computed property 无法证明时 fail closed。普通 literal data property不当成
callback，且 callback recursion stack 继续阻止无限展开。

这一规则锁住 two-level carrier：outer structured callback 定义 recursive helper，
第一次传入 safe callback，第二层 carrier 才写入 captured owned row。旧 guard 因 recursive
args 本身不携带 principal 而跳过第二层 method；新规则会分析该 method 并失效 captured
derived object。既有 `callback-data-argument.ts` pure recursive canonicalizer 仍通过，
证明无 callback carrier 的合法递归仍按原边界截断。

## 21. Round 12 收敛、real tree 与 ledger

fixtures 为 63 个 bypass fail、27 个 positive pass。新增 red 覆盖 derived fallback 的
object alias default（同一 pattern 含 nested array/default 与两类 rest）以及 two-level
recursive structured carrier；既有 recursive structured positive 作为防误报 green。

最终扫描仍为：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0；本轮 full-tree runtime 1.40 秒。

## 22. Round 13：recursive carrier 的 called-property 证据

recursive structured-carrier 截断前，checker 现在把 recursive function 的同位置参数与
object argument 对齐，并收集 function body 中直接执行的静态 property call：
`input.f()` 与 `input["f"]()` 都证明 carrier 的 `f` 是 callback 位。若 argument 为
`{ f }` / `{ f: reference }`，即使短名不匹配 callback/handler/mutate 启发式，只要
`f` 随后被调用而 reference 无法解析到稳定 function body，就 fail closed 并失效当前
taint。computed property call 无法确定目标名时同样 fail closed。

这补住 `let f; f = () => { job.id = body.id }; recurse(..., { f })`：无 initializer 且
被 reassignment 的 `f` 不能再因普通短名被归为 data。静态 method/function/shorthand
仍分析真实 callback body；未在 recursive body 中作为 method 调用的普通 data property
不因本规则被升级成 callback。扫描只在 recursive structured-carrier path 生效，不改变
一般 object/data argument 的分类。

## 23. Round 13 收敛、real tree 与 ledger

fixtures 为 64 个 bypass fail、27 个 positive pass。新增 red 覆盖无 initializer 后赋值
的普通短名 callback shorthand；既有 two-level recursive carrier、pure recursive
canonicalizer 与普通 callback data 正例全部保留。

最终扫描仍为：

`PASS=37 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，96 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0。
