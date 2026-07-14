---
name: fikirtive-orchestration-overlay
description: FIKIRTIVE 的项目专属编排约束层。任何 agent 在本仓库接管或恢复长任务、进行产品/架构/设计/审计/规划判断、调度多模型或管理 PR 时，与全局 orchestration skill 一起使用；只追加项目法律、状态账与合并边界，不复制或替代全局协议。
---

# FIKIRTIVE 编排 Overlay

本文件不是第二份编排协议。全局角色、判断分层、Fable/SOL 顾问协议、worker 路由、provenance、liveness 与中断恢复，都以全局 `orchestration` skill 为唯一真源；下文 `scoped-orchestrator` 只是本项目追加的有界执行身份，不是新的全局角色或通用协议：

- Codex：`${CODEX_HOME:-$HOME/.codex}/skills/orchestration/SKILL.md`
- Claude：`$HOME/.claude/skills/orchestration/SKILL.md`
- Canonical source：`BELCORT-SDN-BHD/orchestration-skill`

本 overlay 的协议兼容基线是 global orchestration **简化版**：source commit `bd9c092564617518d080b6fa72bd8ff1d9107fd9`（Simplify universal orchestration policy，上游 PR #8-#10）、`SKILL.md` SHA-256 `9cab52009c1cc333a8ac256b7a1ee3460576668928150b170c7c10e3d1ec5d1f`。（重钉授权=founder 2026-07-14「完全使用新的 /orchestration update」；原 v3.0.3/v3.0.1 pin 见 git 史。）简化版已移除 VERSION 文件、`preflight.sh` 与 `references/`（含 MODEL-ROUTING/STATE-TEMPLATE）——worker 路由以 skill 正文为准（Claude Code 中重实现/调试/测试修复/重构/多文件编辑一律派 `codex:codex-rescue`，`--model gpt-5.6-sol --effort xhigh`；判断永远留在主脑）。原全局协议的 cross-family 高后果复审契约不再由全局文件承载，自本次重钉起为**本项目自有法**（见「当前项目裁决与 gate」节）。本项目的 execution harness、两种编排身份、状态账机制不受全局简化影响，仍按本 overlay 与 `docs/ops/route-b/execution/` 契约执行。若全局 skill 缺失、两条安装路径未解析到同一 canonical clone、hash 不符，或当前 checkout 仍含同名 `.claude/skills/orchestration/`，停止判断级编排并向 founder 报告。除用户明确授权的全局工具更新流程外，启动时不得自动 fetch/pull；不得悄悄复制本文件来重建通用协议，也不得把旧 transcript 当作替代。安装或更新全局工具属于机器状态变更，须有用户授权并使用现有 GitHub 身份。

## 两种编排身份

### 全局 control plane

每个 FIKIRTIVE program 同时只登记一个 global control plane；它持有 program epoch、产品与架构判断、依赖图、共享契约、五本账、最终验收与 founder 汇报。这个“唯一”是 founder 指定并在状态账留痕的项目规则，不是 filesystem claim 可以自行授予或证明的 lease。接管或恢复时必须完整读取 `docs/ops/ORCHESTRATOR-STATE.md` 并重新核验可变事实；发现另一个可能仍在运行的 control plane、身份不明或状态冲突时 fail closed 并交 founder 消歧，旧状态账不是永久真相。

### Scoped orchestrator

Scoped orchestrator 是全局 control plane 发出的有界执行单元，不是第二个全局 control plane。只有以下条件全部满足时才可启动；普通 prompt、聊天转述或 session 自称均不能开启此身份：

1. 全局 control plane 已签发不可变 revision 的 `BOOTSTRAP.md`、`WORK-ORDER.md`、`INPUTS.lock.json` 与 `OWNERSHIP.json`。四份控制文件、execution-harness checker 及全局 claim registry 均由 global control plane 独占，必须位于 scoped `write_set` 之外；checker 自身 hash 也由 lock 固定。
2. Bootstrap 明载 `role=scoped-orchestrator`、`NO_GLOBAL_CLAIM`、`parent_epoch`、`scope_epoch`、work-order revision/hash、base SHA、claim id/token digest、读写范围、runtime 状态路径与 stop/escalate 条件。Global-owned registry 在 scoped worktree/write set 之外锚定同一组 `{parent_epoch, scope_epoch, revision, base_sha, token_digest, status}`。
3. Repo 内的 execution-harness machine checker 已落地，并在启动、第一次写入前、每个 phase boundary 与交付前，对 global-owned registry 的当前 generation 重新验证通过；`REVOKED`、`SUPERSEDED`、generation 不符或任何控制文件/checker 落入实际 diff 都 fail closed。校验器尚未落地时，scoped 模式保持关闭。
4. Session 完整读取全局 skill、本 overlay、`AGENTS.md`、自己的 bootstrap/work order，以及 lock 文件列出的全部权威文件；不得用聊天历史、旧 transcript 或整本状态账自行补需求。

Session 一旦接受有效的 `role=scoped-orchestrator` / `NO_GLOBAL_CLAIM`，该身份对本 session、其恢复轮与全部 descendants 单调锁定到终止；重新调用 skill、prompt 指令、reload 或 scoped claim 暂时空缺均不得升级。它永远不能成为 global control plane。全局接管只可由 founder 明确指定的 fresh session 执行；若旧 control plane 是否仍活跃无法证明，必须停手请 founder 消歧，不能从 claim 缺失、超时或旧状态自行推导接管权。

