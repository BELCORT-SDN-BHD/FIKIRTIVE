# Otto Prompt 精通 skills 设计 —— `seedreamPrompt`(图) + `seedancePrompt`(视频)

**状态:** 设计已与创始人对齐(brainstorm 完成 2026-07-01,研究支撑)。下一步:writing-plans 出实现计划 → subagent-driven TDD,节奏同 block 1。

**语言约定:** 本 spec 及 skill 文档用华语(创始人偏好)。装配出的**生成 prompt 一律英文**(图/视频模型英文调优)。

---

## 0. 在 roadmap 的位置

创作子项目的 **block D/E**(创作 spec `2026-07-01-otto-creation-experience-design.md` §4.1 的 D/E)。block 1(`requires` 资讯门 / 刨根问底)已 ship = **PR #83**。创作剩余顺序:**D/E(本文件)→ F storyboard 卡片 → G 两道闸执行**。每块独立 brainstorm→spec→plan→实现。

---

## 1. 目标

Otto 今天写的 `structuredPrompt` **原样直送模型**,是通用 prompt,没有 per-model 调优。D/E = **两个确定性"造 prompt"skill**,把结构化创作意图拼成契合 **Seedream(图)/ Seedance(视频)** 各自偏好风格的**英文** prompt。

**核心约束(创始人):我们的用户不懂 prompt / 不懂摄影。** 所以镜头、光线、动作这些专业活**不能去问用户**——由 **Otto + skill** 负责。skill 提供结构 + 词表,Otto(被 skill 的 description/词表引导)负责填。**加一个模型 = 加一个这样的 skill。**

---

## 2. 现状(研究 + 源码,2026-07-01)

- **prompt 直送模型**:`propose` → `CardPayload.structuredPrompt` → worker → `BytePlusProvider`。图:prompt 原样 `POST /images/generations`;视频:provider 追加 `${prompt} --resolution/--duration/--ratio`(技术 flag 自动加,skill **不产出** flag)。`packages/generation/src/byteplus.ts`。
- **已有一层顾问式提示** `packages/core/src/cowork-directives.ts`(全部 `confidence:"untested"`)——只"提醒"Otto 自己写。**D/E 是它的确定性装配器版**(同知识,但结构化输入→精确字符串输出,Otto 不再自由发挥模型规则)。
- **模型(实测确认)**:图 = `seedream`(`seedream-5-0-260128`);视频 = `seedance-2-fast`(`dreamina-seedance-2-0-fast-260128`):**720p、时长 [5,10]、16:9|9:16、audio-on、`tail:false`(只有首帧,无尾帧)**。`packages/core/src/gen.ts`。
- **reference(实体条件化)**:`entityIds`(schema/worker 支持最多 8 实体 / 10 图,`gen.ts:351-426` round-robin+封顶+presign+不可达拒付)→ 但 **provider 只发第 1 张**(`byteplus.ts:30` `image: inputImageUrls[0]`,注释 "v1 limitation")。**`@图片N` 是消费级"即梦 web app"机制,不在我们的 Ark API 线上**(参考图走 API 参数,不走 prompt 文字)。"多图真喂给模型"的最后一公里 = 独立 task **`task_dc06ac5a`**(改 provider 那行 + 先验 Ark + money review),**不属于 D/E**。

---

## 3. 决策(创始人拍板)

