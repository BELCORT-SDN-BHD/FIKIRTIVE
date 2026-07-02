# Otto 分镜 · G(闸② make all 视频)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现 = Opus;每 task review + 整支 money-safety review(合并前硬门)。
> **机制蓝本 = F4 闸①(已合 main)**:`apps/web/lib/storyboard-gate1-actions.ts` + `StoryboardCard.tsx` 的闸① UI。G = 同一套子卡设计克隆到视频,凡与蓝本同形之处**照抄其模式与断言强度**,本 plan 只写差异与硬性语义。

**Goal:** 分镜卡闸②:每镜头时长选择(model-driven)→ "Make all videos(N · X credits)" 聚合审批(部分执行:有帧才做)→ i2v 视频子卡循环未改动 `coworkGenerate` → 统一 sync 写回 `videoGenerationId` + 播放展示;单镜头重做(替换语义同 I1 修复)。

**Architecture:** spec `2026-07-03-otto-storyboard-gate2-design.md` §3。钱路零改;级联规则 = 帧变则视频作废(只删引用键)。

## Global Constraints(全部继承 F4 已验证不变量)

- **钱路一行不改**;服务端 $0(无 GenJob 创建、genJob 只读、无 @fikirtive/generation);花钱仅客户端两类确认点(make-all-videos / remake-video)走现有 `coworkGenerate`;**禁复合 key**;子卡回链 `{storyboardCardId, shotId}`。
- **owner-scoped 身份仅 session**;zod-first `{error}` 风格;事务 RMW 定点写、additive-only、FAILED 惰性。
- **单一事实源**:spend 集只来自本次确认交互的 prepare 返回;编辑/时长变更即作废暂存集。
- **model-driven**:客户端不写死任何时长列表;选项唯一来源 = `packages/core/src/gen.ts:115-132` 能力表(经 $0 action 暴露)。
- **级联只删引用键**(videoCardId/videoGenerationId),绝不自动触发重生成,绝不删 Generation。
- 每 task 结束:相关 vitest 全绿 + `pnpm --filter @fikirtive/web typecheck` + **`pnpm --filter @fikirtive/web build` EXIT 0**(凡动 client 文件必跑)。

---

### Task 1: payload 三字段 + 编辑/级联纯变换($0)

**Files:** Modify `packages/otto/src/skills/propose-storyboard.helpers.ts`、`apps/web/lib/storyboard-edit.ts`、`apps/web/lib/storyboard-card.ts`、`apps/web/lib/storyboard-actions.ts`;Tests 同名测试文件。

**语义(硬性,测试逐条锁):**
1. `StoryboardCardPayload` shots += `durationSeconds?: number`、`videoCardId?: string`、`videoGenerationId?: string`(后两个服务端写;`durationSeconds` **进 zod 输入** `storyboardShot`(`z.number().int().min(1).max(60).optional()`,Otto 可按用户要求建议)+ `buildStoryboardPayload` 透传)。
2. **`applyEditShotPrompt` 级联修正**(改 F3 的无条件删帧行为):
   - patch 含 `firstFramePrompt` → 删 `firstFrameCardId`/`firstFrameGenerationId` **和** `videoCardId`/`videoGenerationId`(帧过期 ⇒ 视频过期)。
   - patch 只含 `videoPrompt` → **只删** `videoCardId`/`videoGenerationId`(**帧两键保留** —— 这是对 F3 行为的语义修正,原测试相应更新并注明)。
   - patch 新增 `durationSeconds?: number` → 只删视频两键(时长变 ⇒ 视频过期,帧无关)。
   - 一律 key-omission 删除;不 mutate 入参;其余变换(add/delete/reorder)`restamp` 展开自然保留新字段。
3. `parseStoryboardCardPayload` 透传三字段(defensive typeof);`StoryboardShotView` 同步。
4. `apps/web/lib/storyboard-actions.ts` 的 `editShotPrompt` zod 加 `durationSeconds` 可选并透传给纯变换;"两 prompt 都不传"的拒绝条件更新为"三个可改字段都不传才拒"。

