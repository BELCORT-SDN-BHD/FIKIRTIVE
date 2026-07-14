# FIKIRTIVE 编排状态账

> 更新时间：2026-07-15（Asia/Kuala_Lumpur；第四版——Codex 接管同一 epoch + #315 r005 收口验收 + Founder 呈交边界）
> 性质：可恢复 control plane 的最后核验检查点，不替代 git、GitHub、CI、部署、进程或 Founder 指令。
> 协议状态：`trial`。旧版保留在 git 史（`449145e9`/`4a09c52c`/`ff995eab`），只作历史证据，不得恢复其 claim、模型路由、PR、SHA 或部署状态。

## Control plane

- Program：`fikirtive-launch-v1` · Epoch：`fikirtive-launch-v1-20260713-01`
- **当前主脑 = 本 fresh Codex session**。Founder 于 2026-07-15 现场逐字指定：「旧 Claude Code global control plane 现在正式退任，Codex 接管同一 program epoch fikirtive-launch-v1-20260713-01，并按上述 r005 路径开始。」前任 Claude Code（Opus 4.8）自该指令起正式退任；program / epoch 不变，未新开 epoch。
- 复审配置由 Founder 逐 session 指定。Claude/Opus 主脑任内完成的 #315 R3（挑战者为 Codex）保留其历史跨族 provenance；接管后的 Codex worker / verifier 与本主脑同族，**不得**写成 cross-family PASS。未来高后果跨族复审需由 Founder 或现行规则另行指定不同 frontier family。
- **实证记录（2026-07-15）**：#314 的同族（Fable）对抗复审把两个真缺陷**双双「反驳掉」**（2/2 refutes）——一个致回头客永不复活，一个致生产热表锁死；异族（codex）复审翻案，成文法（REVIEWER-PLAYBOOK / closed-beta-saas §3.4）与 repo 逐字节先例均站异族一边。**此为「复审者与被审者同族则可能集体盲」的一次硬证据**，供后续复审配置决策参考。
- Global control plane 的身份来自 Founder 明确指定并在本账留痕，不来自本地 claim、超时或 lease。本次身份冲突已由上述 Founder 现场指令消歧；任何旧 session / pid 的晚到输出均须重新核验，不能恢复其 current 权限、旧 pin 或旧 recovery 指令。

## ⚠️ 合并权（2026-07-15 控制面自纠——本次换届最重要的一条）

**控制面此前把 Founder 2026-07-14 的口头总授权（「我给你权利 merge」）读成覆盖一切 —— 错。**

`AGENTS.md` §2 的 **Founder-only** 明列：governance/merge-policy、product identity/brand、blueprint、**irreversible architecture**、**schema/migration**、**money/tenant paths**、security credentials、production/deploy、external publish/spend/delete、异常大或有争议的 PR、**tier 不确定的任何东西**。§5 定义 sacred spend path 含 credit ledger reserve/settle/refund。

**Delegated ordinary merge** 另有四条硬前置：未自撰该 diff + 当前 head CI 全绿 + **independent cross-family review 无未决 P0/P1** + 不含任何 founder-only 类别 + 结果对 main 复核。

**现行法：口头总授权不推翻成文 sacred 类别保留（宪法 1：安全 > 效率）。钱路 / schema / 治理 一律呈 Founder 亲点。**
此错误由 codex SOL 跨族复审在控制面**即将合并 PR #315（钱路 diff）之前**逮到。

## VERIFIED（2026-07-15 重验）

