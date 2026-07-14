# B9 · OTTO Phase 1 composition seam 施工证据

> 工单：`WO-OTTO-PHASE1 r003`（诚实修复轮），base `725773ba11922fda1ffaf014dc1ddd8d935cfb78`。本报告只记录 author lane 的证据边界；不改写 B9 冻结契约，不代表 global control plane 验收或 merge 授权。

## r003 施工结果

- 本轮没有改动 `runtime.ts`、`meter.ts`、`model.ts`、`otto.ts` 或任何 production entry；生产运行语义相对 r003 base 为零改动。
- `apps/worker/src/otto-resume.test.ts` 不再在 `@fikirtive/otto` mock 中重写 runner/finalizer。测试执行 production `runOttoTurn`、`finalizeOttoTurn`、`ottoWorkerVerdictRuntime`、`RunState` restore 与 history sanitizer，只替换 `OttoRuntimeExecution` 的 `run` / `withLlmBudget` 原语及 DB IO。
- worker 用例的预算断言落在真实 `ottoBudgetArgsFor` 结果：`model`、`paid`、`maxSteps=1`、manifest `prices` identity 与 `usageOnError` 均逐项核对。
- runtime 用例增加 paid stream 的 `onStream` throw：真实 `withLlmBudget` 先 reserve，随后整笔 refund，且不调用 success settle；另用明确事件序列钉住 `drain → completed → usage`。
- runtime 用例由独立旧构造 Agent 生成真实 SDK parked state，再用 `RunState.fromString(ottoApprovalResumeRuntime.agent, state)` 恢复、approve 并成功 resume；provider 边界使用本地 stub，未发网络请求。
- CLI fence 扫描根由三个子树扩到 `apps/**`、`packages/**` 的 production JS/TS，并以去注释、解码字符串字面量的保守规则拒绝具名 driver；自测为五种已点名绕过分别配置红 fixture。

## 诚实测试口径

| 文件/命令 | 数量 | 本轮实际证明 |
|---|---:|---|
| `packages/otto/src/runtime.test.ts` | 19 | profile/manifest/shared runner；真实 meter stream refund；drain/completed/usage 次序；旧构造 Agent state 到 production approval Agent 的 SDK restore/resume |
| `apps/worker/src/otto-resume.test.ts` | 14 | worker entry 经真实 runner/finalizer/runtime；完整预算参数；真实 serialized history；claim/CAS/best-effort/capability boundary |
| `scripts/check-otto-cli-fence.mjs --self-test` | 1 绿 + 5 红 fixture | inline block comment static import、同行 directive 后 static import、template dynamic import、variable dynamic import、Unicode escape 均被拒绝 |
| `apps/web/lib/__tests__/otto-stream-route.test.ts`（既有，未改） | 3 | 成功 stream、canvas references、余额不足；**没有 MaxTurns 用例** |

r003 新增 **3 个 Vitest 用例**（runtime 16→19）；worker 14 个既有用例被改为真实 composition seam，数量不变。fence 红 fixture 由 2 增至 5，增加 3 个。

## 覆盖边界

- PH1-A5 的测试证明 factory 只接收显式 deps/profile，并证明三个 selector-like env 名不是 API 输入；它没有构造 HTTP request，因此不把 header/cookie/query/body 各入口宣称为动态回归覆盖。production 静态 composition 事实仍可由源码审查，但不是这组测试独立证明的请求通道矩阵。
- 跨 Agent state 用例证明 SDK agent/tool identity 映射、approval 记录与 resume 能继续完成；它不证明真实 provider、真实 schedule port 或外部发布副作用。provider edge 被 stub，且没有真实花费。
- worker entry 用例 mock DB IO 与两个 execution primitives；真实 ledger 数据库行为由既有 meter/db suites 承担。本轮 stream-error 用例执行真实 `withLlmBudget` 控制流，但 reserve/settle/refund 函数本身是 spy。
- fence 范围是 `apps/**`、`packages/**` 的 production JS/TS；排除 tests、dependencies、build/coverage output。完全由计算拼接、且源码中不出现任何 forbidden literal 的 specifier 不能由这个静态扫描器证明；apps/packages 之外也不在范围内。
- fence 当前只能手动运行，**尚未接入 root `package.json` 或 `.github/workflows/ci.yml`**。两处属于控制面 write_set，本 author lane 未改；接线前不能把一次 PASS 当作持续门禁。

## Money-safety 证据

- `onStream` throw 的新用例走 production `runOttoTurn` + `withLlmBudget`：reserve 调用先于 refund，settle 未调用。
- worker verdict 的真实预算派生为 production model、`paid:true`、single-step reserve、manifest pricing，并验证 MaxTurns state usage 才触发 actual-usage 映射。
- 本轮没有改动 spend/ledger/provider production 实现，没有调用真实 LLM/provider，没有外部写，没有真实花费。

## r003 验证

| 命令/范围 | 结果 |
|---|---:|
| harness startup / prewrite | generation 4，changed=0，0 / 0 |
| harness boundary（施工后） | generation 4，changed=4，0 |
| runtime focused suite | 19/19，0 |
| worker focused suite | 14/14，0 |
| CLI fence self-test + repository scan | 1 green + 5 named red；apps/packages scan PASS，0 |
| CI `check` job 原样命令 | 0 |
| CI `test` job原样命令 | 71 migrations；schema drift none；2923 tests，0 |
| CI `web-build` job原样命令 | production build 完成，0 |
| CI `lint` job原样命令 | 0 errors；75 个既有 warning，0 |

锁定输入 SHA-256、write_set、forbidden roots 与相对 base 的 production-semantics diff 由 delivery harness 和 r003 mailbox 双份记录。施工测试库 `fikirtive_wophase1_test` 在交付前删除。

本 PR 已裁定 **founder-only**（既有 diff 触及 `meter.ts`）。作者与控制面均不合并。
