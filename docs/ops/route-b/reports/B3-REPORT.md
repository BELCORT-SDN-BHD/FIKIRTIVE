# B3 板块报告 · 创作 L-C + 资产

> 按 MASTERPLAN §七 十四节标准编制（= 终验讲解稿同构）。**本文件为骨架**：B3 处冻结候选阶段（spec v0.2，代码未施工），各节为 **owner + 证据槽位**，随批次施工增量投递（只读不需批，终验=确认非发现）。不适用/未施工的节**如实标注**而非省略（宪法 3 状态诚实）。
> 人话对照：「创作 L-C」= 把创作车间七页从"漂亮的假"接上真后台；「资产」= 品牌记忆/资产库/模板。本报告是这块建完后给 founder 的**逐条可查交付单**，现在先立骨架、施工时逐格填证。
> **报告状态**：骨架（施工前，随 spec v0.2 同步——BR2 六项闭合）。批次映射见 spec §五（LC-0 / W-B3-A~D 批1b；W-B3-E~H 批2〔v0.2 补 W-B3-H=LCd paid storyboard〕；引擎集成批3；tranche-2 批4；收口批5〔LCg 灰度迁移/legacy 收尾为前置〕）。

## ① 块 ID / PR / 最终 SHA / 认证日期

- **owner**：控制面（收口）。
- **证据槽位**：块 ID = B3 · 创作 L-C + 资产。spec = `docs/superpowers/specs/2026-07-12-b3-block-spec.md`（v0.2 冻结候选，本批交付）+ 主体 L-C `docs/superpowers/specs/2026-07-10-lc-creation-zone-lighting.md`（引用采纳）。施工 PR 列（LC-0 / W-B3-A~H〔v0.2 补 W-B3-H=LCd〕/ LCg 收口片）+ 各 merge SHA + 认证日期 = **待施工填**。epoch `claude-20260712-03`。

## ② 批准范围 + 明示排除 + 映射

