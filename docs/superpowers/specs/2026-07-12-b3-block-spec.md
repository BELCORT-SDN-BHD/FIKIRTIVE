# B3 创作块 · 块 spec（v0.1——冻结候选）

> 2026-07-12。epoch `claude-20260712-03`。性质：**装配件不重画**——本 spec 把控制面已裁定的判断内容 + 两份取证报告（W-DELTA 差额核证 / W-ANCHOR 对标锚提案）装配成 B3 创作块的冻结候选；判断已全部定案，本工位逐字执行不改判。**主体施工图 = `docs/superpowers/specs/2026-07-10-lc-creation-zone-lighting.md`（L-C 创作区点亮施工图）——引用采纳为附件，不复述，本 spec 各节 = 对 L-C 的修正 + 增补。**
> **状态：冻结候选（freeze candidate）v0.1——冻结走四权闭环（双顾问签核+异族复审+机器闸+非作者合并），依 #254 §一.2。** spec-ready 迁移随冻结 PR 执行（03-B3 主 tranche 行随冻结 PR 迁级；tranche-2 六行待 addendum）——**本 PR 不迁任何行的六级状态**（仅新增两份文档）。founder 参与移至终验一次过审计索引（#254 §一.3/§二.5）。华语（宪法 9）。
> **钱路警告（承 L-C 头部）**：本区是全城**最重的 spend path**。凡触及 `startGen`/`genRequest`/批量编排/幂等键的施工 diff **逐个必过 `money-safety-review` skill**。任何真实供应商验证花费**逐笔问 founder，"问"就是上限**（宪法 2）。
> **人话**：这是「创作车间」的施工总纲——把已经画好的图纸（L-C）、差额核对单（W-DELTA）、对标记分卡（W-ANCHOR）三张纸订成一份能开工的合同。开工前先把一件事说清楚：车间的那七个漂亮门面，其实还没盖在 main 上（在另一根未合入的分支上），所以第一道工序不是"接线"，是"先把门面搬过来"。

---

## 一、范围与体制

### 1.1 块定义与行数

B3 块（`docs/ops/route-b/matrix/03-B3.md`）= **46 行**，拆两 tranche：

- **主 tranche 40 行**：E1-01~E1-19（19）、E2-13/E2-14/E2-22（3）、E5-17（1）、B0-10~B0-26（17）。本 spec 主体覆盖对象；随冻结 PR 迁 `spec-ready`。
- **tranche-2 六新行**：`B0-94`（多 clip 拼叙事长片）、`B0-95`（AI 配乐+音效）、`B0-96`（多机位一键出图）、`B0-97`（视频换脸/换角）、`B0-100`（实景/OOH 场景模式）、`B0-101`（卡点模板）。此六行是 B0 修宪包（D-018④/D-019）新增，**锚以 addendum PR 补录，补录前保持 `listed`**——采 **D-021 先例**（「listed 行不认证不出程、终验如实显示」，Marketplace 70/72、第一米 76 同纪律）。本 spec §四.⑥、§三.10、§七 为其预留钉桩与槽位，不构成即时出程。

### 1.2 体制：L-C 引用采纳，本 spec 是修正层

本 spec **不复述 L-C**。L-C 施工图（点亮令牌，与 L0/L1 同级）已定：七页判词表、接线图（每页动作 ↔ server action ↔ Otto skill 的 Parity 登记表）、钱路触点表（10 触点+六态+gate4 诚实契约映射）、后台缺口清单（11 本期建/9 诚实 Coming soon）、每环最强对标、R4 Design B 决策、验收/规模/PR 切片、九条假设台账。**以上全部引用采纳。** 以下各节仅做三件事：

1. **基线修正**（§二）——吸收 W-DELTA：L-C 写作时的基线前提（「七页原型已存在只需接线」）已被核证推翻，最高优先级上修。
2. **对标锚清单**（§三）——吸收 W-ANCHOR + 控制面对 10 待裁项的裁定：L-C §六「每环最强」只给了第一性分解，本 spec 落成法定锚清单（水准判官要件，无锚不开工，MASTERPLAN §六）。
3. **钉桩/批次/闸/台账**（§四~§八）——把 L-C 的决策项与本工位入参钉成终案。

冲突处置：当本 spec 与 L-C 冲突，**本 spec（承 W-DELTA 核证）为准**（如 L-C「点亮=只接线」前提 vs §二规模上修）；当本 spec 与上位法（`docs/BLUEPRINT.md`/宪法/MASTERPLAN）冲突，**停在该项报告**，不自裁。

---

## 二、基线修正（W-DELTA 全量吸收）

> W-DELTA 差额核证报告核对了 L-C 施工图 + 03-B3.md 矩阵对 `main@45fb27f7` 的 19 条断言（3 漂移/存疑 + 16 仍准），原文存档见证据槽位。以下逐项吸收。

### 2.1 规模上修声明（最高优先级）