1. **输出英文** —— 和现有 `structuredPrompt` 契约一致;结构(谁做什么/一镜一动/衔接)跨语言通用;走 fal/BytePlus API,非消费级即梦。
2. **无面向用户的 `requires`** —— 用户不懂摄影,不去问他们镜头/光线;`subject`/`action` 仍 zod 必填,但**由 Otto 从 goal/品牌上下文推断填入**。skill 的 description + 词表负责"逼"Otto 把 camera/光照/构图填好。用户侧追问只停在 block 1 的 `goal`/clarify。
3. **视频默认加 clean-footage 负向约束**(`no on-screen text, watermark, or logo`);当创意确实要字/logo 时 Otto 关掉(`cleanFootage:false`)。图**不**默认加(图的 `textContent` 是刻意功能)。
4. **reference = 措辞 + 身份锁定,不搬像素** —— 像素永远走 `entityIds → worker → API 参数`(D19 信任边界)。skill 只据 `role`/`name` 织入英文身份锁定句。
5. **形态 = 主动确定性装配 skill**(纯模板,无额外 LLM,$0),每模型一个。
6. **cowork-directives 关系** —— 这两个 skill 成为 seedream/seedance 的**唯一权威**;`cowork-directives.ts` 只留给没有专属 skill 的模型作 fallback。

---

## 4. `seedreamPrompt` skill(图,Seedream 5.0)

### 4.1 输入 schema(`skills/seedream-prompt.helpers.ts`)

```ts
const seedreamRef = z.object({
  role: z.enum(["character", "product", "location", "brandmark"]),
  name: z.string().min(1).max(64),   // 仅用于织入英文措辞，不带 entityId
  lock: z.boolean().default(true),   // true=锁一致；false=只借鉴风格
});

const seedreamPromptInput = z.object({
  mode: z.enum(["t2i", "i2i"]).default("t2i"),
  // t2i / 共享创作意图（Otto 填，非问用户）
  subject:      z.string().min(1),                 // 必填 —— 主体，权重最前
  actionPose:   z.string().optional(),
  environment:  z.string().optional(),
  style:        z.string().optional(),
  lighting:     z.string().optional(),
  colorPalette: z.string().optional(),
  cameraLens:   z.string().optional(),             // 取景/镜头/景深/角度
  mood:         z.string().optional(),
  detail:       z.string().optional(),             // 具体材质纹理，非堆砌 buzzword
  textContent:  z.string().max(60).optional(),     // 图内文字，引号内、放最后
  forVideo:     z.boolean().default(false),        // 作视频首帧 → 干净可动构图
  references:   z.array(seedreamRef).max(8).default([]),
  // i2i 编辑模式
  editVerb:     z.enum(["Add", "Remove", "Replace", "Change"]).optional(),
  editTarget:   z.string().optional(),
  preserve:     z.string().optional(),
});
```

必填仅 `subject`(t2i)。i2i 模式 Otto 应填 `editVerb`+`editTarget`(Otto 从上下文判断,非问用户)。**无 `requires`**(见决策 2)。

### 4.2 确定性装配(Seedream 偏好:prose、最前 token 权重最高)

```ts
function assembleSeedream(i: SeedreamPromptInput): string {
  if (i.mode === "i2i") {
    const parts = [
      `${i.editVerb} ${i.editTarget}`,
      i.style && `restyle to ${i.style}`,
      i.lighting,
      identityLockClause(i.references),
      i.preserve ?? "keep everything else unchanged, maintain the same composition and lighting",
    ];
    return parts.filter(Boolean).join(", ");
  }
  const parts = [
    i.subject, i.actionPose, i.environment, i.style, i.lighting,
    i.colorPalette, i.cameraLens, i.mood, i.detail,
    i.forVideo && "clean uncluttered composition with headroom for motion, single dominant light direction",
    identityLockClause(i.references) || undefined,  // 直接追加祈使句（已是完整句）；不套 "featuring"（否则 "featuring keep/reproduce…" 语法破损，见实现 fix 789f96c）
    i.textContent && `with the text "${i.textContent}" in bold sans-serif, placed prominently`,
  ];
  return parts.filter(Boolean).join(", ");
}
```

join 逻辑:present 字段按固定顺序 `join(", ")`;缺省静默跳过;`textContent` 永远最后、加引号;`identityLockClause` 见 §6.2。

### 4.3 例子

