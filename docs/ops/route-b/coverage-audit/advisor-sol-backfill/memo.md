# 跨族补审 memo

结论先行：B0 不必整体翻案，但存在需要定向修宪的真实漏项和两处“机器保证名不副实”；B2/B9 v0.2 均有阻断级缺陷，当前不可冻结；B8 体量包不能原样交 founder；D-016 的“沉默即同意”解释与上位法冲突。

两份 spec 和五份设计目前仍在各 PR 分支、未进入账本分支；以下结论按对应 Git head 复核。

## 1. B0 冻结产物

### P0——下个窗口必须修

1. **二阶覆盖已经造成实际漏项，不能再只当披露。**

[B0 报告](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/route-b/reports/B0-REPORT.md:65)承认 GRILL 判决全集与 harmony 只做二阶覆盖。对照正式[判决记录](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/research/GRILL-VERDICTS-2026-07-03.md:132)，至少以下已批能力没有可审计的独立 HIT/OUT：多 clip 叙事长片、AI 配乐/音效、多机位出图、视频换脸/换角、营业时间自动回复原语、消息互动信号触发源。实景/OOH、卡点模板、字段变更留痕至多被宽泛地藏进 Wave/ActionEvent 行，违反“一行一条能力承诺”的冻结粒度。

处理：不要重开全表；做一个定向修宪包，逐项裁为“新增行 / 明示并入哪一冻结行并证明同义 / OUT”。不能继续用“应该已被二阶吸收”代替处置。

2. **冻结锁只锁 ID 存在，没锁 founder 实际签的四件事。**

当前[校验器](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/scripts/route-b-matrix-check.mjs:112)不锁 `ID→块`、能力行义或 OUT 处置；一个 ID 可以被移块、改义、OUT 改判而继续全绿。coverage 又只校验 `MISSING`，不校验 HIT、源项总数或审计文件删项。

parity 也不是合同所称的双向一一对应：它只确认 manifest key 出现在债表一次，矩阵的 `missing(debt-33,34,…)` 实际只解析第一个编号；删掉矩阵里的债引用也可能继续全绿。

处理：冻结快照至少记录 `ID→block→semantic identity/OUT kind`；任何语义漂移必须要求决策日志授权。债表、manifest、矩阵三者做真正 bijection；四源计数与内容摘要也要钉死。

3. **“7 条💰”不能当全量花费/价值动作保证。**

后续设计已经证明 B0-68/69 等会调用现有生成钱路，微站发布是外部可见写，referral 发奖会创造商家价值；这些不是七个 emoji 行，却同样需要 `cost/effect/reach`、审批、幂等与审计。尤其“商家价值、不走 CreditLedger”不等于“无钱风险”。

处理：把闸从“行上有没有 💰 emoji”升级为“每个动作的三字段分类”；商家 voucher/积分/奖励必须按 external financial effect 处理。

### P1——随下一块顺手修

- 状态失效规则只覆盖 `release-certified`。`sandbox-verified`、`live-verified` 或 spec 本身改变后也必须回落到适当级，否则旧证据继续挂在新实现上。
- D-015 所称同 PR 连迁没有历史载体。#242/#243 的分支 diff 直接 `listed→code-complete`，#246 直接到 `spec-ready`，同时仍留 `TBD-B10`；这既不可证明“未跳级”，也违反 [B0 合同](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/route-b/B0-CONTRACT.md:12)的 spec-ready 硬化要求。合并前应修正。
- `migration-fidelity.json` 只是 PASS 断言，不是可重跑证据；建议保留逐行摘要或正式脚本。

### P2——勘误留痕即可

- “九列定义”实际列出十个冻结字段，再加存量列。
- I1-15 的能力注释说 free-plan 陈述已失真，但闸列仍原样重复旧陈述。
- B0-82 的“128 errors”、B0-83 的“8 读面”已被 D-017 改判但矩阵未勘误。
- AF1-04 指向不存在的 `docs/review/GRILL-VERDICTS…`，实际文件在 `docs/research/`。

## 2. B2/B9 spec v0.2 可冻性

**裁定：两份均 NO-GO，不得迁 `spec-ready`。**

### B2 阻断项

1. 文件自身已写明第二、三波需求单尚未吸收、需 v0.3，另留三项开放问题；形式上就不是冻结候选。

