# B9 · OTTO Phase 1 composition seam 施工证据

> 工单：`WO-OTTO-PHASE1 r002`。本报告只记录 author lane 的行为不变施工证据；不改写 B9 冻结契约，不代表 global control plane 验收或可合并结论。

## 施工结果

- 新增 `OttoRunProfile`、`OttoModelRuntime`、`OttoRuntimeDeps` 与 `createOttoRuntime` / `runOttoTurn` / `finalizeOttoTurn`。
- production composition root 在进程装载时显式绑定既有 Anthropic Sonnet 4.6 + 同阶 4.5 仅 529 fallback；runtime 与 manifest 冻结，request/header/cookie/query/body/env 均没有 runtime 选择入口。
- model binding、billable model、usage mapper、cache capability、price lookup 与 `withLlmBudget` 的 model/paid/maxSteps/prices/usageOnError 均由同一 manifest/runtime 派生。
- fresh non-stream、stream、approval-resume、worker-verdict 四入口均经同一 `runOttoTurn`；持久化前均消费同一 `finalizeOttoTurn` 投影。profile 只改变 tools/steps：前三者全 tools + 10 步，worker verdict 零 tools + 1 步。
- 既有 persistence、approval hash、pending→approved CAS、consume-before-act、RunState、thread CAS、degrade 与 receipt/card 语义保留；`runFactoryBatch` resume 仍把已消费 APPROVAL_CARD id 绑定为 server-only attempt id。
- `research.ts` 没有加入 profile enum，只把 billable model 常数来源改为 production manifest。

## 四入口 contract matrix

Phase 1 专用 matrix 共 **22 个用例**：

| 文件 | 用例数 | 覆盖 |
|---|---:|---|
| `packages/otto/src/runtime.test.ts` | 16 | profile tools/steps、manifest 原子性/不可变、client/env 不可选 fixture、fresh/stream/approval-resume/worker-verdict 共用 runner/finalizer、fake provider 安全 skill、park→serialize→restore→approve→resume |
| `apps/web/lib/__tests__/otto-actions.test.ts` | 5 | fresh 计量、generate approval-resume 计量、`runFactoryBatch` consume-before-resume/attempt binding、hash collision fail-closed、fresh 无 attempt fail-closed |
| `apps/worker/src/otto-resume.test.ts` | 1 | production worker verdict 同 manifest 计费、零 tools、单步、CAS persistence |

另有既有 `otto-stream-route.test.ts` 3 例继续验证 authenticated stream route 的 reserve→stream→usage→finalize、insufficient credits 与 max-turns 行为；不计入上述 22 个 Phase 1 专用 matrix 用例。

## Money-safety 自查

- reserve 仍在 SDK run 前发生；reserve 失败时 runner 不执行。
- run `maxTurns` 与 reserve `maxSteps` 由同一 profile cap 产生，不存在 10 步执行配 1 步预扣。
- success 仍按 manifest price + mapped actual usage settle；无 usage 仍 settle 全 reserve；普通 throw 仍整笔 refund；带 RunState usage 的 MaxTurns 仍 settle actual。
- `withLlmBudget` 新增的 `prices` 只替换 price table 来源；reserve/settle/refund 顺序、idempotent refId 与 fail-closed fallback 均未改变。专测证明 manifest prices 同时用于 reserve 与 settle。
- `fixture-no-charge` 只有独立测试 manifest 可声明；production manifest 不含该值且被冻结。
- 没有调用真实 LLM/provider，没有外部写，没有真实花费。

## CLI import fence

- `node scripts/check-otto-cli-fence.mjs --self-test`：退出 0；绿色 fixture 放行，2 个红色 fixture（静态/动态 CLI driver import）均被拒绝。
- `node scripts/check-otto-cli-fence.mjs`：退出 0；扫描 `apps/web`、`apps/worker`、`packages/otto/src` 的 production source，无 CLI/Flight Simulator driver import。
- **control-plane 接线升级项**：把该脚本接入 root `package.json` 与 `.github/workflows/ci.yml`。两者不在 r002 write_set，本施工 lane 明确未改。

## Author-lane 验证

| 命令/范围 | 结果 |
|---|---:|
| `pnpm --filter @fikirtive/otto typecheck` | 0 |
| `pnpm --filter @fikirtive/otto build` | 0 |
| Otto package tests | 636/636，0 |
| `pnpm --filter @fikirtive/worker typecheck` | 0 |
| Worker tests | 157/157，0 |
| `pnpm --filter @fikirtive/web typecheck` | 0 |
| web 关键 suites（otto-actions / stream-route / factory-approval / refgen-approval） | 98/98，0 |
| Phase 1 contract matrix | 22/22（runtime 16 + web 5 + worker-verdict 1），0 |
| CI `check` job 全量口径 | 0 |
| CI `test` job 全量口径（71 migrations、schema drift none、2920 tests） | 0 |
| CI `web-build` job 全量口径 | 0 |
| CI `lint` job 全量口径（0 errors；75 个既有 warning） | 0 |
| execution harness boundary（generation 3，changed=17） | 0 |

锁定输入与 shared-contract 9 个文件的 SHA-256 均与 `INPUTS.lock.json` 一致，锁定路径相对 frozen base 的 `git diff --name-only` 为空；`git diff --check`、CLI fence 自测/扫描与最终 boundary 均通过。施工测试库 `fikirtive_wophase1_test` 在四关完成后删除。本报告不代表 merge 授权；author lane 不合并。
