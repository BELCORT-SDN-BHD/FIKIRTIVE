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
- 高后果件在呈 Founder 请求批准或进入任何被允许的 merge gate 之前,须由与 author/orchestrator 不同 frontier family 做一次 bounded、read-only challenge:给原始证据与验收标准,不预塞结论;reviewer 只报告发现,不取得 merge 或产品裁决权;同族复审、fallback 或 worker 自评不得记为 cross-family PASS。跨族复审未完成时,该件不得作为可批准或可合并的成品呈上,但向 Founder 的汇报与故障呈报在任何情况下都不被阻止。
- 跨族通道故障或额度耗尽时:先诊断修复;修不了则按 Founder 2026-07-21 授权立即启用同厂不同模型替补复审,不停摆。替补结论一律标注「同厂替补复审」并在 PR 记录注明故障事实,永不记为 cross-family PASS;带替补结论呈 Founder 请批照常进行,是否据此放行由 Founder 决定;非作者执行者 merge gate 在真跨族复审补上或 Founder 对该 PR 明示接受替补之前保持关闭;通道恢复且 PR 未合并时补做真跨族复审。
- 汇报三标注：`【已验】`＝已有可复现证据、`【在途】`＝进行中、`【待决】`＝等 Founder。未复核的 worker 输出、fallback 结果与不可用的 CI 都不得写成完成。
