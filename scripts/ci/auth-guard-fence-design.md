# Auth guard fence：双契约设计

## 0. 边界与诚实披露（请先读完本节，再读下文）

> 本节由 2026-07-26 的诚实性修订加入，位置刻意放在文档最前。当日 Founder 裁定：
> 防护机制与测试**不再改动**（维持裁决五「停在第 28 轮」），改为把「绿灯不等于安全」
> 与盲区清单如实前置到本文档开头。相关记录：PR #461、issue #442，裁决全文见 #287。

### 0.1 定位：这是一条零维护的 CI 绊线，不是安全证明

按 2026-07-26 裁决五，`scripts/verify-auth-guards.mjs` **停在第 28 轮，不再加固**。
它的定位是**补充性的 CI 绊线（tripwire）**：当改动引入它已建模的违规形态时，把 PR 拦下来。
它**不是**运行时强制，也**不是**租户隔离的证明。

租户隔离真正的防线是**运行时路线**：第②步的**请求级 principal 值守卫**（#459），
以及**跨租户复合外键**（#317）。本围栏与它们的关系是「先响的铃」，不是「锁」。
任何把本围栏当作隔离保障来引用的说法都是错的。

### 0.2 绿灯不等于安全

**围栏通过（exit 0、`FINDING=0`）只说明：在它扫描到的形态里，它建模过的违规没有再出现。
它不证明不存在串店（跨租户）写入。**

顾问复审给 Founder 的原话（逐字，已置于 PR #461 正文顶部）：

> 这个检查器跑绿，只代表它在它建模的形态里没找到违规——它不是代码安全的证明；特别是，
> 一个未受保护的 export 仍可能因为与一个受保护的 export 同处一个文件而静默通过，
> 所以绿灯永远不能替代 diff 里对鉴权处理的人工审查。

三条必须一起记住的后果：

1. **「没报红」有三种含义**：一是真的被证明了；二是**整个文件带零告警从报告里消失**
   （`files=0`）；三是**文件被扫到并报 PASS，但其中某个导出面已静默脱离覆盖**——上面
   那段逐字引文说的正是第三种（未受保护的 export 因与受保护的 export 同处一个文件而
   静默通过），0.4 的 P1-2「可调用导出面会静默从覆盖中消失」属同一族。后两种在报告里
   与「这个文件本来就没有敏感操作」「这个导出被证明了」**无法区分**。
2. **覆盖率地板（`120 file(s) / 465 entr(ies)`）按构造只抓「既有覆盖下跌」**。一个从出生
   起就 `files=0` 的新文件不会让地板下跌，因此地板对「一出生就隐形」这一族**零信号**。
3. **豁免账本按 `path + export + reason` 三字段精确匹配**，因此新增的敏感 site 可能被
   既有豁免条目吸收而不产生任何信号（见 0.4 的 P1-3）。

### 0.3 已知漏网形态清单

以下形态在写下本节时**均可复现**，且**按裁决五不再修复**。编号仅为引用方便。
「静默放行」= `ok=true`、零 diagnostic（其中若干条连文件都不出现在报告里）；
与之相对的「报红」= fail closed，属正常拦截，**不在**本清单内。

**A 组：整文件 / 整导出静默脱离扫描（`files=0`，或该 export 被跳过）**

**第 1–5 条**的复现前提是那句未加 scope 的查询**不在 entry 文件文本内**（否则 module 级
兜底仍会响）——§42 / §43 的原始实测同样是按这个前提记的。**第 6–7 条不受该前提约束：
即使查询就写在 entry 文件文本内，module 级兜底也不会响。** 机制是
`scripts/verify-auth-guards.mjs:8314` 那道兜底闸门要求 `hasCallableExport`，而当一个文件的
导出**全部是 unknown 形态**时该条件为 false，闸门整条被跳过；第 6 条点名的生产文件
`apps/web/lib/channels/x.ts` 就处于这一状态。复审探针
`export const leak = ((fn) => fn)(async (id) => prisma.contact.findMany({ where: { id } }))`
（查询就在 entry 文件内）实测 `files=0`、零 diagnostic。
完整实测对照表见 §42「刻意保留的边界」的 Round 28 补记。

1. **static class 成员方法 dispatch**——`class S { static list(db, id) { return findA(db, id) } }`
   后 `S.list(prisma, id)`：`ok=true`、**`files=0`**、零 diagnostic。
2. **static class 属性箭头**——`class S { static list = (db, id) => findA(db, id) }`：同上。
3. **call-expression receiver**——`makeService().list(prisma, id)`：同上。
4. **参数 receiver**——`service.list(prisma, id)`：同上。
5. **函数体内从容器取出的 callable**——`new Map([...]).get("list")!(prisma, id)`：同上。
6. **导出对象字面量的方法**——`export const dispatch = { run: (db, id) => … }`。
   **本条已确认有一个真实生产文件处于该状态**：`apps/web/lib/channels/x.ts`——
   它今天的归属写法是正确的，但围栏看不见它，因此**归属若被删除也不会报警**。
7. **导出类的 static 方法**、**高阶包装导出**（`export const leak = wrap(...)`）、
   **模块初始化期查询**（`export const leaked = prisma…`）——跨厂商复审的四个探针全部返回
   `ok:true, files:0, 无诊断`（见 0.4 的 P1-2）。这与 §34 末段「unknown export 与其他
   member call 仍 fail closed」的表述**矛盾**，以本条实测为准。

A 组共有的根因是第二层兜底闸门的**取名范围**：`visibleScopedBinding` 只认
`FunctionDeclaration` 与 `VariableStatement`，`info.localValues` 也只从 `VariableStatement`
填充；`ClassDeclaration`、参数、call 表达式、容器取出的 callable 都拿不到「本地变量声明」
这个身份，于是 `unresolvedLocalReceiverNames` 返回 `[]`，fail-closed 闸门永不触发。

**B 组：collection sticky-poison 不变式的缺口**（原始出处见 §43 第 1–3 条）

8. **构造期污染**——`const keys: string[] = [input.clientKey];` 之后接一次 trusted push：
   `ok=true`、零 diagnostic。根因是 `emptySafeCollection` 要求 initializer 是**元素数为 0**
   的数组字面量，非空字面量因此从头到尾不被 tracking。对照组
   `if (input.extra) keys.push(input.clientKey);` 正确报红。
9. **callback 体内插入**——`input.rows.forEach((row) => { keys.push(row.raw); });` 之后接
   一次 trusted push：`ok=true`、零 diagnostic。poison 在 callback 退出时被丢掉，没有回映
   到 caller 的 collection binding。
10. **经属性链写入 + 经裸标识符读取**——`const box = { list: keys };` 之后
    `box.list.unshift(input.clientKey);`、再一次 trusted push、sink 读**裸名** `keys`：
    `ok=true`、零 diagnostic。`box.list` 与 `keys` 指向同一个运行时数组，污染当然到得了；
    只有把 sink 也改成经 `box.list` 读写才报红。

**C 组：同文件兄弟遮蔽**

11. **一个未受保护的 export，可能因为与一个受保护的 export 同处一个文件而静默通过。
    已复现。** 这是顾问点名的「最尖锐的一条」，也正是 0.2 那段逐字引文所指。

**D 组：可见性缺口（实测无活实例，属潜在风险）**

12. 经**仓库内 re-export** 取得 Prisma 客户端时，全体消费者对围栏不可见。
    2026-07-26 实测**0 个活实例**。

**E 组：精度缺口（非安全）**

13. `Object.assign(keys, { 0: <owner-derived> })` 里那个**容器字面量实参**本身永远不是
    `"derived"`（`principalExpressionKind` 不对对象/数组字面量做逐元素推导），因此
    `derived-collection-object-assign-poison.ts` 把攻击者 key 换成 owner-derived key 后
    **仍然报红**，至今没有隔离出它自己声称的 bypass class。它作为 bypass 仍然有效
    （攻击者形态正确报红），只是隔离性待补。详见 §43 末段。

**以下属 fail closed、不在本清单内的保留边界**（一并列出以免误读），**且仅当文件本身对
扫描可见时才成立**：跨模块 class 体不
递归解析（`new ImportedClass().run(prisma, id)` 由第二层报红）、数组下标取出的 callable
（`handlers[0](prisma, id)` 报红 `unprovable`）、本地 class 实例方法
（`new S().list(prisma, id)` 报红 `missing-principal-resolution`）。这些是**拦下来了**，
性质与上面 13 条完全不同。**但可见性是它们生效的前提**：同样的形态一旦落进 A 组的隐形
写法（例如把 `handlers[0](...)` 挪到一个导出对象字面量后面），文件报 `files=0`、零
diagnostic，这几条 fail closed 同样不会发生——见 A 组第 1–7 条。

### 0.4 跨厂商复审确认的 4 项 P1 盲区

来源：PR #461 评论，复审员自标日期 2026-07-26、评论发表于 2026-07-25 UTC，GPT 家族、
read-only 密封，读取范围为 committed `origin/main...HEAD`（head `20a8d0ef`）。复审员按
「补充性 CI 绊线、非运行时强制」这一定位评判，其加粗结论逐字为：
**结论：P0 0 项 / P1 4 项 —— 复审员判定「按现状不可合并」。** 四条如实
收录如下；**四条按裁决五均不再加固，由第②步运行时守卫（#459）接手。**

**P1-1 混合权属数组被当成租户安全。** 检查器对数组只要求**任一**元素可证，未证元素在
分析中被略去（`scripts/verify-auth-guards.mjs:2348–2361`），剩余证明即满足敏感操作检查
（`:3447–3454`）。两个探针零诊断通过：`ownerId: { in: [gate.ownerId, attackerOwnerId] }`；
以及 `createMany` 的 data 数组中混入 `{ ownerId: attackerOwnerId }`——**后者可以真写出
一条跨租户行，而围栏报绿**。本设计文档与 PR 正文此前均未披露此模式。
按裁决五不再加固，由第②步运行时守卫接手。

