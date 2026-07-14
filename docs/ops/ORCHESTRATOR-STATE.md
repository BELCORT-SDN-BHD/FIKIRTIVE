# FIKIRTIVE 编排状态账

> 更新时间：2026-07-15（Asia/Kuala_Lumpur；第三版——正式 dev 开工 + 跨族复审双 BLOCK + **合并权自纠**）
> 性质：可恢复 control plane 的最后核验检查点，不替代 git、GitHub、CI、部署、进程或 Founder 指令。
> 协议状态：`trial`。旧版保留在 git 史（`449145e9`/`4a09c52c`/`ff995eab`），只作历史证据，不得恢复其 claim、模型路由、PR、SHA 或部署状态。

## Control plane

- Program：`fikirtive-launch-v1` · Epoch：`fikirtive-launch-v1-20260713-01`
- **主脑 = Claude Code（Opus 4.8）**。Founder 于 2026-07-15 换届。前任 Fable 5 session 交棒即退。
- 复审配置由 Founder 逐 session 指定；本 session 期间为 codex（GPT-5.6 SOL, xhigh）。跨族复审法本身见 overlay（#308 收编为项目自有法）。
- **实证记录（2026-07-15）**：#314 的同族（Fable）对抗复审把两个真缺陷**双双「反驳掉」**（2/2 refutes）——一个致回头客永不复活，一个致生产热表锁死；异族（codex）复审翻案，成文法（REVIEWER-PLAYBOOK / closed-beta-saas §3.4）与 repo 逐字节先例均站异族一边。**此为「复审者与被审者同族则可能集体盲」的一次硬证据**，供后续复审配置决策参考。
- Global control plane 的身份来自 Founder 明确指定并在本账留痕，不来自本地 claim、超时或 lease。身份不明或状态冲突 → 停止派单，请 Founder 消歧；不得自动 takeover。

## ⚠️ 合并权（2026-07-15 控制面自纠——本次换届最重要的一条）

**控制面此前把 Founder 2026-07-14 的口头总授权（「我给你权利 merge」）读成覆盖一切 —— 错。**

`AGENTS.md` §2 的 **Founder-only** 明列：governance/merge-policy、product identity/brand、blueprint、**irreversible architecture**、**schema/migration**、**money/tenant paths**、security credentials、production/deploy、external publish/spend/delete、异常大或有争议的 PR、**tier 不确定的任何东西**。§5 定义 sacred spend path 含 credit ledger reserve/settle/refund。

**Delegated ordinary merge** 另有四条硬前置：未自撰该 diff + 当前 head CI 全绿 + **independent cross-family review 无未决 P0/P1** + 不含任何 founder-only 类别 + 结果对 main 复核。

**现行法：口头总授权不推翻成文 sacred 类别保留（宪法 1：安全 > 效率）。钱路 / schema / 治理 一律呈 Founder 亲点。**
此错误由 codex SOL 跨族复审在控制面**即将合并 PR #315（钱路 diff）之前**逮到。

## VERIFIED（2026-07-15 重验）

- `origin/main = f2e08a37`（#313 squash）。路线乙创作批2 四工位（F-P/G-P/H-P/E-P）全落 main；#280/#282/#307/#312/#313/#305/#308 均已合并。
- 外部 `CLAIMS.json`：**generation 4**；`claim-wo-otto-phase1-r003` = 唯一 **ACTIVE**（scoped，base_sha `725773ba`）。r001/r002 与 E-P claim 均 SUPERSEDED。
- **哈内斯新判例（2026-07-15 立）**：checker 的 `startup`/`prewrite` 硬要求 `HEAD == base_sha` 且 changed=0（`scripts/execution-harness-check.mjs:717,742`）→ **在已交付的 commit 之上做修复轮，必须签发新 revision**（把 base 钉到交付 head）。#315 修复轮首派即被 lane 正确 fail-closed，据此签发 r003。
- **Registry generation 串行约束**：签发新 claim 会 bump generation → 令在飞 lane（pin 了旧 generation）fail-closed。**在飞期间零新签发**；批量签发只在交付边界做。
- 本 control plane 自换届以来：**零 merge、零 deploy、零真实花费、零真实平台写入、零轮询 automation**。

## 在飞（2026-07-15，交接必读）

两个 **detached `codex exec` 进程**（`nohup`，脱离会话——控制面 session 断了它们照跑完并写文件）：

| pid | 干什么 | 结果落点 |
|---|---|---|
| 43512 | **#314 跨族 R2 复验**（验修复是否真修好 + 修复本身有无引入新缺陷）；工地 `.claude/worktrees/rereview-pr314` @ `b15a4ff7` | `<HARNESS>/reviews/pr314-codex-rereview/VERDICT.md` |
| 30549 | **#315 r003 诚实修复轮**（G1-G5 / PH1F-A1~A6）；工地 `.claude/worktrees/wo-otto-phase1` | mailbox `<HARNESS>/mailboxes/WO-OTTO-PHASE1/r003/`（REPORT/STATE/EVIDENCE/ESCALATION + `FINAL-MESSAGE.txt`） |

