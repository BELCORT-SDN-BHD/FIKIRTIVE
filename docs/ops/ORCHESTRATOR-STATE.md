# FIKIRTIVE 编排状态账

> 更新时间：2026-07-14（Asia/Kuala_Lumpur）
> 性质：可恢复 control plane 的最后核验检查点，不替代 git、GitHub、CI、部署、进程或 Founder 指令。
> 协议状态：`trial`。旧状态账保留在 git 史（`449145e9` 与 `4a09c52c` 两版），只作历史证据，不得恢复其 claim、模型路由、PR、SHA、部署状态或旧 workflow。

## Control plane

- Program：`fikirtive-launch-v1`
- Epoch：`fikirtive-launch-v1-20260713-01`
- Founder 当前指定的 global control plane：Claude Code（Fable 5）session——Founder 于 2026-07-14 经 handoff 文件（`FIKIRTIVE-HANDOFF-2026-07-14.md`）明示「继续这个总指挥的任务」并下达「先合」指令而指定；前任 Codex task `019f5a53-ada3-75e2-bfcb-8f0a89c16afa` 已完成 handoff 后闲置，未合并未部署未花钱。
- 目标：以 filesystem-harnessed sessions 完成一个真实可收费的 FIKIRTIVE 纵切，随后对 exact release candidate 执行完整 launch-readiness、E2E、受控 canary 与 Founder Go/No-Go。
- Global control plane 的身份来自 Founder 明确指定并在本账留痕，不来自本地 claim、超时或 lease。若另一个 control plane 可能仍活跃、身份不明或状态冲突，停止派单并请 Founder 消歧；不得自动 takeover。
- `按 v1 开始` 授权执行本计划，不等于授权任何 Founder-only merge、deploy、真实花费、凭据变更或真实平台写入；每次 merge 均须该 PR 自己的 exact-head 证据闭合。

## VERIFIED

- `origin/main=4a09c52cef6d5e0c445826aa9a3bbfb2a973cd1f`（重验于 2026-07-14，= H1 squash 落地后）。
- Global orchestration：`VERSION 3.0.3`；source `BELCORT-SDN-BHD/orchestration-skill@0902f0131c79de14c0e040297b6e0d8d371d85e8`；`SKILL.md` SHA-256 `2fdccc103b2425e4aab0832dbdbe3ef2d84186f5f98cf8c50d38ed4341473c34`。重钉授权=Founder 2026-07-14「按照最新的版本去」。双安装路径解析到同一 canonical clone；preflight v6 与 upstream smoke/validate 通过。
- Gate 0：PR #284 已由 Founder 合入 main（`c84ceec0`），author lane 未执行 merge。
- H1：PR #285 已于 2026-07-14T04:36Z 由本非作者 control plane 按 Founder 2026-07-13 录案授权+2026-07-14「先合」现场指令执行 squash merge（`4a09c52c`）。合并前实时重验 exact base/head `c84ceec0`/`a0dc1823`、CI 4/4 绿、MERGEABLE-clean、零评论；落地树与受审 head 逐字节一致（10 文件，+2785/-0）。证据链（独立 exact-head PASS + Fable 5 xhigh 异族 PASS，无 P0/P1/P2，99/99）冻结在外部 harness 目录 `reviews/h1/`。
- PR #280：`7da86886`，OPEN、head CI 4/4 绿，钱路 Founder-only；base 已落后 main 两个 commit，须 restack+重出 exact-head 证据后由 Founder 点名。
- PR #282：`be968f39`，同上（非钱路），须 restack+重验后点名。
- 216 条 Route-B 能力仍为 145 `listed`、68 `spec-ready`、3 `code-complete`、0 `sandbox-verified`、0 `live-verified`、0 `release-certified`；H1 是治理设施，不晋升任何能力行。
- 本 control plane 自接管以来：执行了一次 Founder 授权的非作者 merge（#285）；无 deploy、无真实花费、无真实平台写入、无轮询 automation。