**L-C「点亮 = 只接线」的前提不成立。** W-DELTA 核心结论坐实：L-C 全篇讨论的**创作七页原型只在 `origin/claude/northstar-immersive`**（`canvas-page.tsx`/`studio-factory.tsx`/`studio-home.tsx`/`studio-ideas.tsx`/`studio-storyboard.tsx`/`media-editor-page.tsx`/`asset-viewer-page.tsx` 及 `/northstar-immersive/create/*` 七条路由），该分支**领先 main 122 个提交、从未合入**（`git merge-base --is-ancestor 896419e1 45fb27f7` → exit 1）。main 上的 immersive 树目前只有骨架三支（#232 地基 / #236 壳契约切片1 / #255 lint），覆盖 otto/global/onboarding/cityhall，**零个 create/* 页面**（`git ls-tree HEAD` 核实）。后端（gen 链/账本/`FlowCanvas`/`canvas-actions`/`storyboard-actions`/`storyboard-gate1-actions`/`refgen-actions`/`GenerationBatch`）确实都在——**但 L-C 要「接线」的前端壳完全不存在于 main。**

**裁定 · 新增 LC-0 壳落地工位为批1b 首 PR：**

- **源** = 原型分支（`origin/claude/northstar-immersive`）创作七页；**适配** #236 壳契约切片1 的既有模式（沿用已合入 main 的 immersive 壳契约，不另立规矩）；**落 main**。
- **账记** = LC-0 落地后，B3 各行的「人工入口」列由现状 `TBD-B3` / `A′ 页 create/*（切片2）` 硬化为实指（顾问处方：**壳基底显式并入首批工单**，不作隐含前提）。
- **依赖** = LC-a~LC-g 各片的**前端接线依赖 LC-0**（无壳无从接线）；LC-0 是批1b 的第 0 道工序，不是可选前置。
- **规模从 L 上修**：L-C §八原评 `L`（工厂编排层为主要新建，其余多为接线）。**依据 W-DELTA**——「接线」目标（前端壳七页）本身要先落地（约 2248 行 canvas-page + 1135 行 studio-factory + 716 行 storyboard + home/ideas/media-editor/asset-viewer，适配 #236 契约的改造量），此工作量在 L-C 原估里被「只需接线」前提隐藏。**上修评级 `L→L+`**；LC-0 的实测改造量入假设台账（§七），measure 后回填精确工时。

### 2.2 E1-06 定价漂移

矩阵 03-B3.md:12 与旧判决称参考视频「7cr 固定价」；W-DELTA 核证代码现值 = **16cr**（`packages/core/src/spend.ts:89` `REFERENCE_VIDEO_CREDITS = 16`，自 #131〔2026-07-04〕即 16，文档从未同步代码）。

- **本 spec 以代码现值 16cr 为现状记录**，**不照抄 7cr**。
- **定价终案挂 B12 对表，B3 不自行改价**（承 L-C §一非目标「不碰定价数字的最终拍板」；报价一律走真后台 `pricedGenCredits`）。
- **矩阵行勘误提案**：03-B3.md:12「7cr 固定价」→「16cr（现值，`spend.ts:89`），定价终案挂 B12」，随下次 `ledger-sync` PR 写入（账行提案见本 PR 描述 + §八）。
- **教训入纪律**：此类硬编码价目每次引用前必须重查代码（W-DELTA §对 B3 影响 2）。

### 2.3 E1-14 措辞重写

矩阵 03-B3.md:20 称 Library「不在主导航，仅深链」。W-DELTA 核证：`immersive-nav.tsx:115` 的 Assets 组**有** Library 条目，但 `assets/*` 路由**未建**（死链 404）；legacy `/otto` 的 `OttoNav.tsx:100` 有渲染。

- **重写为**：「nav 配置存在（`immersive-nav.tsx:115`）但 `assets/*` 路由未建（死链）；legacy `/otto` 有渲染」。措辞随 ledger-sync 勘误（账行提案）。

### 2.4 GenerationBatch 行号刷新 + Stitch 技术参照补录

- **GenerationBatch 行号引用刷新 `schema.prisma:961`**（L-C 引 `:954`，W-DELTA 核证漂移 7 行，**非结构性**；`GenJob.batchId(:464)` 预埋）。凡本 spec / L-C 引 `schema:954` 处，读为 `:961`。
- **Stitch 技术参照补录**：`apps/worker/src/jobs/render.ts` **已有 xfade/concat 逻辑**（timeline 剪辑），是 stitch $0 顺序 concat 的**现成技术参照**（用于 §四.① stitch 同物性判据；render.ts 注释「re-rendering is free」）。

### 2.5 存量断言引用免重核（16 条）

W-DELTA 判「仍准」的 16 条存量断言，本 spec **直接引用免重核**：E1-01/E1-02/E1-05/E1-08/E1-09/E1-10/E1-17/E1-18/E1-19、E2-13/E2-14/E2-22、B0-15/B0-16/B0-20/B0-24/B0-25、B0-17（钱路地基尤其扎实：`GenerationBatch`/`batchId` 软引用、`pricedGenCredits`、`MAX_GEN_COUNT=4` 服务端硬顶〔`gen.ts:75`〕、`GENERATION_PROVIDER` fail-safe〔`generation/src/index.ts:358-375`〕、`MAX_CONDITIONING_IMAGES=10`〔`refgen.ts:30`〕）。

