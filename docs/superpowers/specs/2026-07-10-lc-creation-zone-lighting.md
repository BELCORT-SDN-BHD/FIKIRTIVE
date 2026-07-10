# L-C 创作区点亮施工图 —— 北极星城 immersive 创作区七页原型接真后台(spec)

> **性质**:施工图层(蓝图金字塔最下层)。把 immersive 创作区的七页原型 UI 接上**已存在的真生成后台**,让「贴产品 → 想图/出视频 → 批量出可投成片 → 落 Library → 进排期」这条创作闭环第一次在真账本上跑通。这是点亮系列里**规格最高的一张**:创作环是 R5 走城判词里 founder **唯一"能接受"的区**,也是「每环最强」宪法级条款的第一战场。
> **立项依据**:founder 2026-07-10 亲令(走城判词:immersive 创作区是唯一能接受的区,直接点亮)。混合上市模式(MEMORY「混合上市模式 2026-07-09 拍板」):**原型全城=产品的完整形态;immersive 原型接手为产品壳;点亮 = 原型 UI 接真后台,不是另做一套**。
> **走的缝**:记账缝(`docs/review/EXPANSION-SEAMS.md` Seam 3,reserve→settle/refund)+ 生成缝(Seam 2,provider/model)+ 队列缝(Seam 6,gen/render worker)+ 设计缝(Seam 7,.gb + coral 只属 Otto)+ Otto 技能缝(Seam 1,让 Otto 能驱动创作)+ Parity(Seam 9,每个动作出生即登记)。
> **状态:待 founder 过目后动工。本文件只是图纸,不含任何代码。** 本 spec 是**点亮令牌 L-C**,与 L0(量测原语)/L1(发布链)同级,插在 L0 之后(创作是第 1 环,L1 发布是第 2 环)。
> **基线**:origin/main @ #216(8de50a2d)= 真后台;原型面 = origin/claude/northstar-immersive @ 896419e1(第四闸修复舰队 gate4 收尾)。
> **钱路警告**:本区是全城**最重的 spend path**。凡触及 `startGen`/`genRequest`/批量编排/幂等键的施工 diff **逐个必过 `money-safety-review` skill**(§四逐触点标注)。任何真实供应商验证花费**逐笔问 founder,"问"就是上限**(宪法 2)。

## 名词对照(人话)

| 术语 | 人话 |
|---|---|
| 点亮(lighting) | 把原型的"假按钮"接上真后台,让它真能干活;不是重画 UI,是给现成 UI 通电 |
| 原型壳 / 真后台 | 原型壳 = 用户看到的漂亮界面(immersive 七页);真后台 = 已经写好的生成引擎(gen 链 + 账本 + worker)。点亮 = 把两者焊起来 |
| gen 链(spend path) | 花钱生成一张图/一段视频要走的那条唯一管线:`genRequest`(验货闸)→ `startGen`(下单+扣预留)→ 幂等键(防重复下单)→ provider(真调 fal/BytePlus)→ `reserve/settle`(先冻结后结账)|
| reserve → settle → refund | 「先冻钱、成功才真扣、失败自动退」三步:下单时冻结 credits(reserve),生成成功结账(settle),失败或没交付就退回(refund)。这就是"状态诚实"铁律的账本形态 |
| 幂等键(idempotencyKey) | 每次下单带的唯一编号;同一个编号只会下一次单、只扣一次钱。防"点两下扣两次"、防 worker 重投递双扣 |
| 六态 | 一次花钱生成的六种结局:成功 / 余额不足 / provider 拒 / 超时 / 部分成功(批量矩阵半数失败)/ 恢复(worker 崩了结局不明)。**每一态都得先设计好账本怎么走,才动工** |
| 第四闸(gate4)诚实契约 | 原型层刚被"第四闸修复舰队"改对的一批钱数诚实行为(报价=预留=结账三数一致 / 失败即退还看得见 / Library 真落库 / 批量半数失败只退失败的)。**这些是原型对用户的承诺,真后台点亮时必须逐条兑现** |
| 能力运行时(Design B) | R4 采纳的 Otto 终局架构:UI 按钮和 Otto 调**同一个 typed handle**(比现在的 defineOttoSkill 更彻底的单一动作层)。裁定是"随点亮逐区落地,不做一次性大重写"——本区是否第一个落它 = §七决策项 |
| GenerationBatch | 真后台**已存在**的对象(schema.prisma:954):把一批一起生成的成片归组。工厂的 variant 矩阵/bulk 网格正好挂它 |
| 变体矩阵 / bulk 网格 | 工厂的两种批量出片:矩阵 = 一个 brief × N 个投放位 × N 个钩子;bulk = 行是产品、列是任务。一次点"确认批量"下 N 张单 |
| 报价 credits-only | 用户面永远只显示 credits,永不显示美元(宪法 3 铁律①);美元只在市政厅成本页(founder 的账房) |

---

## 一、目标与非目标

