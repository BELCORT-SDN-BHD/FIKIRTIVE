# B9 · OTTO Phase 1 composition seam 施工证据

> 工单：`WO-OTTO-PHASE1 r004`（第二次诚实修复轮），base `c116b10bb42cbba6a6ee06a77ffe9d03d2ee6dba`。本报告只记录 scoped author lane 的结果与边界；不改写 B9 冻结契约，不代表 global control plane 验收或 merge 授权。

## M1–M6 对账

| 项目 | 落点 | 断言与变异证据 |
|---|---|---|
| M1 退款/结算身份 | `packages/otto/src/runtime.test.ts` | refund 核对当前 reservation 的 `{orgId:"org_t", refId:"paid:stream-error"}`；settle 核对 `{orgId:"org_t", refId:"fixture:stream-order", actualInternal:1}`。`meter.ts` 临时改为 wrong org/ref 后 refund 用例 exit 1；success settle 临时改为 wrong org/ref/amount 后 order 用例 exit 1；逐项还原后 PH1F-A2 2/2。见 r004 `EVIDENCE/02-m1-refund-settle-mutations.txt`。 |
| M2 排空完成次序 | `packages/otto/src/runtime.test.ts` | 受控 gate 在 iterator yield 后阻塞，释放前快照只能有 `drain-start`；释放后要求 `drain-complete → completed → usage`。`runtime.ts` 临时改成启动 `onStream`、先 await `completed`、再 await stream 后，释放前收到 `drain-start,completed`，用例 exit 1；还原后 2/2。见 `EVIDENCE/03-m2-drain-order-mutation.txt`。 |
| M3 AST fence | `scripts/check-otto-cli-fence.mjs` | 通过现有 Otto workspace 依赖加载 TypeScript，并用 `ts.createSourceFile` 枚举 static import/export、import-equals、dynamic import、require 与 import type；静态求值只覆盖 literal/template、`+` 和唯一 local binding。12 个 fixture 覆盖两种 regex-comment 形状、行续接、hex/Unicode/non-escape/legacy-octal、计算拼接、变量/template、export-from、import-equals；另有 symlink 与 test-directory fixture。删除 literal/concat/binding/symlink/test-skip 分支的临时变异分别点名变红；扫描任意字符串的变异使 green docs fixture 变红；全部还原后 self-test 与仓库扫描 exit 0。见 `EVIDENCE/04-m3-ast-fence-mutations.txt`。 |
| M4 报告诚实边界 | 本文件 | 删除 r003 对退款、次序和 regex fence 的过度陈述；每个正向结论均指向对应变异记录；未覆盖面逐项列在下节。 |
| M5 worker 断言 | `apps/worker/src/otto-resume.test.ts` | winning path claim 恰好一次；restore 入参同时核对 full-tool `otto` identity、非零且完整 toolset、旧 state；sanitizer fixture 喂 stale system + data-URL input image，并精确核对只保留 user text 后追加 verdict。临时改用 zero-tool agent、重复 claim、移除 sanitizer 时分别 exit 1；还原后 worker 相关用例全绿。见 `EVIDENCE/05-m5-worker-mutations.txt`。 |
| M6 交付 | r004 mailbox、commit、PR #315 | mailbox 含 `REPORT.md`、`STATE.json`、`EVIDENCE/`、`ESCALATION.md`；fence 接线仍交给控制面；作者不合并。交付命令、commit 与 PR 跟评记录在 mailbox。 |

## 实际测试口径