**P1-2 可调用导出面会静默从覆盖中消失。** 导出索引对若干可调用形态省略或降级为
`unknown`（`:1435–1488`、`:1611–1623`），而 unknown 的非 route 导出被跳过
（`:8250–8252`），模块兜底同样排除（`:8312–8317`）。四个探针全部返回
`ok:true, files:0, 无诊断`：导出对象字面量的方法、导出类的 static 方法、高阶包装导出
（`export const leak = wrap(...)`）、模块初始化期查询（`export const leaked = prisma…`）。
这与本文档 §34 末段「unknown export 仍 fail closed」的表述矛盾。
按裁决五不再加固，由第②步运行时守卫接手。

**P1-3 豁免账本会吸收未来站点。** 三字段键（`path + export + reason`，见 §3）使**新增
站点可被既有豁免条目吸收**；本文档此前未披露此性质。账本现状：72 个身份覆盖 222 个
豁免站点（见 §43 Round 28 实测）。
按裁决五不再加固，由第②步运行时守卫接手。

**P1-4 测试未钉住每个导出与每个敏感站点。** bypass 测试断言文件覆盖与整体失败
（`verify-auth-guards.test.mjs:412–428`），仅子集断言导出名（`:429–435`）；positive 测试
（`:448–460`）既不断言精确导出也不断言敏感站点；聚合下限（`:346–370`）在总数高于下限时
无法察觉某个导出被漏掉。**后果：上述 P1-1 / P1-2 的回归可以在套件全绿的情况下发生。**
按裁决五不再加固，由第②步运行时守卫接手。

复审另附两条非 P1 的观察：两个 fixture 因更弱或不同的原因通过——
`bypass/local-class-surface-inherited.ts:7–16` 实际命中的是「凡有继承的类一律拒绝」
（`checker:3161–3164`），而不是追踪到继承成员；`bypass/workspace-storage-helper-capability.ts:13`
在无 workspace 包注册表的 fixture 根下运行，测的是通用未解析导入处理——以仓库根解析
重跑该 fixture 会 PASS。

复审执行说明（如实）：该复审 session 未运行 vitest，改为用 `git show` 把 committed
检查器载入内存，对抽样 fixture 与对抗探针直接执行；外部 current-head CI 因禁网未知；
沙箱拒绝 `ps`，故复审员无法提供项目要求的进程级身份证据。

### 0.5 本节之后的内容怎么读

§1 起是**按轮次记录的设计与实测档案**（Round 1–28），描述的是每一轮**当时**的建模意图
与实测结果。凡与本节冲突之处，**以本节为准**——本节是修订日最新的如实状态。其中：
§43「尚未关闭」是 B 组与第 13 条的原始出处；§41 / §42 的「刻意保留的边界」及其
Round 28 补记是 A 组与第 10 条的原始实测出处。

---

`scripts/verify-auth-guards.mjs` 对每个**它看得见的**可达敏感操作，试图证明以下两种契约
之一。敏感操作包括 Prisma/原始 SQL、对象存储 I/O、队列发送，以及一层同 package 的敏感
调用。此处原文曾写「无法静态解析的动态分派仍然 fail closed」——**该表述已被实测推翻**：
static class 成员 dispatch、call-expression receiver、参数 receiver、容器取出的 callable
等形态是**静默放行（`files=0`）**而非 fail closed，完整清单见 §0.3。

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

## 24. Round 14：默认 discovery 的 production universe

默认 source root 现在是 `apps/web/lib` 与整个 `apps/web/app`，不再只枚举
`apps/web/app/api`。production universe 递归包含这些 root 下的
`.ts/.tsx/.mts/.cts`，继续排除 `__tests__`、`*.test.*`、`*.spec.*`、
`.d.ts` 与 `EXCLUDED_PRODUCTION_FILES` 中逐路径审核的 principal-establishment
implementation。`--entry` 仍只用于 fixture/定点分析，不能作为默认 coverage 的证据。

永久不变量是：真实 production `apps/web/app/**` 中 directive prologue 含顶层
`"use server"` 的每个文件，都必须出现在零参数 `analyzeAuthGuards()` 的
`sourceFiles`。回归测试独立使用 TypeScript AST 枚举真实 app tree，再与默认 enumeration
比对；旧 root 的 RED 精确漏掉 `apps/web/app/login/actions.ts`，因此 explicit
`entryFiles` 无法再冒充 default discovery。

默认 source enumeration 从 176 增至 279，app source 从 8 增至 111；进入语义 verdict
的 covered file 从 96 增至 117。首次扩大 root 没有改 app 或 ledger，但诚实暴露
`apps/web/app/otto/page.tsx` 经 `apps/web/lib/data.ts` 的 3 个 false-positive site；
它们没有被 exempt，而是在 Round 15 收紧 imported callback 的可证明边界。

## 25. Round 15：bounded imported pure callback

`callbackArgumentResolution` 只在以下闭集内解析 imported callback：

- callback 是静态 identifier，并对应当前 module 的 non-type value import；
- module specifier 是 repository 内可静态解析的相对路径或 `@/` 路径；
- import 精确指向目标 module 自己明确 export 的 function body，不递归追 re-export；
- binding 未被 reassignment，且仍在既有 one-module import depth 内。

满足闭集时，checker 用真实 imported function body执行既有 `analyzeCallback`，并把
callback 造成的 alias invalidation 合并回 caller。callback 的 import depth 随 mapping
传递，所以 imported callback 内不能再多追一层 sensitive helper。dynamic/namespace
property、factory return、conditional、reassignment、超深、external package 与任何
解析失败仍为 `unresolved` 并 fail closed；本轮没有加入 general recursive module
resolver。

Round 15 positive fixture 锁住：
`requireOwner → imported owner-scoped query → rows.map(imported pure DTO export) → imported
owner-scoped query`。两个 negative fixture分别证明 imported callback 对 principal
object 的 mutation 会使 alias 失效，以及 imported factory 返回的 callback 仍 unresolved；
两者后续 sensitive operation 都继续失败。

最终 fixtures 为 66 个 bypass fail、28 个 positive pass。真实扫描为：

`PASS=58 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，117 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry；
`apps/web/app/otto/page.tsx` 现在显式显示 `PASS`。ledger 仍为 72 个 identity，
delta 为 0。

## 26. Round 16：provider export binding reassignment

Round 15 的 direct imported function export 还必须证明 provider 端 binding 稳定。只检查
consumer import binding 不够：provider 可以先 `export let callback = safeInitializer`，
再在 module body 把同一 binding 赋为 mutator；若 checker 只解释旧 initializer，就会把
runtime mutator false-green。

接受 imported callback target 前，checker 现在对 provider source 中可命名的 direct
function binding复用 `bindingIsReassigned`。出现 assignment、update 或 loop overwrite
即返回 `unresolved`，沿用既有 fail-closed invalidation。匿名 direct default function
没有可检查的 local binding，继续按 Round 15 的 direct-body规则处理。此检查不追
re-export，也没有新增 general export/module resolver。

Round 16 negative fixture 使用一个先安全、后改写为 principal-object mutator 的 exported
callback。旧实现 RED 为 `result.ok=true`；修复后后续 owner-sensitive query 以
`principal-result-unused` 失败。

最终 fixtures 为 67 个 bypass fail、28 个 positive pass。真实扫描保持：

`PASS=58 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，117 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0。

## 27. Round 17：local alias binding chain

Round 16 只检查 final function target 的名字仍不足够。`resolveLocalTarget` 原先会把
`const safe = fn; export let callback = safe` 折叠成 `safe` 的 function target，并丢掉
live exported binding `callback`；export-list alias 的 local binding 也有同一缺口。之后
改写 `callback` 时，仅检查 `safe` 会继续 false-green。

local target resolution 现在附带从 exported/local binding 到 final function body 的完整
`localBindings` 链。direct named function 的链含自身；identifier initializer 每折叠一层
就把当前 local binding 加入链；anonymous direct default function 用明确空链表示没有
可改写的 local binding。cycle、unknown initializer 或跨 module 的不完整链仍返回
null/unknown，不会获得 callback trust。

接受 imported callback 前，checker 要求该链存在，并逐个用 `bindingIsReassigned`
核对 provider source。任一 binding 被改写即 `unresolved` 并 fail closed。此证据只附着
于既有 local resolution，不追 re-export，也不扩 general module resolver。

Round 17 multi-export negative fixture 同时锁住 identifier initializer 与 export-list alias；
旧实现 RED 为 `result.ok=true`，修复后两个 leak export 都以
`principal-result-unused` 失败。新增 anonymous default positive 继续通过。

最终 fixtures 为 68 个 bypass fail、29 个 positive pass。真实扫描保持：