**Steps:** TDD 红→绿→`pnpm --filter @fikirtive/otto build`→双 typecheck→commit `feat(otto): gate2 payload fields + video-staleness cascade in edit transforms ($0)`。

---

### Task 2: `getStoryboardVideoOptions` + `prepareStoryboardVideos`($0)

**Files:** Modify `apps/web/lib/storyboard-gate1-actions.ts`(或新 `storyboard-gate2-actions.ts`,实现者按文件体量判断,倾向同文件保持 loadCard/mintChild 复用);Tests 追加 describe。

**语义:**
1. `getStoryboardVideoOptions() → { model: string; durations: number[] } | { error }`:requireOwner 后,用**与铸卡同源**的模型选择(读 `buildProposeCard`/`selectModel` 对 kind:"video" 的选择路径)取将选模型,从 gen.ts 能力表(**读它的既有导出,不复制表**)返回 `durations`。$0 纯读。
2. `prepareStoryboardVideos({cardId}) → { children: ChildFrameCard[]; totalCredits } | { error }`:镜像 `prepareStoryboardFirstFrames`,差异:
   - eligible = `shot.firstFrameGenerationId && !shot.videoGenerationId`(**部分执行**:没帧的镜头静默跳过,由 UI 提示)。
   - 铸卡:`buildProposeCard({kind:"video", structuredPrompt: shot.videoPrompt, entityIds: [], variantSel:{}, count:1, desiredDuration: shot.durationSeconds}, ctx)`,**ctx.sourceGenerationId = shot.firstFrameGenerationId**(逐镜头 ctx;i2v)。确认 buildProposeCard 的输入面接受 desiredDuration(propose 输入 Pick 里有)——不接受则 BLOCKED 上报,不得绕。
   - 父卡写 `shot.videoCardId`(事务 RMW,同蓝本)。
   - reuse-if-fresh:未花钱子卡且 `structuredPrompt === shot.videoPrompt && payload.sourceGenerationId === shot.firstFrameGenerationId && (shot.durationSeconds === undefined || payload.params?.durationSeconds === shot.durationSeconds)` → 复用不铸。
3. **$0 断言全套照 F4 Task 2**(genJob.create 从未调、回链、owner-scoped、可重入不重铸、totalCredits 只加未花钱)+ 新增:子卡 payload 的 `sourceGenerationId` 正确、`kind:"video"`。

**Commit:** `feat(otto): gate2 $0 video child minting + model-driven duration options`。

---

### Task 3: 统一 sync(帧+视频写回 + 帧覆写级联清视频 + videoUrls)

**Files:** Modify 同文件(`syncStoryboardFirstFrames` → 泛化改名 `syncStoryboardMedia`,唯一调用方是 StoryboardCard,同步改;保守也可保留旧名 export alias)。Tests 追加/更新。

**语义:**
1. 候选 = 有 `firstFrameCardId` 的镜头(帧类,规则不变)∪ 有 `videoCardId` 的镜头(视频类,同构:子卡 DONE genId ≠ 当前 `videoGenerationId` → 定点覆写)。
2. **级联**:同一事务里,若某镜头的 `firstFrameGenerationId` 被**覆写为不同值**(帧被替换落地),且该镜头有视频键 → 一并删 `videoCardId`/`videoGenerationId`(源帧变 ⇒ 旧视频作废;spec §3(c))。首次写入(原无 genId)不触发级联。
3. 返回 `{ payload, frames, videos }`:`videos: Record<shotId, url>`,解析同 frames 的 owner-scoped 机制(视频 Generation → asset → storage URL;确认视频类 Generation 的 asset/storage 形状,蓝本在 data.ts / OttoResult 的视频 URL 路径)。
4. 既有帧类测试全部保持绿;新增:视频写回、same-genId 不写、not-DONE 惰性、**帧覆写级联清视频**、纯首写不级联、$0。

