# B3 板块报告 · 创作 L-C + 资产

> 按 MASTERPLAN §七 十四节标准编制（= 终验讲解稿同构）。**本文件为骨架**：B3 处冻结候选阶段（spec v0.3，代码未施工），各节为 **owner + 证据槽位**，随批次施工增量投递（只读不需批，终验=确认非发现）。不适用/未施工的节**如实标注**而非省略（宪法 3 状态诚实）。
> 人话对照：「创作 L-C」= 把创作车间七页从"漂亮的假"接上真后台；「资产」= 品牌记忆/资产库/模板。本报告是这块建完后给 founder 的**逐条可查交付单**，现在先立骨架、施工时逐格填证。
> **报告状态**：骨架（施工前，随 spec v0.3 同步——BR2 六项 + BR2-R2 三项文字收口闭合）。批次映射见 spec §五（LC-0 / W-B3-A~D 批1b；W-B3-E~H 批2〔v0.2 补 W-B3-H=LCd paid storyboard〕；引擎集成批3；tranche-2 批4；收口批5〔LCg 灰度迁移/legacy 收尾为前置〕）。

## ① 块 ID / PR / 最终 SHA / 认证日期

- **owner**：控制面（收口）。
- **证据槽位**：块 ID = B3 · 创作 L-C + 资产。spec = `docs/superpowers/specs/2026-07-12-b3-block-spec.md`（v0.3 冻结候选，本批交付）+ 主体 L-C `docs/superpowers/specs/2026-07-10-lc-creation-zone-lighting.md`（引用采纳）。施工 PR 列（LC-0 / W-B3-A~H〔v0.2 补 W-B3-H=LCd〕/ LCg 收口片）+ 各 merge SHA + 认证日期 = **待施工填**。epoch `claude-20260712-03`。

## ② 批准范围 + 明示排除 + 映射

