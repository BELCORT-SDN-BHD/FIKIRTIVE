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

Checker 先把 worktree、control directory、registry 与 mailbox 全部解析成 canonical path。
Worktree 必须正好是 Git repository top level；其余三者必须在 worktree 外。Control directory
和 registry 各自都必须与可写 mailbox 双向不相交。控制文件必须物理留在 canonical control
directory 内；registry file 也必须留在其 canonical registry directory 内。Registry 的
canonical 落点决定边界，不能用 symlink alias 躲进 worktree、mailbox 或另一个目录。

## 四阶段校验

```bash
node scripts/execution-harness-check.mjs \
  --phase startup \
  --control-dir /absolute/path/to/revision \
  --claims /absolute/path/to/CLAIMS.json
```

同一命令只替换 phase：

1. `startup`：读取控制面、重算全部 hash 与输入 hash，验证 canonical filesystem 边界、当前
   generation/ACTIVE claim 与实质性 work order，并要求 `HEAD == base_sha` 且 worktree clean；
2. `prewrite`：第一次 repo 写入前重复全部校验，仍要求 frozen base 与 clean；
3. `boundary`：每个 phase boundary 重验 generation、claim、hash、ownership conflict，
   并检查截至当前的 committed/uncommitted/untracked diff 与 `base_sha..HEAD` merge history；
4. `delivery`：再次执行 boundary 全套，并验证 runtime report/state/evidence 的完整性、
   Git facts、证据 hash、验收映射和 no-out-of-scope 声明。

未知 phase 一律失败。每阶段都重新读取 registry；`REVOKED`、`SUPERSEDED`、`STALE`、
generation 漂移或 token 漂移均 fail closed。
Required work-order section 若只由重复 placeholder token 组成也失败，例如
`TBD TBD TBD TBD` 或 `<objective> <objective>`；实质性华语或英文正文不受影响。

## Ownership 规则

只支持两种机器可靠的写范围：

- `exact_files`：规范化 repo-relative 文件路径；
- `directory_prefixes`：以 `/` 结尾的规范化 repo-relative 目录前缀。

不支持 glob、否定式 pattern 或隐式默认目录。Active scoped claims 的 writer overlap、
write-vs-locked-input overlap、共同 exclusive group 都失败。以下范围即使被恶意写进
ownership 也失败：四控制文件、checker、claim registry、路线乙五本账、Blueprint、
schema/migrations、pricing authority、CI/root config、shared registry/parity/catalog、secrets、
`.git/`、`.claude/`、global orchestrator state、Gate 0 contract、standing delegation 与本 execution
control directory。

Registry 内每个 active scoped claim 都接受 identity、generation/hash、lexical forbidden path
与 claim-to-claim overlap 检查；但 foreign claim 没有可供本 schema 验证的 authoritative
worktree。Ignored-path 与 physical/symlink 检查只对本次 bootstrap 已验证的当前
`OWNERSHIP.write_set` 执行。每个 parallel claim 必须在它自己的 invocation/worktree 重跑同一套
physical checks，不能借用当前 claim 的 filesystem view。

Git 判定为 ignored 的 exact target 不能授权。Directory prefix 本身被 ignore，或当下包含
ignored path，也不能授权；checker 在每个 phase 重验，因此 prefix 下后来出现的 ignored
output 会在下一次 boundary 前 fail closed。

Write set 也不是纯 lexical allowlist：checker 对每个 target 解析 canonical target，或在尚未
创建时解析 nearest existing ancestor，且两者都必须留在 canonical worktree。任何既有 symlink
path component 都失败；既有 directory prefix 会递归拒绝任一 symlink descendant。Boundary
所枚举的 actual diff 若自身是 symlink entry（包括 base/HEAD/index 中的 symlink mode）同样失败。

`delivery` 以 `base_sha..HEAD`、`git diff HEAD` 和 untracked files 的并集为事实；两次 diff
都显式使用 `--no-renames`，所以 committed、staged 或 unstaged rename 的 source 与 destination
必须分别出现。报告里的 `changed_files` 不能替代 Git，也必须与这份未折叠事实完全相等。
`base_sha..HEAD` 中任何 merge commit 都失败。

## Scoped 身份单调性

有效 bootstrap 固定 `role=scoped-orchestrator`、`no_global_claim=true`，并声明 promotion 与
descendant claims 均 forbidden。Registry 中 scoped claim 只能由
`issuer_role=global-control-plane` 直接签发，`parent_claim_id` 必须为 `null`。Scoped lane
不得晋升 global、再签 scoped descendant、改 global epoch、宣告 program completion 或执行
merge。`author_identity == merger_identity` 是硬失败。

本地 checker 只能验证 control/claim/report 中声明的 actor 不冲突、`merge_executed=false`，
不能证明 GitHub 实际 author、reviewer 或 merger 身份。真实 GitHub separation-of-duties、
current-head CI 与 merge 权限仍由 global control plane 在远端事实面验证。

## Cooperative contract 边界

这是 deterministic cooperative gate，不是 OS sandbox。它会 canonicalize 每次读取的路径并在
当次检查拒绝 symlink/path-component escape，但无法阻止另一个进程在检查后替换文件（TOCTOU），
也不能证明未被 Git 枚举的历史外部写入。尤其是写集之外任意新建的 ignored path 不会进入 Git
diff；local checker 无法单凭 repository facts 证明它从未发生。Scoped session 仍须在首次 repo
写入前跑 `prewrite`、
每个边界跑 `boundary`、交付时跑 `delivery`；若需要抵抗同机恶意并发进程，必须停手并升级到
OS-level isolation，不能把本 checker 描述成物理 sandbox。

## 模板

`templates/` 含六个复制起点。占位值必须在签发前替换；模板本身不是 claim，也不能直接
启动 session。Claim registry schema、字段闭集与 runtime 验收见
`WORK-ORDER-SCHEMA.md`。