`PASS=58 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，117 个 covered file，
0 个 finding、174 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，delta 为 0。

## 28. Round 18：storage 是一等敏感 capability

checker 现在把精确 storage module 的 named `storage` import、静态 alias 与跨 callable
参数传播纳入 capability state。`get`、`put`、`head`、`delete`、presign 等 object
I/O 都是敏感操作。纯 URL 格式化只在精确 trusted `storage.url(storageKey(...))`
结构、且 `storageKey` 是从 `@fikirtive/core` 精确导入并收到三个参数时免除敏感
判定；任意 key、同名 local helper 或其他调用结构均不免除。computed dispatch 继续
`unprovable`。因此只有 storage、没有 Prisma 的 export 也必须获得语义 coverage，
不能再以 0 covered file 通过。

storage key 的合法 authority 采用闭集，不把任意字符串当 owner identity：

- `storageKey(owner-derived value, ...)` 的返回值；
- 支配后续 I/O 的精确 `keyOwnerMatches(key, gate.ownerId)` 成功分支；
- 精确 `verifyMediaToken` 返回 non-null claims 后，再由
  `keyOwnerMatches(claims.key, claims.ownerId)` 绑定的 signed-media/HMAC 路径；
- owner-scoped row 经过已分析的 `map`、tuple、local `Map` 与 `get` 所形成的有限
  collection 流。

上述 signed authority 只放行 storage，不授予 Prisma authority。真实
`upload-actions.ts`、files storage route 与 signed-media route 都由测试断言为显式
covered export，而不是依赖 exemption。

## 29. Round 18：lexical binding 与 path-sensitive admin

`knownPrincipalBindings`、`nullableDerivedBindings` 与 `safeDerivedCollections` 已从
EntryAnalyzer 全局名字 cache 移入每条 flow state。新 variable/function declaration
与 callee parameter 先清除同名 inherited metadata；跨 module callee 从干净 lexical
metadata 开始，返回 caller 时也只恢复 caller state。owner-derived 身份若通过 object
literal 传给 destructured callee，只传播参数声明中同名、且 caller 已证明的 identity
field；generic resolver field（例如 `role`）不会成为 owner identity。

admin waiver 只接受单一 identifier 接住 `requireRole` 的结果，并在控制流证明
`"error"` 不存在的路径上清除 pending gate。丢弃、condition-only、multi-binding 或
destructured resolver result 都不能获得 waiver；拒绝分支若会继续执行，继续路径仍保留
pending 并 fail closed。既有正确的 `ownerId` destructure 与单一 assigned admin gate
仍通过，`admin-global-op.ts` 仍显示 `ADMIN-PASS`。

## 30. Round 18：depth boundary 与 production discovery

one-module import depth 到顶时，只要实参携带 tracked DB、storage 或 queue capability，
即使目标 module 的预扫描没有发现敏感调用，也必须直接 `unprovable`；capability 不能在
第三个 module 静默消失。薄 ENTRY 若自身没有 resolver，又连续跨越多个无 principal
实参的 opaque sensitive factory boundary，会同时保留一次
`missing-principal-resolution`，避免把 nested carrier 误写成已证明路径。

production discovery 不再通用排除名字为 `fixtures` 的目录；只保留 `__tests__`、
`*.test.*`、`*.spec.*` 与 `.d.ts` 排除。isolated temp regression 会创建
`apps/web/lib/fixtures/production-leak.ts`，并同时证明默认 enumeration 包含它、语义
verdict 为 red。fixture expectation table 与实际 bypass/positive 目录继续保持严格
双射。

## 31. Round 18 收敛、real tree 与 ledger

最终 fixtures 为 77 个 bypass fail、33 个 positive pass。新增 red 覆盖 storage-only、
三类同名 lexical reuse、四类 admin result/branch bypass、single-role destructure，以及
三 module DB capability depth；新增 green 覆盖 owner-derived storage key、支配式
key-owner check、signed-media authority 与真实 storage collection flow。

真实扫描为：

`PASS=60 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，119 个 covered file，
0 个 finding、175 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，内容与数量都没有变化。

## 32. Issue #442 defensive review hardening

trusted storage capability 改为显式、封闭的 path registry。production 默认只列出
`apps/web/lib/storage.ts`；fixture 必须显式传入自己的 audited storage path。每个
registry path 必须存在、必须是 file，并在 `realpath` 后仍位于当前 repo root 内。
import origin 也必须解析到 registry 中同一个 realpath；不使用 basename、path suffix
或 export 名字启发式。named import 与 namespace import 都依赖此 identity；同名
untrusted module 以及 unresolved origin 一律 `unprovable`。

独立 review 项逐项收窄如下：

- signed-media authority 只接受精确二参数 `verifyMediaToken`、精确二参数
  `keyOwnerMatches(claims.key, claims.ownerId)`、同一 claims root、直接 member
  reference，以及支配后续 call 的直接 lexical 成功分支；storage `get` 只接受一个
  精确 `claims.key` 参数。
- owner-derived storage key 不再接受 conditional/logical 等未建模组合；只接受已追踪
  binding、已追踪 object 上的直接 `ownerId` member，或 production 已有且显式列入
  canonical relation 的一层 `.asset.ownerId`；任意深 path 仅以 `.ownerId` 结尾不算证明。
- one-module depth 边界会递归检查 nested object/array capability carrier；到边界仍携带
  DB、storage 或 queue capability 时 fail closed，不能靠额外 wrapper module 消失。
  body 确实不可解析时直接 `unprovable`；callback body 则交由既有 callback analyzer。
- `storage.url` 的 exact pure proof 与 raw client key、同名 local key builder 两个
  negative control 成对；trusted namespace positive 则与 named wrong-origin、
  namespace wrong-origin、unresolved-origin 三个 negative control 成对。
- registry 另有 symlink 指向 repo 外部的 realpath escape negative test。fixture
  harness 继续严格枚举 bypass/positive 内容，未声明 fixture 会直接失败。

收敛 fixtures 为 93 个 bypass fail、35 个 positive pass。真实扫描为：

`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file，
0 个 finding、175 个 reviewed exemption site、0 个 stale entry。ledger 仍为 72 个
identity，没有新增、删除或修改。

## 33. 174 → 175 reviewed-site delta 的逐路径证据

此数字计算 diagnostic occurrence，不是 ledger identity 数量。相对 Round 17 的
174，当前 175 是以下 site delta 的净结果：

- `+1`：
  `apps/web/app/api/otto/stream/route.ts` / `POST` / `unprovable`，implementation
  `apps/web/lib/otto-actions.ts:307`；
- `-1`：
  `apps/web/lib/canvas-node-placement.ts` / `placeCanvasJobNode` /
  `principal-parameter-unused-by-sensitive-operation`，implementation
  `apps/web/lib/canvas-node-placement.ts:246`；
- `+1`：
  `apps/web/lib/otto-client-actions.ts` / `ottoTurn` / `unprovable`，
  implementation `apps/web/lib/otto-actions.ts:307`。

另外两个 `missing-principal-resolution` occurrence 仅由
`apps/web/lib/otto-actions.ts:759` 搬到 `:592`（`ottoTurn` 与 `ottoApprove` 各一），
数量净变化为 0。所有新增/搬移 occurrence 都由原有精确
`path + export + reason` identity 覆盖，所以 ledger 保持 72 条，scanner 同时证明
0 stale entry。

## 34. Round 19：workspace source 与 pg-boss transaction adapter

capability depth 闸不能把 workspace package 当成 opaque external package。checker 现在
从当前 repo `packages/*/package.json` 建立精确 package-name registry，只接受 manifest
中 exact `exports` subpath，并把 runtime `dist/.../*.js` 映射回同 package 内实际存在的
`src/**/*.ts`。package 内 NodeNext 风格 `export ... from "./helper.js"` 也只按同 stem
解析到实际 `.ts` source；candidate 经 `realpath` 后仍须留在该 package 目录。fixture
repo 没有对应 package manifest 时继续 unresolved、fail closed，所以
`workspace-storage-helper-capability.ts` 与 `workspace-storage-surface-capability.ts` 不会
借 production workspace 获得解析或被放行。isolated regression 同时证明 owner-scoped
helper 可由 body 通过、unscoped helper 会由 body 报红；这里没有 package/export
allowlist。

external `pg-boss` 只承认一个语义闭集：精确 named import
`fromPrisma` from `"pg-boss"`、一个直接 tracked transaction 参数、直接位于 tracked
queue `.send(name, data, options)` 第三个参数 object 的 `db:` property。它只是把同一
Prisma transaction 交给既有 queue-send 敏感点；queue send 本身仍须引用 owner-derived
authority。赋值、返回、其他 caller、其他 package、其他 option shape 一律仍走 unresolved
capability fail-closed。negative fixture `from-prisma-outside-queue-send.ts` 固定此边界。

storage canonical relation 也同步收窄：一层 `.asset.ownerId` 的 root 只能是 principal
object 或 derived object；scalar `principalDerivedBindings` 不再获得 relation authority。
`storage-key-scalar-relation.ts` 固定这个 negative control。

workspace body 展开后新增的 provenance 只在已由 manifest 精确解析的 workspace source
内生效，不扩散到普通 app helper。内部 callable 的 required `ownerId` contract 可追踪
同 module 的 type alias/interface，但只在跨 source boundary 时建立；同文件 utility
不能借自己的 domain row type 自动取得 principal。owner-derived template string 可在
workspace 内把 provenance 传给 advisory-lock helper。精确解析出的 literal array export
上的 `.includes(...)` 被识别为静态只读数据操作，不再误判成会触达 package sensitive
surface；unknown export 与其他 member call 仍 fail closed。

flow state 现在携带 invocation lineage，callee 分支返回时按 lineage 找回原 caller state，
不再按 array index 错配。跨 module 时只重建实际传入参数的 alias，caller 其他 lexical
alias 不会泄漏进 package callback；`Date#toISOString()` 作为零参数只读 scalar method
不会误撤销 row authority。简单 boolean branch fact 会跨精确 object destructuring call
传递，已 owner-scoped create 的 `isNew` 路径因此不会和 existing-row 路径交叉。nullable
queue state 只在 `getBoss()` 成功态与已知 null 态之间做 truthiness 收窄，确保
`if (!boss) throw` 后的 `fromPrisma(tx)` 仍必须位于 tracked queue send。

空数组的 structured provenance 另记录“已执行至少一次 push”。只有
`length === 0` 的反分支确实排除零次 push state 时，for-of destructuring 才继承 exact
property provenance；未知 push 即使通过 non-empty guard 也仍报红。
`nonempty-derived-collection.ts` / `nonempty-untrusted-collection.ts` 固定这对正反例，
nullable queue 形态则由更新后的 `queue-send-transaction.ts` 固定。

最终 fixtures 为 105 个 bypass fail、37 个 positive pass。真实扫描为：

`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file，
0 个 finding、176 个 reviewed exemption site、0 个 stale entry。ledger 没有新增、
删除或修改。

## 35. Round 20：opaque worker callback 的精确 ledger 边界

移除 workspace `parameterShape` authority fallback 后，真实扫描正确暴露
`workflowLifecycleService.transitionWorkflowRun`、`enrollWorkflowJourney`、
`advanceWorkflowJourney`、`enterWorkflowJourneyWait` 与
`createWorkflowJourneyDueRun`。这五个 identity 与已复核的 `createWorkflowRun`
具有同一静态限制：`requireWorker` 验证注入的 `resolveWorkerContext` 返回值，但
callback return 对 checker 仍是 opaque。这里必须逐 identity 登记，不能把
owner-shaped type、`verified` 字段、函数名或返回值形状升级成通用 principal authority；
否则任意未受信 callback 都可伪造 owner provenance。

isolated temporary-repo regression 创建两个同名
`createLifecycleService.run` export：两者都消费注入 callback 返回的
`{ ownerId, verified: true }` 后访问 Prisma，ledger 只列其中一个 path。结果只有精确
`path + export + reason` identity 被豁免；未列 path 仍以
`missing-principal-resolution` 报红，证明 ledger 不按名字或形状泛化。既有 workspace
shape negative 与 `requireOwner() → gate.ownerId` positive 均继续通过。

最终 fixtures 为 109 个 bypass fail、37 个 positive pass。真实扫描为：

`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file，
0 个 finding、237 个 reviewed exemption site、0 个 stale entry。actual pre/post scan
中，五个新 identity 覆盖 38 个 diagnostic occurrence，reviewed-site 从 199 增至 237，
delta `+38`；ledger identity 从 72 增至 77。generic scanner 仍保持 fail-closed。