## Product truth

- 当前真实主链是：目标 → Otto 计划/基础价格 → 确认 → 生成 → Canvas/聊天查看结果 → 下载/credit 明细。
- 目标可收费体验是：目标 → 完整 plan 与绑定报价 → `Watch Otto work` → FIKIRTIVE Canvas/Factory/Storyboard 的真实执行与可理解进度 → 在安全边界暂停/修改/接管/恢复 → 输出与统一费用/结果凭证。
- Schedule、publish、analysis 不强制把用户带到沉浸现场；可信状态、关键结果与 deterministic deep link 足够。Canvas/Factory/Storyboard 的创作动作才需要 live work surface。
- 生产代码没有 Canva.com integration；「Canvas」指 FIKIRTIVE 自己的创作面，不得对外误称 Canva。
- Factory 正式面、durable pause/takeover/resume、active browser E2E、部署 SHA provenance、restore/rollback/alerting 与 public legal/support 仍是 launch blockers。B11/B12/B13 未完成。

## Active phase

1. **H1 已落地**：下一关是 current-main（`4a09c52c`）cold-start 验收——独立 fresh lane 只凭已落地的 filesystem contract 完成 bootstrap、权威校验、尊重 CLOSED claims 并正确汇报；证据记录在外部 harness 目录 `runs/`，不入 repo。
2. **Scoped mode：仍关闭**。外部 `CLAIMS.json` 为 `CLOSED_BOOTSTRAP_ONLY`、零 claim；cold-start PASS 且 global control plane 签发有效 registry generation 前不得开启。
3. **Product work orders**：H2 风险/flow inventory 与 launch contract 仍只是外部 harness 目录的 draft/research；cold-start PASS 前不得提升为 repo 真源或启动写 session。Founder 2026-07-14 定向：以 grilling + wayfinder 式决策地图推进产品规划（决策层），与 harness（执行层）、Route-B 台账（能力真源）分层不冲突，不得因此另建第二本 backlog。
4. **待 Founder 合并**：重钉 v3.0.3 + 本状态账更新的 docs PR（治理件，Founder-only）。

## Persistent evidence

- Current external checkpoint：`/Users/winnin/Documents/Codex/FIKIRTIVE-HARNESS/fikirtive-launch-v1/CONTROL-PLANE.md`
- Checkpoint updated：`2026-07-14T04:45:00Z`（换届+H1 落地边界）
- H1 frozen reviews：同目录 `reviews/h1/`（含 Fable exact-head PASS 与 4 条非阻塞 P3 加固候选）
- H2 launch-risk inventory：同目录 `research/H2-LAUNCH-RISK-INVENTORY.md`
- H2 product-flow inventory：同目录 `research/H2-PRODUCT-FLOW-INVENTORY.md`
- Draft launch/E2E contract：同目录 `drafts/H2-LAUNCH-CONTRACT-E2E.md`
- Automation 时区事故：同目录 `incidents/2026-07-14-AUTOMATION-TIMEZONE.md`（不得重建轮询 watcher）

恢复时先完整读取 global skill、`AGENTS.md`、`docs/BLUEPRINT.md`、`.claude/CLAUDE.md`、review playbook、overlay 与本账，再从 repo/GitHub/CI/worktree/进程/部署重验可变事实。外部 checkpoint 的 hash 若已变化，先审阅变化原因；不得用 transcript 或历史状态自动补权限。

## Recovery next step

1. 重验 global skill pin（v3.0.3）、`origin/main`、#280/#282 current heads、所有 dirty worktree 与外部 checkpoint。
2. 完成 current-main cold-start 验收；未 PASS 不签发任何 scoped claim。
3. #280/#282 restack 到 exact current main，重出各自 exact-head 证据，交 Founder 点名；不得 bulk merge。
4. Cold-start PASS 后，才按 H2 输入签发互不重叠的产品 work orders；完整 launch-readiness/E2E 在 exact release candidate 上执行，而不是现在提前宣称。
