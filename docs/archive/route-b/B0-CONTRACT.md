# B0 · 发布契约（founder 签署件）

> 2026-07-12。epoch `claude-20260712-03`。基线 main@`2fb2b935`。
> **Founder 合并原 B0 PR #240 = 签署以下四件事的冻结**：①行集（覆盖矩阵全部行）②功能ID ③归块 ④「不在本程」清单。此后修改只经对应 GitHub Founder Resolution 与适用的 Blueprint/计划修订流程。这是 2026-07-12 的历史签署记录，不授予当前或后续 PR 任何 merge 权限。
> **勘误豁免**：不改行义的文字勘误（错别字/断链/格式）须在对应 GitHub task/PR 留下 exact diff 与复核证据，不走产品修订；改行义（能力范围/归块/出程/状态语义）必须取得 Founder Resolution，并在需要时走 Blueprint/计划修订。
> 这一页是合同正文；矩阵（`matrix/`）是附件。签的是合同，附的是附件。
> **2026-07-16 Founder plan amendment（D-038，#334 + Blueprint v2.12）**：216 个既有能力 ID、归块与六级状态全部保留；商业第一期不再由某个单块或 B0-51～61 的「11 行」代称，而按 `../ROUTE-B-MASTER-PLAN-2026-07-12.md`「七·甲」把既有行组合为内容、发布、完整 Customer Engagement CRM 三支柱。D-038 修订的能力单元格须在决策入账后用既有 `--freeze` 流程更新语义 hash；冻结锁机制不变，零新增/删除 ID，且不预支任何行的认证级别。
> **当前 authority 注**：2026-07-12 epoch/总指挥/合并窗口记述只保留历史 provenance。当前执行和 merge 权限取自 `AGENTS.md`、FIKIRTIVE orchestration overlay 与当前 GitHub 票；#331 bounded sanitation coordinator 不是 global control plane。

## 一、六级状态制 + 第 0 级（「建毕」一词废除）

| 级 | 名 | 语义 | 迁移权 | 升级所需证据 |
|---|---|---|---|---|
| 0 | `listed` | 已入册，本程尚无冻结 spec | B0 合同即赋 | 矩阵行存在 |
| 1 | `spec-ready` | 所属块 spec 冻结，**含对标锚清单**（对标对象+版本+关键旅程+通过阈值——§六 无锚不开工） | 对应 GitHub task/PR 按当前 authority 完成审批与合并 | spec 链接 + exact PR/SHA + 锚清单 |
| 2 | `code-complete` | 本程 PR 合入 main，该行功能全链在 main 成立 | 对应 GitHub task/PR 的 current-head CI、复审、合并与 main 验证 | PR# + SHA + 测试名 |
| 3 | `sandbox-verified` | 沙箱/staging 真浏览器旅程走通，**双执行器都走**（人工路径 + Otto 话术） | 对应 GitHub task 核验 exact-head 证据；无 standing controller | E2E 证据链接（录像/截图）+ 双模走查记录 |
| 4 | `review-submitted` | 外部受审材料已递（仅外部位行；内部行标 `n/a-internal` 直接 3→5） | 对应 GitHub task + Founder 的外部提交权限 | 递交回执 |
| 5 | `live-verified` | 生产可达可用（前置：发布溯源修复，见 §五-2） | 当前 GitHub authority + Founder-only 生产权限 | prod SHA 溯源 + 烟测证据 |
| 6 | `release-certified` | founder 终验通过所属块 | **仅 founder** | 终验记录（15 步剧本） |

- **存量代码不预支任何级**：main 上已 integrated 的代码一律从 `listed` 起证；「main 上确实能跑」的信息保留在独立「存量现状」列（闭集：`integrated / implemented / ui-shell / schema / absent / partial / unknown / na`）。看板读法：「已认证 X / 存量 integrated N」——这个差值就是路线乙的定义。
- 状态迁移只增不跳（4 级例外见表内）；迁移或降级须在对应 GitHub task/PR 留下 exact evidence 与适用批准。
- 定稿后 delta：`release-certified` 行被触碰即回落 `code-complete` 重认证（交付标准 ⑭）。

## 二、行的粒度与 ID 规则

- **一行 = 一条对 founder 的能力承诺**，拥有自己的人工入口、Otto skill 或权限/花费闸之一；纯叙事/背景不成行。
- ID 规则：**只增、不改、不复用**；ID 不编码块号（块界可经批准重划，ID 不跟着断）。存量行沿用初次签署 ID（E1-xx/E2-xx/E3-xx/E4-xx/E5-xx/AF1-xx/I1-xx）；B0 裁决新增行用 `B0-xx`；后续语义增补必须有 current GitHub Founder Resolution。
- 占位值必须是显式 `TBD-B<n>`（表示「归属块 spec-ready 时硬化」）；空白 = 校验违规。
- 例外两类留痕行：`OUT`（不在本程/被改判，含理由与出处）与 `EVIDENCE`（商业证据行，非能力行，不参与六级认证）。

## 三、十列定义

`功能ID | 能力（人话） | 批准来源（文件:行/判决号） | 所属块 | 人工入口 | Otto skill | 权限/花费闸 | 测试 | 报告 | 六级状态`（+ 独立「存量现状」列）。
- **人工入口 / Otto skill 双列 = 宪法 7 双执行器**，每功能出生即双执行器；Otto 列的债值 `missing(debt-nn)` 链接 `parity-debt.md`，该块清零才可验收（禁新增债的棘轮闸继续有效）。
- **权限/花费闸列是程序级法律**：18 个 mock-变真风险点全部有归属行；**current matrix 实数 7 条💰行**（2026-07-12 历史 supply snapshot 曾按文件标 6 个💰；该静态 dossier 已退役，不能用于当前授权），💰行闸列一律非 TBD（机器强制）；任何💰行变真必过 `money-safety-review`。