## 36. Round 21：captured write、local capability carrier 与 member loop target

本轮修复三个有界 false-green。第一，traced nested helper 或 modeled callback 对 captured
principal 做 whole-binding assignment 时，checker 先按 lexical binding 判断该名字是否
属于 callee 自己；只有真正 captured 的 principal 才把完整 alias group invalidation 带回
caller。callee 自己的同名 parameter、local（包括 function-scoped `var`）不会误伤 caller。
boolean fact correlation 若与 live state 全部冲突，不再返回空 state 集合；它保留执行路径并
删除该名字的 stale fact authority。

第二，function-local object/array initializer 若语义上包含已追踪 DB、storage 或 queue
capability，该 local binding 继续携带保守 capability taint；nested object 与 local alias
不能让 capability 在 imported helper 边界消失。call/new expression 的返回值保持 opaque，
不会因为调用过程出现 capability 就把返回值猜成 capability。

第三，`for...of` / `for...in` 的 member assignment target 走与普通 property assignment
相同的 root invalidation，因而 `gate.ownerId` 会使 `gate` 的完整 principal alias group
失效；既有 identifier 与 destructuring target 继续按 binding reassignment 清理。

新增六个 bypass negative control：local captured overwrite、`.forEach` captured overwrite、
captured overwrite + stale boolean、direct local DB carrier、nested/aliased local DB
carrier，以及 aliased principal member loop target；另加一个 positive 同时固定 callee
同名 parameter/local 不影响 caller。

最终 focused suite 为 115 个 bypass fail、38 个 positive pass，实测
`real 41.63s`（`user 60.57s`、`sys 2.41s`）。默认 production scan 实测
`real 41.53s`（`user 60.91s`、`sys 2.36s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
0 个 finding、237 个 reviewed exemption site、0 个 stale entry。本轮没有改 ledger；
其 diff 仍恰为上一轮既有五条 addition（总 identity 77）。本轮没有 #392 / #36 的直接
验收证据，因此不声称两者已解决。

## 37. Round 22：mixed collection、capability return 与 cross-module captured write

本轮关闭三个 v7 false-green。non-empty correlation 以实际 lexical collection binding
记录 modeled callback/traced callee 的 captured push；guard 保留该 binding 的全部
runtime-plausible state，不再因另一 branch 有 `knownNonEmpty` 而丢弃未知 branch，也不把
owner authority 泛化。member write 会把 RHS capability 保守带到 target root；只有已解析
traced callee 的真实 return path 可标记 exact call expression 为 returned capability，
opaque imported call/new 仍不猜测。cross-module callback 则记录被改写的实际 lexical
binding identity，并在 defining scope 的后续 call 前失效；同名 callee parameter/local
仍不受影响。

新增五个 bypass negative control：mixed visible/callback 与 traced-callee push、
member-write DB carrier、
traced-return DB carrier、imported-wrapper captured identifier overwrite 与 captured member
overwrite。最终 focused suite 为 120 个 bypass fail、38 个 positive pass，实测
`real 45.61s`（`user 65.54s`、`sys 2.58s`）。默认 production scan 实测
`real 45.34s`（`user 65.39s`、`sys 2.65s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
0 个 finding、237 个 reviewed exemption site、0 个 stale entry。ledger 未改；其 diff
仍恰为既有五条 addition、零 removal。#392 / #36 仍没有直接 acceptance evidence，
本轮不声称两者已解决。

## 38. Round 23：v8 P1 收敛

non-empty narrowing 现在只排除 `definitelyEmpty` state，不再用「已知 non-empty」反推并
丢弃未知但可运行的分支。collection poison 绑定实际 lexical alias group：element write、
alias push 或其他不可信元素一旦进入，sticky-negative 会保留到重新声明，后续 trusted
push 不能恢复整组 provenance。所有 member assignment operator 都把 RHS capability
带到 target root；精确未遮蔽的 `Object.assign` 与数组 `.push` 分别传播 object/array
carrier，opaque mutator 只在同一 call 同时收到 tracked capability 与另一 local mutable
carrier 时保守标记 carrier，不猜测 opaque call/new return。

captured-binding invalidation 已移到共同 expression entry，所以普通 call 与 tagged raw SQL
都会先清除同一 lexical binding 的 stale owner authority。新增九个 one-export negative：
`nonempty-mixed-element-write.ts`、`nonempty-mixed-alias-push.ts`、
`local-db-carrier-nullish-member-write.ts`、`local-db-carrier-object-assign.ts`、
`local-db-carrier-array-push.ts`、`local-db-carrier-opaque-mutator.ts`、
`captured-owner-reassignment-imported-raw-sql.ts`、
`captured-owner-member-reassignment-imported-raw-sql.ts` 与
`derived-collection-sticky-poison.ts`。

> 更正（Round 26 补记）：上文「element write、alias push **或其他不可信元素**一旦进入」
> 这一句在 Round 23 只是**意图**，并未落地。当时 member call 的 poison 唯一生产者是
> `.push`，`unshift`/`splice`/`fill`/`Object.assign` 等插入型 mutation 只 invalidate
> 而不 poison，因此后续一次 trusted push 仍能重新 bless 整组 provenance。该断言自
> Round 26 起才真正成立，机制与证据见 §41。

> 再更正（Round 28 补记）：上面那句「自 Round 26 起才真正成立」**说过头了**。
> Round 26 关掉的是「已 tracked 的空 collection 被非 push 插入型 mutation 污染」
> 这一族。sticky-poison 不变式至今**仍不完整**，实测另有两族污染进不了 poison：
> 构造期污染（`const keys: string[] = [input.clientKey]`）与 callback 体内插入
> （`input.rows.forEach((row) => { keys.push(row.raw); })`），两者后接一次 trusted
> push 都以 `ok=true`、零 diagnostic 通过。两族都是**旧有**缺口而非 Round 26/27 的
> 回归——在 Round 26 之前的 HEAD 上它们同样不报红（那时该处根本没有 storage
> sensitive channel，files=0）。逐条形态、根因与实测证据见 §43「尚未关闭」。
> 正确的表述是：**插入型 member mutation** 一旦进入已 tracked 的 collection，
> sticky-negative 会保留到重新声明；构造期与 callback 体内的插入尚未纳入。

最终 focused suite 为 129 个 bypass fail、38 个 positive pass，实测
`real 49.65s`（`user 71.18s`、`sys 2.80s`）。默认 production scan 实测
`real 48.94s`（`user 70.62s`、`sys 2.68s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
237 个 reviewed exemption site、0 个 stale entry。ledger 未改，diff 仍为既有
`+5/-0`、总 identity 77。#392 / #36 仍无直接 acceptance evidence，本轮不声称两者
已解决。

## 39. Round 24：v9 nested carrier、binding origin 与动态 capability 收敛

modeled/traced call 现在为每次 invocation 建立以 caller 实际 declaration node 为键的
argument→parameter origin map；callee 的同名 parameter/local 不再切断或伪造回传。
object/array literal 内可按引用修改的 principal/collection alias 会精确带入 carrier root，
callee 的 poison/invalidation 再映回原 caller binding；标量拷贝不会被误作可变 carrier。
未能形成普通 call binding 的 computed namespace 与 conditional callee，只有在表达式可
解析到同 repo function 且参数携带已追踪 DB/storage/queue capability 时才以
`unprovable` fail closed；普通 built-in 与任意 callback 不因此取得 authority。

新增五个 one-export bypass negative control，分别固定 nested derived collection、
nested principal object、跨 module 同名 local，以及 computed/conditional capability
crossing。最终 focused suite 为 134 个 bypass fail、38 个 positive pass，实测
`real 48.16s`（`user 70.21s`、`sys 2.42s`）。默认 production scan 实测
`real 48.52s`（`user 70.89s`、`sys 2.29s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
237 个 reviewed exemption site、0 个 stale entry。ledger 未改，diff 仍为既有
`+5/-0`、77 个唯一四字段 identity。#392 / #36 仍无直接 acceptance evidence，本轮
不声称两者已解决。

## 40. Round 25：mixed carrier —— 把「可达 principal」与「是 principal」拆开

### 漏洞

Round 24 的 nested carrier origin map 有一个致命的语义混用。对于 identifier
parameter 搭配非 identifier argument 的调用，checker 会遍历
`escapedAliasIdentifierNodes(argumentNode)`，只要 object literal 内**任意一处**含有
object-tainted 名字，就把整个 callee parameter 加进 `principalObjects`。而
`principalObjects` 同时是 `principalExpressionKind` 的 identifier 分支所认定的
「本身就是 principal object」——一旦成立，property access 分支的兜底规则
`receiverKind === "object" → name === "ownerId" ? "binding" : null` 就把该 carrier
的 `.ownerId` 直接判成已认证 ownerId。

于是只要在 carrier 里塞一个真 principal 作陪，同一字面量里由攻击者控制的
`ownerId` 兄弟属性就免费取得 authority：

```ts
const gate = await requireOwner();
return load({ session: gate, ownerId: input.ownerId });  // 攻击者控制
```

`load` 内的 `ctx.ownerId` 被判为 `binding`，跨租户读取以 `ok=true`、**零条
diagnostic** 通过围栏。read sink、write sink（`create({data:{ownerId}})`）、
一层 imported helper、更深的嵌套 carrier（`{meta:{audit:{session:gate}}, …}`）、
以及 element access `ctx["ownerId"]` 五种形态全部同样绿灯。

