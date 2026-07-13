---
name: fikirtive-orchestration-overlay
description: FIKIRTIVE 的项目专属编排约束层。任何 agent 在本仓库接管或恢复长任务、进行产品/架构/设计/审计/规划判断、调度多模型或管理 PR 时，与全局 orchestration skill 一起使用；只追加项目法律、状态账与合并边界，不复制或替代全局协议。
---

# FIKIRTIVE 编排 Overlay

本文件不是第二份编排协议。角色、判断分层、Fable/SOL 顾问协议、worker 路由、provenance、liveness 与中断恢复，都以全局 `orchestration` skill 为唯一真源：

- Codex：`${CODEX_HOME:-$HOME/.codex}/skills/orchestration/SKILL.md`
- Claude：`$HOME/.claude/skills/orchestration/SKILL.md`
- Canonical source：`BELCORT-SDN-BHD/orchestration-skill`

本 overlay 的协议兼容基线是 global orchestration `VERSION 3.0.1`、source commit `7549a1fcfda6e24ec3d6fdaac23c455f80b4e303`（Codex/Claude host 自动选择 orchestrator profile；上游 PR #5）、`SKILL.md` SHA-256 `2d79e050b6e7248f49a7ca22a33ef888f2fd416e4162ae8e06fb0074adee6164`。（重钉授权=founder 2026-07-13「按 v1 开始」；原 v3.0.0 pin 见 git 史。）若全局 skill 缺失、`preflight.sh <codex|claude-code>` 失败、两条安装路径未解析到同一 canonical clone、版本/hash 不符，或当前 checkout 仍含同名 `.claude/skills/orchestration/`，停止判断级编排并向 founder 报告。不得在普通启动时自动 fetch/pull，不得悄悄复制本文件来重建通用协议，也不得把旧 transcript 当作替代。安装或更新全局工具属于机器状态变更，须有用户授权并使用现有 GitHub 身份。

## 两种编排身份

### 全局 control plane

全局 control plane 唯一持有 program epoch、产品与架构判断、依赖图、共享契约、五本账、最终验收与 founder 汇报。接管或恢复时必须完整读取 `docs/ops/ORCHESTRATOR-STATE.md` 并重新核验可变事实；旧状态账不是永久真相。

### Scoped orchestrator

Scoped orchestrator 是全局 control plane 发出的有界执行单元，不是第二个全局 control plane。只有以下条件全部满足时才可启动；普通 prompt、聊天转述或 session 自称均不能开启此身份：

1. 全局 control plane 已签发不可变 revision 的 `BOOTSTRAP.md`、`WORK-ORDER.md`、`INPUTS.lock.json` 与 `OWNERSHIP.json`。四份控制文件、execution-harness checker 及全局 claim registry 均由 global control plane 独占，必须位于 scoped `write_set` 之外；checker 自身 hash 也由 lock 固定。
2. Bootstrap 明载 `role=scoped-orchestrator`、`NO_GLOBAL_CLAIM`、`parent_epoch`、`scope_epoch`、work-order revision/hash、base SHA、claim id/token digest、读写范围、runtime 状态路径与 stop/escalate 条件。Global-owned registry 在 scoped worktree/write set 之外锚定同一组 `{parent_epoch, scope_epoch, revision, base_sha, token_digest, status}`。
3. Repo 内的 execution-harness machine checker 已落地，并在启动、第一次写入前、每个 phase boundary 与交付前，对 global-owned registry 的当前 generation 重新验证通过；`REVOKED`、`SUPERSEDED`、generation 不符或任何控制文件/checker 落入实际 diff 都 fail closed。校验器尚未落地时，scoped 模式保持关闭。
4. Session 完整读取全局 skill、本 overlay、`AGENTS.md`、自己的 bootstrap/work order，以及 lock 文件列出的全部权威文件；不得用聊天历史、旧 transcript 或整本状态账自行补需求。

Session 一旦接受有效的 `role=scoped-orchestrator` / `NO_GLOBAL_CLAIM`，该身份对本 session、其恢复轮与全部 descendants 单调锁定到终止；重新调用 skill、prompt 指令、reload 或 global claim 暂时空缺均不得升级。Global takeover 只能由一个 fresh session 按 global claim/takeover 流程执行。