`<HARNESS>` = `/Users/winnin/Documents/Codex/FIKIRTIVE-HARNESS/fikirtive-launch-v1`

**接手者先做**：`ps -p 43512 -p 30549` 看死活 → 死了就读结果文件 → 都在跑就架哨兵等。

## 待 Founder 的四件（控制面不能代做）

| 件 | 是什么 | 为何是 Founder |
|---|---|---|
| **PR #314** | B8 一期 schema（5 表 + 2 加性外键 + 2 枚举值 + tenant-guard）@ `b15a4ff7` | schema/migration = founder-only |
| **PR #315** | Otto Phase 1 composition seam @ `725773ba`（r003 修复轮在改） | **钱路**（meter.ts `withLlmBudget` reserve/settle/refund）= founder-only |
| **#317** | 跨对象外键是否升级为「共租户复合 FK」房规 | 架构级房规，影响所有既有 FK |
| **#318** | `NOT VALID`+`VALIDATE` 同文件=同事务 → **锁安全收益为零**（影响 org_tenant 6 条热表 FK） | 房规修订 |

另有三件 Founder **亲手**文书：#299（Meta 验证，审核中）· #301（Gupshup 开户 + API key）· #309（EasyStore Partner 注册）。
（#316 = W-3 裁决机械同步，docs-only，随 #314 一并呈。）

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

## 控制面自己欠的

- **CLI fence 接线** root `package.json` + `.github/workflows/ci.yml`（lane write_set 外 = 控制面域）。**接线前任何文档不得把该 fence 写成保障。**
- GitHub CI 仍 skip（Founder 2026-07-14 裁：public 前不开；`protect-main` 的 required_status_checks 已移除，其余规则在）。**合并前必须本地全量复现四关并贴进 PR**（`docs/runbooks/local-ci.md`）。重开票 #303（挂 B13）。

## Product truth

- 卖法：**「雇一个会用全套工具的 AI 营销员工」**；第一期钉死三环（做内容 / 发出去 / 唤回老客）；收钱走已 LIVE 的 credits 轨；三环外全城诚实 Coming soon。
- **城照建钱先收**：建城图管宽度（13 板块并行盖），卖图管深度（三环到齐即对顾客一号收钱，不等全城）。
- 目标可收费体验：目标 → 完整 plan + 绑定报价（**一个 request = 一次批准**的授权信封）→ `Watch Otto work`（live reflection，B9 契约 6）→ **「停」按钮 + 人插手即停**（不建暂停/存档/接管/续跑重机器）→ 输出与统一费用/结果凭证。
- 生产代码没有 Canva.com integration；「Canvas」指 FIKIRTIVE 自己的创作面，不得对外误称 Canva。
- B11/B12/B13 未完成（Factory 正式面、active browser E2E、部署 SHA provenance、restore/rollback/alerting、public legal/support 仍是 launch blockers）。

## Persistent evidence

- **外部 checkpoint（真源，比本账更细）**：`<HARNESS>/CONTROL-PLANE.md`
- 跨族复审与裁决：`<HARNESS>/reviews/`（`ADJUDICATION-2026-07-15-*`、`pr314-codex-crossfamily/`、`pr315-codex-crossfamily/`、`pr314-codex-rereview/`）
- 施工单控制文件：`<HARNESS>/control/WO-OTTO-PHASE1/r003/`（4 件 + DISPATCH-PROMPT）
- 信箱：`<HARNESS>/mailboxes/`；日志：`<HARNESS>/logs/`；claim registry：`<HARNESS>/CLAIMS.json`
- Automation 时区事故：`<HARNESS>/incidents/2026-07-14-AUTOMATION-TIMEZONE.md`（**不得重建轮询 watcher**）

恢复时先完整读 global skill、`AGENTS.md`、`docs/BLUEPRINT.md`、`.claude/CLAUDE.md`、review playbook、overlay 与本账，再从 repo/GitHub/CI/worktree/**进程**/部署重验可变事实。不得用 transcript 或历史状态自动补权限。

## Recovery next step

1. 重验：`origin/main`、`CLAIMS.json`（应为 gen 4 / r003 ACTIVE）、**两个在飞 pid（43512 / 30549）**、PR #314/#315 current heads、worktree 清单、外部 checkpoint。
2. #314：等跨族 R2 复验裁决 → 清则**呈 Founder 合并**（不可代合）。
3. #315：等 r003 修复轮交付 → 独立四关 + harness `--phase delivery` + 跨族复验 → 清则**呈 Founder 合并**（钱路，不可代合）。
4. #315 合并后：**一次 generation bump 批量签发**（retire r003 + W1/W2/W3 + #311 加固批次）——在飞期间零新签发。
5. 控制面补 CLI fence 接线 PR。
6. 完整 launch-readiness/E2E 只在 exact release candidate 上执行，不提前宣称。