- `origin/main = f2e08a37`（#313 squash）。路线乙创作批2 四工位（F-P/G-P/H-P/E-P）全落 main；#280/#282/#307/#312/#313/#305/#308 均已合并。
- 外部 `CLAIMS.json`：**generation 6**；`claim-wo-otto-phase1-r005` = 唯一 **ACTIVE**（scoped，base_sha `7742eb6036052d91590d596f39ddf3a6a4f4d657`）；r004 已 `SUPERSEDED`，更早 revision 只作历史证据。ACTIVE 在此是 fencing claim，不表示仍有授权施工在飞。
- **哈内斯判例（历史仍有效）**：checker 的 `startup` / `prewrite` 硬要求 `HEAD == base_sha` 且 changed=0 → 在已交付 commit 上做修复轮必须签发新 revision；r003/r004/r005 均据此换基座。签发会 bump generation 并令旧 lane fail closed。
- **#315 r005 current-head 已验**：base `7742eb60…` → head `f9cfb314210acee1139463660c5056638072ebb5` 恰好只改 B9 报告与 fence 顶部 docblock；fence 首个 `import` 至 EOF 逐字节不变，production/tests/root config/CI/schema/钱路零 diff。mailbox `READY_FOR_VERIFY` / delivery / gen 6，terminal checker `changed=2`。
- **独立同族复核已验**（不冒充 cross-family）：exact head 上 check、71 migrations + drift 0 + 2923 tests、web-build、lint（0 errors / 75 warnings）、fence self-test / 仓扫描、locks/scope/effects/cleanup 全部 exit 0；未发现 r005 范围内新 P0/P1。
- PR #315 Actions run `29363340148` 四个 jobs 都因 GitHub billing/payment annotation 在零步骤处失败，所以 remote CI **不绿**。证据评论：`https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/315#issuecomment-4973404091`。钱路仍为 Founder-only；本账的“已验”不是 merge 授权。
- 本 Codex control plane 接管以来：**零 merge、零 deploy、零真实花费、零真实 provider/LLM 请求、零轮询 automation**。获授权的 GitHub 写入仅为 r005 分支 non-force push 与 #315 evidence comment；无生产或真实平台状态变更。

## 在飞（2026-07-15，交接必读）

- **当前没有获授权的 scoped 写入在飞。** r005 author lane 已停止写入；mailbox 为 terminal `READY_FOR_VERIFY`，repo / remote / PR head 三方均为 `f9cfb314…`。
- generation 6 / r005 唯一 ACTIVE 暂时保留为 fencing 边界，直到 Founder 对 #315 明确决定。不得为“先开工”提前 bump generation，也不得把 terminal claim 误写成仍在施工。
- 旧 Claude / Codex 进程可能仍在主机上存活，但自 Founder 接管指令起没有 control-plane 权限。其任何晚到输出必须由当前控制面从 repo、GitHub、CI、worktree 与哈内斯重新核验后才能提升；不得按旧 pid recovery 指令自动恢复。

`<HARNESS>` = `/Users/winnin/Documents/Codex/FIKIRTIVE-HARNESS/fikirtive-launch-v1`

## 待 Founder / 待收口（控制面不能越权）

| 件 | 当前核验状态 | 边界 |
|---|---|---|
| **PR #314** | `079d4b1e9aae3985109ff480757528019d20d651`；current-head 本地四关、migrate/drift、2,906 tests 与裁决证据齐，`READY_TO_PRESENT`；远端 CI billing 零步骤失败，**不是绿** | schema/migration = Founder-only；只能由 Founder 明确批准 CI-unavailable 程序后亲合 |
| **PR #315** | `f9cfb314210acee1139463660c5056638072ebb5`；r005 两文件收口、mailbox、主控制面与独立同族全验均闭合；远端 CI billing 零步骤失败，**不是绿** | 既有钱路 diff = Founder-only；当前控制面与作者均不得合并 |
| **PR #316** | `80bf525d8d61b8da9232dfcdaa0d273cd26147c5`；**BLOCKED**：D-037 把 W-3/CANCELLED 派工 provenance 错链到不含该裁决的 `control/WO-OTTO-PHASE1/…`，且无 current-head fallback 门禁证据 | outcome provenance 应指向明确写有“已裁独立 CANCELLED”的 NH-1 dispatch；B8 plan 只能证明裁决槽位 / 两案 / 随车时点。新 head 重跑门禁并独立复核后，才可随 #314 呈 Founder |
| **PR #319（本 PR）** | v3 `023d1a3c` 已过时且无 exact-head 本地四关 / 独立 review；本次 v4 正在收账 | governance / merge-policy = Founder-only；本控制面是 material editor，不得自审自合；新 head 仍须本地完整门禁、证据评论与 Founder 明确批准 |
| **#317 / #318** | 共租户复合 FK 房规；`NOT VALID` + `VALIDATE` 同事务锁收益问题 | 架构 / schema 房规，待 Founder 选择 |
| **#320 / #321** | 约 69 处 update/upsert tenant-guard 盲区；LLM meter 旧退款测试不核对退款身份 | tenant / money 路径，另立受控工单，不混入 r005 |

