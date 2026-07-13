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

Runtime mailbox 必须在 scoped worktree 外。CLI 的 `--claims` 必须与 `claims_registry` 是同一
绝对路径；checker 不搜索默认位置。

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
并计算 SHA-256；一字节漂移即失败。所有 pinned input 也必须被
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

所有 ACTIVE scoped claims 还会两两检查：writer overlap、writer 对任一 locked input 的 overlap、
共同 exclusive group。Global claim 可同 registry 存在，但不能冒充 scoped claim 的 issuer。

## 明确禁止进入 scoped write set

Checker 对 ownership 与实际 Git diff 双重检查以下范围：

- 当前四控制文件、当前 claims registry、checker；
- 路线乙五本账（`matrix/` + 四个 ledger 文件）；
- `docs/BLUEPRINT.md`；
- Prisma schema/migrations；
- `packages/core/src/spend.ts` pricing authority；
- `.github/`、root files/config 与 hooks；
- Otto shared registry、parity manifest/test、catalog；
- `.env*`、`.secrets/`、`secrets/`。

宽 directory prefix 若覆盖上述任一对象同样失败。

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
必须在 mailbox 的 `EVIDENCE/` 下且 hash 重算相等；所有 entry 的 changed-path union 必须与
Git diff 相等；所有 acceptance id 必须有证据覆盖。

`STATE.json` 必须含共同 ID、`status: "READY_FOR_VERIFY"`、`phase: "delivery"`、当前
`last_validated_generation`、base/head SHA。它是 scoped mailbox checkpoint，不是 global
program state，也不能宣告全局完成。
