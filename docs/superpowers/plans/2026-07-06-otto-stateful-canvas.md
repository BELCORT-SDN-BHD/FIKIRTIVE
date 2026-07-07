# Otto → Grok 式「有状态画布」改造 · 分期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实施。步骤用 `- [ ]` 复选框跟踪。
> **本文是工程执行计划;创始人版的分期概览见对话 / 桌面 `FIKIRTIVE-Grok化-逻辑说明.md`。**

**Goal(北极星,不变):** 把 FIKIRTIVE(Otto)的整个操作范式从「聊天为主」翻成 Grok Imagine 式「**画布为主 · 有状态**」——无限画布 = 主场(蓝图已称 canvas-as-home),每个产物 = 画布上持久、可选中、可就地反复迭代的对象,选中即在其脚下贴出「Type to imagine」+ 工具条原地进化,Otto 聊天退为编排侧栏。**功能不变,只换流程/交互范式。**

**Architecture:** 复用现有 React Flow(`@xyflow/react`)画布与 `CanvasNode` 表,不换引擎、不新造 spend 路径。改造集中在交互层(选中→贴附输入框→就地迭代)与"把散卡片拢成活的画布文档"。聊天生成经 `syncOttoCanvasNodes` 桥接落回画布的链路保留。

**Tech Stack:** Next.js(`apps/web`)+ React Flow v12 + Prisma(`packages/db`)+ pg-boss worker(`apps/worker`)+ fal provider。生成唯一入口 `startGen`(`apps/web/lib/gen-actions.ts`)。

---

## Global Constraints(每个任务都隐含遵守 —— 创始人已拍板)

- **视频**:保留花费确认弹窗(完整审批),不变。
- **图片**:直接出、无确认弹窗。合宪法**例外①「余额即闸」**:生成动作=审批 + 余额为硬闸 + 失败退款 + 重试防双扣。**不改蓝图**;PR 里注明"图片直出 = founder 2026-07-06 拍板走例外①",防被当 bug 改回。
- **默认图片只出 1 张**(显式要多张才多张)。
- **不碰 `startGen` 钱路**;建卡/移动/就地迭代布局全部 display-only、不花钱;整套 diff 过 `money-safety-review`。
- **Otto 对等**:一期先做人工界面;Otto 等价能力作为紧随的 fast-follow,一期即登记为 parity 债务(todoSkill),避免 CI 对等检查误判。
- **合规边界**:改的是"创作产物画布"(蓝图 O-09 允许),**不是**"拖节点搭自动化流程"(撞 O-09 + 宪法第 8,须停手报告)。
- **交付纪律**:走新分支 + PR,**绝不直推 main**;CI 三 job(check/web-build/test)全绿才可合并;涉及新花费点先过 costing + 毛利地板 ≥45%。

---

## 分期总览

| 期 | 名称 | 一句话 | 交付即验证 |
|---|---|---|---|
| **Phase 0** | 校准(动工前) | 核实 3 个有争议/关键的代码事实,让计划建立在事实上 | 3 条结论各有代码出处 |
| **Phase 1** | 画布成主场 + 卡脚就地续写(MVP) | 画布当主场;选中卡脚下就地续写;图直出/视频确认;默认 1 张 | 真机走查通过 + CI 绿 + money-safety 过 |
| **Phase 2** | 有状态深化 | 版本谱系树、图↔视频原地编辑、@Image N、Otto 对等还债 | 卡片能翻历史版本 + Otto 就地改 + 对等检查过 |
| **Phase 3** | 追平 Grok 高光 + 规模(costing 先行) | 并行多镜头、全屏再生成、(按需)轮询→推送、性能 | 并行多片落位 + 大量卡片流畅 |

---

## Phase 0 — 校准(pre-flight,读代码为主,不改功能)

**为什么先做**:对抗性复查发现两处"方案乐观结论"建立在对现有代码的误读上;动工前必须以代码为准核实,否则一期会改错方向。

**Files(只读核实):**
- `apps/web/lib/canvas-actions.ts`(`resolveCanvasNode`)、`apps/web/lib/otto-canvas-bridge-core.ts`(`canvasNodeDisplayStatus`)、`packages/db/prisma/schema.prisma:1029`(`CanvasNode`)
- `apps/web/components/canvas/useCanvasGen.ts`(`generateImage` 的 `count`/sibling/`sourceNodeId`)
- `apps/web/lib/otto-canvas-bridge.ts`(`syncOttoCanvasNodes`)+ 三处轮询(gen 2.5s / activity 4s / 在途 5s)