---

## 三、对标锚清单（W-ANCHOR 提案 + 控制面 10 裁定）

> 锚法定形态（B0-CONTRACT §一 + MASTERPLAN §六）：对标对象 + 版本（一律 2026-07 市场版）+ 关键旅程 + 通过阈值 + 并排截图打分法。**组织原则采工位形态**：按泳道设锚（6 泳道锚 + X1 跨切锚），46 行以「泳道锚 + 行级差异断言」挂靠。W-ANCHOR 锚表全量落入；控制面对 10 待裁项的裁定逐条覆盖其上。

### 3.1 控制面 10 裁定（逐字执行）

| # | 待裁项 | 裁定 |
|---|---|---|
| 1 | F2 竞品（AdCreative.ai 荐本波 vs Arcads 留 Wave2） | **F2 = AdCreative.ai 入本波锚**；Arcads 留 **Wave2 注记** |
| 2 | S1 竞品 | **S1 主锚 = Grok Imagine**（多镜头/story）；**Runway Gen-3 作连贯度上限对照**（不并排求 parity，只作上限参考） |
| 3 | M1 竞品 | **M1 = CapCut** |
| 4 | A1 子面是否对标 Canva Brand Kit | **A1 结构化子面对标 = Canva Brand Kit 采纳**；护城河面 B0-26 对 **O-04 判决自证** |
| 5 | A2 是否对标 Canva | **A2 = Canva 采纳** |
| 6 | H1 竞品 | **H1 主锚 = Canva home**；Grok home 作参照截图，**盲评以 Canva 为准** |
| 7 | Wave2/3 parity 解禁触发条件 | **显式 TBD-B3 待裁**（挂 harmony-03 升级票纪律；本波 Coming soon 不解） |
| 8 | 各 spend 触点 ≤M 分钟的 M 值 | **TBD-B3**（待 costing/压测填数，槽位留在锚表） |
| 9 | Stitch $0 | **已判**（GRILL:245 + render.ts 参照）——**记录性条目**，非新裁 |
| 10 | E1-02 vs B0-96 同义歧义 | **判不同物**：E1-02 = 同一视角**批量采样**（count 1-4）；B0-96 = 多机位 = **视角/构图控制**（tranche-2 锚时细化）——两行**独立**，歧义闭 |

### 3.2 锚清单（6 泳道锚 + X1 跨切）

#### 泳道一 · canvas

**锚 C1 · Grok Imagine canvas**（主锚，已点名）
- 关键旅程：空布→「一句话想图」出首图→选中一张「变这样」就地演化（不回填表单）→Make Video（i2v/t2v）→「A/B 对」count=2 分叉→派生关系（源→果）连线可见
- 通过阈值：三模式（图/视频/agent）切换隐形；选中即改无表单回填；A/B 分叉一键可达；派生关系可视；并排盲评「零学习曲线生成语法+就地演化+即时反馈心流」不落下风
- 打分法：staging 截「空布→首图→就地编辑→A/B→Make Video」五态，与 Grok Imagine 同旅程左右并排，founder+审查员 5 分制盲评（不标品牌），任一态 <3 分即「未及」进待裁链
- 出处：GRILL O-09（GRILL-VERDICTS-2026-07-03.md:23）；L-C §六（:271）；L-C §二目标2（:32）

**锚 C2 · magicpath**（次锚·无限画布心流，已点名）
- 关键旅程：无限画布平移/缩放+多对象同屏+秒级出结果心流（真数据量下）
- 通过阈值：「后台已出片而界面还转圈」按缺陷；生成态变化秒级反映；真数据量压测下画布不卡；并排盲评空间感/流畅度不落下风
- 打分法：录 canvas N 节点下平移/生成刷新短视频（带时间码），对 magicpath 同规模操作评帧率/反馈延迟
- 出处：L-C §六（:269/271）；§八规模（:287）+ live reflection（:335）

#### 泳道二 · factory

**锚 F1 · Higgsfield Marketing Studio**（主锚，已点名）
- 关键旅程：贴商品链接（或选 Product）→选人设（多参考图一致性）→选拍法（3 无口播模式：产品展示/开箱/促销卡点）→brief 预检+总价确认页→确认批量矩阵（brief×平台×尺寸×钩子）→N 格逐格出可投成片→落 Library 按 `GenerationBatch` 归组
- 通过阈值：贴链到成片全链走通；总价确认页「报价=预留=结账」三数一致；成片「可投不需再拼」；批量 N 格 **≤M 分钟**全链（**M = TBD-B3**，裁定8：待 costing/压测定）；并排盲评「卖成品非工具箱」不落下风
- 打分法：截「贴链→选人设→批量矩阵确认页→成片网格」对 Higgsfield Marketing Studio 同旅程；成片网格并排盲评「可投性」5 分制
- 出处：harmony-03（:8/16/35）；GRILL C-01（:65）

