---
name: fikirtive-orchestration-overlay
description: FIKIRTIVE 的项目专属编排增量。用于多 agent 编排、中断任务恢复及产品/架构/设计/审计判断；只追加本项目的有界任务、安全停线与复审要求，不复制全局 orchestration 协议。
---

# FIKIRTIVE 编排 Overlay

本文件不是第二份项目法律，也不复制通用 orchestrator/worker 分工。先完整读取
runtime 提供的 global `orchestration` skill 与 `.claude/CLAUDE.md`；发生冲突时立即停下，
不得用本 overlay 放宽项目法。全局工具的安装、更新或拉取属于仓库外机器状态变更，
未经用户明确授权不得执行。

## 有界任务身份

- 连续性属于当前 GitHub issue/map；session、模型、进程、路径、branch、handoff、memory 或旧 claim 都不能自授身份。
- 开始或恢复前，重新核验当前 Founder/task scope、GitHub dependency、现有 branch/worktree/PR、cwd/HEAD/dirty/remote，以及 project task-ownership registry。
- Founder 明确解冻产品后，每个 repo-mutating task 必须在首次 mutation 前用 `scripts/task-ownership-check.mjs` 取得自己的 task-linked `ACTIVE` claim；恢复时复验同一 claim，结束/移交时 `RELEASED` 或 `SUPERSEDED`。缺失、过期、重叠、wrong base/worktree/scope 或 malformed registry 一律 fail closed；expiry 不转移 ownership。Read-only factual work 可无 claim，但不得改 repository 或产品状态。
- Ownership claim 只围栏 task/write-set，不授产品、merge、部署、花费、Blueprint 或 destructive-cleanup 权。
- Coordinator 保留意图理解、判断、拆解、优先级、取舍、验收与 Founder 沟通；worker 只做已界定的取证、实现、测试或验证。Worker 不得扩大 scope、改共享契约或把自评提升为完成。
- Coordinator 与 descendants 只拥有当前工单明示的权限。任务完成后身份结束；下一任务重新核验，不继承永久职位。
- 任何 authored 或 materially edited diff 的整条 lane 都属于 author side，不得执行该 PR 的 merge。

## FIKIRTIVE 停线条件

遇到以下任一项，停止对应动作并呈 Founder：

- 产品方向、identity、scope、用户行为或 acceptance 的实质选择；
- `docs/BLUEPRINT.md` 冲突或 §7 amendment；
- governance/merge-policy、不可逆架构、schema/migration、money/tenant、凭据/权限；
- production/deployment、外部发布/写入/删除、真实花费；
- authority 冲突、任务依赖未解锁、write-set/base/hash 漂移或风险等级不确定。

钱路必须 exactly-once、fail-closed；owner-scoped 查询必须带已认证 `ownerId`。永不直推
`main`，永不 auto-merge/merge watcher。保护所有不属于当前工单的 dirty 或不确定工作；
不得 reset、clean、prune、stash-drop、force-remove 或删除它们。

## 跨族高后果复审

高后果件在呈 Founder 或进入任何允许的 merge gate 前，调用与 author/orchestrator 不同
frontier family 做一次 bounded、read-only challenge。提供原始证据与 acceptance，不预塞
结论；reviewer 不可用时保持 fail closed。同族复审、fallback 或 worker 自评不得冒充
cross-family PASS。Reviewer 只报告发现，不取得 merge 或产品裁决权。

## 状态与汇报

- 当前执行顺序来自 GitHub native dependencies；实际状态来自 live Git/GitHub/CI/worktree/claim/platform query。未查询外部状态写 `Unknown`。
- 决定、证据、完成与下一依赖写回当前 GitHub task；不维护第二份 current-state 总账。
- 向 Founder 使用 `【已验】`、`【在途】`、`【待决】`。Incomplete、fallback、billing-blocked CI 或未复核 worker 输出不得写成完成或共识。