加重因素：per-property provenance 此前被 `workspacePropertyProvenance`
（`isWorkspacePackageModule`）闸住，而 `workspacePackageRegistry` 只登记
`packages/*`，`DEFAULT_SOURCE_ROOTS` 的 `apps/web/lib`、`apps/web/app` 都不是
workspace package。也就是说在**整棵真实目标树**上，上述 blanket object 规则是
carrier authority 的唯一来源——脆弱路径就是默认路径。

这个洞还直接击穿了 repo 自己已有的断言：workspace 块里
`shapedHelper(prisma, { ownerId: searchParams.owner })` 断言 `ok=false`，只要给同一
字面量补一个 `session: gate` 就会转绿。

### 修复

根因是 `principalObjects` 把两种语义压成了一个集合：「此 binding **是**已认证
principal object」（授予 `.ownerId ⇒ binding`）与「此 binding 是一个**能到达**
principal 的 carrier」（只有 mutation/poison/alias 追踪需要）。本轮把两者拆开：

1. 新增 state 集合 `principalCarrierObjects`，carrier 映射改写入它；
   `createState`、`cloneState`、`dedupeStates` state key、`clearPrincipalName`、
   跨 module reset、invocation-exit caller restore 六处同步登记。
2. `principalNameIsTainted` 与 `principalNameIsObjectTainted` 都纳入新集合，
   因此 carrier mutation 仍然精确 poison/invalidate 回原 caller binding——
   `nested-principal-object-carrier.ts` 的 `poison({ gate }, body.ownerId)`
   洗白路径保持报红，语义与 Round 24 完全一致。
3. `principalExpressionKind` 的 identifier 分支**不**认新集合。carrier 的
   `ctx.ownerId` 与 `ctx["ownerId"]` 因此落回 `principalPropertyBindings`
   逐属性查表，未证明 provenance 的属性默认拒绝。真 principal object
   （guard result、destructuring、`principalKind` 路径所设）不受影响，
   `ctx.session.ownerId` 这类形态仍按原规则成立。
4. 撤掉参数传递处的 `workspacePropertyProvenance` 闸，逐属性 provenance 对所有
   module 生效。这不是放宽：逐属性 provenance 严格窄于 blanket object 授予，
   属性 kind 一律取自 caller state 的 `principalExpressionKind`，无法凭空制造
   authority；没有它，第 3 步会把 `apps/web` 里合法的 `{ownerId: gate.ownerId}`
   carrier 全部误报。`workspacePropertyProvenance` 常量随之成为孤儿，一并删除。
5. 深层 carrier（`ctx.meta.audit.session.ownerId`）不递归推导，按 fail closed
   处理——这是本轮的明确取舍，由 `mixed-principal-carrier-nested.ts` 固定。

对抗性验证另外确认四点：callee 先 `ctx.ownerId = evil` 再读取报红；
`{...{ownerId: input.ownerId}, session: gate}` spread 洗白报红；
untrusted local 的 shorthand `{ ownerId, session: gate }` 报红；重复键
`{ownerId: gate.ownerId, ownerId: input.ownerId}` 按 last-wins 报红。而
owner-proven carrier 再转发一层（`forward(ctx) → sink(ctx)`）正确保持通过。

### fixture

新增五个 one-export bypass negative control：`mixed-principal-carrier.ts`、
`-imported.ts`、`-write.ts`、`-element-access.ts`、`-nested.ts`，全部固定为
`missing-principal-resolution`。新增两个 positive：
`principal-session-carrier.ts`（`{session: gate}` → `ctx.session.ownerId`）与
`principal-owner-id-carrier.ts`（`{ownerId: gate.ownerId}` → `ctx.ownerId`）；
前者在修复前其实是**误报**（apps 形态无 per-property provenance），现在证明通过。
workspace 块另加 `shaped-mixed.ts`（混合 carrier 必须红）与
`shaped-carrier.ts`（owner-proven carrier 必须绿），把 provenance 闸的改动在
`packages/*` 形态上双向钉死。

### 结果

最终 focused suite 为 139 个 bypass fail、40 个 positive pass，实测
`real 48.42s`（`user 71.14s`、`sys 2.28s`）。默认 production scan 实测
`real 48.28s`（`user 70.72s`、`sys 2.23s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
222 个 reviewed exemption site、0 个 stale entry。

FINDING 仍为 0，真实树没有新增未受保护的 tenant-scoped 调用点。第 4 步的逐属性
provenance 反而使 `customer-inbox-service.ts` 的 `assignConversation`、
`takeOverConversation`、`handOffConversation`、`setConversationStatus`、
`requestAutomationResume` 五个 export 首次被**证明**——它们走的正是
`commitConversationEvent(tx, { principal, current, … })` 这一合法 nested carrier，
sink 读的是 `args.principal.ownerId`。这五条 Round 7 豁免（理由原文即
「nested carrier provenance is intentionally not inferred」）随即转为 STALE，
按 ledger 卫生规则删除；exemption site 由 237 降为 222，唯一四字段 identity
由 77 降为 72。这是收紧而非放宽：这五个 export 今后必须每轮自证，证明一旦断裂
就报红，而不再被豁免静默吸收。#392 / #36 仍无直接 acceptance evidence，本轮
不声称两者已解决。

## 41. Round 26：collection washing —— 让 poison 的生产脱离 `.push`

### 漏洞

§38（Round 23）写下的 sticky-poison 不变式是「element write、alias push 或其他不可信
元素一旦进入，sticky-negative 会保留到重新声明，后续 trusted push 不能恢复整组
provenance」。实现只兑现了前两项。member call 路径上 poison 的**唯一**生产者是
`.push` handler：`wasPoisoned` / `becomesPoisoned` 与 `poisonedCollections.add`
全部长在那一个 handler 里；另一个生产者是 element-access assignment。

任何**非 push 的插入型 mutation** 都落到 un-modeled member call 分支，只走
`markCollectionsPossiblyMutated`（仅 `definitelyEmptyCollections.delete`）与
`invalidateCallEscapes → invalidateDirectAlias`。而 `invalidateDirectAlias` 在名字尚未
object-tainted 时直接 early-return——对一个刚声明的 `const keys: string[] = []` 是纯
no-op。于是 `keys` 保留干净的 tracked state，紧随其后的一次 trusted push 算出
`wasPoisoned === false`，把整个 list（含仍坐在 index 0 的攻击者元素）重新 bless：

```ts
const gate = await requireOwner();
if ("error" in gate) return gate;
const keys: string[] = [];
if (input.extra) keys.unshift(input.clientKey);              // 攻击者控制，index 0
keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));  // 把整组重新 bless
return Promise.all(keys.map((key) => storage.get(key)));     // index 0 被真的取出
```

以 `ok=true`、**零条 diagnostic** 通过围栏。最锋利的证据：把既有红 fixture
`derived-collection-sticky-poison.ts` 里唯一的 `keys.push(input.clientKey)` 改成
`keys.unshift(...)`，同一个文件立刻转绿。

第二条洗白路线：即便 receiver 已经 object-tainted，
`invalidatePrincipalAlias → clearPrincipalName` 会丢掉
`safeDerivedCollections` / `knownNonEmpty` / `definitelyEmpty` 却**从不**写入
`poisonedCollections`，随后 `collectionAliasesForState` 对这个已不再 tracked 的名字
返回空集，下一次 push 的 `wasPoisoned` 依然是 false。

实测转绿的形态：`unshift`、`splice(0,0,x)`、`fill(x)`、
`Object.assign(keys,{0:x,length:1})`、alias（`const alias = keys; alias.unshift(x)`）、
imported helper（callee 体内 `target.unshift(value)`）、`copyWithin`、
element access `keys["unshift"](x)`、动态成员 `keys[input.mutator](x)` 共九种。

### 修复

把 poison 的生产从 `.push` 里剥出来，改成 un-modeled member call 分支的一等公民。

1. 新增 `PURE_COLLECTION_READ_MEMBERS` **allowlist**（`:171`），沿用 Round 7 的
   default-deny 架构：只列举不可能插入新元素的成员——`map`/`filter`/`forEach`/
   `slice`/`concat`/`join`/`find*`/`some`/`every`/`reduce*`/`includes`/`indexOf`/
   `at`/`entries`/`keys`/`values`/`flat`/`flatMap`/`toString`，外加非插入型 mutator
   `pop`/`shift`/`sort`/`reverse`。**不用 denylist**：`keys.map(...)` 这类
   positive 必须保持绿灯，而未知成员、`callMemberName` 返回 null 的动态成员，
   一律落在 allowlist 之外 → 报红。
2. `poisonCollectionNames`（`:3622`）是唯一的 poison 写入点：对 alias group 里每个
   名字做 `poisonedCollections.add` + `safeDerivedCollections` /
   `principalDerivedBindings` / `principalDerivedObjects` /
   `definitelyEmptyCollections` 四删。`affectedNames` 在 alias group 尚未 tracked 时
   回落到 receiver 本名——这一步是**必需**的，镜像 push handler 的同款回落：
   `new Array(1)` 这种未 tracked 的 receiver 否则仍可被洗白，而 poison 条目本身
   正是让该名字此后变为 tracked 的东西（`collectionAliasesForState` 的 tracked 判据
   含 `poisonedCollections`），下一次 push 的 `wasPoisoned` 因此为 true。
3. `poisonMutatedCollectionReceiver`（`:3641`）复用 push handler 的
   `carriesOnlyDerived` 判据（`principalExpressionKind === "derived"` 且无
   object-tainted escape）。参数并非全部 principal-derived（含 `args.length === 0`
   的全不透明 mutation）才 poison。挂载点在 un-modeled call 分支内、
   `invalidateCallEscapes` **之前**（`:6104`），并额外补在 `Object.assign` 自己的
   handler 上（`:5880`），因为 `Object.assign` 属于 modeled call、走不到前者。
4. `poisonEscapedCollections`（`:3672`）把同一 poison 延伸到**参数位置**：tracked
   collection 一旦交给 un-modeled callee，alias group 直接 poison（`:6111`）。这里
   刻意**只**处理已 tracked 的 collection——任意 identifier 传进 opaque call 由既有
   escape invalidation 负责，不在此扩权。imported helper 形态则由既有的
   traced-callee 回映（callee 内 parameter 被 poison → caller argument origin 被
   poison）覆盖，无需新增映射。
5. `clearPrincipalName` **不动**：它本来就不清 `poisonedCollections`，poison 因此能
   活过后续的 `invalidatePrincipalAlias`，正是第二条洗白路线所需的解法。

### 一次自伤与收敛方式（重要）

第一版把 receiver poison 无条件应用到**所有**非 allowlist 成员调用，真实树立刻从
`FINDING=0` 变成 `FINDING=4`（7 条 diagnostic），全部落在
`data.ts:198/242/281` 与 `library-actions.ts:66` 的 `storage.exists`。根因是同一份
production 形态：

```ts
const ext = g.asset.ext.toLowerCase();
const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
```

`toLowerCase` 不在 collection allowlist 内，于是 chain root `g` 被 poison、被踢出
`principalDerivedBindings`，`g.asset.ownerId` 的 owner provenance 随之蒸发——这是**我
自己引入的建模缺陷**，不是真实的未受保护调用点。

收敛方式是**新增健全建模**，不是放宽默认：未 tracked 的 receiver 只在 callee receiver
恰为**裸 identifier**时才 poison（`:3646`、`:3663`）。理由是精确的——裸 identifier 正是
后续 `.push` 唯一能 bless 进 `safeDerivedCollections` 的形态；经属性链访问的
collection（`box.keys`）在本 checker 里从来不是 tracked collection，sink 侧
`collectionReceiverIsDerived` 也要求 `ts.isIdentifier(receiver)`，因此该路径不可达。
同时把整块 receiver poison 收进 `!callIsModeled` 分支，避免误伤
`derivedMapGetCall`（`labels.get(...)`）、`derivedCollectionPreservingCall`
（`.slice()`）与 storage/prisma 等 modeled receiver。修正后真实树回到
`FINDING=0`，输出与基线**逐字节相同**。

### 刻意保留的边界

`box.keys.unshift(x)` 这类经属性链的 collection 不做递归推导，按 fail closed 处理——
它在修复前后都报红（由 `nested-derived-collection-carrier.ts` 一族固定），本轮不为它
新增建模。

> 更正（Round 28 补记）：上面这段（连同「修复」节末尾「该路径不可达」那句论证）
> **只对经属性链读取的 sink 成立**，覆盖不到攻击者真正会用的形态。实测：
>
> ```ts
> const keys: string[] = [];
> const box = { list: keys };
> if (input.extra) box.list.unshift(input.clientKey);          // 经属性链写入
> keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));  // 重新 bless
> return Promise.all(keys.map((key) => storage.get(key)));     // sink 读**裸标识符**
> ```
>
> 结果是 `ok=true`、**零 diagnostic**。只有把最后两行也改成经 `box.list` 读写
> （`box.list.push(...)` + `box.list.map(...)`）才报红 `principal-result-unused`。
> 原论证只证明了「`box.keys` 这个**receiver 形态**在 sink 侧不是 tracked
> collection」，没有证明「经 `box.list` 写入的污染到不了裸名 `keys`」——而
> `const box = { list: keys }` 让两者指向同一个运行时数组，污染当然到得了。
> 真实敞口是：**经属性链写入 + 经裸标识符读取**这条组合路径至今未关闭。
> 本轮（Round 28）不修它，只把描述改成可证的事实，并列入 §43「尚未关闭」。

### fixture

新增七个 one-export bypass negative control，全部固定为 `principal-result-unused`，
每个都是既有 `derived-collection-sticky-poison.ts` 的单 token 变体：
`derived-collection-unshift-poison.ts`、`-splice-poison.ts`、`-fill-poison.ts`、
`-object-assign-poison.ts`、`derived-collection-alias-unshift-poison.ts`、
`derived-collection-imported-unshift-poison.ts`（配套 support
`unshift-keys.ts`）、`derived-collection-dynamic-member-poison.ts`（把 allowlist 的
default-deny 语义钉死：动态成员名必须报红）。

新增两个 positive，双向钉住 allowlist：
`derived-collection-derived-unshift.ts`（`unshift` 只携带 owner-derived 值时必须绿，
锁住 `carriesOnlyDerived` 出口）与 `derived-collection-pure-read.ts`（`.slice()` 等
纯读成员不得 poison owner-derived collection）。

### 结果

focused suite 由 139 bypass / 40 positive 升至 **146 bypass / 42 positive**，exit 0，
实测 `real 2:00.66`（`user 197.62s`、`sys 6.70s`）。默认 production scan 实测
`real 1:59.31`（`user 196.92s`、`sys 6.68s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
222 个 reviewed exemption site、0 个 stale entry，exit 0——与 Round 25 基线输出
**逐字节相同**。