**Commit:** `feat(otto): unified storyboard media sync — video write-back + frame-replace cascade`。

---

### Task 4: UI —— 时长选择 + Make all videos + 单镜头重做 + 播放展示

**Files:** Modify `apps/web/components/otto/StoryboardCard.tsx`(照闸① UI 蓝本克隆状态机);两渲染器无需新改(props 已通)。

**语义(硬性):**
1. 挂载时取一次 `getStoryboardVideoOptions`($0);每镜头(有帧后)渲染时长选择(options 即返回的 `durations`,当前值 `shot.durationSeconds ?? 默认留空显示 "auto"`);变更走 `editShotPrompt({cardId, index, durationSeconds})`(级联由服务端保证)。`generating` 时禁用(时长属编辑类)。
2. "Make all videos(N clips · X credits)":N = eligible 数;流程/守卫/单一事实源/部分失败容错/`onBalanceRefresh` **全部照 `confirmGenerateAll` 蓝本**;按钮旁若有缺帧镜头显示 "M shots need a first frame first"(英文 chrome)。
3. 单镜头 "Remake video"(有视频后):**替换语义照 I1 修复后的 regen 蓝本**(旧视频保留到新落地;取消真无操作;确认文案含替换+花费)。
4. sync 轮询改调统一 sync;视频等待期加长(5s × 120 上限);`replacingShotIds` 机制复用并**在轮询放弃时清除**(顺手修 F4 遗留 M1)。
5. 展示:有 `videos[shotId]` → 小播放器 `<video controls preload="metadata" src={...} style={{maxWidth: 240}} className="rounded-[10px] border border-border" />`。
6. **花钱调用点全卡全文件必须恰好 3 处**(make-all-frames / make-all-videos / 单镜头重做共用的确认 handler 数按实现,原则:每处都在显式确认 handler 内,grep 断言写进 review)。无 mount/effect/poll 花钱;无 `@fikirtive/otto` 客户端值导入。

**Verify:** 全套 vitest(允许失败仅既有环境族)+ typecheck + **build EXIT 0**。Commit `feat(otto): gate2 UI — make-all videos + per-shot duration + remake + players`。

---

### Task 5: 整支 money-safety review(合并前硬门)

- [ ] 最强模型整支 review(F4 两轮标准):不变量 (a)-(i) 复核 + G 新增面(级联只删引用、时长 model-driven 无硬编码、sourceGenerationId 不可伪造〔服务端写〕、部分执行不误扣、统一 sync 双类写回精确)。Critical/Important → 修完由**原审复核**再谈合并。

---

## Self-Review

Spec §2 拍板逐条:时长 model-driven ✅(T2 选项 action + T4 无硬编码 + 下游 snap);部分执行 ✅(T2 eligible + T4 提示);无连贯 ✅(无链式代码)。§3 机制逐条:三字段 ✅ T1;铸卡/ctx.source ✅ T2;统一 sync+级联 ✅ T3;重做替换语义 ✅ T4;级联(a)(b)(c) ✅ T1(a,b)+T3(c)。Placeholder:本 plan 刻意以蓝本引用替代重复代码(蓝本已合 main 且经两轮 money 终审),硬语义均逐条列出且要求测试锁定。类型:`ChildFrameCard` 复用;`syncStoryboardMedia` 返回三键在 T3 定义、T4 消费。Money:见 Global Constraints。

## 相关文件

蓝本:`apps/web/lib/storyboard-gate1-actions.ts` / `StoryboardCard.tsx`(闸①)。能力表:`packages/core/src/gen.ts:115-132` + `cowork-route.ts:67`。定价:`propose.helpers.ts`(buildProposeCard,ctx.sourceGenerationId)。花钱(不动):`cowork-actions.ts`。spec:`2026-07-03-otto-storyboard-gate2-design.md`。