#322 是 CLI driver 的真正强制路线（依赖清单 / 生产镜像 / 生产环境凭据），目前仅跟踪、**未实施**。另有三件 Founder 亲手文书：#299（Meta 验证，审核中）· #301（Gupshup 开户 + API key）· #309（EasyStore Partner 注册）。

## 跨族复审双 BLOCK（2026-07-15）— 判决与证据

codex SOL 对 **#314 与 #315 双双判 BLOCK**。控制面逐条回一手证据自裁（**两族冲突处一律以成文法 + repo 先例为准，不采信任一族结论**）。裁决书 8 条全文：`<HARNESS>/reviews/ADJUDICATION-2026-07-15-pr314-pr315.md`。

**#314 采纳 3 条**（每条都违反成文法且有 repo 逐字节先例；**其中 2 条曾被同族复审反驳掉**）：
- ContactIdentity 软删模型用**全量**唯一索引 → 违 REVIEWER-PLAYBOOK；先例 EntityVariant partial index。**产品后果：回头客被 CSV 导入静默当「重复跳过」，永不复活。**
- `Generation`（法条**点名热表**）上默认验证型 FK → 违 closed-beta-saas §3.4；先例 org_tenant 6× NOT VALID。
- tenant-guard `CHECKED_OPS` 漏 `findFirstOrThrow`（app 真实调用点 0 → 零爆炸半径）。

→ 修复轮已交付 `b15a4ff7`；控制面独立四关全绿 + **真库实证**（`pg_indexes` 见 partial 索引带 `WHERE deletedAt IS NULL`、`pg_constraint.convalidated=t`）。

**#314 降级 1 条**：codex 判「跨租户 FK」BLOCKER → 降级（全仓共租户复合 FK=0，既有 FK 一律裸 id → 遵循房规非新洞；且日后补是**加性**非单向门）→ 归 #317。

**#315 采纳**：合并权 BLOCKER（见上）+ worker-verdict 测试**假覆盖**（mock 里重新实现被测对象 → 没跑生产实现；与 W-B3-E-P 被 BLOCK 的假覆盖同类）+ 缺 stream 错误路径与**旧持久化 state→新 agent 恢复**（唯一触及线上真实数据的回归面）+ CLI fence 可绕过且未接线 = **假保障** + 报告失真。

**#315 代码本身干净**：跨族明确否证行为漂移与钱路缺陷（reserve 在 run 前、maxSteps≡maxTurns 同源、四类 settle/refund 未改、NaN/负数全拦、MaxTurns instanceof 失败方向 = 整退非多扣）。**被 BLOCK 的是「谁能合」与「测试/文档在说谎」，不是实现。**

## #315 R3 裁决与 r005 收口（2026-07-15）

- 历史跨族 R3 对 `7742eb60…` 判 BLOCK，但其关键结论是**原 PH1G-A4「不得留可绕过的 fence」本身不可达**：在有动态 loader / `eval` 的语言里，静态 import 扫描不能成为安全边界。裁决书：`<HARNESS>/reviews/ADJUDICATION-R3-2026-07-15.md`。
- R3 已用故障注入确认 M1 钱路身份、M2 drain 次序与 M5 worker 断言有真实咬合力；production 实现相对 r004 base 零 diff。不得再打第四轮 fence 逻辑补丁。
- r005 只做两项诚实收口：fence 顶部 docblock 明确 best-effort / 非 security boundary / 已知非穷举盲区 / #322 未实施；B9 报告同步这些边界并删除“完整披露”绝对措辞。可执行 body 与 tests 未改。
- 当前控制面已把 acceptance 限定为修正后的 `PH1G-A4`、`PH1G-A5`、`PH1G-A7`，并在 exact head `f9cfb314…` 独立复核通过。mailbox machine status 保持 `READY_FOR_VERIFY`；control-plane disposition 是 `READY_TO_PRESENT`。两者都不把 billing-blocked remote CI 写成绿色，也不产生 merge 授权。

## 控制面自己欠的

