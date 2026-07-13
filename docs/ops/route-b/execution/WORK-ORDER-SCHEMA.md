# 路线乙 · Execution work-order schema v1

> 这是 execution control contract，不是产品 spec 或第六本状态账。所有路径均区分大小写；
> repo 内路径用 `/`，不得使用 absolute path、`./`、`..`、glob 或反斜线。

## 共同字段

四个控制文件必须共同钉住以下值，任何不一致都失败：

| 字段 | 规则 |
|---|---|
| `schema_version` | 整数 `1` |
| `program_id` | 非空稳定 ID |
| `work_order_id` | 非空稳定 ID |
| `revision` | 不可变 revision ID，例如 `r001` |
| `parent_epoch` | global control plane 当前 epoch |
| `scope_epoch` | 本 scoped lane 唯一 epoch |
| `base_sha` | 40 位小写 full Git SHA |

Markdown 控制文件在 `<!-- execution-harness:json -->` 后放一个 `json` fenced block；checker
只从该 block 读取机器字段。说明文字不能覆盖机器字段。

## `BOOTSTRAP.md`

必须包含：

- `role: "scoped-orchestrator"`、`no_global_claim: true`；
- `identity_lock: { promotion: "forbidden", descendant_claims: "forbidden" }`；
- 共同字段及 `claim_id`、64 位小写 `token_digest`、正整数 `claim_generation`；
- absolute `worktree`、`runtime_mailbox`、`claims_registry` 与非空 `branch`；
- 固定 `checker_path: "scripts/execution-harness-check.mjs"`；
- `hash_authority: "global_claim_registry"`；
- canonical `required_hashes`：四控制文件再加 checker；
- 非空 `stop_conditions`、`escalate_conditions`、`founder_intent_snapshot`。

`worktree` canonical path 必须正好等于 `git rev-parse --show-toplevel` 的 canonical path。
Control directory、claim registry 与 runtime mailbox 的 canonical 落点必须在 worktree 外；
control directory 和 registry 还必须各自与 mailbox 双向不相交。CLI 的 `--claims` 必须与
`claims_registry` 是同一绝对路径并解析到同一 registry；checker 不搜索默认位置。每个控制
文件必须解析到 canonical control directory 内；registry file 必须解析到其 canonical parent
directory 内。Symlink/path component 不能逃出这些边界。

## `WORK-ORDER.md`

机器 block 包含共同字段与排好序、唯一、非空的 `acceptance_ids`。正文所有 `##` 标题必须
完整且只出现一次，顺序严格为：

```text
OBJECTIVE
SCOPE
OUTPUT
ACCEPTANCE
BUDGET
```

增加别的二级标题、缺失、重复或换序均失败。细分内容如确有需要只能用三级标题。
每节正文都必须有实质性、非 placeholder 内容；空白、`TBD`、`<...>` 等占位正文失败，重复
placeholder 不能靠长度绕过，例如 `TBD TBD TBD TBD`、`<objective> <objective>` 仍失败。
实质性华语与英文正文均有效。
机器 block 中每个 `acceptance_id` 都必须以完整 ID 明文出现在 `ACCEPTANCE` 正文。

## `INPUTS.lock.json`

除共同字段外必须包含：

```json
{
  "claim": {
    "id": "<claim_id>",
    "token_digest": "<sha256>",
    "generation": 1
  },
  "hashing": {
    "algorithm": "sha256",
    "authority": "global_claim_registry",
    "required_artifacts": [
      "BOOTSTRAP.md",
      "WORK-ORDER.md",
      "INPUTS.lock.json",
      "OWNERSHIP.json",
      "scripts/execution-harness-check.mjs"
    ]
  },
  "authoritative_inputs": [
    { "path": "AGENTS.md", "sha256": "<sha256>" }
  ],
  "shared_contract_inputs": [
    { "path": "path/to/shared-contract", "sha256": "<sha256>" }
  ]
}
```

两类 input 都至少一项，按 `path` 排序且不可重复。Checker 每 phase 都从 worktree 重新读取
其 canonical target 并计算 SHA-256；target 必须物理位于 canonical worktree 内，一字节漂移
或 symlink/path-component escape 即失败。所有 pinned input 也必须被
`OWNERSHIP.locked_inputs` 覆盖。

