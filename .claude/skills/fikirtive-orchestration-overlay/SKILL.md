---
name: fikirtive-orchestration-overlay
description: FIKIRTIVE 的项目专属编排约束层。任何 agent 在本仓库接管或恢复长任务、进行产品/架构/设计/审计/规划判断、调度多模型或管理 PR 时，与全局 orchestration skill 一起使用；只追加项目法律、状态账与合并边界，不复制或替代全局协议。
---

# FIKIRTIVE 编排 Overlay

本文件不是第二份编排协议。角色、判断分层、Fable/SOL 顾问协议、worker 路由、provenance、liveness 与中断恢复，都以全局 `orchestration` skill 为唯一真源：

- Codex：`${CODEX_HOME:-$HOME/.codex}/skills/orchestration/SKILL.md`
- Claude：`$HOME/.claude/skills/orchestration/SKILL.md`
- Canonical source：`BELCORT-SDN-BHD/orchestration-skill`

本 overlay 的协议兼容基线是 global orchestration `VERSION 3.0.0`、source commit `4c05c495`（frontier orchestrator + bounded workers 重设计：编排者直派有界工位、无常任顾问层、跨族复审仅限例外件，上游 PR #4）、`SKILL.md` SHA-256 `acc46e6a3950e5589270c860a590efed21a66f342aa6e763d0418dcef9208f84`。（重钉授权=founder 2026-07-13 就任令「照 #269 先例处理」，原 v2.1.0 pin 见 git 史。）若全局 skill 缺失、`preflight.sh` 报两条安装路径不一致、版本/hash 不符，或当前 checkout 仍含同名 `.claude/skills/orchestration/`，停止判断级编排并向 founder 报告。不得在启动时自动 fetch/pull，不得悄悄复制本文件来重建通用协议，也不得把旧 transcript 当作替代。安装或更新全局工具属于机器状态变更，须有用户授权并使用现有 GitHub 身份。

## 启动顺序

1. 完整读取根目录 `AGENTS.md` 及其规定的法律与产品文件。
2. 完整读取全局 `orchestration` skill 及本次需要的 references，再核对协议版本/hash。
3. 读取本 overlay、`docs/ops/ORCHESTRATOR-STATE.md`、`docs/ops/MODEL-ROUTING-2026-07-11.md` 与 `docs/review/FULL-PRODUCT-REAUDIT-2026-07-11.md`。
4. 从 git、PR/CI、worktree、进程与部署重新核验可变事实；状态账和旧 transcript 只作证据。
5. 先核对现有 control-plane claim；无冲突或 founder 明确授权接管后，才将调用本 skill 的 session 记为唯一可恢复 control plane，不恢复旧 workflow。

## FIKIRTIVE 追加红线

- `docs/BLUEPRINT.md` 不可由 agent 修改；若现实与蓝图冲突，停下并交 founder 修宪。
- 钱路必须 exactly-once、fail-closed；owner-scoped 查询必须携带 `ownerId`。
- 永不直接 push `main`，永不 auto-merge/merge watcher，永不自动部署、花真钱或写真实平台。
- PR #228 改写治理与 merge law，因此只能由 founder 合并。它落入 `main` 后，普通 PR 的 delegated merge 才按 `AGENTS.md` 生效；作者或实质编辑者不得执行自己的 merge。
- Founder-only 类别、CI 不可用处置与分离职责，以 `AGENTS.md` 为准；全局 skill 只能收紧，不能放宽。
- 顾问证据包必须移除 `.env`、token、private key、凭据值与含密 transcript；默认 tool-less。不得以 hook 锁模型、冒充实际 model provenance 或关闭 provider safeguard。
- 保护所有未归本工单所有的 dirty worktree；不得 reset、clean、prune、stash-drop、force-remove 或删除。

## 当前项目裁决与 gate

`docs/ops/ORCHESTRATOR-STATE.md` 的 D0–D8 是 founder 已批准的当前工作授权，但状态事实必须重验。全产品 re-audit 的 Gate 0/1 完成前，不扩建产品 thesis、大壳或新 continent；只允许 L1 red test、安全/凭据 inventory 与只读取证等不扩大 thesis 的工作先行。

任何产品身份、品牌、蓝图、不可逆架构、schema/migration、钱路/租户、凭据/权限、生产/部署、外部写入/花费/删除或治理判断都升为 Tier 1。Fable 5 Max 与 independent SOL Ultra 使用同一份盲化 raw evidence 分别作答；缺 Fable 时 SOL 只能标成 fallback，不能一人占两席或伪报完整 council。Founder 保留最终裁决。

## 项目状态与汇报

阶段边界更新 `docs/ops/ORCHESTRATOR-STATE.md`，但它只是最后核验检查点。向 founder 使用 `【已验】`、`【在途】`、`【待决】`；顾问 incomplete、fallback 或 worker 自评都不得写成共识或完成。

本项目协议仍是 `trial`：完成一个真实工作循环后，用状态账的衡量项复盘；只有 founder 可把它转为 `accepted`。若 trial 未减少中断、错误完成或越界动作，就简化或退役，不把编排协议养成第二个产品。