- [ ] **0.1 卡片状态真相**:`resolveCanvasNode` 完成时到底写不写真实终态(done/failed/timeout)?`canvasNodeDisplayStatus` 是 bug 还是刻意的最终一致性自愈层?→ 结论(文件:行)决定"状态说真话"这条一期任务**要不要做**。
- [ ] **0.2 图片扇出真相**:一次 `generateImage` 是否 `count=4`?sibling 卡带不带 `sourceNodeId`?改默认 1 张的影响面(计费、UI、桥接)?→ 结论决定"就地迭代以哪张为源"的规格。
- [ ] **0.3 桥接真相**:`syncOttoCanvasNodes` 在"画布主场"下怎样、何时、以什么状态把 Otto 聊天生成的产物落到画布?轮询延迟与"活画布"体验的张力有多大?→ 结论决定一期桥接是否需要动。
- [ ] **0.4 产出**:一页《事实核实结论》,据此**定稿 Phase 1 的逐任务 TDD 计划**(在本文件追加 Task 级细化)。

**成功判据**:0.1/0.2/0.3 各有明确结论 + 代码出处;Phase 1 详细任务据此可无假设地写出。

### Phase 0 结论(2026-07-06 · 已读代码核实,有出处)

**0.1 卡片状态 — 结论:状态已说真话,一期不碰(删一个伪任务)。**
- `resolveCanvasNode`(`apps/web/lib/canvas-actions.ts:191`)轮询完成时写**真实终态** `{status, generationId}`,status ∈ {done,failed,timeout,missing}(:26)。
- `canvasNodeDisplayStatus`(`apps/web/lib/otto-canvas-bridge-core.ts:47`)是读时纯展示推导;`settledCanvasNodeRepairPatch`(:106)+ listCanvasNodes 修复环(canvas-actions.ts:51–131)是**故意的最终一致性自愈**(注释 :123 明写"浏览器提前离开时补回 sibling 卡"),非 bug。
- ✅ 批判 agent 对、勘察 agent"状态常年 pending"是误读。**一期删掉"修状态"这个伪任务。**

**0.2 图片 4 变体 — 结论:确为 count=4、sibling 无 sourceNodeId;默认改 1 干净。**
- `generateImage`(`apps/web/components/canvas/useCanvasGen.ts:112`)一次 `count: IMAGE_VARIANT_COUNT`(=`CANVAS_IMAGE_VARIANT_COUNT`,`@/lib/canvas-gen-costs`);sibling 卡(:150)创建时**不带 sourceNodeId**;count 是经 `startGen` 的计价/闸/上限参数(:11 注释"charge scales by count")。
- ✅ 默认改 1 = 把 `CANVAS_IMAGE_VARIANT_COUNT` 设 1(spend-adjacent,过 money-safety)。**count=1 时只有一张卡,"就地迭代以哪张为源"的歧义自动消失** —— 创始人"默认 1 张"正好填平这坑。

**0.3 桥接 — 结论:桥接照常,一期基本零改。**
- `syncOttoCanvasNodes`(`apps/web/lib/otto-canvas-bridge.ts:89`)扫每条 thread 的 GEN_CARD/GEN_RESULT + GenJob,为聊天产物 `createCanvasNode`(:149,display-only 不花钱),返回全项目节点带 URL(:188)。
- 轮询:gen 2.5s(useCanvasGen:61)+ activity 4s(OttoApp:241)+ 在途 5s(FlowCanvas:594);纯轮询无推送。
- ✅ "画布主场"是布局/默认改动,不是桥接重写(T7 基本零改);轮询→推送是 Phase 3。

**对 Phase 1 的净影响:** 删 1 个伪任务(修状态);"默认 1 张" = 一处 `CANVAS_IMAGE_VARIANT_COUNT` 改动(过 money-safety);桥接零改。**一期心脏收敛为三件:① 画布当主场 ② 选中卡脚贴附续写框(图直出/视频确认)③ 默认 1 张。**

---

## Phase 1 — 画布成主场 + 卡脚就地续写(MVP · 一期心脏)

> 详细逐任务 TDD 步骤在 Phase 0 结束后追加(依赖 0.1–0.3 结论,不预写臆测代码)。以下为已确定的任务骨架与文件。