`required_artifacts` 只声明必须由 registry 锚定哪些对象，不携带自 hash。实际五个 hash
只存在 global-owned claim 中；这是刻意消除 circular hash。

## `OWNERSHIP.json`

除共同字段外必须包含固定身份、写集、锁集、互斥组和 separation-of-duties 身份：

```json
{
  "role": "scoped-orchestrator",
  "no_global_claim": true,
  "write_set": {
    "exact_files": ["path/to/file"],
    "directory_prefixes": ["path/to/directory/"]
  },
  "locked_inputs": {
    "exact_files": ["AGENTS.md"],
    "directory_prefixes": []
  },
  "exclusive_groups": ["shared-contract-name"],
  "author_identity": "<stable actor id>",
  "merger_identity": null
}
```

四个 path/group array 都必须排序且唯一。Read-only 工单使用空 write set。`merger_identity`
可为 `null` 或独立 actor；不得等于 author。Claim 中的 write/lock/group/actor 必须与本文件
逐项相同。

## Global-owned `CLAIMS.json`

Registry 不属于 revision，也不提供 scoped 写权限。顶层：

```json
{
  "schema_version": 1,
  "generation": 17,
  "claims": []
}
```

当前 scoped claim 必须在 `claims` 内恰好出现一次，并含：

```json
{
  "claim_id": "<claim id>",
  "claim_type": "scoped",
  "issuer_role": "global-control-plane",
  "parent_claim_id": null,
  "role": "scoped-orchestrator",
  "no_global_claim": true,
  "program_id": "<program>",
  "work_order_id": "<work order>",
  "parent_epoch": "<global epoch>",
  "scope_epoch": "<scope epoch>",
  "revision": "r001",
  "base_sha": "<full git sha>",
  "token_digest": "<sha256>",
  "status": "ACTIVE",
  "generation": 17,
  "write_set": { "exact_files": [], "directory_prefixes": [] },
  "locked_inputs": { "exact_files": [], "directory_prefixes": [] },
  "exclusive_groups": [],
  "author_identity": "<actor>",
  "merger_identity": null,
  "hashes": {
    "BOOTSTRAP.md": "<sha256>",
    "WORK-ORDER.md": "<sha256>",
    "INPUTS.lock.json": "<sha256>",
    "OWNERSHIP.json": "<sha256>",
    "scripts/execution-harness-check.mjs": "<sha256>"
  }
}
```

Checker 比较 exact `{parent_epoch, scope_epoch, revision, base_sha, token_digest,
status=ACTIVE}`、generation 与五个 hash。缺失、重复、`REVOKED`、`SUPERSEDED`、`STALE`、
旧 generation、descendant-minted 或 role promotion 都失败。

所有 registry status 的 `claim_id` 都必须非空且全局唯一。每个 ACTIVE scoped claim 的
`program_id / work_order_id / parent_epoch / scope_epoch / revision` 必须非空，`base_sha` 与
`token_digest` 必须格式有效；ACTIVE scoped claims 的 `scope_epoch`、token digest 与
`{program_id,parent_epoch,scope_epoch}` identity 必须各自唯一。它们还会两两检查 writer
overlap、writer 对任一 locked input 的 overlap、共同 exclusive group。Global claim 可同
registry 存在，但不能冒充 scoped claim 的 issuer。

Foreign active claim 没有 authoritative worktree 字段，所以 checker 只对它执行上述 registry
结构、identity、generation/hash、lexical forbidden-path 与 overlap 检查；不得用当前 bootstrap
的 worktree 判断 foreign claim 的 ignored 或 physical path。当前 claim 的 ignored/physical
检查由已经 exact-match 的 `OWNERSHIP.write_set` 执行。每个 parallel claim 必须在自己的
invocation/worktree 接受同一检查。

## 明确禁止进入 scoped write set

Checker 对 ownership 与实际 Git diff 双重检查以下范围：