- **owner**：控制面。
- **证据槽位**：
  - 范围 = 46 行（主 tranche **38** + tranche-2 处置 **8**〔六新行 B0-94/95/96/97/100/101 + 改档 B0-17/B0-18，v0.2 BR2②(b)〕，后者保持 listed 待 addendum，D-021）。来源映射：蓝图第六章创作/资产区 + MASTERPLAN §三 B3 + A′ 舱单 create/* 七页 + 判决（GRILL/O-04/harmony-03 Wave1-3/判决 7-2/7-3/7-6/7-7）。
  - 明示排除 = Wave2/3 能力（口播/lipsync/TTS、多语配音、Ad Reference 逆向、选角库训练版、coherence/audio-driven）本期诚实 Coming soon（L-C §五.2，9 项；其中 B0-17/18 两行已改档 tranche-2 处置）；定价终案（挂 B12）；Design B 首落（荐否，L-C §七.D1）。
  - 映射 = 缝：记账缝(3)/生成缝(2)/队列缝(6)/设计缝(7)/Otto 技能缝(1)/Parity(9)（L-C 头部）；宪法 3/5/7/11。

## ③ 功能清单（非页面清单）

- **owner**：各工位（LC-0 / W-B3-A~H / LCg 收口片）。
- **证据槽位**：46 能力行的逐条能力名（非页面名）+ 现状六级状态 → 目标状态。存量断言 16 条免重核（spec §二.5）；absent 行（E1-09 stitch/E1-19 A/B 分叉/B0-14/16~26 工厂族）为净新建。**待施工逐行填交付状态**。

## ④ 双执行矩阵

- **owner**：各工位（出生即配双执行器）。
- **证据槽位**：每行**人工入口 + Otto 话术逐条**（含设置/异常/取消/花费确认）。B3 是全城最大 parity 债窝——**47 条对等债**（v0.2 BR2⑤ 改正，`parity-debt.md:81-88` 复核确数：debt-03~26/29~37/39/50/51/60/68/69 + **debt-75~77**〔storyboard〕+ **debt-78~82**〔upload〕）逐条清偿，每片 `lint:parity` 绿。
- **债→工位对照（47 条每条有工位，v0.2）**：

  | 工位 | 债号 | 条数 |
  |---|---|---|
  | W-B3-A（canvas $0） | debt-33,34,35,36,37,60（E1-01） | 6 |
  | W-B3-B（media/asset-viewer/上传渲染/生命周期） | debt-14,15,**78,79,80,81,82**（E1-17 上传链）；debt-19,20,21,22,23（B0-13 render/caption）；debt-25,26（B0-14 编辑面）；debt-16,17,18,24,39（B0-12 生成物生命周期） | 19 |
  | W-B3-C（storyboard $0） | debt-11,12,13,**75,76,77**（E1-08） | 6 |
  | W-B3-D（home/ideas/library/brand/项目实体） | debt-29,30,50（E1-14）；debt-31,32（E1-12）；debt-51（E1-11）；debt-03,04,05,06,07（B0-10）；debt-08,09,10（B0-11） | 14 |
  | W-B3-G（refgen） | debt-68,69（B0-15） | 2 |
  | **合计** | | **47** ✅ |

  **待施工填每行双执行器交付物 + 债清零证据**。

## ⑤ 对标锚

- **owner**：各泳道工位 + founder/审查员（盲评）。
- **证据槽位**：spec §三锚清单（6 泳道锚 C1/C2/F1/F2/S1/M1/A1/A2/H1/I1 + 跨切 X1）三栏评（平齐/超过/未及→链待裁）。10 裁定已落（F2=AdCreative.ai/S1=Grok+Runway 上限/M1=CapCut/A1=Canva Brand Kit/A2=Canva/H1=Canva home）；批量全链时长 = **显式临时阈值（v0.2）：mock 级 20 格 ≤30 分钟**（真 provider 接入按 costing 实测受控修订、决策日志留痕）；Wave2/3 解禁触发随 tranche-2 addendum 钉（v0.2）。E1-17（A2 三条行级断言：进度/失败可重试/超限诚实拒绝）与 E2-13（C1 research 轨迹可见性断言）v0.2 起随所挂锚验。**待施工填并排截图 5 分制盲评结果**；任一态 <3 分进待裁链。

## ⑥ 全旅程证据

- **owner**：各工位 + 浏览器 runtime QA。
- **⚠️ 三无纪律预注**：本程处**用户数=0 + Stripe 零成交 + 无生产流量**（三无）状态下——**旅程证据 = mock/staging 级，如实标注**（宪法 3 状态诚实）：happy/empty/loading/denied/failure/retry/mobile 七态截图取自 staging + MockProvider（$0）+ 夹具注入失败形态，**不冒充生产真实流量**；真钱旅程（真 provider 小额）= 只交方案不执行，执行点 = **每笔真实花费 = founder 逐笔明示批准**（宪法 2/BLUEPRINT:61；$300 信封是总额上限背景，不构成单笔授权载体——spec §六.3，v0.2 BR2④(b)）。凡 staging/mock 级证据一律标注来源级别，不作生产已验证陈述。
- **证据槽位**：canvas 五态（空布→首图→就地编辑→A/B→Make Video）；工厂（贴链→选人设→批量矩阵确认页→成片网格 partial）；storyboard（draft→make-all→animatic→stitch）；media-editor（trim→抽帧→存版本 $0）。**待施工填七态截图 + 时间码**。

## ⑦ 测试全家桶可重跑链接

- **owner**：各工位。
- **证据槽位**：本地三关（`check`/`test`/`web-build`，配方 `docs/runbooks/local-ci.md`）；契约测试（`runVariantBatch` N 格独立/幂等不双扣/partial 只退失败格/Trim $0 断言/Otto propose 零 GenJob/Library 真落库归组）；`node scripts/route-b-matrix-check.mjs`（矩阵闸）；`pnpm lint:parity`（对等债闸）。**待施工填可重跑命令 + CI job 链接**。

## ⑧ schema / ownerId / 审计 / 同意 / 秘密

- **owner**：W-B3-F（工厂编排，schema 触点最重）+ 控制面。
- **证据槽位**：`GenerationBatch`（schema.prisma:961，已建，nullable 软引用无 FK、不持钱字段）；`GenJob.batchId(:464)` 预埋。新对象（idea 小 owner-scoped 对象）ownerId scoping；**模板 = g5b 静态代码目录，零新 schema 对象**（v0.2 钉②改判——`schema.prisma:294-316` 的 `TemplateBundle` 是 ComfyUI workflow bundle 另一物，禁混用命名）。`CreditLedger_finalizer_once` partial-unique 索引（每 ref 一 finalizer）。**schema 变更走 founder-only 类别**（如新增对象/迁移）——单列上报。**待施工填 schema diff + ownerId 断言 + 审计事件形状 + 脱敏检查**。

## ⑨ 成本 / 延迟 / margin / 监控 / 回滚

- **owner**：控制面 + W-B3-E~H（spend 工位）+ B10 联动。
- **证据槽位**：**真实花费**——开发期 $0（MockProvider）；真钱验收 = 每笔真实花费 founder 逐笔明示批准（宪法 2/BLUEPRINT:61）。**margin**：**Quality ×1.5 倍率本期撤销**（v0.2 BR2④(a)，GRILL:244 终判——仅当 Speed/Quality toggle 映射到真实更贵参数才可保留差价）；报价一律 `pricedGenCredits` 按真实模型成本×毛利（≥45% 地板）收；批量定价毛利证明依赖 B10 数值 gate（假设 B3-A5：B10 未就绪则批2 停等上报）。延迟：批量全链 = mock 级 20 格 ≤30 分钟临时阈值（v0.2，真 provider 接入按 costing 实测受控修订）。回滚：feature flag 灰度（canvas 迁移，L-C §二.8）+ revert PR。**待施工填 costing 数 + margin 证明 + 监控告警 + 回滚步骤**。

## ⑩ 上下游契约 + 外部位状态 + 通电步骤

- **owner**：控制面。
- **证据槽位**：
  - 上游：B0 矩阵（46 行）+ B9 上下文桥契约（B3 第一旅程「把这个改成 9:16」依赖 selection[0] server-resolve）+ B9 分域装载（create 域）。**批3 引擎集成开工门 = #253 或其拆分后继合并**（R-009 待 founder 裁；RISKS-PENDING 选项 B 拆分冻结解锁 B3/B4）。
  - 下游：B4 发布（出片→排期 schedulePosts）；B8 Campaign（asset-viewer Add to campaign 软引用）；B10 毛利地板数值 gate（批量定价毛利证明；Quality ×1.5 已撤——v0.2）；B12 定价终案（E1-06 等）。
  - 外部位：本区**无新外部依赖**（gen 链走既有 fal/BytePlus provider，凭据已在）。
  - 通电步骤：canvas 迁移灰度翻户（3 用户零断供，L-C §二.8/D3）。**待施工填**。

## ⑪ 异族评审

- **owner**：非作者 agent + `/codex` 对抗二审。
- **证据槽位**：spec 冻结走四权闭环（双顾问签核 + 异族复审 + 机器闸 + 非作者合并，#254 §一.2）——**已有一轮：codex BR2（钉 v0.1 head `fb1a8efd`）判 BLOCK 六项，v0.2 全数闭合（其中钉②/×1.5/信封三处 = 控制面改判）**；后续轮次待补 provenance。施工期：**批2 spend 四工位（W-B3-E/F/G/H，v0.2 补 H）每 PR 逐个过 `money-safety-review` + 对抗 `/codex` 二审**（P0/P1=0 才 code-complete）；$0 片走常规 proportional review。**待施工填各 PR 异族评审判定原文 + provenance 路径**。

## ⑫ 已知限制与待裁（没有写「无」）

- **owner**：控制面。
1. **规模上修（L→L+）**：原型七页不在 main（W-DELTA 核证），「只需接线」前提不成立，新增 LC-0 壳落地工位（spec §二.1）；LC-0 实测改造量待回填（假设 B3-A1）。
2. **E1-19 A/B 分叉出处已钉**（v0.2）：GRILL-VERDICTS:132-138（复核相符）；R-002 默认项 A 完结。行现状 absent，能力随 W-B3-E 建。
3. **定价挂 B12**：E1-06（16cr 现值 vs 旧 7cr 文档）+ 报价一律 pricedGenCredits——B3 不自行改价；**Quality ×1.5 本期撤销**（v0.2，GRILL:244 终判，非挂 B10 缓上）。
4. **tranche-2 处置 8 行保持 listed**（D-021）：六新行 + 改档 B0-17/18（v0.2）锚待 addendum；B0-101↔E1-15 关系、B0-96 多机位细化、B0-97 肖像授权边界、B0-17/18 解禁触发未钉（假设 B3-A6/A2）。
5. **批量全链时长真值未测**：v0.2 已落显式临时阈值（mock 级 20 格 ≤30 分钟）；真 provider 实测值待 costing/压测，受控修订走决策日志（假设 B3-A3）。
6. **B10 毛利地板数值 gate 时序假设**（批2 前置）：批量定价毛利证明依赖 B10；若 B10 未就绪批2 停等并上报（假设 B3-A5）。
7. **Design B 首落本区 = 荐否**（L-C §七.D1/A2）：安全 > 效率，L-C 用成熟单一动作层 + parity 清债，Design B 另择小区首落——待 founder/总审查员定。

## ⑬ 录像时间码 + founder 10 分钟自查脚本

- **owner**：各工位 + 控制面（终验日）。
- **证据槽位**：录像时间码 = **待施工填**（三无纪律：staging 级，如实标注）。**Founder 自查脚本（10 分钟，终验日跑脚本非读散文）**——骨架：
  1. 打开 canvas（staging）→ 一句话想图 → 就地编辑 → A/B → Make Video：你应看到五态心流 + 每次花费先弹确认。
  2. 工厂贴链 → 选人设 → 批量矩阵确认页：你应看到「报价=预留=结账」三数一致 + 成片按 GenerationBatch 归组落 Library。
  3. media-editor Trim 一段视频：你应看到 **$0**（不扣 credits），非原型的 12cr。
  4. Account→Credits 明细：你应看到单笔可展开（reserve/settle/refund 三态可见），失败即退看得见。
  5. 终端跑 `node scripts/route-b-matrix-check.mjs` + `pnpm lint:parity`：你应看到全绿 + B3 债清零。
  **待施工填实测截图 + 时间码**。

## ⑭ 定稿后 delta

- **owner**：控制面。
- （spec 冻结后触碰本块任何签署对象=重认证；delta 记录从此处追加。）
