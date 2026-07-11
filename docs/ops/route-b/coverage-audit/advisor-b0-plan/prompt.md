You are a read-only advisor. Answer directly in one memo; do not invoke skills, spawn agents, or delegate.

# 咨询主题：路线乙 B0（发布契约与覆盖矩阵）的执行分解方案 —— 首轮盲审

## 1. 决策背景与 founder 原话

Founder 于 2026-07-12 以如下启动令开启新总指挥 session（epoch `claude-20260712-03` 已按状态账移交机制认领）：

> /orchestration 接管路线乙直建程序。先读 docs/ops/ROUTE-B-HANDOFF-README.md 全文与其指向的执行合同，认领控制面 epoch（状态账「epoch 移交待新 session 首轮认领」），然后从 B0（发布契约与覆盖矩阵）开始执行 ROUTE-B-MASTER-PLAN。判断过顾问、施工派舰队、每块出板块报告。

本次咨询对象：**B0 这一块怎么分解执行**（工作产物形态、舰队设计、账本落位）。这是开 loop 的先决条件块，做错会污染后面全部 12+ 块的验收边界。

## 2. 适用法律（均在 repo，逐字有效）

- `docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md` §一（B0 定义，Sol 阻断 #1）：
  - 「新总指挥的第一个工单不是施工，是**把『全城』冻结成有限清单**：逐条建立 `功能ID → 批准来源(蓝图/判决/舱单) → 所属块 → 人工入口 → Otto skill → 权限/花费闸 → 测试 → 报告 → 六级状态`；
  - 来源穷举：蓝图第六章全部区、MASTERPLAN 全章、A′ 舱单 65 页、MISSING-CONTINENTS 前五、宪法 11 条、九缝；每项要么入块、要么进宪章『不在本程』；
  - 六级状态：`spec-ready → code-complete → sandbox-verified → review-submitted → live-verified → release-certified`；『建毕』一词废除。」
- 同文件 §二 范围宪章已由 founder「照签」冻结（真点亮：创作/资产/排期发布/分析/量测/WhatsApp 收件箱/回执/唤回/缺失大陆前五/Campaign 一期/CRM 最小版/生命周期最小版/账务透明；壳+Coming soon：订阅层/协作审批/email/生命周期其余；不在本程：TikTok/Lazada/Shopee/Agency/市政厅v2/手机App）。
- 同文件 §三 范围表 v3：块 = B0–B13 + 两横切（并入 B10/B13 验收维度）。
- 交接包十条硬约束（`docs/ops/ROUTE-B-HANDOFF-README.md`）：B0 先行（范围没冻成有限清单前一行产品代码不写）；六级状态制；判断永不下放 worker；每块分解过顾问；总指挥是办公室不是会话——五本账（范围矩阵/依赖状态/决策日志/风险待裁/证据清单）全在 repo。
- MASTERPLAN v1.0 §五：「五本账全在 repo」「第 1 块末尾做一次故意换届演练」；§十一：「`.orchestration/` 全部入库走 PR（M5 最高优先发现）」。
- 本机 merge 安全闸：任何 merge 需 founder 当轮明示；B0 产物走 PR。

## 3. 原始证据（路径与规模，均已亲核）

- main = `2fb2b935`（#238 状态账终局 + #239 交接包均已合入）；working tree 干净；无 open PR。
- 来源文件规模：`docs/BLUEPRINT.md` 227 行（宪法 11 条 + 第六章对标地图 11 区 + 九缝）；`docs/MASTERPLAN.md` 299 行（P0/P0.5/P0.75-84债/P1 工厂/P1.5-P4/点亮章 L0-L4/A1-A5/7-1~7-14 判决）；`docs/ops/APRIME-MANIFEST-2026-07-11.md` 127 行（272 文件分类、PR-0+8 切片分组、18 个 mock-变真风险点含 6 个💰）；`docs/research/MISSING-CONTINENTS-2026-07-10.md` 166 行（前五大陆各带「商家第一性工作清单」5-7 条）；`docs/review/ROUTE-B-EVIDENCE-2026-07-11/` 9 份分片共 570 行、**143 行能力真相矩阵**（列 schema：id/zone/capability/promise_source/stage_main/stage_prod/gate/evidence/provenance/gaps，见 `matrix-schema.md`）+ `MATRIX-V0.md` 综合。
- A′ 的 65 页注册表真源在设计基准分支 `origin/claude/northstar-immersive@54c1de0b` 的 `apps/web/components/northstar/_registry.ts`（可 `git show` 只读取用，不 checkout）。
- repo 尚无 `.orchestration/` 目录；五本账目前无落位。
- MATRIX-V0 已知六级状态外的现实：现有代码多为 `integrated`（main 全链成立）但从未过路线乙验收；`stage_prod` 系统性 Unknown（release provenance 断裂）。
- 顾问拓扑：selected SOL ultra（你），fallback Fable max。worker lanes：Claude 原生 subagents（Opus/Sonnet/Haiku）+ codex exec。B0 全程 $0（无真实供应商花费）。

