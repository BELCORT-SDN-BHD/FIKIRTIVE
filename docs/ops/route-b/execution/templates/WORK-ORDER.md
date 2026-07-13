# <work-order-id> <revision>

<!-- execution-harness:json -->
```json
{
  "schema_version": 1,
  "program_id": "<program-id>",
  "work_order_id": "<work-order-id>",
  "revision": "r001",
  "parent_epoch": "<global-epoch>",
  "scope_epoch": "<unique-scope-epoch>",
  "base_sha": "0000000000000000000000000000000000000000",
  "acceptance_ids": [
    "A-01",
    "A-02"
  ]
}
```

## OBJECTIVE

用一句可验证的话写唯一目标。

## SCOPE

列明角色、worktree/branch/base、允许读写范围、项目法律、禁止动作与 stop/escalate 条件。

## OUTPUT

逐项列出唯一允许产生的 repo 与 runtime 产物。

## ACCEPTANCE

- `A-01`：写成可复跑命令或确定性事实；
- `A-02`：写成可复跑命令或确定性事实。

## BUDGET

列明 worker 数、时间/模型/真实花费、外部写入与 implementation-attempt 上限。
