# Otto whole-clip reference video (整段视频参考, v1) — design

**Date:** 2026-07-02
**Status:** approved-for-planning (pending founder spec review)
**Builds on:** reference-vision + 抽帧 (PR #84, merged `87519aa`); research in the corrected Non-goals of
[2026-07-01-otto-reference-vision-design.md](2026-07-01-otto-reference-vision-design.md)

---

## 一句话 (TL;DR)

拖一段视频进 Otto 聊天框,除了"抽一帧",现在也可以**整段当参考**:视频上传后,生成视频时把整段片子传给
Seedance 2.0(`reference_video`),模型照它的**运镜/节奏/风格**来生成,或**改写/续写**它 —— 用户想干嘛由提示词说了算。
**碰钱**(新的生成形状),所以必过 money-safety-review + 上线前花一点真钱实测那个 API 参数(测前先问创始人)。

**创始人已拍板:**
1. **通用**,不预设用法 —— 一套 `reference_video` 接线,运镜迁移/风格/改写/续写全靠提示词,模型自己理解。
2. **真人脸认证流程直接 SKIP,不考虑。** 真脸主体被 Seedance 拒 → 走现有"失败自动退款" + 友好报错,不做任何认证。
3. 输入片长要**设上限**保 margin(细节见 Money)。

## Problem

抽帧只给了"从这个画面开始";用户拿一段参考广告想要的常常是**动态**——运镜、节奏、转场、整体风格——一帧图给不了。
我们的默认模型 `seedance-2-fast`(BytePlus `dreamina-seedance-2-0-fast-260128`)**原生支持**视频输入
(`{type:"video_url", video_url:{url}, role:"reference_video"}`,官方 ModelArk/1520757 + /1330310),
只是我们没接线。

## Goals

拖视频 → 选择"整段当参考" → 视频上传成素材 → 用户要求生成视频时,整段片子作为 `reference_video`
传给 Seedance → 产出照参考的运镜/风格,或按提示词改写/续写。

## Non-goals (v1 明确不做)

- **真人脸认证/资产库流程** — 创始人明确 SKIP。真脸主体输入被模型拒 → 现有 fail-closed 退款 + 报错文案。
- **多段参考视频**(API 支持 ≤3 段;v1 只 1 段)、**参考音频**、**reference_image 1–9 张**(以后)。
- **fal 那条路** — 只接 BytePlus(我们的默认)。
- **Otto "看"视频像素** — v1 Otto 靠文字理解("用户挂了一段参考视频")+ 本地抽帧缩略图仅作 UI 显示;
  真正的 keyframe 视觉管线是 v2。
- 改动图片参考(`sourceGenerationId`)的任何行为。

## Design

### UX — 复用抽帧的入口,一个面板两个出口

用户拖视频进 streaming composer → 现有的**选帧面板**打开,新增第二个动作:

- **Use this frame**(现有)→ 抽一帧当图片参考(不变)。
- **Use whole video**(新)→ 整段视频走 `uploadFilesDirect` → `finalizeCandidateUploads`
  (上传管线**本来就收** mp4/mov/webm,见 `UPLOAD_EXTS`)→ 得到视频 `Generation` id →
  attach 成 `referenceVideoGenerationId`;缩略图 = 当前 canvas 那一帧(本地,只做显示)。
  Chip 上标出"整段参考"以区别于图片参考。

客户端在选帧面板读到 `duration` 后即校验片长(见 Money 的 2–10s 界),超界禁用"Use whole video"并说明原因。

### 数据流 — 与图片参考平行的新字段(不混用)

新字段 **`referenceVideoGenerationId`**,全链路与 `sourceGenerationId`(图片首帧)平行且互斥语义清晰:

1. **Composer** 发送 `referenceVideoGenerationId`(streaming route + ottoTurn 两条路都收)。
2. **服务端校验(新的、独立的门):** owned + in-project + **video ext (`mp4/mov/webm`)** 的
   `generation.findFirst`。**现有 4 个"只收图片"的门一字不动** —— 不放宽,新字段配新门,图片门照旧封死。
3. **OttoContext** 加 `referenceVideoGenerationId?: string | null`;`buildContextSystemMessage`
   注入一句"the user attached a REFERENCE VIDEO this turn (you cannot see it; reason from their text;
   it will guide the video generation's motion/style)"。
4. **propose**(`propose.helpers.ts`):`ctx.referenceVideoGenerationId` 只对 `kind === "video"` 的计划
   进入 CardPayload(镜像 `isI2V` 的门法);对 image 计划忽略(参考视频只对视频输出有意义)。
   **不强制 kind** —— 沿用 #84 的 decouple 原则,planner 依用户意图定。
5. **genRequest**(`packages/core/src/gen.ts`):新增可选 `referenceVideoGenerationId`,`checkCast`
   验证同 `sourceGenerationId` 模式。`buildGenRequestFromCard` 从 payload 透传。**这是 spend-path 改动。**
6. **Worker**(`apps/worker/src/jobs/gen.ts`):镜像现有 i2v 源解析 —— resolve → 校验(owned/in-project/
   video-ext)→ presign;**找不到/取不到 → `failClosedWithRefund`**(与 i2v 完全同款,先退款不白扣)。
7. **Provider**(`packages/generation/src/byteplus.ts`):`VideoRequest` 加 `refVideoUrl`;
   `generateVideo` 在 content 数组加 `{ type: "video_url", video_url: { url }, role: "reference_video" }`。
   FalProvider 不改(收到该字段 → 明确抛错拒绝,防静默丢弃)。

`sourceGenerationId`(首帧)与 `referenceVideoGenerationId` **同回合互斥**:composer 一次只允许一种 attach
(现 UI 本来就单 attach),服务端校验若两者同时出现取 referenceVideo、丢弃另一个并记日志。

### 真脸/内容被拒的兜底

Seedance 对"真人脸当主体"的输入会拒(输入侧人脸检测)。不做任何预检:provider 报错 → 现有
fail-closed 退款路径 → 用户看到友好文案(如"参考视频里的真人内容被模型拒绝了 — 试试产品/场景素材")。
**分文不损**:退款语义与现有 i2v 源丢失完全一致。

## Money(必过关卡)

- **收费不变:同 `seedance-2-fast` 视频档,720p = 7cr**,由现有 `FLAT_PRICED_VIDEO_MODELS` 平价表出——
  **`pricedGenCredits` 一行不改**,预扣=实扣照旧成立(卡片与 startGen 同源)。
- **输入片长界:2–10 秒**(Seedance 每段下限 2s;10s 上限护 COGS——参考视频的输入时长会计费)。
  客户端读 metadata 校验;越界不给上传整段。常量集中一处,便于调。
- **spend-path 改动清单(= money-safety-review 范围):** `genRequest` 新字段、`buildGenRequestFromCard`
  透传、worker 解析+fail-closed、`byteplus.ts` content part。**不改**:价格函数、reserve/settle、
  幂等/去重、卡片计价来源。
- **上线双门:**
  1. **money-safety-review** skill 过整个 diff;
  2. **付费实测**:合并前用真 API 跑一次 reference_video(确认参数名/形状/行为 + 记录**实际 COGS**)——
     **花钱前先问创始人**(规矩)。若 10s 输入的实测 COGS 明显超过 7cr 收入(>20%),把片长界收到 5s
     (改常量)再上,而不是改价格函数。

## Testing

- **单测:** 新门校验(owned/in-project/video-ext/互斥);propose 的 kind=video 门(image 计划忽略该字段;
  reserve==settle 断言照抄 #84 的 4a/4b 风格);`buildGenRequestFromCard` 透传;byteplus `generateVideo`
  content-part 形状(mock fetch);Fal 收到 refVideoUrl → 抛错。
- **Worker:** 参考视频缺失 → `failClosedWithRefund`(镜像现有 i2v 测试)。
- **付费 E2E(创始人门):** 真 API 一次,验证参数 + 实测成本。
- **真机 smoke:** 拖视频 → Use whole video → chip → "照这段的运镜给我的产品来一条" → 出视频。

## Rollback

Feature 尾端是 provider 的一个 content part + 一个可选字段:revert 该 PR 即回到纯图片参考;无迁移。
