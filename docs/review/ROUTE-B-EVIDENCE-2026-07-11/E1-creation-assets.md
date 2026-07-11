# E1 · 创作区 + 资产区 — 能力真相矩阵

> 基线核对:`git rev-parse --short=8 HEAD` = `b5a48d0f`(与工单一致)。
> production web = `7ed7ac22`(工单给定;本 worktree 历史中**无法解析该 SHA**——
> `git rev-parse 7ed7ac22` fatal: ambiguous/not a valid object。凡涉及 stage_prod 的行,
> 一律标 `Unknown(SHA 不可解析,无法判断 ancestry)`,不编造"已部署/未部署"。
> production worker SHA = Unknown(工单给定)。staging = `54c1de0b`(immersive 分支,非 main,未测绘)。
>
> 列含义见 `.orchestration/matrix-schema.md`。七档阶梯同文件。

## 矩阵

| id | zone | capability | promise_source | stage_main | stage_prod | gate | evidence | provenance | gaps |
|---|---|---|---|---|---|---|---|---|---|
| E1-01 | 创作 | 无限画布(FlowCanvas) | PR #191 "Grok-style stateful canvas Phase 1" | integrated | Unknown(SHA不可解析) | 硬编码 `skin==="gb"` 启用,无 env/flag | `apps/web/components/canvas/FlowCanvas.tsx`(1009 行);`apps/web/components/canvas/useCanvasGen.ts`(201 行);`apps/web/components/canvas/nodes/{ImageNode,VideoNode,TextNode,GeneratingBody,NodeResize}.tsx`;PR `2688c313` | Observed | 无 |
| E1-02 | 创作 | 图片生成 4 变体(count 1-4) | 工单描述 + `packages/core/src/gen.ts:75 MAX_GEN_COUNT=4` | implemented(代码路径存在,画布 UI 未暴露入口) | Unknown | 服务端 genRequest 硬顶 4,客户端硬编码送 1 | `packages/core/src/gen.ts:75,194`;`apps/web/lib/canvas-gen-costs.ts:5-15`(`CANVAS_IMAGE_DEFAULT_COUNT=1`,注释"founder decision 2026-07-06: one image per canvas generation by default, owner requests more variants explicitly");`apps/web/components/canvas/FlowCanvas.tsx:418` 唯一调用点 `generateImage(prompt,pos,promptIds,variantSel)` — **未传 count 参数,恒为默认值 1** | Observed | **断层**:canvas UI 里没有任何"选 2/3/4 变体"控件(`grep -rn "variantCount\|numVariants" apps/web/components/canvas` 零命中)——服务端能扛 4,画布用户今天点不到 4;"4变体"目前只在 Otto 聊天侧 `proposePack`(2-4 图广告包变体)体现,不是 canvas 直生 |
| E1-03 | 创作 | 生成成本确认(image 无弹窗报价,video 有确认弹窗) | founder 2026-07-06 决定(注释引用) | integrated | Unknown | 硬编码于组件,无 flag | `apps/web/components/canvas/FlowCanvas.tsx:536-538`(image 无 confirm,展示报价代替)、`:714`("Image generation has no confirm dialog (founder 2026-07-06, constitutional exception ①")、`:925,980`(video confirm 文案"Cost: {videoCostLabel}. No charge until you confirm.") | Observed | 无 |
| E1-04 | 创作 | i2v(image→video)/t2v(text→video) | founder 判决 + 代码 | integrated | Unknown | genRequest kind="video" 走同一花钱闸 | `apps/web/components/canvas/useCanvasGen.ts:160`(i2v,`sourceGenerationId`)、`:180-183`(t2v,无 source);`packages/core/src/gen.ts:313` GEN_VIDEO_MODELS 13 个模型 | Observed | 无 |
| E1-05 | 创作 | 多参考图调理(Seedream 全部 @mention 实体) | PR #92 `c0c53afa` | integrated | Unknown | 无 flag,MAX_CONDITIONING_IMAGES=10 硬顶 | `git show c0c53afa`(commit msg:"worker already collects every @mentioned entity's refs...BytePlusProvider only sent inputImageUrls[0]...fixed to send ALL");`packages/generation/src/byteplus.ts` | Observed | 无(此 PR 早于 07-02 地图基线但仍在 main 历史里,补充确认) |
| E1-06 | 创作 | 整段参考视频(whole-clip reference video) | PR #97 `a80117a1`("整段视频参考 v1") | integrated | Unknown | BytePlus-only,2-10s 输入上限硬编码;7cr 固定价 | `apps/web/lib/video-frame.ts:30-34`(`REF_VIDEO_MIN/MAX_SECONDS`,`isRefVideoDurationOk`);`OttoChatStream.tsx` "Use whole video" 分支(referenceVideoGenerationId);commit msg:"face-verification SKIPPED per founder;charge unchanged 7cr flat" | Observed | 无 |
| E1-07 | 创作 | 抽帧(视频帧选取用作图片参考) | 代码 + F28 注记 | integrated | Unknown | 无 flag | `apps/web/lib/video-frame.ts`;`apps/web/lib/__tests__/video-frame.test.ts`;`OttoChatStream.tsx`(frame picker,F28 frameReady gate,webm Infinity-duration force-seek fix — CODEBASE-MAP:176) | Observed | 无 |
| E1-08 | 创作 | 分镜卡(storyboard)全链 | proposeStoryboard skill(#99)+ Gate①铸卡 | integrated | Unknown | $0(proposeStoryboard 免费,子卡花钱走既有 cowork 闸) | `packages/otto/src/registry.ts`(16 号技能 proposeStoryboard,$0,shots 1-8,MAX_STORYBOARD_SHOTS=8);`apps/web/components/otto/StoryboardCard.tsx`(引用`storyboard-gate1-actions`);`apps/web/lib/storyboard-gate1-actions.ts`(891 行,"闸①的$0铸卡层":每个缺首帧图的镜头铸子 GEN_CARD,子卡走既有`cowork:<childCardId>` once-EVER 幂等键);`apps/web/lib/storyboard-actions.ts`/`storyboard-card.ts`/`storyboard-edit.ts`;测试`apps/web/lib/__tests__/storyboard-gate1-actions.test.ts` | Observed | 无(此为工单点名的"全链"要求,证据显示确实首帧铸卡→子卡花钱→既有幂等闸,链条完整;未验证跑通到 render 的时间线拼接一段) |
| E1-09 | 创作 | 视频拼接 stitch($0 顺序版) | founder 2026-07-11 判决 `3dc41f22`:"视频拼接(stitch)先做 $0 版……简单顺序拼接免费;AI 转场收费版待下一波 costing" | **不存在**(judgment 之前的档位——代码里查无 stitch 概念) | Unknown | N/A | `git show 3dc41f22 -- docs/research/GRILL-VERDICTS-2026-07-03.md`(判决原文,只证明"曾经决定过");`grep -rIl "stitch" apps/web apps/worker packages/core` 零命中;render.ts 里的 concat/xfade(`apps/worker/src/jobs/render.ts:66-105,452`)是**已有的时间线拼接/转场渲染管线**(RenderJob,项目内 Shot 序列),但这是既有的"时间线剪辑渲染",不是判决里描述的独立"stitch(拼接多段视频素材)"新功能——两者概念邻近但未见代码把后者接到具体入口 | Inference(promise_source 只证明决定过;stage 判定来自代码,代码里未见 stitch 专属实现) | **重要断层**:承诺来自昨天(2026-07-11)判决文本本身,但代码里没有对应的 stitch 动作/UI/job;若上级把"render 的 concat/xfade"当作 stitch 的既有实现,需要人工确认两者是否是同一物 |
| E1-10 | 资产 | My Stuff(统一 cast+ads) | commit `0d9062af`("unified My Stuff") | integrated | Unknown | 无 flag,view=stuff | `apps/web/components/otto/OttoStuff.tsx`;`apps/web/lib/stuff-items.ts`(77 行);CODEBASE-MAP:166 "stuff→OttoStuff(tabs \"cast\"\|\"ads\": entities + ads/adJobs)" | Observed | 无 |
| E1-11 | 资产 | Brand memory v2 — 6-tab | commit `0d9062af` | integrated | Unknown | 无 flag,view=memory | `apps/web/components/otto/OttoMemory.tsx:362-422`(tab bar,`role="tablist"`,6 个 section key:about/look/customers/products/offers/rules);`apps/web/components/otto/memory/{FactSection,OfferList,ProductShowcase,SegmentCards,UndoBar}.tsx` | Observed | 无 |
| E1-12 | 资产 | living collections(BrandRecord:products/segments/offers 动态记录) | commit `0d9062af` | integrated | Unknown | 无 flag;OTTO 可写(3 技能 save-product/save-customer-segment/save-offer),用户可编辑+撤销 | `packages/db/prisma/schema.prisma:901-916`(`model BrandRecord`,kind∈product\|segment\|offer,nameKey upsert 键,pinned/status/startsAt/endsAt);`packages/core/src/brand-records.ts`+测试;`packages/otto/src/skills/{save-product,save-customer-segment,save-offer}.ts`;UndoBar.tsx(撤销 UI) | Observed | 无 |
| E1-13 | 资产 | 产品链接建档(product URL 一键 ingest) | commit `db1e0550`("P1-01 product URL one-click ingest, dual-mode $0 deterministic + LLM escalation") | integrated | Unknown | 无 flag | `apps/web/lib/product-ingest-actions.ts`;测试`apps/web/lib/__tests__/product-ingest-actions.test.ts` | Observed | 未展开验证 dual-mode 的 LLM escalation 分支细节(预算限制) |
| E1-14 | 资产 | Library 面 | CODEBASE-MAP:166 | integrated | Unknown | view=library,不在主导航,仅深链 | `apps/web/app/library`(旧路由,重定向 `/otto`);`apps/web/lib/library-actions.ts`+测试;`apps/web/components/otto/stuff/StuffLibrary.tsx` | Observed | 与 CODEBASE-MAP 一致:library/templates/discover 均"不在导航,仅 ?view= 深链可达"——**入口断层**(代码闭环但普通用户点不到) |
| E1-15 | 资产 | Templates 面 + 付费路径 | CODEBASE-MAP:166,199 | integrated | Unknown | view=templates,不在主导航;付费走真实 startGen | `apps/web/components/otto/OttoTemplates.tsx`(静态 `TEMPLATES` 数组,非 `TemplateBundle` DB 模型);`apps/web/components/otto/TemplateModal.tsx:14,124`(`import {startGen...}`,`started = await startGen({...})` — 真花钱) | Observed | Templates 面用的是硬编码 `lib/templates.ts` 目录,和 schema 里 `TemplateBundle`(ComfyUI 注册表,slug+version+zipHash)是**两套不同的东西**——若上级以为"Templates 面=TemplateBundle 后台可配置模板库",这里是断层:面板模板是代码里写死的静态列表 |
| E1-16 | 资产 | Discover 面 | CODEBASE-MAP:166 | integrated | Unknown | view=discover,不在主导航 | `apps/web/components/otto/OttoDiscover.tsx:12,14,22,104`(`INSPIRATIONS` 静态数据,`onUseInOtto`→seed composer) | Observed | 同 E1-14,入口深链限定 |
| E1-17 | 资产 | 直传上传链(authorize/finalize/ingest 哈希复验,D19) | CODEBASE-MAP §存储 §3 | integrated | Unknown | 服务端 requireOwner + storageKey 服务端拼接,client 不能自定 key | `apps/web/lib/direct-upload.ts`(client hash-wasm streaming sha256→authorizeUpload→Uppy PUT→finalizeCandidateUploads);`apps/web/lib/upload-actions.ts:41,80,124`(authorizeUpload/finalizeCandidateUploads);`apps/worker/src/jobs/ingest.ts:72-89`(`sha256Stream` 重算,CONFIRMED mismatch→deleteObject+tombstone Asset+软删 Generation+`ActionEvent "asset.hash_mismatch"`,`:122`) | Observed | 无(与地图一致,今日复核确认代码仍在) |
| E1-18 | 资产 | 失败恢复(付费卡防误删 + 失败态卡片) | CODEBASE-MAP:193"paid-aware delete confirm" | integrated | Unknown | 客户端确认弹窗,非服务端强制(服务端仍允许删除请求,前端拦一道) | `apps/web/components/canvas/FlowCanvas.tsx:8`(`import {useCanvasGen, isInFlightPaidGen}`)、`:607`(`hasInFlightPaidNode`)、`:707`(`pendingDeletePaid`);`apps/web/components/canvas/useCanvasGen.ts`(`isInFlightPaidGen` 导出,pending/timeout+无url=reserved,"delete≠refund"注释) | Observed | 这是**前端拦截**,不是服务端强制——若用户绕过 UI(直接调 action)可能仍删掉一个正在花钱的卡片而不触发确认;未在预算内验证服务端是否有对应硬闸(时间不足,标记为待查) |
| E1-19 | 创作 | A/B 分叉(canvas 变体分支) | 工单称"判决「要」" | **未找到判决文档也未找到代码** | N/A | N/A | `grep -rIln "fork\|branchVariant\|duplicateNode\|abTest" apps/web/components/canvas apps/web/lib` 仅命中 `meta-errors.ts`(无关,Meta API 错误码)——canvas 侧零命中 | Unknown | **断层/待查**:预算内未找到工单描述的"判决「要」"这份判决文档本身,也没有找到对应代码。可能是判决记在本次审计未覆盖的文档里,或判决尚未落地成代码。二者都待上级确认,不编造 |
| E1-20 | 创作 | Speed/Quality 双档 | 工单称"2026-07-11 判决:凭空加价撤" | **代码里不存在**(与判决一致——本就该撤/未建) | N/A | N/A | `git show 3dc41f22 -- docs/research/GRILL-VERDICTS-2026-07-03.md`(判决原文:"真后台只有 seedream/seedance-2-fast 两模型,无独立 quality 模型;原型『Quality=Speed+50%』是无成本依据的凭空加价……Speed/Quality toggle 仅当映射到真实更贵参数才保留,否则本期撤");`grep -rIln "speedMode\|qualityMode\|1\.5x\|fastMode" apps/web/components/canvas apps/web/lib/gen-actions.ts packages/core/src/gen.ts` 零命中 | Observed(代码确认判决已落地——撤销后代码里确无该功能) | 无(这是判决与代码一致的正例,不是断层) |

## 断层观察(原始观察,不排序不评分)

1. **canvas 4变体入口未接线**:服务端硬顶 4(`MAX_GEN_COUNT`),但 canvas 唯一调用点 `FlowCanvas.tsx:418` 从不传 count,恒等于 founder 2026-07-06 定的默认值 1——用户在画布上今天点不出"生成4张变体"这件事;4变体只在 Otto 聊天侧的 `proposePack` 广告包路径出现,不是 canvas 直生路径。工单要求核对的"含成本确认"这块反倒是做到位的(image 无弹窗、video 有弹窗都对上)。
2. **stitch($0 版)判决是昨天(2026-07-11)刚拍的,代码里目前查无对应实现**——`grep -rIl stitch` 全仓零命中。render.ts 里已有的 xfade/concat 是项目时间线渲染管线(已在地图里记录为$0 compute),和判决描述的"简单顺序拼接"是否是同一功能,需要人工判断;本次审计只能如实报告"没找到叫 stitch 的东西"。
3. **A/B 分叉**——工单称有判决"要",但本次预算内既没找到判决文档也没找到代码,两头都是空;不排除判决记录在本分片未覆盖的文档路径。
4. **Templates 面 = 硬编码静态列表,不是 TemplateBundle 后台注册表**——两套机制并存,命名相似容易被误认为同一个;`OttoTemplates.tsx` 用 `lib/templates.ts` 的写死数组,`TemplateBundle` Prisma 模型(ComfyUI slug+version+zipHash)在这条用户路径上完全没被读到。
5. **Library/Templates/Discover 三面均不在主导航**,仅 `?view=` 深链可达(与 2026-07-02 地图记录一致,本次复核代码仍如此)——入口闭环但普通用户找不到路径进去,这是"代码存在但用户到不了"的典型断层。
6. **付费卡防误删是前端拦截,非服务端强制**——`isInFlightPaidGen` 逻辑只在 `FlowCanvas.tsx` 客户端组件里,预算内未追踪到服务端 action 层是否有对应的"仍在花钱的卡片拒绝删除"硬闸;如果只有前端一道拦,绕过 UI 的直接调用可能仍会删掉一个已扣费未出结果的卡片。
7. **production SHA `7ed7ac22` 在本仓库历史里无法 `git rev-parse` 解析**——无法建立 ancestor 关系判断"哪些能力晚于它合并因此未部署"。本分片所有 `stage_prod` 列一律标 Unknown,不能像工单期待的那样按 SHA 精确切分「已部署/未部署」。

## Unknowns

- production web SHA `7ed7ac22` 在本 worktree 无法 `git rev-parse` 解析(既不是本仓库对象,也可能是被压缩/rebase 过的历史,或来自另一个未 fetch 的远端)——所有 `stage_prod` 判定因此全部 Unknown,不是本分片能补的证据缺口,而是工单给定事实与本地 git 历史不对齐。
- production worker 服务 SHA:Unknown(工单本身声明未知)。
- "A/B 分叉"判决文档定位:预算内未找到,不确定是否存在于本分片未覆盖的路径(如 docs/research 或 docs/ops 下按日期归档的判决文件,未逐一扫描)。
- "视频拼接 stitch" 与既有 render.ts xfade/concat 管线是否为同一功能(还是两个独立概念):需要产品侧判断,本次只能确认"没有一个叫 stitch 的独立实现"。
- E1-18(失败恢复)服务端是否有对应硬闸:预算内未验证,只确认了前端拦截层。
- E1-13(产品 URL ingest)的 LLM escalation 分支细节未展开读代码,只确认文件与测试存在。

## Dropped(预算放弃项)

- 未逐行核对 `packages/core/src/timeline.ts` 完整渲染管线细节(已由 2026-07-02 地图充分覆盖,本次只做增量 diff 核对,未发现该文件在此期间有结构性变化之外的新增改动)。
- 未展开验证 storyboard 全链跑通到最终 render 输出这一步的端到端测试是否存在(只确认了"铸子卡→子卡花钱"这一段的测试覆盖)。
- 未对比 staging(`54c1de0b`,immersive 分支)与 main 在创作区/资产区的差异——工单要求这块用 main 实况判定,staging 属于另一条产品线,未测绘。