2. 事件契约与已经生效的 L0 schema 冲突。现有 `AttributionEvent` 有 `evidence/evidenceRung/outcomeDelta/utmSnapshot/idempotencyKey` 等关键语义；v0.2 改成嵌套 `source/subject/payload`，并把幂等改为含 `occurredAt` 粒度的组合。后者既不能稳定去重 webhook 重试，也可能吞掉同桶内的合法多事件。

3. “一切用户可感渠道动作都写 AttributionEvent”混淆了五种不同账：

| 真相面 | 应有载体 |
|---|---|
| Credits 收支 | `CreditLedger` |
| 安全/操作审计 | `ActionEvent` |
| observed/attributed 量测 | `AttributionEvent` |
| 外部经营事实 | `BusinessEvent/Receipt` |
| UI 秒级刷新 | 独立 live-event envelope |

Campaign 的 `credits_spent`、Marketplace 的操作日志、UI live reflection 都不应被塞进归因流水。

4. consent 契约自相矛盾：一处把 `opted_in/opted_out/suppressed` 当同一状态，另一处又落成 Contact 上的 `marketingConsent + doNotDisturb`。法律同意、顾客退订、商家 DND、频控抑制是四个不同轴。冻结前必须定义按 channel/purpose 的追加式证据记录，以及当前资格如何确定性派生。

5. `(ownerId, channel, externalId)` 对 FB/IG 的 page/app-scoped ID 不够，可能把同租户不同连接下的人错并。需要 issuer/connection namespace、规范化版本和可逆 merge 契约。

6. `utmBase` 单字符串会与既有 `TrackedLink.utmJson` 形成双真源。应冻结结构化 UTM schema，而不是请 founder 批准一个存储捷径。

### B9 阻断项

- domain 闭集仍明确等待二、三波；而且新八域与已批 P0.5 spec 的 `creation/brand/meta/research` 六域不一致，未给迁移表。单一 `domain` 也装不下 research 这类跨域依赖。
- `selection.kind` 仍含 `…`，不是真正可冻结的 union；`view:string` 与客户端 `zone` 也未规定服务端权威。
- context bridge 的 ownerId 复核仍被留作开放问题，直接触碰租户铁幕。必须由 server resolve 所有引用、限制数量、丢弃越权/过期对象，不能持久化客户端裸 ID 作为可信上下文。
- 新稿丢了旧引擎 spec 的关键逃生条款：approve/worker-resume 全量工具、零命中全量回退、RunState 恢复时工具集合兼容。需冻结 toolset snapshot/version 或等效规则。
- live reflection 只有“秒级”目标，没有接口：缺事件 envelope、owner auth、resource revision、排序/去重、断线 replay cursor、actor/correlation、敏感字段限制与短轮询上限。
- 对标锚仍有“待 worker 实测基线的 50%”这种 TBD 阈值，证据层也未完成。

两份共享契约还都属于 D-016 carve-out，且是 founder-only 的架构/schema 类别；SOL 复审通过也不能替代 founder 明示过目。

## 3. B8 体量过目包

**不应原样递交。最严重的是体量数字失真。**

[B8 包](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/route-b/reports/B8-DEPTH-REVIEW-PACK.md:34)称五设计合计只有 Campaign、MicrositePage 和 TrendSnapshot 三个新对象；设计原文实际至少是：

- Campaign + TrendSnapshot：2
- CRM Contact/ContactIdentity/Segment：3
- 口碑 ReviewRequest/ReviewItem/Testimonial/Referral/LoyaltyMember：5
- MicrositePage：1

即至少 **11 个新业务对象**；若 GBP 连接具象成新模型则至少 12 个，另有 ScheduledPost/Generation 外键迁移。这个数字必须先改，否则 founder 会在错误体量上圈档。

另有四类漏列：

- 每档会让哪些冻结行可认证、哪些只能继续 `listed`；
- 平台 OAuth/App Review、PII 审查、B5/B6/B7 前置和外部方差；
- 新表、页面、skills、actions、queues、connectors 与长期运营成本；
- 五份原文共数十个开放问题，过目包只露出三个。