t2i + forVideo:输入 `{subject:"a matte-black wireless headphone", environment:"soft cream-to-warm-gray gradient background", style:"premium product photography", lighting:"soft box key light from upper-left", cameraLens:"85mm, shallow depth of field", forVideo:true}` →
```
a matte-black wireless headphone, soft cream-to-warm-gray gradient background, premium product photography, soft box key light from upper-left, 85mm, shallow depth of field, clean uncluttered composition with headroom for motion, single dominant light direction
```
i2i:输入 `{mode:"i2i", editVerb:"Replace", editTarget:"the background with a beach sunset", preserve:"preserve all foreground elements exactly"}` → `Replace the background with a beach sunset, preserve all foreground elements exactly`。

---

## 5. `seedancePrompt` skill(视频,Seedance 2.0)

输出**只是创作 prompt**(provider 追加 `--resolution/--duration/--ratio`,skill **不出**技术 flag)。主模式 = **i2v**(相对首帧描述运动)。本层 `tail:false`,**无首+尾帧模式**,多镜头连贯 = 手递手,现为**文字提示**(真链接 = block G)。

### 5.1 输入 schema(`skills/seedance-prompt.helpers.ts`)

```ts
const seedanceShot = z.object({
  subject:     z.string().min(1),        // 谁/什么（i2v：引用首帧，别重描）
  action:      z.string().min(1),        // 做什么/怎么动 —— i2v 最关键
  camera:      z.string().optional(),    // 一镜一动
  shotFraming: z.string().optional(),    // 景别 + 角度
  sceneLight:  z.string().optional(),    // 环境 + 光方向 + 色温（i2v：光如何变化）
  mood:        z.string().optional(),
  audio:       z.string().optional(),    // SFX/环境/对白，自成一行
});

const seedancePromptInput = z.object({
  mode:  z.enum(["i2v", "t2v"]).default("i2v"),
  style: z.string().optional(),          // clip 级风格锚，前置
  pacing: z.string().optional(),         // 慢动作/硬切/一镜到底
  shots: z.array(seedanceShot).min(1).max(4),
  continuesFromPrev: z.boolean().default(false),  // 本 clip 首帧 = 上 clip 末帧（现为文字提示）
  references: z.array(seedreamRef).max(8).default([]),  // 复用同一 ref 形状
  cleanFootage: z.boolean().default(true),  // 默认加“禁止字/水印/logo”；要字/logo 时 Otto 关
  constraints: z.string().optional(),       // 额外禁止项
});
```

必填 `shots[0].subject` + `shots[0].action`。`camera`/`shotFraming`/`sceneLight` 可选但**强烈建议**(description 引导 Otto 填,非问用户)。**无 `requires`**。

### 5.2 确定性装配(创作 prompt only,无 `--flags`)

```ts
function assembleSeedance(i: SeedancePromptInput): string {
  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    const seg = [
      idx === 0 && i.continuesFromPrev && "continuing from the previous frame,",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "starting from the given first frame,",
      s.shotFraming, s.subject, s.action, s.camera, s.sceneLight, s.mood,
    ].filter(Boolean).join(", ");
    lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
    if (s.audio) lines.push(`Audio: ${s.audio}`);
  });
  if (i.mode === "i2v") lines.push("keep the subject consistent with the source frame — preserve face and outfit");
  const locks = identityLockClause(i.references);
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  if (i.cleanFootage) lines.push("no on-screen text, watermark, or logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}
```

**有意丢弃(研究里有但不适用,不 port):** `@图片N`/`@视频N`/多模态组合、视频延长、首+尾帧 —— 消费级即梦特性,`seedance-2-fast` `tail:false`,照搬=编造。

### 5.3 例子(i2v 单镜)

输入 `{mode:"i2v", shots:[{subject:"the man in the frame", action:"footsteps slow, finally stops at the door, takes a deep breath", camera:"slow dolly in", shotFraming:"facial close-up", sceneLight:"warm interior light strengthens from the left", audio:"quiet ambient room tone"}]}` →
```
facial close-up, the man in the frame, footsteps slow, finally stops at the door, takes a deep breath, slow dolly in, warm interior light strengthens from the left
Audio: quiet ambient room tone
keep the subject consistent with the source frame — preserve face and outfit
no on-screen text, watermark, or logo
```
(provider 再追加 `--duration 5 --resolution 720p --ratio 16:9`)

