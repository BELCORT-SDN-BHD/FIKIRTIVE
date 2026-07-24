# Auth guard fence：双契约设计

`scripts/verify-auth-guards.mjs` 对每个可达敏感操作证明以下两种契约之一。敏感操作包括
Prisma/原始 SQL、队列发送，以及一层同 package 的敏感调用；无法静态解析的动态分派
仍然 fail closed。

## 1. ENTRY 契约

ENTRY 是身份从请求进入系统的边界。结构信号采用闭集：

- `app/api/` 下的 route；
- 文件顶层 directive prologue 含 `"use server"`；
- 文件名为 `*-gateway.ts(x)`。

ENTRY 的每一条敏感路径必须先消费从受信 resolver 返回的 principal。调用者传入
`ownerId` 不能替代 resolver，因此 ENTRY 不能申报 INTERNAL。受信 resolver 仍只按
「精确模块路径 + 精确 export」认定；本轮现场复核没有发现需要扩充的 resolver 模块，
当前集合仍为 `apps/web/lib/auth-guard.ts` 中的 `requireSession`、`requireRole`、
`requireAdmin`、`requireOwner`。本地 `resolvePrincipal` wrapper 会被解释执行，不按名字
直接放行。

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

逐文件 verdict 为 `PASS`、`INTERNAL-PASS`、`EXEMPT` 或 `FINDING`。`FINDING` 行打印实际
implementation 的 `file:line`；跨模块时同时打印 origin export。