**锚 F2 · AdCreative.ai**（广告变体/钩子专项——**裁定1：入本波锚**；Arcads 留 Wave2 注记）
- 关键旅程：一个 brief→自动铺 N 平台×尺寸×钩子变体→挑选
- 通过阈值：钩子变体多样性+一稿多尺寸自动配齐并排不落下风
- 打分法：截 hook 变体网格+多尺寸套装对 AdCreative.ai 评多样性/可投性
- Wave2 注记：Arcads（UGC/演员口播广告）留 Wave2 对标，本波不设锚（口播属 Wave2 无后台，§三裁定7）

#### 泳道三 · storyboard

**锚 S1 · Grok Imagine**（主锚——**裁定2**；Runway Gen-3 作连贯度上限对照）
- 关键旅程：brief→draft scenes（$0）→改脚本→Make all（帧→i2v 逐场景，gate1 真管线）→预览 animatic→（E1-09）$0 顺序 stitch 拼成片
- 通过阈值：分镜→逐场景视频全链走通；单场景 Retry=新键不双扣；stitch $0 顺序拼接（founder 2026-07-11 判，AI 转场留下波）；并排盲评分镜清晰度/叙事连贯不落下风
- **Runway Gen-3 = 连贯度上限对照**（裁定2）：**不并排求 parity，只作上限参考**——多镜头一致性/物理连贯的天花板参照，不作通过/未及判据
- 打分法：截「draft→make-all→animatic→stitch 成片」对 Grok 同旅程，评分镜清晰度+成片连贯度
- 出处：GRILL N（:139，判决把多 clip 归 Grok）；L-C §三（:126-128）；stitch $0 判决（GRILL 追加:245）

#### 泳道四 · media-editor + asset-viewer

**锚 M1 · CapCut**（**裁定3**）
- 关键旅程：从 canvas 对象「全屏/Trim」深链入→Crop/调整→Trim（**必 $0**，§四.G 修正掉原型 12cr）→抽帧作图片参考（E1-07）→存新版本→（B0-13）导出渲染+字幕管线（$0）
- 通过阈值：Trim/Crop/抽帧断言 $0（不 reserve、不建 GenJob）；帧轨/版本可寻址；字幕烧录走 caption 管线；并排盲评剪辑顺手度不落下风
- 打分法：录「trim→抽帧→存版本」短视频（时间码）对 CapCut 同操作评顺手度+步数
- 出处：L-C §四.G（:222-225）；§三（:129）
- **asset-viewer（B0-24）跨挂锚 C1**：Continue/Regenerate 走 `startGen` = C1 就地演化旅程；版本/帧轨 = M1；Share = 跨切审批闸。出处：L-C §三（:130-132）；GOAL G1/g2a spec

#### 泳道五 · 资产库·品牌记忆·library·templates·discover

**锚 A1 · 品牌记忆护城河锚**（宪法级/自证——**裁定4**：结构化子面对标 Canva Brand Kit 采纳）
- 关键旅程：贴产品链接一键 ingest（E1-13，$0）→品牌记忆落库（E1-11 6-tab / E1-12 living collections）→生成时校验注入（B0-25 BrandKit）→自学习（B0-26，O-04）
- 通过阈值：产品档/品牌语气进生成；冷启动诚实标「category signals, not learned from your account yet」（gate4）；并排 vs 对手「假装懂你」更可信；BrandKit 结构化校验 = $0 确定性优先
- 打分法：截「ingest→品牌记忆→生成时注入」旅程+冷启动诚实文案，**Canva Brand Kit 结构化面并排**（裁定4）；**护城河部分（B0-26）改对 O-04 判决 + gate4 逐条核**（裁定4：护城河面自证）
- 出处：GRILL O-04（:22）；蓝图第六章资产区（B0-26 批准来源）；L-C §六（:278）+ gate4（:199）

**锚 A2 · Canva**（资产库/模板/发现读面——**裁定5：采纳**）
- 关键旅程：模板套用（E1-15）→付费路径走真 `startGen`→出片落 Library（E1-14）按 `GenerationBatch` 归组→My Stuff 统一 cast+ads（E1-10）/History 全量（E5-17）三跳内可达
- 通过阈值：Library 真落库（非只记字符串，gate4）按 `GenerationBatch` 归组可读；模板付费走真 `startGen`（非静态数组假付费，**TemplateBundle 正身 §四.② 钉**）；三跳内达任一资产；Discover 无源时诚实占位不留假按钮
- 打分法：截「模板→套用→出片→Library 归组视图」+ My Stuff 统一库，对 Canva 并排评组织力+套用顺手度
- 出处：L-C §二（:54）；§四.D（:196）；GRILL N（:144；Discover=净新 L-C §五.2:260）；矩阵 E1-15

#### 泳道六 · home·ideas·三模式