**目标**:
1. **让 immersive 创作区七页从"漂亮的假"变成"真能出片"。** 七页原型今天是**纯客户端 mock**(`setTimeout` + 一个内存单例 store `immersive/_store.ts`,零 server action);真后台的 gen 链/账本/worker **早已存在且久经加固**(#129/#191)。点亮 = 把七页的每个花钱按钮接到 `startGen` 那条唯一钱路,一颗新钱路都不新造。
2. **每环最强不许降格(宪法级)。** 创作环完成标准 = 对标 Grok Imagine canvas / Canva / Higgsfield 的第一线体验(§六第一性分解);我们赢在**品牌记忆 + Otto 全驱动 + 直通排期**,差在哪要补写进假设台账。**"先通圈"不是降格的借口**(§〇点七一板块一验证协议 + 每环最强条款)。
3. **钱路诚实是底线。** 第四闸刚在原型层修对的诚实行为(报价三数一致 / 失败即退 / Library 真落库 / 批量 partial 退款 / 先问后花)**逐条映射成真账本行为**(§四),不许点亮后倒退回"乐观当成功"。
4. **双模照旧(宪法 7)。** 每页每动作走**单一动作层**:UI 按钮和 Otto skill 调同一个 server action。创作区今天是 Otto 的**最大 parity 债窝**(canvas 全套 + `startRefGen` 假 parity + storyboard 编辑 + 上传/渲染全是 `todoSkill`)——点亮同时把这些债按 Seam 1 清偿(§三)。

**非目标(明确不做,防越界)**:
- **不重画 UI、不另起一套。** 混合上市定律:原型即产品形态;点亮只接线,不改设计(除非 §四发现原型的**钱数不诚实**必须改正,如媒体编辑 Trim 收 12 credits 而真管线是 $0 ffmpeg —— 见 §四.G)。
- **不建 Wave 2/3 的能力。** 口播/lipsync/TTS、多语配音、Ad Reference 逆向、选角库训练版 —— 这些是 harmony-03 Wave 2/3,**本期无后台即诚实 Coming soon**,进假设台账(§五),不在 L-C 承诺内。
- **不碰定价数字的最终拍板。** 报价一律走真后台的 `pricedGenCredits`(`packages/core/src/spend.ts`),**不搬原型里硬编码的 12/40/16**;Quality 档 ×1.5 倍率必须 **costing 先行**(宪法 5 毛利地板 ≥45%)才能上(§七决策项)。
- **不动 /otto 现有画布的数据。** #191 canvas 是真后台的 canvas 种子,本 spec 论证的迁移路径见 §二.8(决策项)。

---

## 二、接管战略(七页逐页判 + 导航归属 + 迁移路径)

> **总纲**:七页分三类 —— **A 类(真后台已在,直接接线)** / **B 类(后台部分在,接现成 + 缺口 Coming soon)** / **C 类($0 页,轻接线或诚实占位)**。判据 = 混合上市的「连后台即成品标准」:能接的接真的,接不了的诚实 Coming soon 并进假设台账,**永不留假按钮**。

### 七页判词表

| 页 | 原型渲染自 | 类 | 真后台现状 | 点亮判词 |
|---|---|---|---|---|
| **canvas** | `components/northstar/create/canvas-page.tsx`(2248 行,与 legacy 共用) | **A** | **强重叠**:`FlowCanvas.tsx` + `useCanvasGen.ts` + `canvas-actions.ts`(6 个 $0 节点 CRUD)+ gen 链全在(#191) | 接真后台:原型 canvas UI(三模式 composer 图/视频/agent + A/B + stitch + 对象即公民)接 `canvas-actions` + `startGen`;**superseded /otto 里的 #191 画布**(§二.8 迁移) |
| **factory** | `components/northstar/immersive/studio-factory/studio-factory.tsx`(1135 行) | **B** | **无 factory/studio 后台**;但零件全在:产品建档(draft)+ gen 链 + 多参考图人设(#92)+ 品牌记忆 + **GenerationBatch 对象已建**(schema:954) | 本期建**编排层**:variant 矩阵/bulk 网格 = 对 `startGen` 批量下单 + 挂 `GenerationBatch`;3 无口播模式/风格卡 = 本期建;口播/编辑工具/预检打分 = Coming soon(§五) |
| **home** | `studio-factory/studio-home.tsx` | **C**($0) | 无专属后台;composer→canvas 是导航;模板/发现是读面 | 轻接线:composer 落 canvas 真下单;「Build brand from a link」接 `ingestProductFromUrl`(已在,$0);模板/发现接真读面或诚实占位 |
| **ideas** | `studio-factory/studio-ideas.tsx` | **C**($0) | 无 idea 对象;Otto suggest 无 skill | 轻接线:idea 落一个小 owner-scoped 对象(或复用 thread 草稿);「Suggest 3 ideas」配 free skill;$0 页无钱路 |
| **storyboard** | `studio-factory/studio-storyboard.tsx`(716 行) | **B** | **部分在**:`storyboard-actions`($0 CRUD)+ `storyboard-gate1-actions`(真·帧→i2v 管线,走 gen 链) | 接 gate1 真管线:Make-all/Retry 走帧→视频;多语配音/coherence/audio-driven = Wave 2 无后台 → Coming soon(§五) |
| **media-editor** | `components/northstar/create/media-editor-page.tsx`(共用) | **A** | **在**:`actions.ts` 的 `saveProjectEdit`/`startRender`/`startCaption`/`getEditorMedia`(timeline 编辑,**$0 ffmpeg/whisper**) | 接真编辑器:Crop/调整/Trim/抽帧**全 $0**(路由 render/caption 管线)。**⚠️ 原型 Trim 收 12 credits 是钱数不诚实,点亮时改回 $0**(§四.G) |
| **asset-viewer** | `components/northstar/create/asset-viewer-page.tsx`(共用) | **A/B** | 续拍/重生成 → gen 链(在);Add to campaign $0;Library 读面在;Share 审批闸 | 接线:Continue/Regenerate 走 `startGen`(paid);Add to campaign $0;Share 走审批闸(external write) |

### 两个原型家族的关系(接管前必须搞清)

- `components/northstar/create/*` = 旧的 pre-immersive 家族;它的 `factory-page`/`home-page`/`ideas-page`/`storyboard-page` **只被 legacy `/northstar/create/*` 路由用,immersive 区不渲染**。
- `components/northstar/immersive/studio-factory/*` = immersive 原生重建(第四闸诚实修复落在这里)。
- immersive `/northstar-immersive/create/*` 七路由**混搭**:canvas / media-editor / asset-viewer 三重件**与 legacy 共用同一份**(create/ 家族);home / ideas / factory / storyboard 用 studio-factory 家族的新件。
- **点亮只认 immersive 路由实际渲染的那一份**(见判词表"原型渲染自"列)。legacy `/northstar/create/*` 不在本 spec 范围,点亮后择机 retire(进假设台账)。

### 导航归属

原型导航(`immersive-nav.tsx`)= 左侧栏可折叠分组 + 一个 INK「Create」主按钮。**创作区 = "Studio" 分组**(5 子项:Canvas / Storyboard / Factory / Ideas / Create home)+ INK「Create」→ canvas。media-editor 与 asset-viewer **不在侧栏,是深链目的地**(从 canvas 对象「全屏」/「Trim」跳入,`?asset=<id>`,`force-dynamic` + Suspense 兜 `useSearchParams`)。
- **点亮后 Studio 分组 = 产品的真实创作区**;INK「Create」= 免费创作画布的家(对齐宪法 11 canvas-first)。
- 导航结构**不改**——点亮只让每个 `<Link>` 后面的页真能干活。

### 迁移路径(#191 canvas 与 3 个真实用户的过渡)

- **现状**:真 canvas(#191)挂在 `/otto`(`OttoView` 里的 `.otto-canvas-pane`),**没有独立 `/canvas` 路由**;原型 canvas 在 `/northstar-immersive/create/canvas`。二者是**两套 UI、一套后台**(canvas-actions + gen 链)。
- **过渡策略(决策项 §七.D3)**:immersive canvas 是"每环最强"目标 UI,#191 是后台种子。三选一:
  - **(a) feature flag 灰度**:immersive 创作区整体挂 env/owner flag;3 个真实用户先留 `/otto`,immersive 达 parity 后逐户翻;**荐**(安全 > 效率,MEMORY「上市冲刺」3 用户体验差评,过渡要稳)。
  - (b) staged 双活:两路由并存一段时间,数据同一后台(canvas-actions 已 owner-scoped,天然同库),用户自选。
  - (c) 硬切:immersive 达标即把 `/otto` 画布指向 immersive 壳。风险最高,不荐。
- **Otto 归位**:宪法 11「canvas-first + Otto 常驻不抢占主场」——点亮后 Otto 从"画布宿主(/otto)"退为**常驻 dock/边栏**(R2 注意力面契约),画布回归主场。这与 §二.8 迁移同一件事。

> **§二.8 一句话**:本区点亮 = 让 immersive 七页壳成为产品的真实创作体验,#191 canvas 的后台被复用、其 /otto 宿主形态被 immersive 壳 superseded;迁移走 feature flag 灰度,3 用户零断供过渡。

---

## 三、接线图(每页动作 ↔ server action ↔ Otto skill —— Parity 登记表)

> **铁律(宪法 7 + Seam 9)**:UI 按钮与 Otto skill 调**同一个** server action,**禁止原型层长出第二套业务实现**。每个动作出生即登记 parity(配 skill / 四类豁免之一 / `todoSkill` 债),CI(`pnpm lint:parity`)硬拦。创作区今天是最大 parity 债窝——点亮**顺带清偿**(Seam 1 六处登记)。

### 3.1 现有动作层(直接复用,禁重造)

| 面 | server action(已在 main) | 触钱? | 现 parity |
|---|---|---|---|
| gen 下单 | `gen-actions.startGen(raw)` | **是** | → `generate` skill ✅ |
| cowork 下单 | `cowork-actions.coworkGenerate(raw)` | **是** | → `generate` skill ✅ |
| 参考图生成 | `refgen-actions.startRefGen` / `dispatchVariantJob` / `createVariant` / `regenerateVariant` | **是** | `startRefGen` 现 **假 parity**(挂 `describeRefs` 读 skill,实际是花钱写)→ **本 spec 补真 skill**(§五缺口) |
| 画布节点 | `canvas-actions.{list,create,move,updateText,resolve,delete}CanvasNode` | 否($0) | 5 个 `todoSkill` + `moveCanvasNode` VISUAL 豁免 → **本 spec 配 skill** |
| 产品建档 | `product-ingest-actions.ingestProductFromUrl` | 否($0 确定性) | → `ingestProduct` skill ✅ |
| 分镜 CRUD | `storyboard-actions.{editShotPrompt,addShot,deleteShot,reorderShots}` | 否 | `addShot`→`proposeStoryboard` ✅;其余 `todoSkill` |
| 分镜→视频 | `storyboard-gate1-actions.{prepareStoryboardFirstFrames,prepareStoryboardVideos,regenShot*}` | **是** | → `proposeStoryboard` ✅(spend 经 gen 链) |
| timeline 编辑 | `actions.{saveProjectEdit,startRender,startCaption,getEditorMedia}` | 否($0 ffmpeg/whisper) | `todoSkill` → 本 spec 配 skill |
| 品牌记忆 | `brand-record-actions.{listMyBrandRecords,saveBrandRecord,...}` | 否 | list/save→`lookupProducts`/`saveProduct` ✅;del/restore `todoSkill` |
| Library 读 | `library-actions.getGenerationHistory` + `data.*` 读面 | 否 | 多为 `todoSkill`(读对等债) |

### 3.2 逐页动作接线(每行 = 一个 UI 按钮 → 一个真 action → 一个 skill)

| 页 · 动作 | server action | Otto skill(Parity) | $0/spend |
|---|---|---|---|
| **canvas** · 想图(type-to-imagine / 空布首图) | `startGen`(kind=image) | `generate` ✅ | spend |
| canvas · Make Video(i2v/t2v) | `startGen`(kind=video,sourceGenerationId) | `generate` ✅ | spend |
| canvas · A/B 对(count=2) | `startGen`(count=2) | `generate` ✅ | spend |
| canvas · 就地编辑(instruct edit) | `startGen`(source=当前图) | `generate` ✅ | spend |
| canvas · Stitch 两视频 | **决策**(§四.G:ffmpeg concat=$0 走 `startRender`;若 AI 转场=paid 走 `startGen`) | `generate` 或渲染 skill | 待定 |
| canvas · Agent 计划(多步 tally) | 每步 `coworkGenerate` / `startGen` + 报价页 | `generate` ✅(origami 7-7 报价预览) | spend |
| canvas · 节点增删移/命名/反馈/选择 | `canvas-actions.*` | **新 canvas skill(本 spec 建)** | $0 |
| **factory** · 确认批量(variant 矩阵) | **新 `studio-batch-actions.runVariantBatch`**(内部对 N 格调 `startGen`,挂 `GenerationBatch`) | **新 `runFactoryBatch` spend skill** | spend |
| factory · Run bulk 网格 | 同上(行×列 image 格下单;text 格 $0) | 同上 | spend |
| factory · Retry 单格 | `startGen`(新幂等键 = 新格)| `generate` | spend |
| factory · 生成钩子 / Learn voice / Facts source / 预检 / 改受众 | `$0` 确定性 / 读面 | 新 free skill(propose 类) | $0 |
| factory · 锁产品(money-shot) | `refgen`/entity 锁 base(已在) | `describeRefs`/新 skill | $0 |
| **home** · composer 提交 | 落 canvas → `startGen`(在 canvas 确认) | `generate` | spend(延到 canvas) |
| home · Build brand from a link | `ingestProductFromUrl` + `saveBrandRecord` | `ingestProduct` / `saveProduct` ✅ | $0 |
| home · 模板/工作流/发现 | `data.*` 读面 | 读 skill(读对等债) | $0 |
| **ideas** · 增/删/转画布 | **新 idea 对象 CRUD**(或复用 thread) | 新 free skill | $0 |
| ideas · Suggest 3 ideas | Otto propose | 新 free `proposeIdeas` skill | $0 |
| **storyboard** · Draft scenes / 改脚本 / 预览 animatic | `storyboard-actions.*`(在) | `proposeStoryboard` ✅ | $0 |
| storyboard · Make all / Retry scene | `storyboard-gate1-actions.prepareStoryboardVideos` | `proposeStoryboard` ✅(spend 经 gen 链) | spend |
| storyboard · 配音/字幕/coherence | **无后台 → Coming soon**(§五) | — | (Wave 2) |
| **media-editor** · Crop/调整/Trim/抽帧 | `actions.saveProjectEdit` / `startRender` / `getFrameCandidates` | 新编辑 skill | **$0**(ffmpeg/whisper) |
| **asset-viewer** · Continue / Regenerate | `startGen`(source=当前版本) | `generate` ✅ | spend |
| asset-viewer · Add to campaign | 挂 campaign 软引用($0) | 新 free skill | $0 |
| asset-viewer · Share | 走审批闸(external write) | 审批 CTA(人声) | $0 但过闸 |

**单一动作层验证点**:工厂的 `runVariantBatch` **不是新钱路**——它是"对现有 `startGen` 循环下单 + 归组"的编排器,每格仍是一个真 `GenJob`、走同一 `reserve/settle/refund`、同一幂等/防双扣索引。**禁止工厂自建"批量扣费"逻辑**(那会绕过 gen 链的精确一次保证)。这是 §四 money-safety 的核心检查点。

---

## 四、钱路触点表(最重要 —— 六态 + gate4 诚实契约映射 + money-safety 标注)

> **全图先设计律(trial 口径)**:生成是花真钱的外部写,失败形态比读多得多。**先把六态全部设计出来**(账本状态 / UI 呈现 / 幂等 / 退款 / 重试),再谈施工。fail-closed 贯穿:**任何结局不明都不许"乐观当成功"**,宁可停在失败态自动退款,绝不静默双扣。
> **所有 spend 触点都映射到真后台已有的账本三态**:`reserveCredits`(下单冻结)→ `settleCredits`(成功结账)/ `refundReservation`(失败退还),`packages/db/src/credits.ts`,RESERVE==SETTLE 确定性定价,partial-unique 索引 `CreditLedger_finalizer_once` 保证每 ref 只结算/退款一次。

### 4.A 钱路触点清单(逐个花钱按钮)

| # | 触点 | 报价源(credits-only) | 幂等键 | 走哪条 | money-safety |
|---|---|---|---|---|---|
| 1 | canvas 想图 / 就地编辑 | `pricedGenCredits(seedream)` | 每点 `newId()`(GenSpace/canvas 现制) | `startGen` kind=image | **必过** |
| 2 | canvas Make Video | `pricedGenCredits(video model)` | `newId()` | `startGen` kind=video | **必过** |
| 3 | canvas A/B 对 | `pricedGenCredits × 2`(count=2) | `newId()` | `startGen` count=2 | **必过** |
| 4 | canvas Agent 计划(多步) | Σ 各步(报价页先示总价,origami 7-7) | 各步 `cowork:<cardId>` / `newId()` | `coworkGenerate`/`startGen` | **必过** |
| 5 | **factory 确认批量(矩阵)** | `Σ 格 pricedGenCredits`(×Quality 倍率,§七) | **`batch:<batchId>:<placement>:<hook>` 每格稳定键** | `runVariantBatch`→N×`startGen` | **必过(核心)** |
| 6 | **factory Run bulk 网格** | `Σ image 格`(text 格 $0) | `batch:<batchId>:<row>:<col>` | 同上 | **必过(核心)** |
| 7 | factory Retry 单格 | 冻结的单格价 | **新键(retry = 新格/新 job,绝不复用旧键)** | `startGen` | **必过** |
| 8 | factory 锁产品→money-shot 出片 | 单格价 | 格键 | `startGen`(conditioning) | **必过** |
| 9 | storyboard Make all / Retry scene | `Σ 场景`(帧+i2v) | `frame:<shotId>:<slot>` / `animate:<shotId>`(gate1 现制) | `prepareStoryboardVideos` | **必过** |
| 10 | asset-viewer Continue / Regenerate | `pricedGenCredits` | `newId()` | `startGen`(source) | **必过** |
| — | **media-editor Trim / Crop / 抽帧** | **$0(ffmpeg/whisper,非 spend path)** | 渲染 job 键 | `startRender`/`getFrameCandidates` | **不适用(§四.G 修正)** |
| — | canvas 节点 CRUD / home 导航 / ideas / storyboard $0 步 | $0 | — | `canvas-actions` 等 | 不适用 |

**触点计数**:**10 个真 spend 触点**(全部收敛到 gen 链,零新钱路);**2 处原型钱数需修正为 $0**(Trim 必修;Stitch 待定,§四.G);其余为 $0 页。

### 4.B 六态设计(以 canvas 单次生成为范本,批量的第⑤态见 4.C)

| # | 结局 | GenJob 状态 | 账本 | UI 呈现 | 重试策略 |
|---|---|---|---|---|---|
| ① **成功** | `QUEUED→GENERATING→DONE` | `reserve` → `settle`(worker store+commit tx 内原子结账) | 成片节点落定 + credits 余额即时下调;**Library 真落库**(见 4.D-Library) | 无(终态) |
| ② **余额不足** | 未建 job | `reserveCredits` 的条件递减 `count===0` → 抛 `InsufficientCredits`,**整个 tx 回滚,job 不建、钱不动** | 友好 OOC 卡:「余额不够,去充值」(充值走 money-in,Otto 永不代办,宪法 7 豁免) | 用户充值后重点 |
| ③ **provider 拒**(确定性硬失败) | `GENERATING→FAILED` | `spent=false` 时终态 `refundReservation`(全退) | 失败态卡 + 人话原因 + 「重试」(= 新 job 新键) | **不自动重试**(重发结果一样);人点重试 = 新键新单 |
| ④ **超时/瞬时**(网络/provider 5xx/限流) | `GEN_QUEUE_POLICY` 有限重试(retryLimit 2 + retryDelay 30s + expire 20m) | 未 `spent` 才退;重试期不动账 | 「生成中」→ 超上限失败态自动退款 | **有限退避重试**;超上限 fail-closed + 退款 |
| ⑤ **部分成功**(批量矩阵半数失败) | 见 4.C | 见 4.C(**只退失败格**) | 见 4.C | 见 4.C |
| ⑥ **恢复**(worker 崩/redelivery,结局不明) | resume-first:`generationIds` 非空→`committed=true` 补交付不重扣;空→原子 claim 失败即 fail-closed 退款 | `spent` 后**永不重试**(防双扣);committed 后 requeue 只 resume 不重花 | 短暂「生成中」→ reaper 判定后转态 | **reaper**(`reapStaleGenJobs` 5 分钟扫)+ 「spent 即不重试」铁律 |

> 六态**不新增机制**——真后台的 `handleGen`(`apps/worker/src/jobs/gen.ts`)已把 `spent`/`committed` 双标志、"spent 后不重试"、store+commit 原子结账、resume 短路、四类 reaper(gen/refgen/llm/research)全部实现并测过。本 spec 的职责 = **让工厂的批量编排层继承这套保证,而不是绕过它**。

### 4.C 第⑤态 —— 批量矩阵部分成功(gate4「bulk 失败退款」的真账本落地)

工厂矩阵/bulk = **N 个独立 GenJob,各自一把稳定幂等键、各自 reserve→settle/refund**。部分成功时:
- **每格独立结算**:成功格 `settleCredits`,失败格 `refundReservation`。**只退失败格,成功格照收**——对齐 gate4「X of Y placements rendered / the failed placement was refunded / charged = rendered × perCell」。
- **text 格永远 $0**:bulk 网格里翻译/文案类 text 格不建 GenJob、不 reserve,天然 $0(对齐 gate4「only image jobs cost/fail, text jobs are free」)。
- **退款幂等**:每格退款经 `CreditLedger_finalizer_once`(一 ref 一 finalizer)+ 各自 refId,**天然对齐 gate4 的 `refundedRef` Set「每格只退一次」**(原型用内存 Set 防 StrictMode 双跑;真后台用 DB 唯一索引,更硬)。
- **Retry = 新格新键**:重试失败格 = 一个**新 GenJob、新幂等键**,按原冻结单价重新 reserve。**绝不复用旧键**(复用旧键会撞 gen 链的"同键只下一次单"→ 静默不下单或误判已付)。对齐 money-safety(c)「retry = a new card, never a silent re-charge」。
- **批量总价确认页(硬性,MASTERPLAN 7-3 A2)**:确认批量前显示总价(复用 PackCard 模式,宪法 3 计费透明);**报价 = 预留 = 结账**三数一致(见 4.D)。

**批量编排的 money-safety 死线**(施工必写进 `runVariantBatch` 注释):
1. 编排器**只调 `startGen`**,不自己 `reserveCredits`/建 GenJob/调 provider —— 单一钱路。
2. 每格幂等键**稳定且唯一**(`batch:<batchId>:<cell>`),同批重投递不重复下单。
3. 一格失败**不影响其他格**(无跨格事务耦合);批量非原子,逐格 fail-closed。
4. `GenerationBatch` 只做**归组软引用**(nullable,无 FK,house 惯例),不持有钱字段、不参与结算。

### 4.D 第四闸诚实契约 → 真账本行为(逐条映射)

| gate4 原型诚实行为 | 原型实现 | 真账本兑现 |
|---|---|---|
| **Quality 档三数一致**(报价=预留=结账) | `tierCredits(base,tier)` 算一次,同一数传 `onConfirmTier→runBatch` | 真后台 **RESERVE==SETTLE 确定性定价**(credits.ts:settle 从 RESERVE 行读冻结额,**永不在结账时重新定价**)。Quality 倍率必须在 `genRequest` 定价一次性算入,quote/reserve/settle 同数。**天然对齐** |
| **失败即退,看得见** | `refundCredits(n,label)` 加回余额 + 写可见 ledger 行「Refund · …」 | 真后台 `refundReservation` 写 **REFUND ledger 行**(六 kind 之一:RESERVE/SETTLE/REFUND/GRANT/ADJUST);用户 Account→Credits 明细可展开单笔。**天然对齐** |
| **Library 真落库** | 原型 `studioLogGen` 只记一条字符串,**没真落库** | 真后台 worker store+commit tx **真写 Asset + Generation 行到 R2/DB**;`getGenerationHistory` 读得到。**点亮即兑现**——工厂批量必须经 gen 链,才自动继承"真落库";Library 页读 `getGenerationHistory` 按 `GenerationBatch` 归组展示 |
| **先问后花**(冷启动不埋伏扣费) | canvas R1 空布首图改走 `SpendConfirmDialog`(24cr 先确认);Home/Ideas 生成延到 canvas 确认 | 真后台报价来自 `pricedGenCredits`,**下单前先弹确认**(对齐 origami 7-7「贵活前 brief 预检 + 报价预览」);Agent 多步先示总价再动手 |
| **批量 partial 退款** | 见 4.C(`refundedRef` Set 每格只退一次) | 见 4.C(`CreditLedger_finalizer_once` 每 ref 一 finalizer,更硬) |
| **相似度诚实化**(非钱、但诚实) | 去掉硬编码「no look-alike in last 20 posts」,改算 `distinctAngles`,脚注「proxy,不是查你历史(那要连账号)」 | 真后台**不谎报它算不出的历史去重**:未连账号时标「代理指标,非历史比对」;连账号后才用真数据 |
| **锁产品闸**(money-shot) | `MIN_LOCKED_SHOTS=4`,不足禁用「确认批量」 | 真后台 money-shot 出片前置校验:entity `baseAssetId` + 锁定参考图数达标(复用 refgen conditioning);不足 fail-closed 禁下单 |
| **取消过期钩子**(换产品清在途) | `hooksTimer` ref 清 `clearTimeout` + 重置 preflight | 真后台换主体时 `cancelGenJob`(退还 QUEUED job)+ 取消在途,**绝不把旧产品的结果交付/计费到新产品** |

### 4.E money-safety-review 触点标注(施工纪律)

**以下 diff 施工时逐个必过 `money-safety-review` skill**(Step-1 命中 = 触及 startGen/genRequest/幂等/reserve-settle):
- 工厂 `runVariantBatch`/`runBulkGrid` 编排层(**新增付费调用点,Step-1 catch-all 命中**)。
- canvas/asset-viewer 接 `startGen` 的所有客户端 hook 改动(如 `useCanvasGen` 扩展)。
- storyboard Make-all 接 `prepareStoryboardVideos`。
- 任何新幂等键格式(`batch:<>`)进 `genRequest.idempotencyKey`(须仍 `min(1).max(80)`、required、`.strict()`)。
- **前瞻义务**:动工前**先扩 `money-safety-review` SKILL.md Step-1 符号范围**,把 `runVariantBatch` 列入 spend-path 枚举(SKILL.md「前瞻义务」③"任何不经 handleGen/refgen 的新付费调用点"已预留位)。

**明确不过 money-safety(§四.G)**:media-editor Trim/Crop/抽帧(ffmpeg/whisper $0)、canvas 节点 CRUD、home/ideas 导航、品牌记忆、Library 读 —— 这些够不到 spend 符号,**不做 money-safety 表演**(SKILL.md Step-1 快速退出)。

### 4.F Otto 侧钱路对等(propose $0 / 用户点才花)

- Otto 在创作区**只 propose,不自动花**:Otto 起草 canvas 卡 / 工厂 brief / storyboard 场景全 `$0`(`propose`/`proposeStoryboard` skill,`estimatedPriceUsd` 仅展示);**唯一花钱 = 用户点「生成/确认批量」→ `coworkGenerate`/`runVariantBatch`→`startGen`**。
- 对齐 money-safety(b)「cowork agent path creates NO GenJob / never spends」:Otto 回合/propose 侧零 GenJob、零 provider 调用。
- 审批数学:生成 = `cost=spend` → `needsApproval=true`,**没有旁路**;审批 = 用户亲点确认页(花钱前必审批,宪法 3 铁律②)。

### 4.G 钱数不诚实修正(点亮时必改)

**媒体编辑 Trim = 12 credits 是钱数不诚实**:真后台 Trim = `startRender`→ffmpeg 剪切,**$0**(money-safety Step-1 明列 render.ts/caption.ts 为 $0 worker path;render.ts 注释「re-rendering is free」)。裁剪一段视频是剪、不是重生成,不调任何 provider。
- **修正**:media-editor Trim/Crop/抽帧点亮为 **$0**(路由 render/caption 管线);删掉原型 `TRIM_COST=12`。Crop/调整已是 $0(存新版本)、抽帧已是 $0 —— Trim 对齐它们。
- **Stitch(canvas 拼两视频)= 决策项**:若是 ffmpeg concat(拼接)→ **$0**(走 `startRender` timeline);若是 AI 生成转场/morph → paid(走 `startGen`)。**待施工 plan 定原型意图**(§七.D5)。
- **原则**:点亮**不新增假收费**——凡真管线 $0 的动作,用户面就得 $0;"卖水不卖装表"(L0 同律)。这本身就是宪法 3 铁律③状态诚实 + 宪法 5 效率良心「永不赚在浪费上」的落地。

---

## 五、后台缺口清单(连后台即成品标准 —— 本期建 / 诚实 Coming soon / 进假设台账)

> **判据**:混合上市「连后台即成品」——能接现成后台或本期能建的 = 建;无后台且属 Wave 2/3 的 = **诚实 Coming soon**(灰置 + 「即将上线」,绝不留假按钮),缺口进假设台账(§九)。

### 5.1 本期建(P1 Wave 1 对齐,复用现有 gen 链不开新钱路)

| 缺口 | 现状 | 本期建什么 | 挂靠 |
|---|---|---|---|
| **工厂编排层** | 无 factory/studio 后台;GenerationBatch 对象已在 | `studio-batch-actions.runVariantBatch`/`runBulkGrid`:对 `startGen` 批量下单 + 挂 GenerationBatch + 逐格 reserve/settle/refund | harmony-03 Wave 1;§四.C |
| **风格卡片** | 无 styleCard 后台 | prompt skills 产品化成风格卡(C-09,「已有能力露出」——seedream/seedance prompt 权威已在 skill) | harmony-03 Wave 1 |
| **3 无口播模式** | 无"video mode"概念,只有 per-model `audio` 布尔 | 3 个确定性模式 = 3 张 prompt 模板(产品展示/开箱/促销卡点),现有 Seedance/Seedream 管线直出 | harmony-03 Wave 1 |
| **money-shot 产品锁出片** | Entity/EntityVariant/参考图 conditioning 已在(#92,MAX 10) | 锁产品闸(≥N 张)+ conditioning 接线,身份保真出片 | §四.D 锁产品闸 |
| **storyboard 多场景渲染** | gate1 帧→i2v 管线已在 | 接 `prepareStoryboardVideos`,逐场景 gen-链计费 | §三 |
| **Library 真落库** | worker 已真写 Asset/Generation;工厂原型只记字符串 | 工厂批量经 gen 链 → 自动真落库;Library 按 GenerationBatch 归组读 | §四.D |
| **home Build brand from a link** | `ingestProductFromUrl` 已在($0 draft) | 接 ingest + `saveBrandRecord` 落品牌记忆 | 已在 |
| **ideas 持久化 + Otto 建议** | 无 idea 对象;无 suggest skill | 小 owner-scoped idea 对象(或复用 thread 草稿)+ `proposeIdeas` free skill | Seam 5 + Seam 1 |
| **media-editor 接真编辑器** | `saveProjectEdit`/`startRender`/`getFrameCandidates` 已在($0) | 接线 Crop/Trim/抽帧(全 $0) | §四.G |
| **asset-viewer 续拍/重生成** | gen 链已在 | 接 `startGen`(source=当前版本) | §三 |
| **canvas Otto 驱动(parity 债)** | canvas-actions 全 `todoSkill` | 配 canvas skill(Seam 1),让 Otto 能读/摆/生成节点 | 宪法 7 |

### 5.2 诚实 Coming soon(Wave 2/3,本期无后台,进假设台账)

| 缺口 | 归属 | 为何本期不建 |
|---|---|---|
| **口播 / lipsync / TTS** | harmony-03 Wave 2 | **全城零 TTS/voiceover 管线**(grep worker/core 零命中);新供应商选型 + costing 先行 + founder 逐笔批(宪法 5) |
| **多语配音 / 翻译(BM/中)** | Wave 3(C-04 三语套装) | 无翻译服务;storyboard 的 dub langs 是纯 fixture |
| **工厂编辑工具**(Inpaint/Expand/Relight/Upscale/Remove-bg) | 评估(部分可映射 gen 模型能力,多为净新) | 无后台;逐个评估是否映射现有模型,超出本期 |
| **预检打分**(virality/similarity scorer) | 净新 | 无评分服务;相似度先按 §四.D「代理指标」诚实标注 |
| **Facts source**(反幻觉价格 grounding KB) | 净新 | 品牌记忆部分覆盖;价格 grounding KB 是净新 |
| **Learn my voice**(品牌语气模型) | 净新 | 无品牌语气模型 |
| **Ad Reference 逆向**(C-02 schema 化拆解) | Wave 3 | 无拆解引擎;宪法 10 拆结构 schema 化,Wave 3 才建 |
| **Trending / Discover / stock library** | 净新 | 无内容库/趋势源 |
| **coherence 模式 / audio-driven storyboard** | Wave 2 | 无连贯引擎 |

**缺口计数**:**11 项本期建**(全复用现有 gen 链或 $0 管线,零新钱路)+ **9 项诚实 Coming soon**(Wave 2/3,进假设台账)。

---

## 六、每环最强对标(第一性工作分解 —— 不抄实现物)

> 宪法级条款:创作环完成标准 = 对标该品类最强者。以下是对 magicpath / Grok Imagine canvas 的**第一性分解**(拆它们赢在哪的底层动作,不复制其素材/代码),对照我们赢在哪、差在哪补。

**Grok Imagine canvas / magicpath 的第一性(它们强在):**
1. **对象即一等公民**:画布上每个产物可寻址、可命名、可派生(A/B、续拍、变体)——不是一次性输出流。
2. **零学习曲线的生成语法**:一句话 → 图/视频/编辑,模式切换隐形(image/video/agent 三模式无缝)。
3. **就地演化**:选中一张图直接"变这样",不回填表单;派生关系可视(源→果连线)。
4. **即时反馈闭环**:秒级出结果 + 无限画布空间感,创作心流不断。

**我们这环赢在哪(护城河,别人没有的下一公里):**
1. **品牌记忆 + 冷启动诚实**:产品档案/品牌语气/风格卡进生成(C-08/O-04);冷启动标「category signals,not learned from your account yet」——比对手"假装懂你"更可信(gate4 相似度诚实化即此)。
2. **Otto 全驱动**:同一动作层,用户可只跟 Otto 说话把整批片做完(宪法 7);对手是纯手工工具。
3. **直通排期 + campaign**:出片 → 一键进排期(schedulePosts)/ 挂 campaign —— 创作车间直连投放(对手没有生成端的下游)。
4. **成品导向**:贴链接 → 可投广告(工厂),不是"给你工具箱自己拼"(Higgsfield/Canva 是工具,我们卖成品 + 会用工具的超级员工)。

**差在哪要补(诚实登记,进假设台账):**
1. **就地编辑深度**:Inpaint/Relight/Upscale 等 —— 本期无后台(§五.2),Grok/Canva 有。补:Wave 2/3 评估。
2. **模式广度**:对手 10+ 视频模式,我们本期 3 个无口播模式;口播是转化最高形态但需 Wave 2。
3. **相似度/去重的真历史比对**:需连账号后才能算(§四.D),对手多为本地代理。补:连账号后升级。
4. **画布性能/心流**:#191 canvas 是种子,immersive 壳的无限画布/秒级反馈要在真数据量下压测(§八规模)。

---

## 七、R4 Design B 决策 + 待 founder 拍板项

### 7.D1 —— 本区是否首个落 R4 Design B(能力运行时)?[决策项,带取舍]

R4 裁定:Otto 缝终局采纳 **Design B**(能力运行时 = UI 与 Otto 调同一 typed handle + 决策策略登记簿 + 引擎 bundle 装载),**「随点亮逐区落地,不做一次性大重写」**,`defineOttoSkill` 降为模型侧工单声明(TWO-BRAIN R4 §3)。**本区是否成为第一个落 Design B 的区** = 待拍板:

| 选项 | 做法 | 优点 | 代价/风险 |
|---|---|---|---|
| **(A) L-C 首落 Design B** | canvas/工厂的 spend 动作用 typed capability handle,UI 与 Otto 共调 | canvas 已是单一动作层最干净的样板(`generate`→`startGen`),证明 Design B 的最佳试验田;创作区 parity 债最大,顺势一次性用新架构清 | Design B 是大架构;**首落押在全城最高流量 + 最重钱路的区** = 风险最高;万一架构反复,3 用户首当其冲 |
| **(B) L-C 沿用现制,Design B 另择小区首落** | L-C 继续用 `defineOttoSkill` + parity 清债;Design B 先在某小区(如 L0 量测/ideas)试点 | 安全优先(宪法 1);L-C 点亮不被架构实验拖慢;先在小区验证迁移七步再推重区 | 创作区 parity 债得用旧架构清一遍,Design B 落地时可能再改一次(返工) |

**荐**:**(B)** —— 安全 > 效率(宪法 1),L-C 是"每环最强"第一战场,不宜同时背"首落大架构"的风险;Design B 迁移七步先在小区跑通,L-C 用成熟的单一动作层 + parity 清债即可满足宪法 7。但这是**架构取舍,标「待 founder / 总审查员定」**——(A) 的"最干净试验田"论也成立,取舍点在"是否愿意让最重的区当架构小白鼠"。

### 7.D2~D6 —— 其余待拍板项

- **D2 · Quality 档 ×1.5 倍率**(spend/定价):原型硬编码 ×1.5,**必须 costing 先行**(宪法 5 毛利 ≥45%)才能上;报价一律走 `pricedGenCredits`,不搬原型 12/40/16。**待 founder + costing 闭合**(harmony-04)。
- **D3 · canvas 迁移路径**(§二.8):feature flag 灰度 / staged 双活 / 硬切,荐灰度。3 用户过渡策略待 founder 定。
- **D4 · 工厂编排对象**:`runVariantBatch` 挂现有 `GenerationBatch`(已在,荐)vs 新对象。**荐复用 GenerationBatch**(house 惯例,nullable 软引用);确认它不持钱字段。
- **D5 · Stitch/Trim 钱数修正**(§四.G):Trim 必改 $0(硬修正,非拍板);Stitch = ffmpeg concat($0)还是 AI 转场(paid)待定原型意图。
- **D6 · legacy `/northstar/create/*` retire 时机**:immersive 达 parity 后退役 legacy 路由,时机待定(进假设台账)。

---

## 八、验收 / 规模估算 / PR 切片

### 验收(可执行 / 可点击;真钱验收 = 方案不执行,逐笔待 founder 批)

**本地三关**(CI 不可用时配方 `docs/runbooks/local-ci.md`):`check`(lint+typecheck)/`test`(vitest,含新批量编排测试)/`web-build`(next build)全绿。

**单元 / 契约测试**:
- 批量编排 `runVariantBatch`:N 格各建独立 GenJob、各自幂等键、部分失败只退失败格(复用 gen-reaper/credits 测试样式)。
- 幂等:同批重投递不重复下单(撞 `GenJob_active_idempotency_key`);Retry = 新键新单不双扣。
- Trim/Crop/抽帧断言 **$0**(不 reserve、不建 GenJob)。
- Otto propose 侧零 GenJob(money-safety(b)回归)。
- Library 真落库:工厂批量后 `getGenerationHistory` 读得到、按 GenerationBatch 归组。

**真钱验收方案(不执行,写成清单待 founder 逐笔批)**:
> 宪法 2:开发/验证期每笔真实供应商花费逐笔问 founder,"问"就是上限。以下为**验收方案**,施工到验收阶段时逐条报 founder 批准后才在 staging 跑:
1. **staging + 真 provider 小额**:一条 canvas 图(seedream,单张)真下单 → `reserve→settle`,Account→Credits 明细可查、余额下调正确、Library 真落库。**约 1 张图成本,待 founder 批**。
2. 一条 canvas 视频(i2v,最短档)全链 —— 六态②③抽验(先造余额不足 / 模拟 provider 拒验退款)。**约 1 段短视频成本,待 founder 批**。
3. **工厂批量 partial**:2×2 矩阵(4 格),人为让 1 格失败 → 验「3 收 1 退」、总价确认页三数一致、GenerationBatch 归组。**约 3 张图成本,待 founder 批**。
4. 恢复(⑥):staging 杀 worker 制造悬空 → reaper 判定不双扣。**$0(不新花,验重投递)**。
- **founder 15 分钟亲点**(一板块一验证协议):走一遍创作→出片→落库→进排期,判品味 + 判诚实。

**浏览器 runtime QA**(宪法 11 live reflection):生成态变化秒级反映(worker 写库→canvas 推送/短轮询刷新);「后台已出片而界面还转圈」按缺陷处理。coral 高亮 = Otto 动作可见(O-12)。

### 规模估算

- **每次生成** = 1 次 provider 调用($ = 真钱,走已有 gen 链定价);批量 = N 次,报价 = Σ 单价。
- **$0 面**(canvas 节点 CRUD、media-editor 编辑、home/ideas 导航、品牌记忆、Library 读)= 无 provider,低负载。
- **worker 负载**:创作是主力生成源,gen 队列已有 `batchSize`/retry/reaper 调优;批量矩阵是**稀疏突发**(用户点确认才来),非高吞吐。
- **规模总评**:**L**(工厂编排层是主要新建;canvas/media-editor/asset-viewer/storyboard 多为接线;口播等 Coming soon 零后台)。

### PR 切片(小批提交,每片独立可审;spend 片单独切 + 单独过 money-safety)

| 片 | 内容 | 触钱? | 验收 |
|---|---|---|---|
| **PR-LCa** | canvas 接线($0 部分):immersive canvas 壳接 `canvas-actions`(节点 CRUD)+ feature flag 灰度骨架 + canvas Otto skill(parity 清债) | 否 | 节点增删移落库;flag 可回滚;`lint:parity` 绿 |
| **PR-LCb** | canvas 接 gen 链(spend):想图/Make Video/A/B/就地编辑 → `startGen`;报价走 `pricedGenCredits`;先问后花确认页;六态①②③④⑥ | **是** | **过 money-safety**;六态各一证据;真钱验收方案①② |
| **PR-LCc** | media-editor + asset-viewer 接线:Crop/Trim/抽帧 **$0 修正**(§四.G);Continue/Regenerate 接 `startGen` | 部分是 | Trim 断言 $0;续拍过 money-safety |
| **PR-LCd** | storyboard 接 gate1 真管线:Make-all/Retry 接 `prepareStoryboardVideos`;配音/coherence 诚实 Coming soon | **是** | 过 money-safety;逐场景计费;Coming soon 灰置 |
| **PR-LCe(核心 spend 片)** | **工厂编排层** `runVariantBatch`/`runBulkGrid` + GenerationBatch 归组 + 逐格 reserve/settle/refund + text 格 $0 + 总价确认页 + money-safety Step-1 扩符号 | **是(最重)** | **过 money-safety(核心)** + 对抗 `/codex` 二审;真钱验收方案③ |
| **PR-LCf** | home/ideas 轻接线:composer→canvas、brand-from-link 接 ingest、ideas 对象 + proposeIdeas skill;风格卡 + 3 无口播模式 | 否($0) | 导航/建档落库;`lint:parity` 绿 |
| **PR-LCg(过 flag 后)** | canvas 迁移收尾:达 parity 后按 D3 灰度翻户;Otto 归位常驻 dock;legacy 退役评估 | 否 | 3 用户零断供;浏览器 QA 全链 |

> spend 片(LCb/LCc/LCd/LCe)**各自单独过 money-safety-review + 建议对抗 `/codex` 二审**(SKILL.md check (e));$0 片走常规 proportional review。

---

## 九、假设台账(还没坐实的,逐条写「上线前如何处置」)

| # | 假设 / 待拍板 | 现状 / 风险 | 谁定 / 如何处置 |
|---|---|---|---|
| A1 | **Quality ×1.5 倍率真价** | 原型硬编码;毛利地板 ≥45% 未验 | founder + costing(harmony-04)先行;不闭合不上倍率 |
| A2 | **Design B 首落本区?** | R4 采纳但"逐区落";本区风险最高 | founder/总审查员(§七.D1,荐 B) |
| A3 | **canvas 迁移 flag/staged/硬切** | #191 在 /otto;3 用户过渡 | founder(§七.D3,荐灰度) |
| A4 | **Stitch = concat($0)还是 AI 转场(paid)** | 原型收 20cr,真意图未定 | 施工 plan(§四.G;Trim 已定必 $0) |
| A5 | **口播/TTS 供应商选型** | 全城零 TTS 管线;Wave 2 | 选型 spec 先行 + costing + founder 逐笔批(harmony-03 Wave 2) |
| A6 | **工厂编辑工具哪些映射现有模型** | Inpaint/Relight 等无后台 | 施工 plan 逐个评估;超出本期即 Coming soon |
| A7 | **相似度/去重历史比对** | 未连账号算不出 | 先按代理指标诚实标注;连账号后升级(§四.D) |
| A8 | **legacy /northstar/create/* retire 时机** | immersive 达 parity 后 | 总审查员(§七.D6) |
| A9 | **风格卡/3 模式的 prompt 模板** | prompt skills 已在,产品化未做 | 复用 seedream/seedance prompt 权威 skill(C-09) |

---

**结尾**:本 spec 为图纸,待 founder 过目后动工(蓝图第五章第 1 条)。**待拍板/待定项**:①Quality ×1.5 倍率 costing 先行(A1);②Design B 是否首落本区(A2,荐否);③canvas 迁移策略(A3,荐灰度);④Stitch 钱数(A4;Trim 必修 $0);⑤口播 Wave 2 选型(A5)。**钱路警告**:本区是全城最重 spend path,10 个真花钱触点全收敛到唯一 gen 链(零新钱路),spend 片逐个过 `money-safety-review` + 对抗二审;一切真实供应商验证花费**逐笔问 founder,"问"就是上限**(宪法 2)。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
