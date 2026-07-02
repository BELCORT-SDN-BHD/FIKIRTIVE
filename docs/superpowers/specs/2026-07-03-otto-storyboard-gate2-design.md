# Otto 创作 · Block G 设计 —— 闸②(make all 视频)

**状态:** 设计与创始人对齐(brainstorm 2026-07-03:时长 = model-driven、部分执行 = 有帧即可做)。机制 = F4 闸① 的子卡设计克隆到视频。下一步:writing-plans → Opus SDD → money-review(节奏同 F4)。

**语言约定:** spec 华语;生成 prompt 英文;卡片 chrome 英文。

---

## 0. 在 roadmap 的位置

创作子项目最后一块。已 ship:Block 1(#83)、D/E(#91)、F 分镜卡 $0 全链(#99)、**F4 闸① 首帧图(#111,2026-07-03 合并)**。本文件 = **G(闸②:make all 视频)**。总设计 `2026-07-01-otto-creation-experience-design.md`;F/F4 机制 `2026-07-02-otto-storyboard-card-design.md` §7。

---

## 1. 目标

用户在分镜卡上看过「文字 + 真实首帧图」、逐帧改满意后 → **一键 "Make all videos(N · X credits)" 聚合审批**,每个有帧镜头出一段独立视频(i2v,首帧图作源帧);支持单镜头重做视频。交付 = N 个独立成片(拼接以后再说,后端无 concat)。

---

## 2. 创始人拍板(2026-07-03 brainstorm)

1. **时长 model-driven,不写死默认**:每镜头可选时长,选项**来自模型能力表**(`packages/core/src/gen.ts:115-132` 的 `durations[]`,如 seedance-2-fast = [5,10])——未来加新模型,选项自动跟着模型走,UI/校验不硬编码。下游本就有 `snap(desiredDuration, o.durations)`(cowork-route.ts:67)按模型吸附。
2. **部分执行**:点 "Make all videos" 时**有首帧图的镜头就开做**,没图的跳过并提示(用户随后可自己补生成首帧,再回来做剩下的视频)。不设"全部有帧"硬门。
3. **v1 不做连贯**(沿 F 决策 2:所有镜头独立,可并发/顺序循环,无末帧链)。连贯模式留后。

---

## 3. 机制(= F4 §7 子卡设计,零新钱路)

- **payload 每镜头加三个字段**(全部服务端写,zod 输入不收):
  - `durationSeconds?: number` —— 该镜头视频时长(用户在卡上选/Otto 建议;**校验 = 交给下游模型吸附**,入库仅存数字)
  - `videoCardId?: string` —— 当前视频子 GEN_CARD id(同 `firstFrameCardId` 语义)
  - `videoGenerationId?: string` —— 视频生成完写回(同 `firstFrameGenerationId` 语义)
- **$0 铸卡** `prepareStoryboardVideos(cardId)`:对每个 `firstFrameGenerationId` 存在且缺视频的镜头,铸视频子卡 —— `buildProposeCard({kind:"video", structuredPrompt: shot.videoPrompt, desiredDuration: shot.durationSeconds, entityIds: [], variantSel:{}, count:1}, ctx)`,**ctx.sourceGenerationId = shot.firstFrameGenerationId**(i2v 源帧;video conditions on source frame, not entity refs)。子卡 payload 带 `{storyboardCardId, shotId}` 回链。reuse-if-fresh:已有未花钱子卡且 prompt+源帧+时长 都一致 → 复用。
- **花钱只在客户端确认点**:同 F4,循环未改动的 `coworkGenerate(childCardId)`,每子卡自己的 `cowork:<childCardId>` once-EVER key。**视频贵(Seedance ≈按秒计价)**,聚合确认额度会明显大——余额 fail-closed 门 + startGen 真兜底,照旧。
- **$0 对账**:现有 `syncStoryboardFirstFrames` 泛化为**统一 sync**(帧 + 视频两类写回,同一事务 RMW、additive-only、FAILED 惰性):视频子卡 DONE 的 genId ≠ 当前 `videoGenerationId` → 定点覆写;返回 `videoUrls`(同 frames 的 owner-scoped URL 解析,视频文件)。
- **单镜头重做视频** = 再铸一张视频子卡(I1 修复后的替换语义:**旧视频保留到新视频落地才被覆盖;取消 = 真无操作**;reuse-if-fresh 防孤儿)。
- **陈旧级联(帧变 → 视频作废)**:视频以某张首帧为源,故以下情况**清该镜头 `videoCardId`/`videoGenerationId`**:(a) `editShotPrompt` 改 `videoPrompt`(视频文字过期;只清视频两键);(b) 改 `firstFramePrompt`(帧都过期 → 清帧两键 + 视频两键);(c) 帧被重出且新帧落地(sync 覆写 `firstFrameGenerationId` 时,若该镜头有视频键 → 一并清除——源帧变了,旧视频不再代表这镜头)。级联只删引用,不删 Generation(已生成的东西永远在 library)。
- **时长选项供给(model-driven)**:$0 server action `getStoryboardVideoOptions()` —— 服务端跑与铸卡同源的模型选择(kind:"video" 默认上下文),返回选中模型的 `durations[]`(+model 名);卡片挂载时取一次,渲染每镜头的时长选择。**客户端不写死 [5,10]**。

---

## 4. UI(分镜卡内,沿 F4 惯例)

- 每镜头(有帧后):时长选择(选项来自 `getStoryboardVideoOptions`)+ 视频状态(无 / Replacing 提示 / 播放器或封面 + "Remake video")。
- 卡级 "Make all videos(N clips · X credits)":N = 有帧且缺视频的镜头数;确认流程、单一事实源(本次 prepare 返回集)、busy/编辑互斥、部分失败容错 —— 全部照 F4。没帧的镜头在按钮旁提示 "M shots need a first frame first"。
- 视频子卡在聊天流隐藏(既有 `payload.storyboardCardId` 守卫天然覆盖,无需新码);子卡 GEN_RESULT 可见性沿 v1 决定(与 PackCard 同形)。
- 编辑 ⊥ 花钱互斥沿 F4(`generating` 锁全部编辑;时长选择算编辑类,generating 时禁用)。

---

## 5. Money-safety(硬约束,全部沿 F4 已验证不变量)

- 服务端零花钱(铸卡/选项/对账全 $0,genJob 只读);禁复合 key;花钱仅客户端确认点走未改动 `coworkGenerate`;最坏情况 = $0 孤儿子卡(once-EVER 索引兜底);sync additive-only 事务 RMW;级联清除只动引用键、绝不触发自动重生成。
- 视频计价:`buildProposeCard` 对 kind:"video" 的 estimatedCredits 已按模型/时长定价(与单卡 propose 完全同源)——报价 = 实扣。
- 实现走 **money-safety review**(整支,合并前硬门,同 F4 两轮标准)。

---

## 6. Build 顺序(Opus SDD,碰钱的放后)

1. payload 三字段 + 编辑/级联纯变换 + parse 透传($0,测试)。
2. `getStoryboardVideoOptions`($0)+ `prepareStoryboardVideos`($0 铸卡,reuse-if-fresh)+ 测试(F4 Task 2 同款断言强度)。
3. 统一 sync 泛化(帧+视频写回 + 帧覆写级联清视频 + videoUrls)+ 测试。
4. UI(时长选择 + make-all-videos 聚合确认 + 单镜头重做 + 播放器/封面)+ **`next build` EXIT 0 门**。
5. 整支 money-safety review(必须)。

---

## 7. 不在 G / 后续

- 连贯模式(末帧→下一首帧、顺序链式、逐镜头确认)——总设计 §4.2 留后。
- 成片拼接(无 concat 后端)。
- per-shot aspect/resolution 控制(沿模型默认;时长以外的参数选择留后)。
- 子卡 GEN_RESULT 在聊天可见(I2,v1 接受)+ F4 遗留 3 个显示级 Minor —— 可与 G 顺手修或单独 chip。

## 8. 相关文件

- 机制蓝本:`apps/web/lib/storyboard-gate1-actions.ts`(prepare/regen/sync 全套先例)、`apps/web/components/otto/StoryboardCard.tsx`(闸① UI 先例)
- 能力表:`packages/core/src/gen.ts:115-132`(`durations[]`)、`cowork-route.ts:67`(snap)
- 定价/铸卡:`packages/otto/src/skills/propose.helpers.ts`(buildProposeCard,ctx.sourceGenerationId → i2v)
- 花钱(不动):`apps/web/lib/cowork-actions.ts`(coworkGenerate)