零回归：把 Round 25 的 suite 日志与本轮日志逐行 diff，唯一差异就是新增的 7 条
`EXPECTED FAIL` 与 2 条 `PASS`，既有 bypass 全部以原 reason 保持红、既有 positive
全部保持绿。ledger 未改，exemption site 与 identity 数均未变。FINDING 仍为 0，
真实树没有新增未受保护的 tenant-scoped 调用点，无需在 #458 立单。

> 更正（Round 28 补记）：上面这句「零回归」以 suite 日志为判据，是**成立的**——
> 但它看不见 suite 之外的**精度**回归，而本轮确实引入了一个。
> `poisonMutatedCollectionReceiver` 的 `carriesOnlyDerived` 要求**每一个**实参都
> principal-derived，于是位置型数字实参会把豁免打掉：
> `keys.splice(0, 0, <owner-derived>)` 报红 `principal-result-unused`，而语义等价的
> `keys.unshift(<owner-derived>)` 是绿的；`keys.fill(<owner-derived>, 0, 1)` 与
> `keys.copyWithin(0, 1)` 同理。它 fail closed，不是安全损失，但它**过度决定**了本节
> 新增的两个 fixture：把 `derived-collection-splice-poison.ts` 与
> `derived-collection-object-assign-poison.ts` 里的攻击者 key 换成 owner-derived key
> 之后两者**仍然报红**，说明它们那时并没有隔离出自己声称的 bypass class
> （`derived-collection-fill-poison.ts` 的对照组正确转绿，不受影响）。
> Round 28 用 `RANGE_ONLY_MUTATOR_SLOTS` 修掉了数字位置参数这一项，
> `splice` 的对照组随即转绿；`Object.assign` 那条另有第二个成因，仍未隔离，
> 两者见 §43。

## 42. Round 27：local object/class surface —— 本地对象门面整File脱离扫描

### 漏洞

本地声明的对象字面量（或本地 class 实例）只要用它的方法转发一个 tracked
capability，**整个文件会从扫描里静默消失**：`ok=true`、covered files = 0、
零 diagnostic、`FINDING=0` 全绿。这是 proof-carrying gate 最坏的失效形态——
不是把某个 entry 判错，而是连同文件一起从报告里删掉，没有任何信号。

```ts
"use server";
const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
return dispatch.run(prisma, id);   // find 体内是 db.contact.findMany({ where: { id } })
```

对照组 `return find(prisma, id);` 正确报红 `missing-principal-resolution`。

机制是三处**同时**失效：

1. `callBinding` 的 property-access 分支只解析 `frame.callbacks`、
   `namespaceImports`、`imports`；`const dispatch = { run: ... }` 三者皆不中，
   返回 `null` → `earlyBinding` 为空。
2. `unresolvedSameRepoCalleeNames` 的 property-access 分支只咨询
   `namespaceFunction`，对本地 receiver 返回 `[]`。
3. 于是 `unresolved same-repo callee …` 那道 fail-closed 闸门虽然
   `callPassesTrackedCapability` 已为 true，却因为名字表为空而从不触发。

同时 arrow body 根本没有被走过：`asyncExpression` 遇到 function-like 直接
`return states`，而对象字面量的属性函数只有在**作为 call argument 传入**并注册成
callback 时才会被展开；`info.localFunctions` 只登记函数声明与「initializer 本身就是
函数」的变量声明，对象字面量永远进不去。

**这是疏漏而非范围裁剪**：imported 同构形态一直是红的——
`import { repo } from …; repo.read(prisma, id)` → `unprovable`，
理由 `imported object surface repo.read receives a tracked DB/storage/queue
capability but its callee body cannot be resolved`。imported receiver 红、
local receiver 隐形，且文件头已自陈「Unresolved dynamic dispatch and computed
sensitive calls are always `unprovable`」。

实测转绿的形态共九种：arrow 属性、method shorthand、element access
`dispatch["run"]`、嵌套 `api.db.read`、module-scope 对象字面量、本地 class 实例
方法（`new Service().run` 与 `const svc = new Service(); svc.run`）、storage
capability 变体、以及**先正确 await requireOwner() 再泄漏**的 guard-then-leak 形态。
唯一残存的兜底是：当那句未加 scope 的查询**文本上就在 entry 文件内**时，
module 级 fallback 仍会响——但 capability tracker 在两种形态下都被绕开了。

### 修复

分两层，第一层给精确 diagnostic，第二层是它背后的 fail-closed 网。

1. **解析本地成员体**（`callBinding` 尾部，`:5127`）。新增
   `localMemberFunctionNode`（`:3166`）：用既有的 `memberPath` 拿到
   `{ root, members }`（property access 与字符串字面量 element access 通吃），
   经 `localReceiverInitializer`（`:3076`）取声明处 initializer——参数、import、
   global 一律不解析——再沿 `members` 逐层走对象字面量，
   末端是 function-like 就返回 `{ kind: "local", … }`。既有的 `kind === "local"`
   路径随即走 `invokeFunction` 追踪函数体，于是复现用例产出与直接调用对照组
   **完全相同**的 `missing-principal-resolution`。
   本地 class 走 `localClassMethodNode`（`:3153`）：`new X()` 形态经
   `visibleClassDeclaration` 找到本文件可见的 `ClassDeclaration`，再取
   `MethodDeclaration`。
   **不健全就不解析**（否则落到第二层）：receiver root 被重新赋值或被写成员
   （`dispatch.run = leak`，`assignmentTargetRootNames` 把它归到 root，
   故 `bindingIsReassigned` 一并覆盖）、receiver 被交给任何 call/new/spread
   （新增 `escapedReceiverNames`，`:3042`，专防 `Object.assign(dispatch, …)`
   这类不透明改写）、字面量含 spread 或 computed key、class 有 heritage clause。