---

## 6. 共享词表 + reference 措辞

### 6.1 `packages/otto/src/skills/prompt-vocab.ts`(参考列表,非枚举 —— 字段保持自由文本)

```ts
export const CAMERA_MOVES = ["dolly in (推镜头)","pull out (拉镜头)","pan (摇镜头)","tracking (跟拍)",
  "orbit (环绕)","aerial (航拍)","handheld follow (手持跟拍)","crane up/down (升降)",
  "fixed (固定)","one continuous take (一镜到底)"] as const; // 规则：每 shot 只一个
export const SHOT_SCALES = ["extreme wide","wide","full","medium","medium close-up","close-up","extreme close-up"] as const;
export const CAMERA_ANGLES = ["eye-level","high-angle","low-angle","bird's-eye","POV"] as const;
export const LIGHTING = ["golden hour","dramatic side light","soft diffused","moody low-key","bright high-key",
  "studio soft box (45°)","backlight / rim","neon","volumetric","natural window light"] as const; // 规则：给方向+色温，别写“漂亮的光”
export const STYLES = ["cinematic","photorealistic","editorial photography","product photography","documentary",
  "film grain","3D CG render","ink-wash (水墨)","cyberpunk neon","minimalist"] as const;
export const PACING = ["slow-motion","hard cut","fast cut","timelapse","one continuous take"] as const;
```

`SHOT_SCALES/CAMERA_ANGLES/PACING/CAMERA_MOVES` 视频为主;`LIGHTING/STYLES` 共享。这些进 skill 的 description(引导 Otto 用"画得出来"的词),不做成 enum(否则过约束、随模型演进易碎)。

### 6.2 `identityLockClause`(reference 措辞,纯函数)

```ts
function identityLockClause(refs: ReferenceInput[]): string {
  if (refs.length === 0) return "";
  const lock: Record<Role, (n: string) => string> = {
    character: n => `keep ${n} identical to the reference — same face, hairstyle, and build`,
    product:   n => `feature ${n} exactly as in the reference — same shape, color, and label`,
    location:  n => `match the setting of ${n} to the reference environment`,
    brandmark: n => `reproduce the ${n} logo exactly as in the reference, unaltered`,
  };
  const style = (n: string) => `draw stylistic inspiration from ${n}`;
  return refs.map(r => (r.lock ? lock[r.role] : style)(r.name)).join("; ");
}
```

**要点:** 不收 `entityId`(身份/所有权由 `propose` 的 `entityIds` + `executePropose` owner-scoped 校验负责;prompt skill 收 entityId 会撞 AGENTS.md「参数禁身份字段」);只承载措辞所需的 `role`/`name`。**即便 provider 现在只喂 1 张图,措辞也把多个身份一起锁住**(多图真喂 = `task_dc06ac5a`)。

---

## 7. Gate + 集成

- **Gate**:两个 skill 均 `cost:"free"` / `effect:"read"` / `reach:"internal"` → `needsApproval=false`。纯字符串装配,不建 GenJob、不碰 fal/reserveCredits、过 CI import fence。`execute: async (i) => ({ prompt: assemble(i) })`。**无 `requires`。**
- **指令路由**(加进 `instructions.ts` 的 prompt-mastery 块):
  - `kind:"image"` → 先调 **`seedreamPrompt`** → `propose({ kind:"image", structuredPrompt: result.prompt, forVideo, entityIds, count })`。
  - `kind:"video"` → 先调 **`seedancePrompt`** → 用 `result.prompt` 提视频(i2v 由 `ctx.sourceGenerationId` 服务端自动识别)。
  - **storyboard(block F)**:每 shot 调一次 `seedancePrompt`(或一次传 `shots[]`);后续 shot 置 `continuesFromPrev:true`。
  - 这两个 skill **取代** `cowork-directives` 对 seedream/seedance 的自由发挥;directives 留作其它模型 fallback。