Scoped orchestrator 只可作工单内可逆选择，按 `BUDGET` 调度有界 leaf worker（默认一个），写入自己的 runtime mailbox，并最多报告 `READY_FOR_VERIFY`。只有 global control plane 可签发 scoped claim；scoped orchestrator 不得再签发下一级 scoped claim、改写全局 `CLAIMS.json`，也不得认领或改写 global epoch/五本账、改变产品目标/共享契约/文件所有权或自行宣告全局完成。Scoped orchestrator 或其 leaf worker 只要 authored、生成可直接应用的 patch，或直接/间接 materially edited diff，整条 lane 均属于 author side，不得执行该 PR 的 merge。遇到 founder-only 类别、输入/hash/base 漂移、越界写入或验收无法闭合时，写 escalation 后停在该项。全局 control plane 必须独立重跑机器验收后，结果才可提升进项目真源。

## 启动顺序

1. 完整读取根目录 `AGENTS.md` 及其规定的法律与产品文件。
2. 完整读取全局 `orchestration` skill 及本次需要的 references，再核对协议版本/hash。
3. 读取本 overlay 并判定身份。Global control plane 还须读取 `docs/ops/ORCHESTRATOR-STATE.md`、`docs/ops/MODEL-ROUTING-2026-07-11.md` 与 `docs/review/FULL-PRODUCT-REAUDIT-2026-07-11.md`；scoped orchestrator 改读其已通过 machine checker 的 bootstrap、work order、locks 与权威引用。
4. 从 git、PR/CI、worktree、进程与部署重新核验本身份需要的可变事实；状态账和旧 transcript 只作证据。
5. Global control plane 先核对现有 claim；无冲突或 founder 明确授权接管后，才登记唯一可恢复 control plane。Scoped orchestrator 只核对自己的 fencing claim，绝不覆盖 global claim 或恢复旧 workflow。

## FIKIRTIVE 追加红线

- `docs/BLUEPRINT.md` 不可由 agent 修改；若现实与蓝图冲突，停下并交 founder 修宪。
- 钱路必须 exactly-once、fail-closed；owner-scoped 查询必须携带 `ownerId`。
- 永不直接 push `main`，永不 auto-merge/merge watcher，永不自动部署、花真钱或写真实平台。
- PR #228 改写治理与 merge law，因此只能由 founder 合并。它落入 `main` 后，普通 PR 的 delegated merge 才按 `AGENTS.md` 生效；作者或实质编辑者不得执行自己的 merge。
- Founder-only 类别、CI 不可用处置与分离职责，以 `AGENTS.md` 为准；全局 skill 只能收紧，不能放宽。
- 顾问证据包必须移除 `.env`、token、private key、凭据值与含密 transcript；默认 tool-less。不得以 hook 锁模型、冒充实际 model provenance 或关闭 provider safeguard。
- 保护所有未归本工单所有的 dirty worktree；不得 reset、clean、prune、stash-drop、force-remove 或删除。

## 当前项目裁决与 gate

仅对 global control plane，`docs/ops/ORCHESTRATOR-STATE.md` 的 D0–D8 是 founder 已批准的历史工作授权，但状态事实必须重验；scoped orchestrator 不从该状态账取得任何超出 work order 的权限。全产品 re-audit 的 Gate 0/1 完成前，不扩建产品 thesis、大壳或新 continent；只允许 L1 red test、安全/凭据 inventory 与只读取证等不扩大 thesis 的工作先行。

任何产品身份、品牌、蓝图、不可逆架构、schema/migration、钱路/租户、凭据/权限、生产/部署、外部写入/花费/删除或治理判断都升为 Tier 1。Fable 5 Max 与 independent SOL Ultra 使用同一份盲化 raw evidence 分别作答；缺 Fable 时 SOL 只能标成 fallback，不能一人占两席或伪报完整 council。Founder 保留最终裁决。

## 项目状态与汇报

只有 global control plane 在阶段边界更新 `docs/ops/ORCHESTRATOR-STATE.md`，且它只是最后核验检查点。Scoped orchestrator 只写自己的声明 mailbox/checkpoint/escalation；由 global control plane 核验后决定是否提升进状态账。向 founder 使用 `【已验】`、`【在途】`、`【待决】`；顾问 incomplete、fallback 或 worker 自评都不得写成共识或完成。

本项目协议仍是 `trial`：完成一个真实工作循环后，用状态账的衡量项复盘；只有 founder 可把它转为 `accepted`。若 trial 未减少中断、错误完成或越界动作，就简化或退役，不把编排协议养成第二个产品。