- 当前四控制文件、当前 claims registry、checker；
- 路线乙五本账（`matrix/` + 四个 ledger 文件）；
- `.git/`、`.claude/`、`docs/ops/ORCHESTRATOR-STATE.md`；
- `docs/ops/route-b/B0-CONTRACT.md`、`docs/ops/route-b/STANDING-DELEGATION.md`；
- `docs/ops/route-b/execution/`；
- `docs/BLUEPRINT.md`；
- Prisma schema/migrations；
- `packages/core/src/spend.ts` pricing authority；
- `.github/`、root files/config 与 hooks；
- Otto shared registry、parity manifest/test、catalog；
- `.env*`、`.secrets/`、`secrets/`。

宽 directory prefix 若覆盖上述任一对象同样失败。
此外，Git `check-ignore --no-index` 判为 ignored 的 exact target 或 directory prefix 本身失败；
prefix 下当下存在的 ignored path 也失败。Checker 每 phase 重验，之后新出现的 ignored output
会在下一次校验被发现。Actual tracked diff 若被 ignore 规则命中同样失败。

当前 `OWNERSHIP.write_set` 每个 target 的 canonical target（未创建时为 nearest existing
ancestor）必须位于 canonical worktree 内。Exact target 的任何 existing path component 不得是
symlink；existing directory prefix 会递归拒绝所有 symlink descendants。Actual diff 路径若在
filesystem、base tree、HEAD tree 或 index 体现为 Git symlink mode，也会失败，防止写穿 alias
而不产生目标文件 diff。

`changedPaths()` 对 `base_sha..HEAD` 与 `git diff HEAD` 都使用 `--no-renames`。因此 committed、
staged、unstaged rename 的 source/destination 都是独立 changed path；两端都要通过 ownership、
forbidden/ignored/symlink 检查，并同时出现在 report 与 evidence changed-path facts 中。

`base_sha..HEAD` 不得含 merge commit。这个 local history gate 不等于 GitHub 身份证明：本地
checker 只核对声明的 author/merger 不同与 `merge_executed=false`；真实 GitHub author、review、
merger、current-head CI 和 merge permission 必须由 global control plane 独立核验。

此检查仍是 cooperative contract，不是 OS sandbox：TOCTOU、hard-link/inode alias，以及 write set
之外未被 Git 枚举的 arbitrary ignored writes 不能由 repository facts 完整证明不存在。需要抵抗
同机恶意进程或证明全 filesystem 无外写时必须停手升级隔离层，不能扩大本 checker 的声明。

## Runtime delivery contract

`REPORT.md` 使用同一 marked JSON 格式。必须包含：

- `result: "READY_FOR_VERIFY"`；
- `changed_facts`、与 Git 完全相等的 `changed_files`；
- `commands`（evidence id + command + integer exit code）；
- `failures`、`unknowns`（READY 时必须为空）；
- 按 work-order `acceptance_ids` 原顺序逐项映射的 `acceptance_mapping`；
- `git: { branch, base_sha, head_sha }`；
- `evidence_hashes`、`no_out_of_scope_changes: true`；
- `actors`，且 `merge_executed: false`。

`EVIDENCE/manifest.json` 必须逐 entry 包含 `id`、非空 `acceptance_ids`、`command`、整数
`exit_code`、`output_path`、`sha256`、`changed_paths`。READY 时所有 exit code 为 0；output
必须是 canonical mailbox `EVIDENCE/` 内的 direct regular file（不能是 symlink）且 hash 重算
相等；report/state/manifest 也不能经 symlink/path component 逃出各自 canonical root。所有
entry 的 changed-path union 必须与 Git diff 相等；所有 acceptance id 必须有证据覆盖。每条
`acceptance_mapping.acceptance_id -> evidence_id` edge 还必须由该 evidence entry 自己的
`acceptance_ids` 明确声明，不能只靠全局 aggregate coverage 交叉凑齐。

`STATE.json` 必须含共同 ID、`status: "READY_FOR_VERIFY"`、`phase: "delivery"`、当前
`last_validated_generation`、base/head SHA。它是 scoped mailbox checkpoint，不是 global
program state，也不能宣告全局完成。