- **"看图 prompt"依赖**:为 i2v/i2i 写更好的 prompt,Otto 最好能**看见**源图 —— 那是 multimodal-to-planner(参考上传 chip `task_21c8587b` 的第 ③ 块)。**D/E 不阻塞**(Otto 从 goal/结构化意图写);"看图"增强随该 chip 落地后自然增益。

---

## 8. Build 顺序(D/E 内,一次一块)

1. `prompt-vocab.ts` 常量(+ 单测)。
2. `seedreamPrompt`(helpers 装配纯函数 + skill + 测试:装配确定性、references 措辞、i2i、forVideo)。
3. `seedancePrompt`(helpers + skill + 测试:装配、i2v 首帧句、continuesFromPrev、cleanFootage、references、无 `--flags`)。
4. `registry.ts` 注册两 skill + `migration.test.ts` gate 断言 + `instructions.ts` 路由块(+ 测试)。
5. `pnpm --filter @fikirtive/otto run catalog` 重生成。

catalog skill 数 13→15(注:`registry.test.ts` 硬编码"13 skills"名单 —— 本块**新增 2 个**,该断言要更新为 15 并加入 `seedreamPrompt`/`seedancePrompt` 两个新名。这是本块唯一需要动既有测试断言的地方)。

---

## 9. 权威 vs 存疑

**有据(源码/实测文档/多源一致):** Seedream 最前 token 权重、prose 非 tag 堆、字段序(主体→动作→环境→风格→光→镜头→文字最后)、文字加引号最后、i2i 单动词+说明保留什么;Seedance WHO-does-WHAT、一镜一动、i2v 描述相对首帧的运动、情绪外化为动作、audio 独立行、衔接=上镜头末态==下镜头初态;`seedance-2-fast` 720p/[5,10]/16:9|9:16/audio-on/无尾帧;prompt 须英文;reference 走 API 参数、provider 现仅单图。

**存疑(保守处理/已丢弃):** `@图片N`/多模态/视频延长/首+尾帧(消费级即梦,已丢弃);字数阈值(社区,未编码为限制);"禁快动/禁时间码/禁负向"(与 BytePlus 官例冲突 → `cleanFootage`/`constraints` 做成可选);Seedream 5.0 专属行为(5.0 当时预览,多继承 4.5 → 只软反映);官方 doc 正文 JS 渲染未直取(靠 in-repo 蒸馏 + 社区镜像,维护者应对活文档复核);identity-lock 措辞的实际效力(需真出图迭代)。

**来源:** fal.ai seedream/seedance prompt guide · docs.byteplus.com ModelArk · datacamp seedance/seedream · wavespeed/seedreamv5/evolink/atlabs guides · github.com/{songguoxs/seedance-prompt-skill, dexhunter/seedance2-skill}。in-repo:`cowork-directives.ts`、`byteplus.ts`、`byteplus.test.ts`、`gen.ts`、`2026-06-29-phase2-byteplus-migration-design.md`。

---

## 10. 相关文件 + 已 spun-off

- 新建:`packages/otto/src/skills/{seedream-prompt.ts, seedream-prompt.helpers.ts, seedance-prompt.ts, seedance-prompt.helpers.ts, prompt-vocab.ts}` + 各 `.test.ts`
- 改:`packages/otto/src/registry.ts`、`migration.test.ts`、`instructions.ts`(+ test)、`registry.test.ts`(13→15)、`skills/CATALOG.md`(生成)
- 参考:`packages/core/src/cowork-directives.ts`(fallback 保留)、`byteplus.ts`(prompt 落点)、`propose.helpers.ts`(structuredPrompt 入口)
- **spun-off(不属 D/E):** 多参考真喂给模型 = `task_dc06ac5a`;参考上传+看图 prompt = `task_21c8587b`