尤其“A=只留缝”不是一种完成深度。B0-70、B0-72、B0-76 若只留缝，不能宣称能力成立；要么继续 listed，要么修宪出程。

我的深度意见：

| 工位 | 原推荐 | 跨族意见 |
|---|---|---|
| Campaign | B | **有条件同意 B**；它才基本覆盖 B0-51~58。但 batch approval 必须绑定 pack hash、逐项状态与稳定幂等键，并过 money-safety-review。 |
| CRM | A | **同意 A**；但在 B5 真入信、B6 回执及 identity/consent 契约完成前，不能宣传为 respond.io $79 档平齐。 |
| 口碑 | A 混合档 | **不同意用一个 A 概括**。评价监控至少需两个平台或承认 B0-64 未完成；B0-65 至少要轻量凭证分享。Referral 可最薄，忠诚只读。 |
| Marketplace | B/A/B/A/A | B0-68=B、69=A、71=B 可；**B0-70 与 72 要么做 B-lite，要么明确保持 listed/修宪出程**，不能以“只留缝”认证。 |
| 第一米 | B/B/A/B/A | 前四项同意；**B0-76 的 A 只是读现有报表，不是“假设→跑→读数”**。要认证应做最薄确定性分流 B-lite；零用户阶段也可以诚实显示“样本不足”。 |

此外，增长实验并不必然“推翻 L0 禁 incremental”：L0 只是禁止无实验设计时冒称增量；未来有 assignment/holdout 的实验对象后，可以在独立证据层合法计算增量。

## 4. 治理：D-016 / D-017

### D-016

**当前解释不成立。**

上位法明确写着“spec → founder 过目”，见 [MASTERPLAN](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/MASTERPLAN.md:278)。D-016 引用的“增量投递、只读不需批”实际只适用于板块报告，不是 spec，见[路线乙总计划](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md:77)。

“可以直接开始”授权的是启动第一批，不是永久放弃后续 spec 过目；沉默也不是 informed consent。可采用的合法版本是：

> spec 可增量只读投递；冻结时必须取得 founder 明示 acknowledgment。普通项可集中到预排窗口确认，但不以未异议视为批准。

B2/B9 又同时命中 D-016 自己的“共享契约/tenant/安全” carve-out，所以即使 D-016 被明确批准，也不适用于这两份。

### D-017 与第一批实况

- `FABLE_CODE_OK=1` 是模型家族自豁免、可伪造、无范围和期限，不应入法。需要的是 task/worktree/path-scoped 授权，不是模型名开关。
- `--no-verify` 不能成为 docs-only 常规做法；缺 node_modules 应运行等价检查或依赖 CI，不能把 emergency bypass 正常化。
- `push HEAD:<被占分支>` 已造成 CRM/Marketplace 本地命名分支仍指 main、远端却指 worker commit 的 split-brain。应每 worktree 使用唯一分支，不向被另一 worktree 占用的分支推送。
- #242 的 auth scanner只扫描顶层 `.ts` 且要求文件首字符严格为双引号 `"use server"`；单引号、BOM/注释、子目录、TSX 均可漏过。#243 仍遗漏 `export const GET = async` API 形状，两者都没有提交永久红例测试，不宜标 `code-complete`。
- `DEPENDENCY-STATUS.md` 仍把 B10/B9/B2/B8 标为“未开”，`EVIDENCE-LEDGER.md` 没有第一批证据，风险账也未收入上述共享契约阻断。ledger-sync 只同步了决策日志，不是“五本账已同步”。

## 5. 置信度与三条底线

整体置信度：**93%**。其中 B2/B9 不可冻 98%，D-016 上位法冲突 98%，B8 数量误导 97%，B0 漏项范围 88%——后者仍需 founder 对“宽泛 Wave 行是否可吸收窄能力”作最终法律解释。

最不可让步的三条：

1. **B2/B9 在事件账分层、consent/identity、上下文租户校验、RunState 工具兼容和 live-event 接口闭合前不得冻结。**
2. **B8 包必须改正“3 个新对象”的错误，并把 A=只留缝对应的未认证行/修宪成本明示给 founder。**
3. **spec 冻结恢复 founder 明示过目；同时取消模型名豁免与常规 `--no-verify`，并让冻结映射、coverage、parity、状态迁移真正受机器约束。**