## 4. 摆上台面的选项（利弊如实，无控制面预立场）

**主结构三选一：**

- **A. 分源抽取舰队（5 只读 worker 并行）+ 控制面合成 + 顾问复审**
  - W1 蓝图（宪法11条→横切验收行；第六章11区→能力承诺）；W2 MASTERPLAN 全章；W3 A′ 舱单+65页注册表；W4 缺失大陆前五+相关判决；W5 把 143 行分片机械归一到 B0 列 schema。每 worker 输出统一结构化行（capability/promise_source/proposed_block/notes）。控制面去重、编功能ID、按宪章分块、六级状态初判；产物过你复审。
  - 利：来源覆盖有独立责任人，可并行（只读），每源可单独对账「抽了多少条」。弊：五份输出的去重/对齐成本在控制面；worker 可能各自发明粒度（行的颗粒不一致）。
- **B. 控制面直接合成（不派抽取 worker）+ 顾问复审**
  - 控制面已完整读过全部来源（本 session 上下文里），直接写矩阵。
  - 利：粒度一致、零协调成本、最快。弊：单脑穷举有盲区风险（B0 的本义就是防漏）；违背「施工派舰队」的 founder 口令倾向；控制面上下文有限，143 行分片细节可能回忆失真。
- **C. 单一大 worker 建全矩阵 + 控制面核对 + 顾问复审**
  - 利：粒度一致。弊：单 worker 上下文装不下全部来源细节；穷举质量依赖单点。

**子决策（无论主结构选哪个都要定）：**

1. **五本账落位**：(a) `docs/ops/route-b/` 新目录（矩阵/状态板/决策日志/风险待裁/证据清单各一文件）；(b) repo 根 `.orchestration/`；(c) 矩阵进 `docs/ops/`平级散文件。考量：founder 文件系统式易管理宪法（可读文件+简单开关）、M5 发现的本义（过程账本必须入库）。
2. **矩阵形态**：(a) 单一大 markdown 表（143+ 行会很宽）；(b) 按块分节的 markdown（一块一节，块内表格）；(c) CSV/TSV + markdown 索引（机器可校验强，founder 可读弱）。B0 验收要求「每行 9 列齐全」可机器查。
3. **六级状态的第 0 级**：六级从 spec-ready 起，但矩阵里大量条目还没有 spec（如缺失大陆前五）。要不要定义显式 level-0（如 `listed`/`未起工`），还是允许状态列为空？
4. **84 条对等债的表达**：逐条进矩阵（+84 行），还是作为「每块验收维度」（块行的 Otto skill 列 + 块级 parity 清零验收）？硬约束 3 说「对等债随块清零」。
5. **既有 integrated 代码的初始状态映射**：MATRIX-V0 的 `integrated` 映射到六级里哪级？直接给 `code-complete`（有旧测试为证）还是全部压回 `spec-ready 以下`（路线乙从未验收过）？这影响 founder 看到的「已完成度」诚实性。

## 5. 请求

请独立作答：
1. 主结构 A/B/C 的推荐与理由（或提出更优的第四方案）；
2. 五个子决策各自的推荐；
3. 你看到的隐藏风险（尤其：B0 冻结错误对后续 12 块的污染路径）；
4. 缺什么证据会让这个决定更稳；
5. 置信度（%）。