## 四、覆盖保证（双向校验，机器强制）

- 初次签署时曾对蓝图、MASTERPLAN、A′ 车道、沉浸城和缺失大陆做逐项覆盖审计；该 dated audit 由 Git 历史保存，不再作为 active bootstrap 或 current truth。当前范围只由矩阵行、`OUT.md`、`EVIDENCE.md` 与上级 authority 决定。
- `scripts/route-b-matrix-check.mjs` 校验：ID 唯一；九列非空（`TBD-Bn` 合法、空白违规）；块/状态/存量 ∈ 闭集；84 债双向闭合；💰行闸非 TBD；冻结行的块归属、能力语义和留痕处置不漂移。
- 「不在本程」不是难题回收站：每条 OUT 附 founder 可见的理由并计入合同计数。

## 五、程序级具名风险（B0 即立行/立账，防 12 块各自撞墙）

1. **沉浸城页面对账**：旧签署基线曾实测 65 个 `page.tsx`；B1 验收必须从当时 current head 重新枚举 `apps/web/app/northstar-immersive/**/page.tsx`，不得复用 dated 文件清单或固定 SHA 代替 live code。
2. **发布溯源断裂**（初次签署发现）：生产部署元数据无 commit SHA → 全矩阵 `live-verified` 不可判。已立具名行（B13），修复先于任何行的 5 级迁移。
3. **合并纪律**：Founder-only 类别须 Founder 合并；普通、可逆 PR 只有在 `AGENTS.md` 的 delegated ordinary merge 条件全部成立时才可由非作者合并，且不设 auto-merge / merge watcher。本 D-038 计划修订是 Founder-only；事实性、可逆步骤不因 Founder 合并窗口停排。

## 六、计数总账（签署对象）

**能力行 216（B0 签署 204 + 修宪包#1 新增 12——D-019）** = 存量 111（沿用初次签署 ID）+ 新增 105（`B0-01`~`B0-105`，94-105 为修宪包#1）。**留痕 27（+CC-O12）** = 不在本程/改判/横切 22 + 商业证据行 5。

| 块 | 行数 | 块 | 行数 |
|---|---|---|---|
| B1 壳车道 | 8 | B7 Customer Engagement Lifecycle/Workflows | 9 |
| B2 量测+分析 | 11 | B8 Campaign+CRM 底座+缺失大陆 | 26 |
| B3 创作+资产 | 46 | B9 引擎横切 | 21 |
| B4 发布（Reminder+Direct）+Meta 通电族 | 20 | B10 安全带+数据信任 | 30 |
| B5 Customer Engagement Inbox + WhatsApp 首渠道 | 11 | B12 收钱+钱路 | 22 |
| B6 统一回执+可选经营事实 connectors | 2 | B13 发射台+运营 | 10 |

（修宪包 #1 后实数——D-019）

**初次签署的每源覆盖统计**（historical evidence；完整逐项审计由 Git 历史保存，不是 current authority）：

| 源 | 源项 | 命中既有行 | MISSING→已裁决 | 建议出程 | 横切条款 |
|---|---|---|---|---|---|
| 蓝图（宪法 11 条+九缝+第六章） | 70 | 18 | 19 | 10 | 23 |
| MASTERPLAN 全章（含点亮章/判决 7-x） | 60 | 18 | 37 | 3 | 2 |
| 2026-07-12 历史 supply/prototype snapshot + 沉浸城 65 页 + 注册表（仅 provenance；原文件在 Git 历史） | 98 | 29 | 50 | 2 | 17 |
| 缺失大陆前五+宪章新点亮项 | 47 | 4 | 39 | 3 | 1 |

**相对 V0 的 historical delta**：121 能力行 → 111 入块 + 10 处置（E1-20 判决撤销出程、E4-15 宪章出程、AF1-01 防呆闸解除留痕、AF1-02/03/08/09/10 转商业证据行、I1-09 并入 E3-19、E5-13 拆分 GM-02/03/04/05）。原逐行 delta 与 PR provenance 由 Git/GitHub 历史保存；执行时以 current matrix 和 live PR evidence 为准。

**84 对等债**：40 条挂既有行、44 条挂新行，12 个行族承债；逐条对照=`parity-debt.md`；每块验收=该块债清零（机器校验强制每条恰好出现一次）。

**18 个 mock-变真风险点**：18/18 有归属行；**7 条💰行**（矩阵行口径）闸列全部非 TBD——此断言已写进校验脚本（💰行闸非 TBD = 机器强制），另有冻结 ID 锁（删行必红）、TBD 格式与块号一致性、撕裂单元格检测（校验可复跑：`node scripts/route-b-matrix-check.mjs`）。初次迁移保真证明由 Git 历史保存；当前机器闸只验证 active matrix。

## 七、持久状态入口

| 事实 | 当前入口 |
|---|---|
| 范围与语义锁 | `matrix/0x-Bx.md` 块文件 + `matrix/frozen-ids.json` / checker；`matrix/INDEX.md` 只导航 |
| 执行顺序与验收 | `../ROUTE-B-MASTER-PLAN-2026-07-12.md`；若与 Blueprint 冲突，停手交 Founder |
| 依赖与待裁 | 当前 GitHub issue 的 native dependencies、开放状态与 Founder Resolution；未实时查询一律 `Unknown` |
| 变更与证据 | 对应 GitHub issue / PR 的 exact-head diff、review、checks 和 merge provenance |

旧 Route-B 手工状态账、reports、coverage audit 与 evidence dossier 已退役；Git 历史保留其 provenance，但它们不再承载当前状态、权限或验收事实。
