# 路线乙 · 有界执行 Harness

> 本目录只保存 dispatch/control metadata。它不记录产品能力、施工状态或路线乙进度，
> 也不替代路线乙五本账。范围矩阵、依赖状态、决策日志、风险待裁与证据清单仍是产品真源。

## 用途

Global control plane 先在其独占位置签发一个不可变 revision，再让 scoped orchestrator
只凭这个 revision 和钉死的项目法律启动。一个 revision 由四个控制文件组成：

- `BOOTSTRAP.md`：身份、epoch、claim、worktree、runtime mailbox 与停手条件；
- `WORK-ORDER.md`：唯一任务授权，二级标题只能依次为
  `OBJECTIVE / SCOPE / OUTPUT / ACCEPTANCE / BUDGET`；
- `INPUTS.lock.json`：权威输入与共享契约输入的 SHA-256；
- `OWNERSHIP.json`：允许写的 exact files / directory prefixes、锁定输入与互斥组。

四个控制文件自身不写自己的授权 hash。Global-owned `CLAIMS.json` 独占锚定四文件与
`scripts/execution-harness-check.mjs` 的五个 hash，避免自引用或控制文件自授权。

## 目录契约

```text
global-owned control root/
  <work-order-id>/
    <revision>/
      BOOTSTRAP.md
      WORK-ORDER.md
      INPUTS.lock.json
      OWNERSHIP.json

global-owned registry/
  CLAIMS.json

runtime mailbox/
  REPORT.md
  STATE.json
  EVIDENCE/
    manifest.json
    <command-output files>
```

Revision 建立后不可原地修改；任何变更都发新 revision、重算五个 hash、提升 registry
generation。Scoped session 不得发现、猜测或修改 claim registry；每次调用必须显式传入其
绝对路径。

## 四阶段校验

```bash
node scripts/execution-harness-check.mjs \
  --phase startup \
  --control-dir /absolute/path/to/revision \
  --claims /absolute/path/to/CLAIMS.json
```

同一命令只替换 phase：

1. `startup`：读取控制面、重算全部 hash 与输入 hash，验证当前 generation/ACTIVE claim，
   并要求 `HEAD == base_sha` 且 worktree clean；
2. `prewrite`：第一次 repo 写入前重复全部校验，仍要求 frozen base 与 clean；
3. `boundary`：每个 phase boundary 重验 generation、claim、hash、ownership conflict，
   并检查截至当前的 committed/uncommitted/untracked diff；
4. `delivery`：再次执行 boundary 全套，并验证 runtime report/state/evidence 的完整性、
   Git facts、证据 hash、验收映射和 no-out-of-scope 声明。

未知 phase 一律失败。每阶段都重新读取 registry；`REVOKED`、`SUPERSEDED`、`STALE`、
generation 漂移或 token 漂移均 fail closed。

## Ownership 规则

只支持两种机器可靠的写范围：

- `exact_files`：规范化 repo-relative 文件路径；
- `directory_prefixes`：以 `/` 结尾的规范化 repo-relative 目录前缀。

不支持 glob、否定式 pattern 或隐式默认目录。Active scoped claims 的 writer overlap、
write-vs-locked-input overlap、共同 exclusive group 都失败。以下范围即使被恶意写进
ownership 也失败：四控制文件、checker、claim registry、路线乙五本账、Blueprint、
schema/migrations、pricing authority、CI/root config、shared registry/parity/catalog 与 secrets。

`delivery` 以 `base_sha..HEAD`、`git diff HEAD` 和 untracked files 的并集为事实；报告里的
`changed_files` 不能替代 Git，也必须与 Git 事实完全相等。

## Scoped 身份单调性

有效 bootstrap 固定 `role=scoped-orchestrator`、`no_global_claim=true`，并声明 promotion 与
descendant claims 均 forbidden。Registry 中 scoped claim 只能由
`issuer_role=global-control-plane` 直接签发，`parent_claim_id` 必须为 `null`。Scoped lane
不得晋升 global、再签 scoped descendant、改 global epoch、宣告 program completion 或执行
merge。`author_identity == merger_identity` 是硬失败。

## 模板

`templates/` 含六个复制起点。占位值必须在签发前替换；模板本身不是 claim，也不能直接
启动 session。Claim registry schema、字段闭集与 runtime 验收见
`WORK-ORDER-SCHEMA.md`。