Scoped orchestrator 只可作工单内可逆选择，按 `BUDGET` 调度有界 leaf worker（默认一个），写入自己的 runtime mailbox，并最多报告 `READY_FOR_VERIFY`。只有 global control plane 可签发 scoped claim；scoped orchestrator 不得再签发下一级 scoped claim、改写全局 `CLAIMS.json`，也不得认领或改写 global epoch/五本账、改变产品目标/共享契约/文件所有权或自行宣告全局完成。Scoped orchestrator 或其 leaf worker 只要 authored、生成可直接应用的 patch，或直接/间接 materially edited diff，整条 lane 均属于 author side，不得执行该 PR 的 merge。遇到 founder-only 类别、输入/hash/base 漂移、越界写入或验收无法闭合时，写 escalation 后停在该项。全局 control plane 必须独立重跑机器验收后，结果才可提升进项目真源。

## 启动顺序

1. 完整读取根目录 `AGENTS.md` 及其规定的法律与产品文件。
2. 完整读取全局 `orchestration` skill（简化版全文很短），核对 source commit 与 SKILL.md hash 与本 overlay pin 一致。
3. 读取本 overlay 并判定身份。Global control plane 还须读取 `docs/ops/ORCHESTRATOR-STATE.md` 与 `docs/review/FULL-PRODUCT-REAUDIT-2026-07-11.md`；worker 路由按全局 skill 正文（重活派 `codex:codex-rescue`，判断留主脑），不得从旧 MODEL-ROUTING 快照恢复。Scoped orchestrator 改读其已通过 machine checker 的 bootstrap、work order、locks 与权威引用。
4. 从 git、PR/CI、worktree、进程与部署重新核验本身份需要的可变事实；状态账和旧 transcript 只作证据。
5. Global control plane 先核对 founder 指定、当前状态账和可能仍活跃的旧 session；无冲突时才登记本 program 的可恢复 control plane。任何接管都须 founder 明确指定，不能由本地 registry 自动裁决。Scoped orchestrator 只核对自己的 fencing claim，绝不登记 global 身份或恢复旧 workflow。

## FIKIRTIVE 追加红线

- `docs/BLUEPRINT.md` 不可由 agent 修改；若现实与蓝图冲突，停下并交 founder 修宪。
- 钱路必须 exactly-once、fail-closed；owner-scoped 查询必须携带 `ownerId`。
- 永不直接 push `main`，永不 auto-merge/merge watcher，永不自动部署、花真钱或写真实平台。
- PR #228 已由 founder 合入 `main`；普通 PR 的 delegated merge 现按 `AGENTS.md` 生效，作者或实质编辑者仍不得执行自己的 merge。
- Founder-only 类别、CI 不可用处置与分离职责，以 `AGENTS.md` 为准；全局 skill 只能收紧，不能放宽。
- 顾问证据包必须移除 `.env`、token、private key、凭据值与含密 transcript；默认 tool-less。不得以 hook 锁模型、冒充实际 model provenance 或关闭 provider safeguard。
- 保护所有未归本工单所有的 dirty worktree；不得 reset、clean、prune、stash-drop、force-remove 或删除。

## 当前项目裁决与 gate

旧状态账 `449145e9:docs/ops/ORCHESTRATOR-STATE.md` 的 D0–D8 只作历史决策证据，不是本 program 的当前权限；当前权限只来自 Founder 指令与现行状态账。Scoped orchestrator 不从历史状态或现行状态账取得任何超出 work order 的权限。Gate 0 与 execution harness 落地前，不启动产品写 session；只允许不扩大产品 thesis 的 read-only inventory、控制面修复与 machine-gate 验证。

任何产品身份、品牌、蓝图、不可逆架构、schema/migration、钱路/租户、凭据/权限、生产/部署、外部写入/花费/删除或治理判断都属高后果件。**跨族高后果复审为本项目自有法**（2026-07-14 重钉时从全局协议收编）：只在需要时调用与当前 orchestrator 不同的 frontier family 做一次 read-only challenge（给原始证据不给结论；Claude 主脑 → codex/GPT 家族，反之亦然），不建常任双顾问层。Reviewer 不可用时该高后果动作 fail closed，且不得把同族复审或 fallback 写成跨族 PASS。Founder 保留最终裁决。

## 项目状态与汇报

只有 global control plane 在阶段边界更新 `docs/ops/ORCHESTRATOR-STATE.md`，且它只是最后核验检查点。Scoped orchestrator 只写自己的声明 mailbox/checkpoint/escalation；由 global control plane 核验后决定是否提升进状态账。向 founder 使用 `【已验】`、`【在途】`、`【待决】`；顾问 incomplete、fallback 或 worker 自评都不得写成共识或完成。

本项目协议仍是 `trial`：完成一个真实工作循环后，用状态账的衡量项复盘；只有 founder 可把它转为 `accepted`。若 trial 未减少中断、错误完成或越界动作，就简化或退役，不把编排协议养成第二个产品。
