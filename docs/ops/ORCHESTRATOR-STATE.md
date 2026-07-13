# FIKIRTIVE 编排状态账

> 更新时间：2026-07-13（Asia/Kuala_Lumpur）
> 性质：可恢复 control plane 的最后核验检查点，不替代 git、GitHub、CI、部署、进程或 Founder 指令。
> 协议状态：`trial`。旧状态账保留在 git `449145e9:docs/ops/ORCHESTRATOR-STATE.md`，只作历史证据，不得恢复其 claim、模型路由、PR、SHA、部署状态或旧 workflow。

## Control plane

- Program：`fikirtive-launch-v1`
- Epoch：`fikirtive-launch-v1-20260713-01`
- Founder 当前指定的 global control plane：Codex task `019f5a53-ada3-75e2-bfcb-8f0a89c16afa`
- 目标：以 filesystem-harnessed sessions 完成一个真实可收费的 FIKIRTIVE 纵切，随后对 exact release candidate 执行完整 launch-readiness、E2E、受控 canary 与 Founder Go/No-Go。
- Global control plane 的身份来自 Founder 明确指定并在本账留痕，不来自本地 claim、超时或 lease。若另一个 control plane 可能仍活跃、身份不明或状态冲突，停止派单并请 Founder 消歧；不得自动 takeover。
- `按 v1 开始` 授权执行本计划，不等于授权任何 Founder-only merge、deploy、真实花费、凭据变更或真实平台写入。

## VERIFIED

- `origin/main=449145e9971e3ac8860d23d7edae697f4f8bd0af`（重验于 2026-07-13）。
- Global orchestration：`VERSION 3.0.1`；source `BELCORT-SDN-BHD/orchestration-skill@7549a1fcfda6e24ec3d6fdaac23c455f80b4e303`；`SKILL.md` SHA-256 `2d79e050b6e7248f49a7ca22a33ef888f2fd416e4162ae8e06fb0074adee6164`。Codex/Claude 安装路径解析到同一 canonical clone；两 host preflight、upstream validate 与 smoke 通过。
- Gate 0：Draft PR #284，Founder-only，author lane 不得 merge。历史 head `f68d9e32` 的 CI 4/4 绿且 frozen Fable cross-family review PASS；任何后续/current head 都不得继承该结论，必须从 GitHub 读取 exact head 并重跑 same-head CI 与 fresh review。本账不自证承载自身变更的 PR head。
- H1：本地 candidate `cb330c3a` 在隔离 worktree；root 已复跑 focused suite 84/84 两次、证据 hash、scope/history、Blueprint、Route-B、packages build 与全 workspace typecheck。它仍未获 exact-head independent PASS，未 push、未 merge。
- PR #280：`7da86886`，OPEN、MERGEABLE、current-head CI 4/4 绿，钱路 Founder-only。
- PR #282：`be968f39`，OPEN、MERGEABLE、current-head CI 4/4 绿。两者均须 Founder 分别点名，不从 v1 启动令推导 merge 权。
- 216 条 Route-B 能力当前为 145 `listed`、68 `spec-ready`、3 `code-complete`、0 `sandbox-verified`、0 `live-verified`、0 `release-certified`。这不是上市完成度。
- 本 launch-v1 control plane 自接管后未执行 merge、deploy、真实花费或真实平台写入；无 15 分钟轮询 automation。

## Product truth

- 当前真实主链是：目标 → Otto 计划/基础价格 → 确认 → 生成 → Canvas/聊天查看结果 → 下载/credit 明细。
- 目标可收费体验是：目标 → 完整 plan 与绑定报价 → `Watch Otto work` → FIKIRTIVE Canvas/Factory/Storyboard 的真实执行与可理解进度 → 在安全边界暂停/修改/接管/恢复 → 输出与统一费用/结果凭证。
- Schedule、publish、analysis 不强制把用户带到沉浸现场；可信状态、关键结果与 deterministic deep link 足够。Canvas/Factory/Storyboard 的创作动作才需要 live work surface。
- 生产代码没有 Canva.com integration；“Canvas”指 FIKIRTIVE 自己的创作面，不得对外误称 Canva。
- Factory 正式面、durable pause/takeover/resume、active browser E2E、部署 SHA provenance、restore/rollback/alerting 与 public legal/support 仍是 launch blockers。B11/B12/B13 未完成。

## Active phase

1. **Gate 0 governance**：expanded review 的 stale takeover、旧 advisor protocol 与 stale-state findings 已修复；最终 pre-commit independent re-review PASS，无剩余 material finding。以 Git/GitHub 当前 exact head 为准，仍须在同一 committed head 重跑 Claude Fable review 与 CI 4/4；任何新 commit 都使旧 verdict 失效。
2. **H1 execution harness**：等待 `cb330c3a` exact-head independent verdict；任何修复都产生新 head 并重跑全部机器证据。
3. **Scoped mode**：关闭。外部 `CLAIMS.json` 明确为 `CLOSED_BOOTSTRAP_ONLY`，不授予 global 身份，也不能启动 scoped session。只有 Gate 0 与 H1 分别落 main、current-main cold-start 通过且 global control plane 签发有效 registry generation 后才可开启。
4. **Product work orders**：H2 风险/flow inventory 与 launch contract 目前只在外部 harness 目录作为 draft/research；H1 接受前不得把它们提升为 repo 真源或启动写 session。

## Persistent evidence

- Current external checkpoint：`/Users/winnin/Documents/Codex/FIKIRTIVE-HARNESS/fikirtive-launch-v1/CONTROL-PLANE.md`
- Checkpoint updated：`2026-07-13T13:28:48Z`
- Checkpoint SHA-256 at this boundary：`5659eccbfc5f860e3b6c2e864288d8071e6df4bd82bee51a41674247db10a577`
- H2 launch-risk inventory：同目录 `research/H2-LAUNCH-RISK-INVENTORY.md`
- H2 product-flow inventory：同目录 `research/H2-PRODUCT-FLOW-INVENTORY.md`
- Draft launch/E2E contract：同目录 `drafts/H2-LAUNCH-CONTRACT-E2E.md`
- Frozen Gate 0 reviews：同目录 `reviews/gate-0/`
- H1 r002 runtime evidence：同目录 `runs/WO-H1-HARNESS/r002/`

恢复时先完整读取 global skill、`AGENTS.md`、`docs/BLUEPRINT.md`、`.claude/CLAUDE.md`、review playbook、本 overlay 与本账，再从 repo/GitHub/CI/worktree/进程/部署重验可变事实。外部 checkpoint 的 hash 若已变化，先审阅变化原因；不得用 transcript 或历史状态自动补权限。

## Recovery next step

1. 重验 global skill pin、repo/main、#284/#280/#282 current heads、所有 dirty worktree 与外部 checkpoint hash。
2. 完成 Gate 0 successor exact-head review/CI；保持 Draft 与 Founder-only。
3. 完成 H1 exact-head independent review；未 PASS 不 push。
4. 只有 Founder 分别合并 Gate 0 后，才把 H1 restack 到 exact current main 并走自己的 PR/review/CI/cold-start。
5. Harness 真正落地后，才签发互不重叠的产品 work orders；完整 launch-readiness/E2E 在 exact release candidate 上执行，而不是现在提前宣称。
