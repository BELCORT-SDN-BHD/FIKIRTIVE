---
name: fikirtive-orchestration-overlay
description: FIKIRTIVE 的项目专属编排增量。用于多 agent 编排、中断任务恢复及产品/架构/设计/审计判断；只写全局 orchestration 协议与项目法之外的净新增，不复制任何一方。
---

# FIKIRTIVE 编排 Overlay

只写净新增：全局 `orchestration` skill 与 `.claude/CLAUDE.md` 已有的内容一律不在此重复；两者冲突时停下呈 Founder，不得用本 overlay 放宽项目法。

<!-- fikirtive:claim-policy -->

- Claim 政策以项目法第 12 条与 `docs/runbooks/task-ownership.md` 为准：每个 repo-mutating task 必须在首次 mutation 前取得自己的 task-linked `ACTIVE` claim，恢复时复验同一 claim，结束或移交时 `RELEASED`/`SUPERSEDED`。claim 只围栏 write-set，不授产品、merge、部署、花费、Blueprint 或 destructive-cleanup 权。
- 全局工具与技能的安装、更新或拉取属于仓库外机器状态变更，须 Founder 明确授权。
- 破坏性 git 动词（`reset --hard`、`clean -f`、`prune`、`stash drop`、`worktree remove --force`）不得作用于不属于当前工单的工作区、分支或未提交工作。
- 高后果件进入任何被允许的 merge gate 之前，须由与 author/orchestrator 不同 frontier family 做一次 bounded、read-only challenge：给原始证据与验收标准，不预塞结论；reviewer 只报告发现，不取得 merge 或产品裁决权；同族复审或 worker 自评不得冒充 cross-family PASS。
- 上一条有两处 **【待决】**，未经 Founder 裁定不得自行认定：① 只呈 Founder、不进 merge gate 的高后果件，是否也强制该复审；② 通道故障时 Founder 指定的同厂替补，是否算数为 cross-family PASS。触发时按现状执行并在汇报里标注。
- 汇报三标注：`【已验】`＝已有可复现证据、`【在途】`＝进行中、`【待决】`＝等 Founder。未复核的 worker 输出、fallback 结果与不可用的 CI 都不得写成完成。
