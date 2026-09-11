# Round 2 覆盖矩阵（coverage-matrix）

> 每个 `R2-xx` × 验收编号／登记行一行。判定值：PASS／PARTIAL／FAIL／NOT RUN／BLOCKED。
> 「需查表才能定」的判定先记 PARTIAL（待后端取证），并在 `run-ledger.md` 写明要查什么 —— 后端取证由 W2 写进 `backend-evidence.md`。
> 依据：`plan.md` §2 与 §3.5 对账表。

## Preflight

| 项 | 判定 | 证据 |
|---|---|---|
| P0-1 版本对齐（web/worker 同版、/api/ready、/api/health） | PASS | run-ledger §0 P0-1；`build.sha=2a96750e`，两服务 commitHash 相同 |
| P0-2 前置票 15 张 | PARTIAL | 14 张已上线；#1320／PR #1349（登录门⑤）仍 OPEN → R2-03 排最后、执行前重查 |
| P0-3 环境边界 | PASS（已复述） | staging 桶 `fikirtive-staging` ≠ production `fikirtive-production`（ENV-01 本轮不成立）；`E2E_GOOGLE_DOOR_STUB` 未武装；`backup=missing` |

## 走查条目

| 条目 | 验收编号／登记行 | 判定 | 证据指针 |
|---|---|---|---|
| （执行中，逐条追加） | | | |
