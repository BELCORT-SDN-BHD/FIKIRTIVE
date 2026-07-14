# FIKIRTIVE 编排状态账

> 更新时间：2026-07-14（Asia/Kuala_Lumpur；第二版——grill 收束 + wayfinder 立图）
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

- `origin/main=0628d580ca0c46ea5b75fa576866b9a5e78b64a2`（重验于 2026-07-14T05:10Z，= #286 squash 落地后；#286 由 Founder 于 05:06Z 亲合）。
- 换届完成：Founder 经 handoff `FIKIRTIVE-HANDOFF-2026-07-14B.md` + 开场指令指定 fresh Claude（Fable 5）session 为 global control plane；前任 Claude session 交棒即退。
- 外部 `CLAIMS.json` 已由本 control plane 迁至 checker v1 schema（`schema_version:1`、`generation:1`、`claims:[]`，仍 `CLOSED_BOOTSTRAP_ONLY`；v0 原件备份同目录）。
- Grill 2026-07-14 判决已入册（判决记录同 PR 追加节）；wayfinder 决策地图 = issue #287（票 #288–#297；三张 research 票已派 AFK 工位）。
- Global orchestration：**简化版**（Simplify universal orchestration policy）；source `BELCORT-SDN-BHD/orchestration-skill@bd9c092564617518d080b6fa72bd8ff1d9107fd9`；`SKILL.md` SHA-256 `9cab52009c1cc333a8ac256b7a1ee3460576668928150b170c7c10e3d1ec5d1f`。重钉授权=Founder 2026-07-14 晚「完全使用新的 /orchestration update」。双安装路径解析到同一 canonical clone（`~/.local/share/orchestration-skill`）。要点：判断留主脑；Claude Code 重实现/调试/重构派 `codex:codex-rescue`（gpt-5.6-sol xhigh）；preflight/MODEL-ROUTING/STATE-TEMPLATE 已随简化移除；跨族高后果复审收编为本项目自有法（overlay 同批改）。（旧 v3.0.3 pin 见 git 史。）
- Gate 0：PR #284 已由 Founder 合入 main（`c84ceec0`），author lane 未执行 merge。
- H1：PR #285 已于 2026-07-14T04:36Z 由本非作者 control plane 按 Founder 2026-07-13 录案授权+2026-07-14「先合」现场指令执行 squash merge（`4a09c52c`）。合并前实时重验 exact base/head `c84ceec0`/`a0dc1823`、CI 4/4 绿、MERGEABLE-clean、零评论；落地树与受审 head 逐字节一致（10 文件，+2785/-0）。证据链（独立 exact-head PASS + Fable 5 xhigh 异族 PASS，无 P0/P1/P2，99/99）冻结在外部 harness 目录 `reviews/h1/`。
- PR #280：`7da86886`，OPEN、head CI 4/4 绿，钱路 Founder-only；base 已落后 main 三个 commit（#284/#285/#286），须 restack+重出 exact-head 证据后由 Founder 点名。
- PR #282：`be968f39`，同上（非钱路），须 restack+重验后点名。
- 216 条 Route-B 能力仍为 145 `listed`、68 `spec-ready`、3 `code-complete`、0 `sandbox-verified`、0 `live-verified`、0 `release-certified`；H1 是治理设施，不晋升任何能力行。
- 本 control plane 自接管以来：执行了一次 Founder 授权的非作者 merge（#285）；无 deploy、无真实花费、无真实平台写入、无轮询 automation。

## Product truth

- 当前真实主链是：目标 → Otto 计划/基础价格 → 确认 → 生成 → Canvas/聊天查看结果 → 下载/credit 明细。
- 目标可收费体验是：目标 → 完整 plan 与绑定报价（**一个 request = 一次批准**的授权信封）→ `Watch Otto work`（live reflection，B9 契约 6）→ **「停」按钮 + 人插手即停**（2026-07-14 grill 裁定：不建暂停/存档/接管/续跑重机器）→ 输出与统一费用/结果凭证。
- Schedule、publish、analysis 不强制把用户带到沉浸现场；可信状态、关键结果与 deterministic deep link 足够。Canvas/Factory/Storyboard 的创作动作才需要 live work surface。
- 生产代码没有 Canva.com integration；「Canvas」指 FIKIRTIVE 自己的创作面，不得对外误称 Canva。
- Factory 正式面、active browser E2E、部署 SHA provenance、restore/rollback/alerting 与 public legal/support 仍是 launch blockers。B11/B12/B13 未完成。（原「durable pause/takeover/resume」一项经 2026-07-14 grill 查档裁定移除：founder 亲定的收钱条件从不含 run-control，该措辞系 agent 起草；替代=「停」按钮+人插手即停，详见判决记录 2026-07-14 节。）

## Active phase

1. **Cold-start 验收已 PASS**（2026-07-14，fresh clone @`4a09c52c`：checker 自测 99/99、真实 registry fail-closed、合成 revision 四阶段全通、越界写被拦；证据在外部 harness `runs/COLD-START-4a09c52c/`）。多 session 并行施工的机器前置已闭合。
2. **Scoped mode：机制就绪、闸仍关**。外部 `CLAIMS.json` 已迁 v1（generation 1、零 claim、`CLOSED_BOOTSTRAP_ONLY`）；签发第一张真实产品工单时才开闸。
3. **Grill 2026-07-14 已收束**（判决见判决记录同批追加节）：第一期卖法/三环定义/审批粒度/停按钮裁定/建卖两图配对全部拍板。产品规划进入 wayfinder 阶段：决策地图 issue #287，票走 grilling/research/prototype/task 四型；wayfinder 只管决策层，执行归 harness 工单，Route-B 台账仍是唯一能力真源。
4. **第一批并行调度（进行中）**：AFK 研究票 #289（引擎图纸 rebaseline）/#290（Meta App Review 材料）/#291（BSP 选型）已派工位；#280/#282 仍须 restack+重出 exact-head 证据后交 Founder 点名；创作批2 剩余工位（G-P/E-P）与 B8 设计草案（票 #296）按建城图排队签发 harness 工单。
5. **不再有待合并的换届件**：#286 已由 Founder 合并；本状态账更新（含判决入册）为下一件 Founder-only docs PR。

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

1. 重验 global skill pin（v3.0.3）、`origin/main`、#280/#282 current heads、CLAIMS.json（v1）、wayfinder 地图 #287 现状、所有 dirty worktree 与外部 checkpoint。
2. 按 wayfinder 地图推进决策票（一次一票）；research 票产物在外部 harness `research/`，核验后回填票与地图。
3. #280/#282 restack 到 exact current main，重出各自 exact-head 证据，交 Founder 点名；不得 bulk merge。
4. 按建城图签发互不重叠的产品 work orders（写 session 必走 harness claim，registry 已 v1）；完整 launch-readiness/E2E 在 exact release candidate 上执行，而不是现在提前宣称。
