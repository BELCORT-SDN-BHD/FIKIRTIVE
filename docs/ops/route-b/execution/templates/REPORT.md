# Scoped execution report

<!-- execution-harness:json -->
```json
{
  "schema_version": 1,
  "program_id": "<program-id>",
  "work_order_id": "<work-order-id>",
  "revision": "r001",
  "result": "READY_FOR_VERIFY",
  "changed_facts": [
    "<只写已由证据证明的事实>"
  ],
  "changed_files": [
    "path/to/owned-file"
  ],
  "commands": [
    {
      "id": "gate-01",
      "command": "<exact rerunnable command>",
      "exit_code": 0
    }
  ],
  "failures": [],
  "unknowns": [],
  "acceptance_mapping": [
    {
      "acceptance_id": "A-01",
      "status": "PASS",
      "evidence_ids": [
        "gate-01"
      ]
    },
    {
      "acceptance_id": "A-02",
      "status": "PASS",
      "evidence_ids": [
        "gate-01"
      ]
    }
  ],
  "git": {
    "branch": "<branch-name>",
    "base_sha": "0000000000000000000000000000000000000000",
    "head_sha": "0000000000000000000000000000000000000000"
  },
  "evidence_hashes": {
    "EVIDENCE/gate-01.txt": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "no_out_of_scope_changes": true,
  "actors": {
    "author_identity": "<stable-author-actor-id>",
    "merger_identity": null,
    "merge_executed": false
  }
}
```