2. **本地 receiver 兜底报红**（`unresolvedLocalReceiverNames`，`:5493`；
   闸门 `:6284`）。刻意**另起一个方法**而不改
   `unresolvedSameRepoCalleeNames`，既有行为零风险。命中条件：root 是本仓库内的
   局部变量声明（`visibleBindingNode` 得到 `VariableDeclaration`，或落在
   `frame.info.localValues`），且**不是** import / namespace import / callback /
   参数 / global，且**不是** tracked capability 本身
   （`expressionContainsTrackedCapability`）。沿用既有报错文案与
   `REASON.UNPROVABLE`。
   两道防回归护栏：闸门加 `!callIsModeled`，让 `$transaction`、`push`、
   `Object.assign`、derived-Map get、pg-boss `fromPrisma` adapter 等已建模形态保住
   各自的精确处理；root 解析不到任何本地声明时**不**加名字，保住 §39 对内建函数与
   任意 callback 的刻意豁免。因为它只在 `callPassesTrackedCapability` 已为 true 时
   才可能触发，爆炸半径被钉死在「本地非函数 receiver 被塞进 prisma/storage/queue」
   这一危险形态上。
   顺带按同一 default-deny 收口：computed 成员名（`dispatch[pick](prisma, id)`）
   原本因 `memberPath` 给出 `null` 而漏网，现在记为 `[computed]` 照样报红——
   动态 dispatch 本就永远钉不到函数体。

### fixture

8 个第一层 bypass（`local-object-surface-{arrow,method,element,nested,module-scope,
guarded,storage}.ts`、`local-class-surface-method.ts`），全部以
`missing-principal-resolution` 报红，与直接调用对照组同因。

6 个第二层 bypass（`local-object-surface-{assign-rewrite,member-write,spread,
dynamic-member,reassigned}.ts`、`local-class-surface-inherited.ts`），
全部以 `unprovable` 报红，逐条钉住上面每一个「不健全就不解析」的出口。

3 个 positive 证明第二层不误伤：`local-object-helper-pure.ts`
（不携带 capability 的普通本地 helper 对象）、
`local-object-repository-owned.ts` 与 `local-class-repository-owned.ts`
（按 ownerId 正确 scope 的本地 repository 形态，第一层把它们从**基线上的
误报 `unprovable`** 变成真正的绿灯——这正是第一层要买的精度）。

`assert.equal(result.files.length, 1, "must be content-covered")` 本来就在
fixture 侧，所以这批 fixture 天然把「静默掉出扫描」钉成硬失败。

### 针对「静默掉覆盖」本身的护栏

原先没有任何断言看住 production 的 covered-file 数，文件从被扫到消失读起来就是绿的。
`verify-auth-guards.test.mjs:338` 新增三条：covered file 数 ≥ 120、
covered entry 数 ≥ 465、以及任何 covered file 都不得报告 0 个 entry。
注释写明这两个 floor 只可随真实覆盖增长而上调，**绝不可为了让某次运行通过而下调**——
下跌正是它要抓的症状。实测把 floor 临时改成 121 会以
`production coverage fell to 120 file(s), below the 121 floor` 失败。
边界说明：floor 抓的是**既有覆盖下跌**（即本轮漏洞的失效形态），
新增文件一出生就隐形不会让 floor 下跌，那一类仍由 fixture 与 default-deny 建模兜底。

### 刻意保留的边界

`new ImportedClass().run(prisma, id)` 走第二层报红（不解析跨文件 class 体），
不做递归跨模块 class 解析——fail closed，非静默放行。

> 更正（Round 28 补记）：这一节**漏列了真正保留的边界**，读起来像是本节开头那句
> 「proof-carrying gate 最坏的失效形态」已经被关掉了。实际上「整个文件从扫描里静默
> 消失」这一失效形态**至今仍可复现**，只是入口换了几种 receiver 形态。
> 复现前提是那句未加 scope 的查询**不在 entry 文件文本内**（否则 module 级 fallback
> 仍会响，正如本节自己写过的兜底说明）；把 helper 挪进独立 module 后实测：
>
> | 形态 | 实测 |
> |---|---|
> | `class S { static list(db, id) { return findA(db, id) } }` → `S.list(prisma, id)` | `ok=true` **files=0** diags=0 |
> | `class S { static list = (db, id) => findA(db, id) }` → `S.list(prisma, id)` | `ok=true` **files=0** diags=0 |
> | `makeService().list(prisma, id)`（call-expression receiver） | `ok=true` **files=0** diags=0 |
> | `service.list(prisma, id)`（参数 receiver） | `ok=true` **files=0** diags=0 |
> | 函数体内 `new Map([...]).get("list")!(prisma, id)`（容器取出 callable） | `ok=true` **files=0** diags=0 |
> | 对照组 `findA(prisma, id)` | 报红 `missing-principal-resolution` |
> | `handlers[0](prisma, id)`（数组下标取出） | 报红 `unprovable` |
> | `new S().list(prisma, id)`（本地 class 实例） | 报红 `missing-principal-resolution` |
>
> 根因是第二层那道兜底闸门的**取名范围**：`visibleScopedBinding` 只认
> `FunctionDeclaration` 与 `VariableStatement`，`info.localValues` 也只从
> `VariableStatement` 填充，`ClassDeclaration` 两者皆不中；参数、call 表达式、
> 容器取出的 callable 同样拿不到「本地变量声明」这个身份。于是
> `unresolvedLocalReceiverNames` 返回 `[]`，`:6284` 的 fail-closed 闸门永不触发。
> 本节真正保留的边界应写为：**static class 成员 dispatch、call-expression receiver、
> 参数 receiver、容器取出的 callable**，加上原文那条跨模块 class 体。这些都是
> 静默放行（files=0），不是 fail closed——这是与本节其余部分性质完全不同的一类。
> Round 28 只做记录，不修（属于独立的范围决定），见 §43「尚未关闭」。
>
> 同时补一句上文 covered-file / covered-entry floor 的边界：它按构造只抓**既有覆盖
> 下跌**。上表这些形态若出现在一个**新增**文件里，该文件从出生起就 files=0，
> 120/465 两个 floor 都不会下跌，因此 floor 对「一出生就隐形」零信号——
> 那一类只能靠 fixture 与 default-deny 建模兜底。

### 结果

focused suite 由 146 bypass / 42 positive 升至 **160 bypass / 45 positive**，exit 0。
默认 production scan 为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
222 个 reviewed exemption site、0 个 stale entry，exit 0——与 Round 26 基线输出
**逐字节相同**。

零回归：把 Round 26 的 suite 日志与本轮逐行 diff，`<` 侧唯一一行就是那句统计汇总，
`>` 侧只有新增的 14 条 `EXPECTED FAIL` 与 3 条 `PASS`；既有 bypass 全部以原 reason
保持红、既有 positive 全部保持绿。ledger 未改。FINDING 仍为 0，真实树没有新增
未受保护的 tenant-scoped 调用点，无需在 #458 立单——事前 grep 也确认真实树不存在
「对象门面/class 实例方法接收 capability」这一形态（只有 Error 子类与 `new Stripe`）。

## 43. Round 28：trailing spread 覆盖已证明的 carrier ownerId —— 一次 RED→GREEN 回归

### 漏洞：Round 25 引入的回归

`principalPropertiesForExpression` 的 spread 分支不撤销任何 provenance，于是一个
**尾随的** spread 可以在运行时覆盖掉已经证明过的 `ownerId`，而围栏仍然全绿。
同一分析器、同一组探针，在 Round 25 之前的 HEAD（`1ec837cf`）与本轮开工时的
HEAD（`f17f98aa`）上的实测对照：

| 形态 | `1ec837cf`（Round ≤24） | `f17f98aa`（Round 25–27） |
|---|---|---|
| `load({ ownerId: gate.ownerId, ...input })` | 红 `missing-principal-resolution` | **绿，`ok=true`，零 diagnostic** |
| `load({ ownerId: input.ownerId })`（对照） | 红 | 红 |
| `load({ ...input })`（对照） | — | 红 |
| `load({ ownerId: gate.ownerId })`（干净） | 绿 | 绿 |
| `load({ ...input, ownerId: gate.ownerId })`（安全顺序） | — | 绿（正确） |

自明的荒谬之处：**两个各自都报红的部件，合起来反而转绿**。而运行时语义正好相反——
`{ ownerId: gate.ownerId, ...input }` 里尾随的 spread **覆盖** `ownerId`，下游那句
`prisma.contact.findMany({ where: { ownerId: scope.ownerId } })` 因此被 scope 到
**调用方自己挑的** tenant 上。这是跨租户读取，不是精度问题。

### 根因

`principalPropertiesForExpression` 的四个分支里，只有 spread 分支**没有 reject
action**：computed key 走 `properties.clear()`，未知 kind 的具名属性走
`properties.delete(name)`，唯独 spread 把未知内容当成一张空表 merge 进来，于是先前
写下的 `ownerId -> "binding"` 原封不动地活了下来。

同一个文件对**同一个运行时风险**在别处的处理是**正确**的：
`principalOwnerAuthorityKind` 的 spread 分支对「无法证明、且不是 owner-neutral」的
spread 会把 `ownerKind` 置 `null`；`principalKeyAuthorityEntries` 的 spread 分支更进
一步，用 `knownSpreadPropertyNames`（`:2284`）区分「已知 shape 只掀掉它能提供的键」
与「未知 shape 全清」。两个函数、同一语义、相反默认——而 Round 25 把弱的那个提拔成
了全树权威。

放大器是 Round 25 的第 4 步：撤掉参数传递处的 `isWorkspacePackageModule` 闸门之后，
这条不健全的子规则从 `packages/*` 扩到了**整个默认目标树**（`apps/web/lib`、
`apps/web/app`）。§40 第 4 点因此需要更正，见下。