**锚 H1 · 创作首页 front door**（**裁定6：主锚 = Canva home**；Grok home 作参照截图，盲评以 Canva 为准）
- 关键旅程：首页 composer 一句话提交→落 canvas 真下单；「Build brand from a link」→`ingestProductFromUrl`（$0）；模板/工作流/发现入口
- 通过阈值：composer 一句话直落 canvas 真下单（延到 canvas 确认花费）；三跳内开始创作；模板/灵感「领进门」不空转
- 打分法：截首页 composer→canvas 旅程对 **Canva home**（主锚）评「领进门」顺畅度；Grok home 仅作参照截图，**盲评以 Canva 为准**（裁定6）
- 出处：L-C §二（:54，C 类 $0）；GOAL A0（矩阵 B0-22）

**锚 I1 · 想法清单（反 Buffer 自证）**（判决点名反面锚）
- 关键旅程：零散想法一键→idea 小对象落库（或复用 thread 草稿）→「Suggest 3 ideas」free skill（$0）→一键转画布真下单
- 通过阈值：想法一键转创作；Otto suggest $0；极轻不做 Buffer 式重管道；与 Campaign 联动
- 打分法：截「捕获→suggest→转画布」旅程；**不与 Buffer 并排求 parity，改对 GRILL N-Buffer 判决「极轻不沉底」逐条核**
- 出处：GRILL N（:148）；L-C §三（:124-125）；矩阵 B0-23

#### 跨切锚 X1 · gate4 诚实契约 + 宪法 3 计费透明（无竞品，机器测 + founder 自查）

- 关键旅程（横切所有 💰 行）：报价（credits-only）→reserve 冻结→settle 结账/refund 退还；批量 partial 逐格结算；先问后花确认页
- 通过阈值：报价=预留=结账三数一致；失败 REFUND ledger 行可见；批量 partial 只退失败格（text 格永远 $0）；Retry=新键不双扣；先问后花（贵活前 brief 预检+报价）；10 个 spend 触点零新钱路全收敛 gen 链
- 打分法：**非截图对标**——机器契约测试（同批重投递不双扣/partial 只退失败格/Trim $0 断言）+ founder Account→Credits 明细单笔可展开自查（L-C §八真钱验收方案①②③）
- 出处：L-C §四（:138-225）+ §四.D（:190-201）；GRILL（:35）；B0-CONTRACT §五（:35）

### 3.3 n/a-internal 4 行（采纳，理由照录）

以下 4 行无品类竞品对标，采 `n/a-internal` 锚，效果经其他泳道锚间接过堂：

| 行 | n/a-internal 理由 |
|---|---|
| E1-17 | 存储安全管道（直传链）；可用性挂 A2 导入旅程间接过堂 |
| E2-13 | research 引擎技能，效果经 C1/F1 间接过堂 |
| E2-14 | prompt 技能，专业判断冻进确定性 code（C-02:67） |
| E2-22 | 生成 provider 选择，纯后端管线（过 money-safety） |

### 3.4 行→锚挂靠对照表（46 行，全量落入）