- [ ] **T1 · 画布当默认主场**:`apps/web/components/otto/OttoView.tsx` —— 进项目默认聚焦画布;聊天 pane 可折叠(复用现有 `clamp(360px,38%,520px)` 折叠机制)。**成功判据**:进项目首屏即画布,聊天可收起/展开。
- [ ] **T2 · 卡脚贴附「Type to imagine」输入框**:`FlowCanvas.tsx` + `nodes/ImageNode.tsx`/`VideoNode.tsx` 的 `NodeToolbar` —— 选中卡片时在其脚下浮出续写输入框(复用现有 `confirmGen`→`handleGenerate` 链路)。**成功判据**:选中任意卡片,脚下出现输入框,随卡片移动。
- [ ] **T3 · 就地迭代生成 + 谱系线**:提交续写 → 走 `useCanvasGen`(以选中卡为源,写 `sourceNodeId`)→ 新版并排落位并连一条谱系边。源卡选择规则依 Phase 0 的 0.2 结论。**成功判据**:选中一张图,输入"换夜景",新图并排 + 有连线回母卡。
- [ ] **T4 · 图直出 / 视频保留确认**:续写提交时,`kind=image` 走直出(跳过 `confirmGen` 对话框,余额即闸);`kind=video` 保留现有 `confirmGen` 对话框。**成功判据**:图无弹窗、视频有弹窗;失败退款、重试不双扣仍在。**过 money-safety-review。**
- [ ] **T5 · 图片默认 1 张**:`useCanvasGen.ts` 的 `IMAGE_VARIANT_COUNT` 相关 —— 默认 `count=1`,显式要多张才 4。**成功判据**:普通生成出 1 张;计费按 1 张。**过 money-safety-review。**
- [ ] **T6 · 工具条基础对齐 Grok**:各 `NodeToolbar` 在现有 Detail/Make video/✕ 上补下载/复制等常用键(抽帧/裁剪/拼接留二期)。**成功判据**:选中卡工具条含基础操作。
- [ ] **T7 · 桥接在主场下照常**:确保 `syncOttoCanvasNodes` + activity 轮询在"画布主场"布局下仍把 Otto 聊天生成的产物落画布(依 0.3 结论,可能零改动)。**成功判据**:聊天里让 Otto 出图,产物仍落画布。
- [ ] **T8 · Otto 对等债务登记**:登记就地续写对应的 Otto skill 为 parity 债务(todoSkill),让 CI 对等检查放行。**成功判据**:CI parity 检查通过。

**Phase 1 交付即验证(真机走查,创始人可亲验)**:选中图→脚下"换夜景"→无弹窗出新图并排+连线;选中视频同操作→弹确认;图一次 1 张;聊天让 Otto 出图仍落画布;`startGen` 钱路 diff = 0;CI 三 job 绿;走 PR 不直推 main。

---

## Phase 2 — 有状态深化

- [ ] 版本谱系树 UI(看一张卡的历代版本;可能需 lineage 字段回填迁移 → 走 schema-drift 闸)。
- [ ] 图↔视频原地编辑:Extract Frame(抽帧成图)、Trim(改时长 —— **先核实 Trim 是否触发重渲染=新花费点**,是则过 money-safety + costing)、按需 Stitch。
- [ ] `@Image 1/2…` token:chat 显式引用画布对象(升级现有 canvas-chat-reference)。
- [ ] 生成状态多处镜像(右上进度胶囊 + 卡片% + 聊天缩略图同步)。
- [ ] **Otto 对等还债**:新写"改选中这张卡"的 Otto skill + 上下文桥("这张/选中的"能被解析),走同一 action。

**成功判据**:能在一张卡上翻看/回到历史版本;视频能原地抽帧成图、改时长;Otto 能就地改选中卡且 CI 对等检查过。

---

## Phase 3 — 追平 Grok 高光 + 规模(待定,costing 先行)

- [ ] 并行多镜头批量生成(Grok 的 Meta 广告主线高光场景)。
- [ ] 全屏查看器再生成(改时长 6s/10s、分辨率 480p/720p)。
- [ ] **按需**评估:轮询(2.5s/4s/5s)→ 推送(WebSocket),支撑"活画布"实时感与多卡并行。
- [ ] 画布文档聚合层 + 大量卡片性能。

**成功判据**:一次并行生成多条候选广告片在画布同带落位;大量卡片下画布仍流畅;凡新花费点先过 costing + 毛利地板 ≥45%。

---

## Self-Review(对照约束核对)

- **钱路**:T4/T5/Phase2-Trim 是唯一触及 spend 的点,均标注过 money-safety-review;`startGen` 本身不动。✅
- **合规边界**:全程限定"创作产物画布",未涉及"用户拖节点搭自动化流程"。✅
- **对等义务**:Phase1 登记债务、Phase2 还债,CI 对等检查不被绕过。✅
- **未决依赖**:Phase 1 的 T3 源卡规则、T7 桥接改动量、"状态说真话"是否要做,均显式挂在 Phase 0 的 0.1–0.3 结论上,不预写臆测代码。✅