- **CLI fence 接线** root `package.json` + `.github/workflows/ci.yml`。脚本只住在 #315：必须先由 Founder 合并 #315、对 `main` 复核脚本存在，再另开接线 PR；否则 CI 会引用 main 上不存在的文件。接线前任何文档不得把该 fence 写成保障。
- **#322 真正强制路线**：dependency/lockfile inventory、生产镜像无 CLI binary、生产环境无订阅凭据。当前仅跟踪，未实施；不得用 r005 静态 fence 代替。
- GitHub Actions 当前因 billing/payment 限制而在零步骤处失败；Founder 2026-07-14 裁定 public 前不处理账单，`protect-main` 的 required status checks 已移除、其余规则仍在。远端结果因此**不是绿**；合并前必须在 exact head 本地完整复现门禁、贴进 PR，并由 Founder 对 CI-unavailable 程序明确批准。重开票 #303（挂 B13）。

## Product truth

- 卖法：**「雇一个会用全套工具的 AI 营销员工」**；第一期钉死三环（做内容 / 发出去 / 唤回老客）；收钱走已 LIVE 的 credits 轨；三环外全城诚实 Coming soon。
- **城照建钱先收**：建城图管宽度（13 板块并行盖），卖图管深度（三环到齐即对顾客一号收钱，不等全城）。
- 目标可收费体验：目标 → 完整 plan + 绑定报价（**一个 request = 一次批准**的授权信封）→ `Watch Otto work`（live reflection，B9 契约 6）→ **「停」按钮 + 人插手即停**（不建暂停/存档/接管/续跑重机器）→ 输出与统一费用/结果凭证。
- 生产代码没有 Canva.com integration；「Canvas」指 FIKIRTIVE 自己的创作面，不得对外误称 Canva。
- B11/B12/B13 未完成（Factory 正式面、active browser E2E、部署 SHA provenance、restore/rollback/alerting、public legal/support 仍是 launch blockers）。

## Persistent evidence

- **外部 checkpoint（真源，比本账更细）**：`<HARNESS>/CONTROL-PLANE.md`
- 跨族复审与裁决：`<HARNESS>/reviews/`（`ADJUDICATION-2026-07-15-*`、`ADJUDICATION-R2-2026-07-15.md`、`ADJUDICATION-R3-2026-07-15.md`、`pr314-codex-*`、`pr315-codex-*`）
- 现行施工单控制文件：`<HARNESS>/control/WO-OTTO-PHASE1/r005/`；现行 mailbox：`<HARNESS>/mailboxes/WO-OTTO-PHASE1/r005/`。r004 及更早 revision 冻结为历史证据，不得回写。
- 信箱：`<HARNESS>/mailboxes/`；日志：`<HARNESS>/logs/`；claim registry：`<HARNESS>/CLAIMS.json`
- #315 current-head evidence comment：`https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/315#issuecomment-4973404091`
- Automation 时区事故：`<HARNESS>/incidents/2026-07-14-AUTOMATION-TIMEZONE.md`（**不得重建轮询 watcher**）

恢复时先完整读 global skill、`AGENTS.md`、`docs/BLUEPRINT.md`、`.claude/CLAUDE.md`、review playbook、overlay 与本账，再从 repo/GitHub/CI/worktree/**进程**/部署重验可变事实。不得用 transcript 或历史状态自动补权限。

## Recovery next step

1. 重验 `origin/main`、四个 open PR current heads、Actions annotations、worktree、`CLAIMS.json`（预期 gen 6 / r005 唯一 ACTIVE）、r005 mailbox 与 external checkpoint；旧 session / pid 只作待核输入。
2. 把 #314（`079d4b1e…`）与 #315（`f9cfb314…`）按各自 current-head 证据呈 Founder；两者 remote CI 都不绿，必须由 Founder 明确批准 CI-unavailable 程序后亲合。控制面不得代合。
3. #316 先修 D-037 provenance 错链，再在新 head 跑完整本地门禁、贴 SHA 绑定证据并独立复核；未闭合前不得写“随 #314 可合”。
4. 本 #319 v4 产生新 head 后，跑完整本地门禁并贴 PR 证据；governance Founder-only，且当前控制面是 material editor，不得自审自合。
5. **只有 #315 实际合并且对 `main` 复核后**，才一次 generation bump：retire r005 + 批量签发 W1/W2/W3 + #311；随后另开 CLI fence 接线 PR。禁止提前引用未落 main 的脚本。
6. #317/#318/#320/#321/#322 各守自己的 founder / architecture / money / tenant / security 边界，不混进 r005 或状态账 PR。
7. 完整 launch-readiness/E2E 只在 exact release candidate 上执行，不提前宣称。