### 修复

让 spread 分支镜像 `principalOwnerAuthorityKind` / `principalKeyAuthorityEntries`，
复用既有的 `knownSpreadPropertyNames`。改动落在 `:2036-2050`：

1. spread 的 shape **已知**时，从 `properties` 里删掉「它能提供、却证明不了」的每一个键；
2. spread 的 shape **未知**时，`properties.clear()`，再把 spread **自己**证明得了的键写回；
3. 两种情况最后都写回 spread 自证的键，因此 `{ ...OWNED }` 这类形态不受影响。

顺序是本修复的要点：spread 必须作废**写在它之前**的键，**不得**作废写在它之后的键。
因为循环按源码顺序处理，写在 spread 之后的键天然在其后被重新 `set`，所以
`{ ...input, ownerId: gate.ownerId }` 合法地保持绿灯。

**它只删 provenance、从不新增**，因此不放宽任何默认——这一点对本项目
「绝不可再放宽默认」的硬约束是关键的。

修复后同一组探针的实测（另加两条钉住已知 shape 分支的精度）：

| 形态 | 修复后 |
|---|---|
| `load({ ownerId: gate.ownerId, ...input })` | **红** `missing-principal-resolution` |
| `load({ ownerId: gate.ownerId, ...patch })`，`patch = { ownerId: input.ownerId }` | **红** |
| `load({ ownerId: gate.ownerId, ...{ ownerId: input.ownerId } })` | **红** |
| `load({ ownerId: input.ownerId })` / `load({ ...input })`（对照） | 红（不变） |
| `load({ ownerId: gate.ownerId })`（干净） | 绿（不变） |
| `load({ ...input, ownerId: gate.ownerId })`（安全顺序） | **绿**（不变，必须保持） |
| `load({ ownerId: gate.ownerId, ...{ label: input.label } })` | **绿**（已知 shape 提供不了 ownerId，精度不被误伤） |
| `load({ ownerId: input.ownerId, ...{ ownerId: gate.ownerId } })` | **绿**（spread 自证覆盖，last-wins 正确） |

### 对 §40 第 4 点的明确更正

§40 第 4 点原文写「撤掉参数传递处的 `workspacePropertyProvenance` 闸，逐属性
provenance 对所有 module 生效。**这不是放宽**」。对本节这一形态而言，
**它就是相对 HEAD 的 RED→GREEN 放宽**：`{ ownerId: gate.ownerId, ...input }` 在
Round 25 之前报红，之后转绿。原句成立的前提是「逐属性 provenance 会对每个未证明
的属性 default-deny」——而 spread 分支当时并不 default-deny，前提不成立，结论也就
不成立。`:6804-6813` 的代码注释同步更正为「Round 25 的 default-deny 自陈当时是错
的，它现在成立、且仅因 Round 28 的撤销而成立」。逐属性 provenance 本身的方向
（严格窄于 blanket object 授予）没有问题，问题在于当时缺了 spread 这一道撤销。

### 附带修掉的精度回归

`poisonMutatedCollectionReceiver` 的 `carriesOnlyDerived` 要求**每一个**实参都
principal-derived，于是位置型数字实参会把豁免打掉：`keys.splice(0, 0, <owner-derived>)`
报红，而语义等价的 `keys.unshift(<owner-derived>)` 是绿的。它 fail closed，不是安全
损失，但它**过度决定**了 Round 26 新增的 fixture（见 §41 的 Round 28 更正）。

修法是**新增健全建模**而非放宽：新增 `RANGE_ONLY_MUTATOR_SLOTS`（`:201-213`），
只登记那些「按签名定义就只能寻址、不可能把值送进 collection」的位置：
`splice(start, deleteCount, …)` 的前两位、`fill(value, start, end)` 的第 1 位起、
`copyWithin(target, start, end)` 的全部（它只搬运 receiver 里已有的元素，引入不了新
内容）。豁免另加两道限制：实参必须是**纯数字字面量**（计算出来的下标仍是不透明
escape，继续 fail closed），且成员名必须由 `callMemberName` 静态解析得出（动态成员
返回 `null`，拿不到豁免）。`Object.assign` 那个挂载点不传成员名，行为完全不变。

实测：`splice(0, 0, <owner-derived>)`、`fill(<owner-derived>, 0, 1)`、
`copyWithin(0, 1)` 由红转绿；`splice(0, 0, input.clientKey)` 与
`splice(0, 1, input.clientKey)`（攻击者参数夹在数字之间）保持红。

### fixture

spread 修复新增两个 bypass，全部固定为 `missing-principal-resolution`：
`trailing-spread-carrier.ts`（未知 shape 的尾随 spread）与
`trailing-spread-known-carrier.ts`（两个 export：内联已知 shape 与本地变量 shape，
用 `MULTI_EXPORT_BYPASSES` 钉住两条都必须红）。
新增 positive `leading-spread-carrier.ts`（两个 export：安全顺序
`{ ...input, ownerId: gate.ownerId }` 必须绿；已知 shape 只提供 `label` 时
`ownerId` 不得被误伤），双向钉死「作废写在前面的、不作废写在后面的」这条顺序语义。

精度修复新增 positive `derived-collection-derived-splice.ts`
（`splice(0, 0, <owner-derived>)` 与 `fill(<owner-derived>, 0, 1)` 必须绿），
把这条精度钉住，防止再次静默漂移。

### 结果

focused suite 由 160 bypass / 45 positive 升至 **162 bypass / 47 positive**，exit 0，
实测 `real 1:59.96`（`user 197.34s`、`sys 6.63s`）。covered-file / covered-entry floor
仍为 `120 file(s) / 465 entr(ies)`，两个 floor 均未改动。

默认 production scan 实测 `real 1:59.65`（`user 196.86s`、`sys 6.45s`），结果为
`PASS=61 INTERNAL-PASS=27 ADMIN-PASS=2 EXEMPT=30 FINDING=0`，120 个 covered file、
222 个 reviewed exemption site、0 个 stale entry，exit 0。把 `f17f98aa` 的
`scripts/verify-auth-guards.mjs` 原样取出单独跑一遍作基线，两份完整输出
**逐字节相同**。

零回归由 suite 自身证明：它对每一个 bypass fixture 断言**精确的 reason**、对每一个
positive fixture 断言**零 diagnostic**，160 条既有 bypass 与 45 条既有 positive 全部
以原判据通过，日志差异只有新增的 2 条 `EXPECTED FAIL` 与 2 条 `PASS`。ledger 未改，
exemption site 与 identity 数均未变。FINDING 仍为 0，真实树没有新增未受保护的
tenant-scoped 调用点，无需在 #458 立单。

### 尚未关闭（本轮明确不修，只据实记录）

以下四族都**在本轮开工前就已存在**，不是 Round 26/27/28 的回归；它们各自需要独立的
范围决定，不应被塞进这一轮悄悄扩面。每条都附可复现的实测形态。

1. **构造期污染**（§38 更正指向此条）。
   `const keys: string[] = [input.clientKey];` 之后一次 trusted push →
   `ok=true`、零 diagnostic。根因：`emptySafeCollection`（`:7250`）要求 initializer 是
   **元素数为 0** 的数组字面量，非空字面量因此从头到尾**不被 tracking**，
   `poisonedCollections` 里自然没有它；随后那次 `carriesOnlyDerived` 的 push 看到
   `wasPoisoned === false`，直接把整个 list 写进 `safeDerivedCollections`。
   对照组 `if (input.extra) keys.push(input.clientKey);` 正确报红。

2. **callback 体内插入**（§38 更正指向此条）。
   `input.rows.forEach((row) => { keys.push(row.raw); });` 之后一次 trusted push →
   `ok=true`、零 diagnostic。poison 在 callback 退出时被丢掉，没有回映到 caller 的
   collection binding。

3. **经属性链写入 + 经裸标识符读取**（§41 更正指向此条）。
   `const box = { list: keys }; box.list.unshift(input.clientKey);` 之后一次 trusted
   push、sink 读**裸名** `keys` → `ok=true`、零 diagnostic。§41 原先记的边界只覆盖了
   「sink 也经 `box.list` 读」的形态（那一支确实报红），覆盖不到攻击者真正会用的
   裸名 sink。

4. **整文件静默脱离扫描**（§42 更正指向此条，含实测对照表）。
   static class 成员 dispatch、static class 属性箭头、call-expression receiver、
   参数 receiver、函数体内容器取出的 callable，五种形态在「敏感 helper 位于独立
   module」时都是 `ok=true`、**files=0**、零 diagnostic——文件连同 entry 一起从报告里
   消失。根因是 `visibleScopedBinding` 只认 `FunctionDeclaration` 与
   `VariableStatement`、`info.localValues` 只从 `VariableStatement` 填充，
   `ClassDeclaration` 两者皆不中，于是 `unresolvedLocalReceiverNames` 返回 `[]`，
   `:6323` 的 fail-closed 闸门永不触发。数组下标取出（`handlers[0](...)`）与本地
   class 实例方法则**正确 fail closed**。
   与之配套的诚实说明：covered-file / covered-entry floor 按构造只抓**既有覆盖下跌**，
   一个从出生起就 files=0 的新文件不会让 floor 下跌，因此 floor 对这一族零信号。

另有一条**精度**（非安全）缺口：`derived-collection-object-assign-poison.ts` 在把攻击者
key 换成 owner-derived key 后**仍然报红**，所以它至今没有隔离出自己声称的 bypass
class。第二个成因与上面那条数字位置参数无关：
`Object.assign(keys, { 0: <owner-derived> })` 里那个**容器字面量实参**本身永远不是
`"derived"`——`principalExpressionKind` 不对对象/数组字面量做逐元素推导，只有裸的
derived 表达式（`Object.assign(keys, <derived>)`）才拿得到绿灯。要关它就得给
`carriesOnlyDerived` 增加容器字面量的逐元素 provenance 建模，那是独立的范围决定，
本轮不做，也**不**用「字面量一律视为安全」这种放宽默认的捷径去凑绿。该 fixture
作为 bypass 仍然有效（攻击者形态正确报红），只是它的隔离性待补。