| 行ID | 挂靠锚 | 备注 |
|---|---|---|
| E1-01 | C1+C2 | 画布本体；C2 承规模心流 |
| E1-02 | C1 | 4 变体入口断层=B3 验收项；**与 B0-96 判不同物**（裁定10，§四.⑤） |
| E1-03 | X1 | image 无弹窗/video 有确认弹窗=先问后花映射 |
| E1-04 | C1 | Make Video |
| E1-05 | C1（兼供 F1） | conditioning ≤10 |
| E1-06 | C1 | 参考片上限 6s/**16cr 现值**（定价终案挂 B12，§二.2） |
| E1-07 | M1（兼 C1） | 抽帧 |
| E1-08 | S1 | 主旅程 |
| E1-09 | S1（跨 canvas） | $0 顺序版已判（裁定9）；AI 转场留下波；同物性 §四.① |
| E1-10 | A2 | My Stuff |
| E1-11 | A1 | 6-tab |
| E1-12 | A1 | living collections |
| E1-13 | A1 | $0 ingest |
| E1-14 | A2 | 真落库归组（gate4）；措辞已重写（§二.3） |
| E1-15 | A2 | TemplateBundle 正身钉（§四.②） |
| E1-16 | A2 | 本期诚实占位 |
| E1-17 | n/a-internal | 存储安全管道；可用性挂 A2 导入 |
| E1-18 | X1 | 失败态卡=gate4；服务端硬闸=B3 验收项 |
| E1-19 | C1 | 分叉出处待核，核不到转新增待裁（§四.③，R-002 默认项） |
| E2-13 | n/a-internal | 引擎技能，效果经 C1/F1 间接过堂 |
| E2-14 | n/a-internal | 专业判断冻进确定性 code（C-02:67） |
| E2-22 | n/a-internal | 纯后端管线（过 money-safety） |
| E5-17 | A2 | History 全量 |
| B0-10 | A2 | 核心是对等债 03-07，benchmark 薄 |
| B0-11 | A1 | 债 08-10 |
| B0-12 | X1 | 付费护栏与 E1-18 同治 |
| B0-13 | M1 | render/caption $0 |
| B0-14 | M1 | 💰 mock 风险 4/18；缝3+money-safety |
| B0-15 | F1+X1 | 💰 refgen；债 68 假对等矫正 |
| B0-16 | F1 | Wave 1 本波主体 |
| B0-17 | F1 | 本期 Coming soon（无 TTS）；parity 阈值 deferred 待裁（裁定7） |
| B0-18 | F1 | 本期 Coming soon（无选角库）；mock 风险 10/18 |
| B0-19 | F1+F2 | 判决 7-2 |
| B0-20 | F1+F2+X1 | 💰 总价确认页硬性（判决 7-3） |
| B0-21 | F1+X1 | 判决 7-7；cost=spend 必审批 |
| B0-22 | H1 | GOAL A0 |
| B0-23 | I1 | 与 Campaign 联动 |
| B0-24 | M1+C1 | mock 风险 17/18；Regenerate=C1 派生 |
| B0-25 | A1 | mock 风险 11/18；$0 确定性校验 |
| B0-26 | A1 | 护城河自证，对 O-04 判决核（裁定4） |
| B0-94 | tranche-2 | 六新行 addendum 另做（多 clip 拼叙事） |
| B0-95 | tranche-2 | addendum（AI 配乐+音效） |
| B0-96 | tranche-2 | addendum（多机位=视角控制，≠E1-02，裁定10） |
| B0-97 | tranche-2 | addendum（换脸换角；肖像授权边界待钉） |
| B0-100 | tranche-2 | addendum（实景/OOH 场景模式） |
| B0-101 | tranche-2 | addendum（卡点模板；与 E1-15 关系 §四.⑥） |

---

## 四、五颗钉子终案（原五钉 + 新钉，全部落判）

> 「钉子」= 矩阵/判决层留下的同义/出处/正身歧义，B3 spec 冻结前必须逐个钉死，否则施工时长成第二套实现或误判钱路。以下六钉全部落判。

**① E1-09 stitch 同物性**
- 判据 = L-C §四.G + `render.ts` 参照（§二.4）：**ffmpeg concat（顺序拼接）→ $0，走 `startRender`**（timeline 剪辑，render.ts 注释「re-rendering is free」）；**AI 生成转场/morph → paid，走 `startGen`**。
- 施工 plan 定原型意图后落 PR；本波交付 = **$0 顺序 concat 版**（裁定9，founder 2026-07-11 判），AI 转场留下波 costing。

**② E1-15 Templates 正身**
- 正身 = **`TemplateBundle` 注册表**，**非静态数组**；**付费路径走真 `startGen`**（非静态数组假付费）。
- 施工义务：模板套用落 canvas/工厂真下单，经 gen 链计费、真落库；A2 锚通过阈值以此为准。

**③ E1-19 A/B 分叉出处**
- 出处 = **批1b 工单核 `W-MP` 审计行号**（北极星注册表 create/canvas 行 sources 引「N (Grok) canvas A/B 分叉判决『要』」，GRILL N 卷为指向）；**核不到转新增待裁**（**R-002 默认项 A**：认可指向、B3 spec 时钉行号）。
- 现状 = `absent`（W-DELTA 核证零分叉/fork 代码，现有 A/B 仅 count=2 平级图）；A/B 分叉 = 净新能力，随 canvas gen 链片建。

**④ E1-06 定价**
- 见 §二.2：现值 16cr 记录；定价终案挂 B12 对表，B3 不自行改价；矩阵勘误随 ledger-sync。

**⑤ E1-02 / B0-96 不同物**
- 见 §三裁定10：**E1-02 = 同一视角批量采样**（count 1-4，`MAX_GEN_COUNT=4` 服务端硬顶）；**B0-96 = 多机位 = 视角/构图控制**（tranche-2 锚时细化）。两行**独立**，歧义闭。

**⑥ B0-101 卡点模板与 E1-15 关系**
- = **tranche-2 addendum 一并钉**（B0-101 属 tranche-2，保持 listed）。钉桩预留：卡点模板（beat 音画对齐）与 E1-15 模板体系（`TemplateBundle`）是否同一注册表 / 是否独立对象，随 tranche-2 取证 addendum 落判，本 spec 不预判。

---

## 五、批次与工位表

> 承 L-C §八 PR 切片（LCa~LCg），按顾问 memo 裁定重排为四批。**纵向切片纪律**（MASTERPLAN §四.4）：每片 = 本片迁移的行 + 每行双执行器交付物（人工入口 + Otto skill）+ 证据随写入 `B3-REPORT.md` 对应节，一次完成。

### 5.1 批1b · 五工位（$0 为主 + 壳落地；批1b 首工位 = LC-0）

批1b 由 L-C 原四工位改**五工位**（新增 LC-0）：

| 工位 | 内容 | 触钱? | 依赖 |
|---|---|---|---|
| **LC-0 壳落地（新增，首位）** | 原型分支创作七页落 main，适配 #236 壳契约切片1 既有模式；账记 B3 各行「人工入口」列硬化（§二.1） | 否 | 无（第 0 道工序） |
| **W-B3-A** | canvas $0（LCa + 切片2 壳基底并入）：immersive canvas 壳接 `canvas-actions`（节点 CRUD）+ feature flag 灰度骨架 + canvas Otto skill（parity 清债 debt-33~37,60） | 否 | LC-0 |
| **W-B3-B** | media-editor / asset-viewer $0 + 上传渲染债：Crop/Trim/抽帧 **$0 修正**（§四.G，删 `TRIM_COST=12`）；上传链（debt-14,15）+ render/caption 债（debt-19~26） | 部分是（续拍归批2） | LC-0 |
| **W-B3-C** | storyboard $0 + 债：`storyboard-actions` $0 CRUD（debt-11,12,13）；配音/coherence 诚实 Coming soon | 否 | LC-0 |
| **W-B3-D** | home/ideas/风格卡/3 模式 + library/brand 债：composer→canvas、brand-from-link 接 ingest、ideas 对象 + proposeIdeas skill；风格卡 + 3 无口播模式；library 读债（debt-29,30,50）+ brand 债（debt-31,32,51） | 否（$0） | LC-0 |

### 5.2 批2 · spend 三工位（每 PR 逐个过 money-safety-review + codex 对抗二审）

| 工位 | 内容 | 纪律 |
|---|---|---|
| **W-B3-E** | canvas 接 gen 链（LCb）：想图/Make Video/A/B/就地编辑 → `startGen`；报价 `pricedGenCredits`；先问后花确认页；六态①②③④⑥ | 过 money-safety + 对抗二审 |
| **W-B3-F** | **工厂编排**（最重钱路）：`runVariantBatch`/`runBulkGrid` + `GenerationBatch` 归组 + 逐格 reserve/settle/refund + text 格 $0 + 总价确认页 | **单资深工位、禁并行拆手**；过 money-safety（核心）+ 对抗二审 |
| **W-B3-G** | refgen 真 skill + asset-viewer Continue/Regenerate：`startRefGen` 补真 skill（矫正债 68 假 parity，debt-68,69）；续拍/重生成 → `startGen` | 过 money-safety + 对抗二审 |

### 5.3 批3 · 引擎集成

- **开工门 = #253 或其拆分后继合并**。B9 上下文桥契约（B3 第一旅程「把这个改成 9:16」依赖）已 R9 CLOSED，但 #253 合并待 R-009 founder 裁（B2 半两残余反例）；RISKS-PENDING R-009 选项 B = 拆分冻结（R9 全 CLOSED 契约先冻结合并解锁 B3/B4）。B3 引擎集成批**待此门开**。

### 5.4 批4 · tranche-2

- tranche-2 六行（B0-94/95/96/97/100/101）**取证 → addendum PR** 补录锚 + 迁级。补录前保持 `listed`（D-021）。

### 5.5 冲突磁铁四件（排队文件）

以下四件是跨工位高频冲突点，**排队串行改，禁并行**：
`packages/otto/src/parity-manifest.ts`（对等债棘轮基线）、`packages/otto/src/registry.ts`（skill 注册表）、`CATALOG.md`、`schema.prisma`。

### 5.6 每片工单模板义务

每片工单**强制**三件：
1. **本片迁移的行**（列出行 ID + 现状六级状态 → 目标状态）；
2. **每行双执行器交付物**（人工入口 + Otto skill；对等债逐条清偿，`lint:parity` 绿）；
3. **证据随写入 `B3-REPORT.md` 对应节**（§⑥全旅程/§⑦测试/§⑧schema/§⑨成本/§⑪异族评审）。

---

## 六、花钱闸

> 承 L-C §四钱路触点表（10 触点 + 六态 + gate4 诚实契约映射）。本节 = 花钱闸的验收口径与施工纪律终案。

### 6.1 账本层全真测（vitest 零真钱）

`reserve`/`settle`/`refund`/幂等/partial 只退失败格 —— **账本层全真测，零真钱**（vitest）：
- `runVariantBatch`：N 格各建独立 GenJob、各自幂等键、部分失败只退失败格；
- 幂等：同批重投递不重复下单（撞 `GenJob_active_idempotency_key`）；Retry = 新键新单不双扣；
- Trim/Crop/抽帧断言 **$0**（不 reserve、不建 GenJob）；
- Otto propose 侧零 GenJob（money-safety(b) 回归）；
- Library 真落库：工厂批量后 `getGenerationHistory` 读得到、按 `GenerationBatch` 归组。

### 6.2 供应商层（MockProvider $0 路径）

供应商层 = **E2-22 `MockProvider` $0 路径**（`GENERATION_PROVIDER` fail-safe：未设/其他值 → MockProvider，$0，离线）+ 夹具注入失败形态（②余额不足/③provider 拒/④超时/⑤partial/⑥恢复）。

### 6.3 真钱验收（只交方案不执行）

真钱验收 = **只交方案不执行**（L-C §八清单形态）；执行点 = **sandbox-verified 批次按 #254 信封或逐笔问 founder**（宪法 2：「问」就是上限）。方案清单（L-C §八①②③④）：staging 小额单张图 / 单段短视频六态②③抽验 / 2×2 矩阵 partial「3 收 1 退」/ 恢复 reaper 不双扣（$0）。

### 6.4 money-safety-review 双时点

1. **spec 期**：**扩 Step-1 符号枚举**（`runVariantBatch`/`runBulkGrid`/`refgen` 变体族入列）——**此项为独立后续 PR 义务，本 spec 只记义务不执行**（不在本 docs-only PR 内改 SKILL.md）。
2. **PR 期**：逐 spend diff 过 `money-safety-review` skill + 对抗二审（`/codex`）；批2 三工位每 PR 逐个过。

### 6.5 定价纪律

- **Quality ×1.5 倍率在毛利地板 gate（B10）闭合前不上**（宪法 5 毛利 ≥45%）；
- 报价一律 `pricedGenCredits`（credits-only，宪法 3；不搬原型硬编码 12/40/16）。

---

## 七、假设台账

> 承 L-C §九九条假设台账（A1~A9），本 spec 增补本工位新入参。逐条写「上线前如何处置」。

| # | 假设 / 待拍板 | 现状 / 风险 | 谁定 / 如何处置 |
|---|---|---|---|
| B3-A1 | **原型分支七页适配 #236 壳契约的改造量** | LC-0 工位新增；改造量在 L-C「只需接线」前提下被隐藏（§二.1） | LC-0 工位**实 measure 后回填**精确工时；规模上修 L→L+ 已声明 |
| B3-A2 | **Wave2/3 parity 解禁触发条件** | 裁定7=显式 TBD-B3；本波 Coming soon 不解 | 挂 harmony-03 升级票纪律；触发条件待控制面/founder 裁 |
| B3-A3 | **各 spend 触点 ≤M 分钟的 M 值** | 裁定8=TBD-B3；锚表槽位已留 | 待 costing/压测填数 |
| B3-A4 | **E1-19 A/B 分叉出处** | §四.③；现状 absent | 批1b 工单核 W-MP 审计行号；核不到转新增待裁（R-002 默认项 A） |
| B3-A5 | **B10 毛利 gate 时序（批2 前置）** | Quality ×1.5 与批量定价依赖 B10 毛利地板闭合 | **假设 B10 毛利 gate 批2 前置；若 B10 未就绪，批2 停等并上报**（不自行上倍率） |
| B3-A6 | **tranche-2 六行锚 + 钉桩** | 保持 listed（D-021）；B0-101↔E1-15 关系（§四.⑥）、B0-96 多机位细化（裁定10）、B0-97 肖像授权边界未钉 | 批4 取证 addendum 落判 |
| B3-A7 | **LC-a~LC-g 前端接线依赖 LC-0** | 无壳无从接线（§二.1） | LC-0 落 main 后各片方可接线；顺序纪律入批次表（§五） |
| — | L-C 原 A1~A9（Quality 倍率/Design B 首落/canvas 迁移/Stitch 意图/口播选型/工厂编辑工具/相似度历史比对/legacy retire/风格卡模板） | L-C §九原文 | **引用采纳**，不复述；处置照 L-C §九 |

---

## 八、冻结条件与状态

- **状态：冻结候选（freeze candidate）v0.1。** v0.1 骨架（本稿）= 装配 W-DELTA + W-ANCHOR + 控制面 10 裁定 + 六钉 + LC-0 规模上修 + 五工位/三工位批次表。
- **冻结门 = 四权闭环**（#254 §一.2）：双顾问签核 + 异族复审（`/codex` 对抗）+ 机器闸（`route-b-matrix-check.mjs`）+ 非作者合并。放行后：
  - **03-B3 主 tranche 40 行随冻结 PR 迁 `spec-ready`**（本 PR 不迁）；
  - **tranche-2 六行待 addendum**（保持 listed，D-021）；
  - founder 终验一次过审计索引（#254 §一.3/§二.5）。
- **账行提案**（随本 PR 描述 + 下次 ledger-sync）：
  - D-02X · B3 块 spec v0.1 交付（冻结候选，走四权闭环）；
  - E1-06 勘误：03-B3.md:12「7cr 固定价」→「16cr（现值 `spend.ts:89`），定价终案挂 B12」；
  - E1-14 措辞勘误：「不在主导航仅深链」→「nav 配置存在（`immersive-nav.tsx:115`）、`assets/*` 路由未建（死链）」；
  - GenerationBatch 行号引用刷新 `schema.prisma:954→:961`。
- **本 spec 不自称已冻结**；冻结实质决策入 `DECISION-LOG.md`，终验重现。

---

**结尾**：本 spec 为装配件，L-C 施工图为主体（引用采纳），W-DELTA/W-ANCHOR 为取证基线。**最高优先级修正 = LC-0 壳落地**（原型七页不在 main，「只需接线」前提不成立，规模 L→L+）。**钱路警告**：本区是全城最重 spend path，10 个真花钱触点全收敛唯一 gen 链（零新钱路），批2 spend 三工位逐个过 `money-safety-review` + 对抗二审；一切真实供应商验证花费**逐笔问 founder，"问"就是上限**（宪法 2）。与上位法冲突 = 停在该项报告，不自裁。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