- **owner**：控制面。
- **证据槽位**：
  - 范围 = 46 行（主 tranche **38** + tranche-2 处置 **8**〔六新行 B0-94/95/96/97/100/101 + 改档 B0-17/B0-18，v0.2 BR2②(b)〕，后者保持 listed 待 addendum，D-021）。来源映射：蓝图第六章创作/资产区 + MASTERPLAN §三 B3 + A′ 舱单 create/* 七页 + 判决（GRILL/O-04/harmony-03 Wave1-3/判决 7-2/7-3/7-6/7-7）。
  - 明示排除 = Wave2/3 能力（口播/lipsync/TTS、多语配音、Ad Reference 逆向、选角库训练版、coherence/audio-driven）本期诚实 Coming soon（L-C §五.2，9 项；其中 B0-17/18 两行已改档 tranche-2 处置）；定价终案（挂 B12）；Design B 首落（荐否，L-C §七.D1）。
  - 映射 = 缝：记账缝(3)/生成缝(2)/队列缝(6)/设计缝(7)/Otto 技能缝(1)/Parity(9)（L-C 头部）；宪法 3/5/7/11。

## ③ 功能清单（非页面清单）

- **owner**：各工位（LC-0 / W-B3-A~H / LCg 收口片）。
- **证据槽位**：46 能力行的逐条能力名（非页面名）+ 现状六级状态 → 目标状态。存量断言 16 条免重核（spec §二.5）；absent 行（E1-09 stitch/E1-19 A/B 分叉/B0-14/16~26 工厂族）为净新建。**待施工逐行填交付状态**。
- **W-B3-A（canvas $0 面，本批交付）**：E1-01（无限画布·节点为一等公民）的 $0 双执行器面——Otto 执行器侧真接后台：新 `manageCanvas` skill（view/place/edit_text/resolve/remove，free/write/internal 不设闸=与人工 UI 同待遇）经 `ctx.canvas` port 驱动与人工 UI **完全同一**的 `canvas-actions` 五动作 + `otto-canvas-bridge.syncOttoCanvasNodes`（display-only sync）。零 spend 触点：`startGen`/gen 链不在本工位 diff（canvas gen 接线归 W-B3-E）；$0 硬线端到端焊死（v2，codex TR1①）——skill 侧无 generationId 拒放 image/video（新媒体只能走 gated `generate`）+ port 侧（`otto-canvas-port.ts`）place 的 generationId 先行 owner+project 验真（伪造/跨项目=结构化硬拒，绝不静默降级），edit/remove 加 project 绑定；canvas-actions 的 UI 既有契约零触碰。**人工入口现状如实**：immersive canvas 壳（LC-0 已落）本批保持壳级（mock 数据形态不动），UI 真接线归批2/批3（见 §⑫.8）。
- **W-B3-C（已交付，$0 面）**：E1-08「分镜工作台」的 **$0 编辑面**双执行器补齐——Otto 侧新增 `editStoryboard` skill（$0/write/internal，`packages/otto/src/skills/edit-storyboard.ts`），与人工 server action（`apps/web/lib/storyboard-actions.ts`，已在 main）共用同一套纯编辑变换（迁至 `packages/otto/src/storyboard-edit.ts` 作双执行器共同权威，含 G 闸② 陈旧级联）。**E1-08 的付费面（Make all/Retry=gate1 真管线）属批2 W-B3-H，本工位未触**；E1-09 stitch 只落 $0 concat 接线预留（注释+TODO 指针，见 `studio-storyboard.tsx` renderState done 动作行）。行级状态迁移提案（E1-08 $0 编辑面 code-complete）入 PR 描述，不动矩阵（D-015⑤ 惯例）。
- **W-B3-D（home/ideas/风格卡/3 模式 + library/brand $0 面，本批交付）**：家/想法/资产库/品牌记忆的 **$0 双执行器面**——Otto 执行器侧真接后台，四把 `manage*` skill 经 ctx port 驱动与人工 UI **完全同一**的 server actions（单一动作层，宪法 7/缝 9）：**`manageProjects`**（get_default/create/rename/set_pinned/delete → `ctx.projects` → `actions.ts` 五动作；delete 对等=**仅空项目**——port 确定性前置闸〔live Generation count>0 硬拒引导 UI 手删，小节审 4952217527 处方〕+ guarded 动作〔running 拒 + queued 退款〕+ 硬拒无 id/伪造 id）、**`manageEntities`**（create/delete/delete_reference_image → `ctx.entities`；create 只落名+类型、上传照片仍人工=诚实边界）、**`manageLibrary`**（history/detail/set_favorite → `ctx.library` → `library-actions`/`asset-actions`）、**`manageBrandMemory`**（delete_record/restore_record/delete_fact → `ctx.brandMemory` → `brand-record-actions`/`memory-actions`；软删+撤销）。**ideas $0**：新 `proposeIdeas`（free/read/internal，「Suggest 3 ideas」纯建议、零持久化、零花费——I1 锚）。**composer→canvas / brand-from-link 复用既有**：composer 一句话落 canvas 真下单延到 canvas 确认（H1，本批只做 $0 提案面 = `manageCanvas.place`）；brand-from-link 走既有 `ingestProduct`（`ingestProductFromUrl`，已对等）。四把写 skill 均 free/write/internal → needsApproval=false（承 `cancelScheduledPost` 先例——内部写不设审批卡，安全在 owner-scoped guarded 动作 + fail-closed port）。**零 spend/零外部/零 schema**；immersive 壳保持壳级（LC-0 已落），UI 真接线归批2/批3（§⑫.10）。
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

- **W-B3-A 债六条清零（四件套，本批交付）**——`lint:parity` 绿：`[parity] OK: 180 entries … TODO_SKILL entries remain: 78`（棘轮 84→78，`scripts/parity-debt-baseline.json` 同 PR 收紧）：

  | 债号 | action key | skill | ctx port | handler（单一动作层） | 测试 |
  |---|---|---|---|---|---|
  | debt-33 | `canvas-actions.listCanvasNodes` | `manageCanvas`(view/remove 预检) | `ctx.canvas.list` | `listCanvasNodes`（人工 UI 同源） | `manage-canvas.test.ts`「remove — in-flight … fail-closed」+ C1 子旅程 |
  | debt-34 | `canvas-actions.createCanvasNode` | `manageCanvas`(place) | `ctx.canvas.place`（port 先行验真 generationId） | `createCanvasNode` | 同上「place — $0 hard line」3 例 + `otto-canvas-port.test.ts` place 4 例 |
  | debt-35 | `canvas-actions.updateTextNode` | `manageCanvas`(edit_text) | `ctx.canvas.editText`（project 绑定） | `updateTextNode` | 同上「edit_text / resolve」+ port 跨项目拒 |
  | debt-36 | `canvas-actions.resolveCanvasNode` | `manageCanvas`(resolve) | `ctx.canvas.resolve` | `resolveCanvasNode` | 同上「edit_text / resolve」 |
  | debt-37 | `canvas-actions.deleteCanvasNode` | `manageCanvas`(remove) | `ctx.canvas.remove`（project 绑定） | `deleteCanvasNode` | 同上「remove」4 例 + port 跨项目拒 |
  | debt-60 | `otto-canvas-bridge.syncOttoCanvasNodes` | `manageCanvas`(view) | `ctx.canvas.sync` | `syncOttoCanvasNodes`（display-only，零 spend） | 同上「view」3 例 |

  port 注入点=`apps/web/lib/otto-actions.ts buildOttoContext` → `makeOttoCanvasPort(ownerId, projectId)`（`apps/web/lib/otto-canvas-port.ts`；身份走 requireOwner，skill 参数零身份字段——工厂硬拦）；`moveCanvasNode` 维持 VISUAL 豁免不动。TOOL_STEP_LABELS 补 `manageCanvas: "Working on your canvas"`（live trace）。instructions.ts 补「When to call `manageCanvas`」条目（REVIEWER-PLAYBOOK:107 注册卫生，v2 codex TR1③）。
  **对等差额如实记（v2，codex TR1②）**：`deleteCanvasNode` 对等=**非在途节点**；**在途付费卡（pending/timeout 无 URL）删除=UI 亲点专属**（防误删护栏，宪法 11 状态诚实）——Otto 一律硬拒并指引用户在画布上亲手确认删除，无模型自我确认参数；预检 fail-closed（list 失败/目标不在本项目清单=拒，绝不「查不到照删」）。
- **W-B3-C 债清零（6/6，已交付）**——四件套逐条：

  | 债号 | action key | 清偿方式 | manifest 状态 |
  |---|---|---|---|
  | debt-11 | `actions.saveShotPrompt` | 能力级对等挂 `editStoryboard`（op=editShot；同 createShot→proposeStoryboard 先例——legacy Shot 面待 LCg retire，reason 如实注明） | todoSkill → skill ✅ |
  | debt-12 | `actions.updateShotStatus` | 能力级对等挂 `editStoryboard`（卡片路径无 status 枚举，就绪态=prompts/pointers；reason 如实注明） | todoSkill → skill ✅ |
  | debt-13 | `actions.softDeleteShot` | 能力级对等挂 `editStoryboard`（op=deleteShot；reason 如实注明） | todoSkill → skill ✅ |
  | debt-75 | `storyboard-actions.editShotPrompt` | 真对等：`editStoryboard` op=editShot 与人工动作共用 `applyEditShotPrompt`（同一纯变换） | todoSkill → skill ✅ |
  | debt-76 | `storyboard-actions.deleteShot` | 真对等：op=deleteShot 共用 `applyDeleteShot`（≥1 镜头下限同动作层） | todoSkill → skill ✅ |
  | debt-77 | `storyboard-actions.reorderShots` | 真对等：op=reorderShots 共用 `applyReorderShots`（合法排列校验同动作层） | todoSkill → skill ✅ |

  棘轮：本工位单独 84→78；**与 W-B3-A（#266，亦清 6 条）合流后 = 72**，`scripts/parity-debt-baseline.json` maxTodoSkill 随 merge 收紧至 **72**；`pnpm lint:parity` 绿（TODO_SKILL=72）。live trace：`TOOL_STEP_LABELS` 补 `editStoryboard: "Editing the storyboard"`（`otto-stream-bridge.ts`）。

- **W-B3-D 债清零（14/14，本批交付）**——四件套逐条（skill → ctx port → 人工同源 handler → 测试）：

  | 债号 | action key | skill(动作) → ctx port | handler（人工同源） | 测试 |
  |---|---|---|---|---|
  | debt-03 | `actions.getOrCreateDefaultProject` | `manageProjects`(get_default) → `ctx.projects.getDefault` | `getOrCreateDefaultProject` | `manage-projects.test.ts`「get_default」 |
  | debt-04 | `actions.createProject` | `manageProjects`(create) → `ctx.projects.create` | `createProject` | 同上「create」（缺 name 拒） |
  | debt-05 | `actions.deleteProject` | `manageProjects`(delete) → `ctx.projects.remove`（**port 前置闸：live Generation count>0 硬拒**，fail-closed；小节审 4952217527 处方） | `deleteProject`（PERMANENT；仅空项目可达；running 拒 + queued 退款，guarded；**闸不进 action 本体**——人工 UI 打全名硬删不受影响） | `otto-projects-port.test.ts` 四例（含付费产物拒/含任意产物拒/空项目可删/fail-closed）+ skill「delete」3 例（无 id 硬拒/port 拒绝透传/running 错误透传） |
  | debt-06 | `actions.renameProject` | `manageProjects`(rename) → `ctx.projects.rename` | `renameProject`（真改 `Project.name`，别于 setTitle 改 `ChatThread.title`） | 同上「rename」 |
  | debt-07 | `actions.setProjectPinned` | `manageProjects`(set_pinned) → `ctx.projects.setPinned` | `setProjectPinned` | 同上「set_pinned」（`false` 不当缺失处理） |
  | debt-08 | `actions.createEntity` | `manageEntities`(create) → `ctx.entities.create` | `createEntity`（名+类型 FormData，无照片=诚实边界，上传仍人工） | `manage-entities.test.ts`「create — 无照片」 |
  | debt-09 | `actions.softDeleteReferenceImage` | `manageEntities`(delete_reference_image) → `ctx.entities.removeReferenceImage` | `softDeleteReferenceImage` | 同上「delete_reference_image」（not-found 透传） |
  | debt-10 | `actions.softDeleteEntity` | `manageEntities`(delete) → `ctx.entities.remove` | `softDeleteEntity`（软删/历史保留） | 同上「delete」 |
  | debt-29 | `asset-actions.getGeneration` | `manageLibrary`(detail) → `ctx.library.detail` | `getGeneration` | `manage-library.test.ts`「detail」 |
  | debt-30 | `asset-actions.setFavorite` | `manageLibrary`(set_favorite) → `ctx.library.setFavorite` | `setFavorite` | 同上「set_favorite」（`false` 不当缺失） |
  | debt-50 | `library-actions.getGenerationHistory` | `manageLibrary`(history) → `ctx.library.history` | `getGenerationHistory` | 同上「history」（过滤透传 + cap + 错误透传） |
  | debt-31 | `brand-record-actions.deleteBrandRecord` | `manageBrandMemory`(delete_record) → `ctx.brandMemory.deleteRecord` | `deleteBrandRecord`（软删） | `manage-brand-memory.test.ts`「delete_record」 |
  | debt-32 | `brand-record-actions.restoreBrandRecord` | `manageBrandMemory`(restore_record) → `ctx.brandMemory.restoreRecord` | `restoreBrandRecord`（软删撤销） | 同上「restore_record」 |
  | debt-51 | `memory-actions.deleteMemory` | `manageBrandMemory`(delete_fact) → `ctx.brandMemory.deleteFact` | `deleteMemory`（软删，别于 rememberBrandFact 增/改） | 同上「delete_fact」（not-found 透传） |

  port 注入点=`buildOttoContext`（`apps/web/lib/otto-actions.ts`）→ `makeOttoProjectsPort/EntitiesPort/LibraryPort/BrandMemoryPort`（`apps/web/lib/otto-{projects,entities,library,brand-memory}-port.ts`）；身份走各动作 `requireOwner`（skill 参数零身份字段——工厂硬拦）。**对等差额如实记**：createEntity 只落名+类型、参考照片上传=人工 file-picker 专属（skill 硬告知去元素页上传）；**deleteProject 删除对等=空项目；含产物（含已结算付费 Generation）项目=UI 亲点专属（打全名确认门）**——Otto 一律硬拒并指引 UI 手删，闸=port 确定性 live-Generation count 前置闸（**不进** deleteProject 本体、无任何 confirm 参数=禁模型自我确认、count 读失败 fail-closed 拒），承 manageCanvas「破坏性动作碰付费对象=硬拒+UI 亲点专属」先例（小节审 4952217527 BLOCK 处方落地）；另 guarded 动作〔running 拒 + queued 退款〕+ 无/伪造 id fail-closed；deleteMemory 无 restore 对应债（如实：fact 删无撤销，skill 明告）。
  棘轮：本工位清 **14** 条，`scripts/parity-debt-baseline.json` maxTodoSkill 从合入 origin/main 后的 **69 收紧至 55**（同 PR）；`pnpm lint:parity` 绿（`TODO_SKILL entries remain: 55`）；`node scripts/route-b-matrix-check.mjs` 债条目=55 全绿。注册卫生全套：`registry.ts`（37 skill）+ `registry.test.ts` 名册（thirty-seven，全量枚举）+ `instructions.ts`「When to call」5 条 + `CATALOG.md` 重生（catalog:check fresh）+ `TOOL_STEP_LABELS` 补 5 条（`otto-stream-bridge.ts`）。
## ⑤ 对标锚

- **owner**：各泳道工位 + founder/审查员（盲评）。
- **证据槽位**：spec §三锚清单（6 泳道锚 C1/C2/F1/F2/S1/M1/A1/A2/H1/I1 + 跨切 X1）三栏评（平齐/超过/未及→链待裁）。10 裁定已落（F2=AdCreative.ai/S1=Grok+Runway 上限/M1=CapCut/A1=Canva Brand Kit/A2=Canva/H1=Canva home）；批量全链时长 = **显式临时阈值（v0.2）：mock 级 20 格 ≤30 分钟**（真 provider 接入按 costing 实测受控修订、决策日志留痕）；Wave2/3 解禁触发随 tranche-2 addendum 钉（v0.2）。E1-17（A2 三条行级断言：进度/失败可重试/超限诚实拒绝）与 E2-13（C1 research 轨迹可见性断言）v0.2 起随所挂锚验。**待施工填并排截图 5 分制盲评结果**；任一态 <3 分进待裁链。

## ⑥ 全旅程证据

- **owner**：各工位 + 浏览器 runtime QA。
- **⚠️ 三无纪律预注**：本程处**用户数=0 + Stripe 零成交 + 无生产流量**（三无）状态下——**旅程证据 = mock/staging 级，如实标注**（宪法 3 状态诚实）：happy/empty/loading/denied/failure/retry/mobile 七态截图取自 staging + MockProvider（$0）+ 夹具注入失败形态，**不冒充生产真实流量**；真钱旅程（真 provider 小额）= 只交方案不执行，执行点 = **每笔真实花费 = founder 逐笔明示批准**（宪法 2/BLUEPRINT:61；唯一澄清处见 spec §六.3）。凡 staging/mock 级证据一律标注来源级别，不作生产已验证陈述。
- **证据槽位**：canvas 五态（空布→首图→就地编辑→A/B→Make Video）；工厂（贴链→选人设→批量矩阵确认页→成片网格 partial）；storyboard（draft→make-all→animatic→stitch）；media-editor（trim→抽帧→存版本 $0）。**待施工填七态截图 + 时间码**。
- **W-B3-A · 锚 C1 $0 子旅程（组件级，如实标注：Otto 执行器路径 + 有状态假 port；server 动作真值由既有 `apps/web/lib/__tests__/canvas-actions.test.ts` 承载）**：`packages/otto/src/skills/manage-canvas.test.ts`「C1 $0 sub-journey: empty board → place → derivation visible (Otto executor path)」——空布（count=0）→ 放文字卡+改写 → 放已生成图 → 放派生图（`sourceNodeId` 指回源）→ view 中派生关系可见（source→result 链）→ 删卡收口。全程 port 面无 `startGen`/credits/provider 任何符号（$0 by construction）。C1 五态并排盲评（空布→首图→就地编辑→A/B→Make Video）依赖 gen 接线=W-B3-E 后补。
- **W-B3-C · 锚 S1 $0 子旅程（brief→draft scenes→改脚本→保存）证据（已交付，执行器级/测试级——如实标注：非浏览器七态截图）**：`packages/otto/src/skills/edit-storyboard.test.ts` 的「S1 $0 sub-journey」用例全链走查——`proposeStoryboard` 起草 2 镜头卡（draft scenes $0）→ `editStoryboard` op=editShot 改第 2 镜头脚本 → op=reorderShots 重排 → payload 持久化断言（保存），并断言全程 **`genJob.create` 零调用**（$0 契约）；人工侧同链由 `apps/web/lib/__tests__/storyboard-actions.test.ts`（存量，owner-scoped 载入/G 闸②级联/边界拒绝）覆盖。**浏览器级七态截图待批3 引擎集成**（immersive 壳与 Otto/卡片接通后才有真 UI 旅程可截，见 §⑫.8）。
- **W-B3-D · 锚 A1（品牌记忆护城河）+ I1（想法清单反 Buffer）$0 子旅程证据（已交付，执行器级/测试级——如实标注：非浏览器七态截图）**：`packages/otto/src/skills/w-b3-d-anchors.test.ts`——**A1「ingest → 品牌记忆 → 注入链」的 $0 部分**：`ingestProduct`(假 `ctx.productIngest`) 得 DRAFT（$0 外读，`note` 指向下一步 `saveProduct`）→ 用户确认后 `saveProduct` 落库（web 动作层测试承载）→ 生成时 `ctx.brandBrain.context()` 注入的品牌文本携带该产品（ingest→记忆→注入链闭合），全程 port 面零 `startGen`/credits 符号（$0 by construction）；**冷启动诚实文案（A1 gate4 阈值）**由 `apps/web/lib/__tests__/w-b3-d-a1-coldstart.test.ts` 对 `HOOK_COLDSTART_NOTE` 断言（含「category signals」+「not learned from your account yet」，源 `studio-factory/data.ts`）。**I1「捕获 → suggest → 转画布提案」**：捕获零散想法（极轻、无重管道，反 Buffer）→ `proposeIdeas` 出 3 点子（$0，零持久化）→ 选一条经 `manageCanvas.place` 落为画布 **$0 文字提案**（真下单延到 canvas 确认=H1），`view` 中可见、`canvasCtx.startGen` undefined（全程零花费）。**浏览器级七态截图待批3 引擎集成**（immersive 壳与 Otto/卡片接通后才有真 UI 旅程可截，§⑫.10 同型）。
## ⑦ 测试全家桶可重跑链接

- **owner**：各工位。
- **证据槽位**：本地三关（`check`/`test`/`web-build`，配方 `docs/runbooks/local-ci.md`）；契约测试（`runVariantBatch` N 格独立/幂等不双扣/partial 只退失败格/Trim $0 断言/Otto propose 零 GenJob/Library 真落库归组）；`node scripts/route-b-matrix-check.mjs`（矩阵闸）；`pnpm lint:parity`（对等债闸）。**待施工填可重跑命令 + CI job 链接**。
- **W-B3-C 可重跑（已交付）**：`pnpm --filter @fikirtive/otto test`（skill 全家桶含 `edit-storyboard.test.ts`：schema/owner-scope/四 op 边界/G 闸②级联/S1 $0 子旅程/零 GenJob）；`pnpm --filter @fikirtive/web test -- storyboard`（人工动作层存量回归）；`pnpm lint:parity`（债闸，棘轮 78）；`pnpm --filter @fikirtive/otto run catalog:check`（CATALOG 同步闸）。CI job 链接=PR checks（见 §①）。
- **W-B3-D 可重跑（本批交付，三关本地全绿）**：`pnpm --filter @fikirtive/otto test`（含 `manage-projects/entities/library/brand-memory.test.ts` + `propose-ideas.test.ts` + `w-b3-d-anchors.test.ts`，57 文件全过）；`pnpm --filter @fikirtive/web test`（含 `__tests__/w-b3-d-a1-coldstart.test.ts`，137 文件全过）；`pnpm lint:parity`（债闸，棘轮 55）；`pnpm --filter @fikirtive/otto run catalog:check`（CATALOG 同步闸，fresh）；`node scripts/route-b-matrix-check.mjs`（矩阵闸，债 55 全绿）；`pnpm --filter @fikirtive/web build`（web-build 关，✓ Compiled successfully）。CI job 链接=PR checks（见 §①）。

## ⑧ schema / ownerId / 审计 / 同意 / 秘密

- **owner**：W-B3-F（工厂编排，schema 触点最重）+ 控制面。
- **证据槽位**：`GenerationBatch`（schema.prisma:961，已建，nullable 软引用无 FK、不持钱字段）；`GenJob.batchId(:464)` 预埋。新对象（idea 小 owner-scoped 对象）ownerId scoping；**模板 = 模板目录（g5b 静态代码目录），零新 schema 对象**（v0.2 钉②改判——被废表述与 `schema.prisma:294-316` 同名 ComfyUI 对象的区别详 spec §四.②）。`CreditLedger_finalizer_once` partial-unique 索引（每 ref 一 finalizer）。**schema 变更走 founder-only 类别**（如新增对象/迁移）——单列上报。**待施工填 schema diff + ownerId 断言 + 审计事件形状 + 脱敏检查**。

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
- **证据槽位**：spec 冻结走四权闭环（双顾问签核 + 异族复审 + 机器闸 + 非作者合并，#254 §一.2）——**已有两轮：codex BR2（钉 v0.1 head `fb1a8efd`）判 BLOCK 六项 → v0.2 全数闭合（其中钉②/×1.5/花钱授权措辞三处 = 控制面改判）；codex BR2-R2（钉 v0.2 head `3bac1bc0`）判 BLOCK(1,3,4)、2/5/6 CLOSED → v0.3 三项文字收口闭合（无判断变更）**；后续轮次待补 provenance。施工期：**批2 spend 四工位（W-B3-E/F/G/H，v0.2 补 H）每 PR 逐个过 `money-safety-review` + 对抗 `/codex` 二审**（P0/P1=0 才 code-complete）；$0 片走常规 proportional review。**待施工填各 PR 异族评审判定原文 + provenance 路径**。

## ⑫ 已知限制与待裁（没有写「无」）

- **owner**：控制面。
1. **规模上修（L→L+）**：原型七页不在 main（W-DELTA 核证），「只需接线」前提不成立，新增 LC-0 壳落地工位（spec §二.1）；LC-0 实测改造量待回填（假设 B3-A1）。
2. **E1-19 A/B 分叉出处已钉**（v0.2）：GRILL-VERDICTS:132-138（复核相符）；R-002 默认项 A 完结。行现状 absent，能力随 W-B3-E 建。
3. **定价挂 B12**：E1-06（16cr 现值 vs 旧 7cr 文档）+ 报价一律 pricedGenCredits——B3 不自行改价；**Quality ×1.5 本期撤销**（v0.2，GRILL:244 终判，非挂 B10 缓上）。
4. **tranche-2 处置 8 行保持 listed**（D-021）：六新行 + 改档 B0-17/18（v0.2）锚待 addendum；B0-101↔E1-15 关系、B0-96 多机位细化、B0-97 肖像授权边界、B0-17/18 解禁触发未钉（假设 B3-A6/A2）。
5. **批量全链时长真值未测**：v0.2 已落显式临时阈值（mock 级 20 格 ≤30 分钟）；真 provider 实测值待 costing/压测，受控修订走决策日志（假设 B3-A3）。
6. **B10 毛利地板数值 gate 时序假设**（批2 前置）：批量定价毛利证明依赖 B10；若 B10 未就绪批2 停等并上报（假设 B3-A5）。
7. **Design B 首落本区 = 荐否**（L-C §七.D1/A2）：安全 > 效率，L-C 用成熟单一动作层 + parity 清债，Design B 另择小区首落——待 founder/总审查员定。
8. **W-B3-A 边界如实（2026-07-12 编排官核准）**：immersive canvas **UI 面本批保持壳级**（`canvas-page.tsx` 深度 mock 的 CvObject/session-pool 客户端组件，整体改写=越界「禁重画」）；$0 CRUD 的「真接后台」由 **Otto 执行器侧**交付（`manageCanvas` → `ctx.canvas` → canvas-actions，双执行器纪律的 Otto 半边先行），**UI 真接线归批2/批3**（随 gen 链接线/live-event 推送化一并）。灰度骨架照 L-C LCa 判据：L-C 无具体 env/flag 形态可照抄 → **壳级路由已在（LC-0 落 main）即为骨架**；flag 形态随批2 UI 接线落地（L-C §七.D3 荐灰度不变）。
9. **storyboard 壳 UI 保持壳级（W-B3-C，控制面裁定——与 W-B3-A 同型）**：核证确认 immersive `create/storyboard` 壳（`studio-storyboard.tsx`）零 server-action 接线、零 thread/卡片上下文（STORYBOARD_CARD 只由 Otto `proposeStoryboard` 铸造，壳拿不到 cardId），「$0 真接后台」在 UI 面只有 mock 缝——依裁定 UI 保持壳级，**「真」由 Otto skill（`editStoryboard`）+ 既有 `storyboard-actions`（双执行器共同纯变换）承载**；壳与真卡片的接通随批3 引擎集成（开工门=#253 或其拆分后继）。壳内 Wave2/3 假开关（coherence/多语配音/音频驱动）已如实禁用 + Coming soon 标注（gate4）；E1-09 stitch 只留 $0 concat 接线预留注释（spec §四.①）。
10. **home/ideas/library/brand 壳 UI 保持壳级（W-B3-D，与 W-B3-A/C 同型）**：immersive 家/想法/资产库/品牌壳（`immersive-home.tsx`、`studio-factory/studio-ideas.tsx` 等，LC-0 已落）为 client store（`_store`）mock 形态，本批不重画（禁重画）；「$0 真接后台」由 **Otto 执行器侧**交付（四把 `manage*` skill + `proposeIdeas` → ctx port → 既有 server actions），**UI 真接线归批2/批3**。**本批不含**（如实划界）：付费模板套用（E1-15 走真 `startGen`）= 批2 禁碰；composer 一句话真下单 = 延到 canvas 确认（H1），本批只 $0 提案面；Discover 无内容源 = 诚实占位（spec 明文），不留假按钮。**对等边界诚实**：`createEntity` 只落名+类型（参考照片上传=人工 file-picker 专属）；`deleteProject` 删除对等=**仅空项目**（v2，小节审 4952217527 BLOCK 处方：底层是物理硬删含已结算付费 Generations 且零退款、人工 UI 有打全名确认门——Otto 路径 port 确定性前置闸：live Generation count>0 硬拒引导 UI 手删，fail-closed，无 confirm 参数；含产物项目=UI 亲点专属）；`deleteMemory` 无 restore（fact 删无撤销，skill 明告）。零 spend/零外部/零 schema。
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