| 文件/命令 | 数量/结果 | 本轮可陈述范围 |
|---|---:|---|
| `packages/otto/src/runtime.test.ts` | 19/19 | r004 新断言集中于 PH1F-A2 2 个用例；M1/M2 的故障注入均使目标用例 exit 1。 |
| `apps/worker/src/otto-resume.test.ts` | 14/14 | r004 恢复 full-tool restore、winning claim once、sanitizer wiring 三组断言；三组故障注入均使目标用例 exit 1。 |
| fence `--self-test` | 12 个 AST bypass fixture + symlink + test exclusion | literal、concat、binding、symlink、目录排除与 green non-import 均有对应红变异。 |
| fence repository scan | exit 0 | 当前 `apps/**`、`packages/**` 边界内未发现静态可解析的 forbidden import。 |
| CI `check` | exit 0 | `ci.yml` check job 的全部本地命令。 |
| CI `test` | exit 0 | 71 migrations、schema drift none、2923 tests。 |
| CI `web-build` | exit 0 | production Next.js build 完成。 |
| CI `lint` | exit 0 | 0 errors；75 个既有 warnings。 |

## 覆盖边界（完整披露）

- PH1-A5 的测试检查显式 deps/profile 与三个 selector-like env 名；没有构造 HTTP request，所以没有逐一动态覆盖 header、cookie、query、body 注入通道。
- 旧 state → 新 agent 用例覆盖本地 SDK serialize/restore/resume；provider 是本地 stub，不覆盖真实 LLM/provider、真实 schedule port、外部发布副作用或网络。
- worker entry 测试保留真实 runner/finalizer/runtime/restore/sanitizer，但 DB IO、SDK `run` 与 `withLlmBudget` execution primitive 是 mock；它不等同于真实 worker + PostgreSQL + provider 的端到端执行。
- PH1F-A2 走 production `runOttoTurn` 与 `withLlmBudget` 控制流，但 reserve/refund/settle DB 函数是 spy。它对传入 identity/amount 的敏感性有故障注入记录，不验证 ledger 事务最终真的释放 reservation。既有 `meter.test.ts` 同类 identity 缺口由 #321 处理，不在 r004 write scope。
- M2 使用受控 async iterator/gate，覆盖 drain completion、completed、usage-map 的调用次序；不模拟真实网络 backpressure、客户端断连时序或 provider streaming transport。
- `apps/web/lib/__tests__/otto-stream-route.test.ts` 的既有 3 个用例没有 MaxTurns HTTP 路由场景；r004 没有把它描述为已覆盖。
- fence 只扫描 `apps/**` 与 `packages/**` 下扩展名为 JS/TS 的 production source；排除 `test`、`tests`、`__tests__`、`*.test.*`、`*.spec.*`、dependencies、`.next`、`.turbo`、dist/build/out/coverage。仓库其他根不在范围内。
- fence 实现会跟随边界内 symlink 文件/目录并防目录循环；r004 的 fixture 与 symlink-branch 变异覆盖的是 symlink **文件**，未单独对 symlink 目录做故障注入。它会读取边界内 link 指向的内容，但这不扩大顶层入口到 apps/packages 以外的任意独立文件。
- 静态 specifier 仅求值 literal/no-substitution template、template span、`+` 拼接、括号/type wrappers 与无歧义 local variable initializer。函数返回、property access、条件表达式、运行时输入及其他任意计算不在静态结论内。
- forbidden 名单是当前 Flight Simulator/subscription CLI driver 命名规则，不是任意未来 driver 名称侦测器，也不是凭证或一般内容扫描器。普通文档字符串不会被当作 import 拒绝。
- fence 目前仍是手动脚本，未接 root `package.json` 或 `.github/**`；两处均不在本工单 write_set。在控制面另行接线前，一次仓库 scan exit 0 不是持续 CI 门禁。
- r004 最终相对 base 对 `runtime.ts`、`meter.ts`、`model.ts`、`otto.ts`、`apps/worker/src/otto-resume.ts` 为零 diff；所有 production 临时变异均已反向还原。
- 本轮没有真实 LLM/provider 请求、外部发布、部署或付费动作，真实花费为 $0。

## 交付边界

锁定输入 hash、write-set、forbidden roots、production 零 diff 与 harness generation 由 r004 mailbox 记录。施工数据库 `fikirtive_wophase1_test` 在 delivery 前删除。

本 PR 因既有钱路 diff 被裁定 **founder-only**。作者与控制面均不合并。
