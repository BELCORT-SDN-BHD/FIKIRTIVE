# Scoped execution bootstrap

> 签发前替换全部 `<...>`；签发后本 revision 不可原地修改。

<!-- execution-harness:json -->
```json
{
  "schema_version": 1,
  "role": "scoped-orchestrator",
  "no_global_claim": true,
  "identity_lock": {
    "promotion": "forbidden",
    "descendant_claims": "forbidden"
  },
  "program_id": "<program-id>",
  "work_order_id": "<work-order-id>",
  "revision": "r001",
  "parent_epoch": "<global-epoch>",
  "scope_epoch": "<unique-scope-epoch>",
  "base_sha": "0000000000000000000000000000000000000000",
  "claim_id": "<global-minted-claim-id>",
  "token_digest": "0000000000000000000000000000000000000000000000000000000000000000",
  "claim_generation": 1,
  "runtime_mailbox": "/absolute/path/to/runtime-mailbox",
  "worktree": "/absolute/path/to/scoped-worktree",
  "branch": "<branch-name>",
  "claims_registry": "/absolute/global-owned/path/to/CLAIMS.json",
  "checker_path": "scripts/execution-harness-check.mjs",
  "hash_authority": "global_claim_registry",
  "required_hashes": [
    "BOOTSTRAP.md",
    "WORK-ORDER.md",
    "INPUTS.lock.json",
    "OWNERSHIP.json",
    "scripts/execution-harness-check.mjs"
  ],
  "stop_conditions": [
    "任何 control/input/checker hash 漂移",
    "claim 非 ACTIVE 或 generation/token/base 漂移",
    "任何 ownership 或项目法律越界"
  ],
  "escalate_conditions": [
    "验收无法在工单 scope/budget 内闭合",
    "需要 founder-only 判断或扩大权限"
  ],
  "founder_intent_snapshot": "<一段冻结的 founder intent；只解释本工单目标，不扩产品范围>"
}
```
