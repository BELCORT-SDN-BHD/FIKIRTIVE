# Otto 分镜 · F2(渲染)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 F1 持久化的 `STORYBOARD_CARD` 在 Otto 聊天里渲染成一张只读的有序分镜卡(每镜头:首帧 prompt + 视频 prompt 文字),并让 Otto 知道多镜头广告/视频请求要走 `proposeStoryboard`。

**Architecture:** 三层薄改动,全 $0、不碰钱路。(1)render 侧抽一个防御式纯函数 `parseStoryboardCardPayload(unknown)` 把 DB 里的不可信 JSON 映射成视图模型(唯一带测试的单元,对齐 `pack-credit-math` 惯例);(2)一个薄 JSX 组件 `StoryboardCard`,样式镜像现役只读卡 `OttoActionPlanCard`;(3)把 `STORYBOARD_CARD` 接进**两个**渲染器(`OttoConversation` 普通用户、`OttoChatStream` founder/admin)+ 补齐两处手维护的 `ChatMessageDTO.kind` 联合 + stream 水合的占位文案。指令(`instructions.ts`)加一节讲何时用 `proposeStoryboard`。

**Tech Stack:** React 19 / Next.js(apps/web,注意 `apps/web/AGENTS.md`:这是改版 Next,写前查 `node_modules/next/dist/docs/`)、TypeScript、vitest(apps/web 无 React 渲染 harness → 只测纯函数)、Tailwind + `.gb`/shadcn tokens、`@fikirtive/otto` 包。

## Global Constraints

- **$0,零花钱路径。** F2 只渲染 + 指令,不产生任何 GenJob、不 reserve/settle、不改 spend 逻辑。闸①首帧图在 **F4**、闸②视频在 **G**。
- **卡片 chrome 用英文**(与 `OttoActionPlanCard`/`PackCard`/`OttoAdBuildCard` 一致:"Shot 1"、"First frame"、"Video");Otto 的对话回复仍随用户语言(由 instructions 既有规则管)。生成 prompt 一律英文。
- **样式镜像 `OttoActionPlanCard`**:外层 `<div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>` → `rounded-[18px] border border-border bg-secondary p-6` → 每行 `bg-card rounded-[14px]`,配色只用 token(`text-foreground` / `text-muted-foreground` / `border-border` / `bg-secondary` / `bg-card`),不写死颜色。
- **两个渲染器都要接。** `ottoStreamEnabled = isFounderAdmin(email)`:founder/admin 走 `OttoChatStream`(读 `m.metadata.kind/payload`),普通用户走 `OttoConversation`(读 `m.kind/m.payload`)。`STORYBOARD_CARD` 两处都要 dispatch,否则一侧渲染空白。
- **`ChatMessageDTO.kind` 是手维护的字符串联合,共两处**(`apps/web/lib/types.ts:68` 接口、`apps/web/lib/dto.ts:116` 的 cast),都要加 `"STORYBOARD_CARD"`。Prisma 生成类型已含(F1 迁移),`packages/db/dist` 已 build。
- **不改 `proposePack` / `generate` / 任何现役卡。** 只新增。

---

### Task 1: 渲染侧 payload 解析纯函数(pure, tested)

把 DB 存的 `STORYBOARD_CARD` payload(到 render 侧是 `unknown`)防御式映射成视图模型。这是本计划唯一带单测的单元(JSX 按仓库惯例不测)。复用 F1 已定义的 `StoryboardCardPayload` 形状 —— 从 `@fikirtive/otto` 导出它做单一真相源。

**Files:**
- Modify: `packages/otto/src/index.ts`(新增一行 type 导出)
- Create: `apps/web/lib/storyboard-card.ts`
- Test: `apps/web/lib/__tests__/storyboard-card.test.ts`

**Interfaces:**
- Consumes:`StoryboardCardPayload`(F1,`packages/otto/src/skills/propose-storyboard.helpers.ts`,形状 = `{ storyboardTitle: string; goal?: string; shots: { index: number; title?: string; firstFramePrompt: string; videoPrompt: string; firstFrameGenerationId?: string }[] }`)。
- Produces:`parseStoryboardCardPayload(payload: unknown): StoryboardCardView`、类型 `StoryboardCardView`、`StoryboardShotView`(供 Task 2 组件消费)。

- [ ] **Step 1: 先导出 payload 类型(单一真相源)**

在 `packages/otto/src/index.ts` 末尾追加(紧跟其它 `export type` 行):

```ts
export type { StoryboardCardPayload, StoryboardCardInput } from "./skills/propose-storyboard.helpers.js";
```

- [ ] **Step 2: 写失败测试**

创建 `apps/web/lib/__tests__/storyboard-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStoryboardCardPayload } from "../storyboard-card";

describe("parseStoryboardCardPayload", () => {
  it("empty / undefined payload → 空标题 + 空 shots", () => {
    expect(parseStoryboardCardPayload(undefined)).toEqual({ storyboardTitle: "", shots: [] });
    expect(parseStoryboardCardPayload(null)).toEqual({ storyboardTitle: "", shots: [] });
    expect(parseStoryboardCardPayload({})).toEqual({ storyboardTitle: "", shots: [] });
  });

  it("shots 不是数组 → shots 归空,标题仍解析", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "T", shots: "nope" });
    expect(r).toEqual({ storyboardTitle: "T", shots: [] });
  });

  it("合法 payload → 映射 title + 双 prompt,按 index 排序", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "New shoes ad",
      shots: [
        { index: 1, title: "Hero", firstFramePrompt: "ff-1", videoPrompt: "v-1" },
        { index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" },
      ],
    });
    expect(r.storyboardTitle).toBe("New shoes ad");
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(r.shots[0]).toEqual({ index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" });
    expect(r.shots[1].title).toBe("Hero");
  });

  it("缺失 prompt 字段 → 兜底成空串(不抛)", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "X", shots: [{ index: 0 }] });
    expect(r.shots[0].firstFramePrompt).toBe("");
    expect(r.shots[0].videoPrompt).toBe("");
  });

  it("index 缺失 → 回落到数组位置", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ firstFramePrompt: "a", videoPrompt: "b" }, { firstFramePrompt: "c", videoPrompt: "d" }],
    });
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
  });

  it("有 firstFrameGenerationId 时透传(F4 会用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameGenerationId: "gen_123" }],
    });
    expect(r.shots[0].firstFrameGenerationId).toBe("gen_123");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-card.test.ts`
Expected: FAIL —— `Cannot find module '../storyboard-card'`(实现还没写)。

- [ ] **Step 4: 写最小实现**

创建 `apps/web/lib/storyboard-card.ts`:

```ts
/**
 * storyboard-card — PURE 渲染侧解析:把 DB 存的 STORYBOARD_CARD payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(对齐 pack-credit-math)。
 * 编辑(F3)/ 首帧图(F4)按 index 定位镜头,故这里稳定按 index 排序。
 */
import type { StoryboardCardPayload } from "@fikirtive/otto";

export interface StoryboardShotView {
  index: number;
  title?: string;
  firstFramePrompt: string;
  videoPrompt: string;
  firstFrameGenerationId?: string;
}

export interface StoryboardCardView {
  storyboardTitle: string;
  shots: StoryboardShotView[];
}

type RawShot = Partial<StoryboardCardPayload["shots"][number]>;

export function parseStoryboardCardPayload(payload: unknown): StoryboardCardView {
  const p = (payload ?? {}) as Partial<StoryboardCardPayload>;
  const storyboardTitle = typeof p.storyboardTitle === "string" ? p.storyboardTitle : "";
  const rawShots = Array.isArray(p.shots) ? p.shots : [];
  const shots = rawShots
    .map((s, i): StoryboardShotView => {
      const shot = (s ?? {}) as RawShot;
      return {
        index: typeof shot.index === "number" ? shot.index : i,
        ...(typeof shot.title === "string" && shot.title ? { title: shot.title } : {}),
        firstFramePrompt: typeof shot.firstFramePrompt === "string" ? shot.firstFramePrompt : "",
        videoPrompt: typeof shot.videoPrompt === "string" ? shot.videoPrompt : "",
        ...(typeof shot.firstFrameGenerationId === "string"
          ? { firstFrameGenerationId: shot.firstFrameGenerationId }
          : {}),
      };
    })
    .sort((a, b) => a.index - b.index);
  return { storyboardTitle, shots };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-card.test.ts`
Expected: PASS(6 个 it 全绿)。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @fikirtive/otto typecheck && pnpm --filter @fikirtive/web typecheck`
Expected: 两个都 Done(index 新导出 + web 新文件都编译过)。
> 注:若 web typecheck 报找不到 `StoryboardCardPayload`,是因为 `@fikirtive/otto` 的 dist 未 build。跑 `pnpm --filter @fikirtive/otto build` 再重试。

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/index.ts apps/web/lib/storyboard-card.ts apps/web/lib/__tests__/storyboard-card.test.ts
git commit -m "feat(otto): storyboard render-side parse helper + export payload type"
```

---

### Task 2: `StoryboardCard` 组件 + DTO kind 补全 + 接进两个渲染器

可见交付:founder 说"做个广告"→ Otto(经 Task 3 指令)产出 `STORYBOARD_CARD` → 聊天里渲染出有序分镜卡(文字)。一个连贯 deliverable,故组件 + 两处 kind 联合 + 两渲染器 dispatch + 占位文案一起做(拆开会留半接线的死代码)。

**Files:**
- Modify: `apps/web/lib/types.ts:68`(`ChatMessageDTO.kind` 联合加 `"STORYBOARD_CARD"`)
- Modify: `apps/web/lib/dto.ts:116`(`toChatMessageDTO` 里 cast 的联合加 `"STORYBOARD_CARD"`)
- Create: `apps/web/components/otto/StoryboardCard.tsx`
- Modify: `apps/web/components/otto/OttoConversation.tsx`(BUILD_CARD 分支后加 STORYBOARD_CARD dispatch)
- Modify: `apps/web/components/otto/OttoChatStream.tsx`(DENIAL/TURN_ERROR 分支后、PLAN skip 前加 dispatch + import)
- Modify: `apps/web/lib/otto-ui-messages.ts`(`placeholderTextFor` 加 STORYBOARD_CARD case)

**Interfaces:**
- Consumes:`parseStoryboardCardPayload`、`StoryboardCardView`(Task 1);`WidgetRow`(OttoChatStream 内既有,无需 import);`OttoAvatar`(OttoConversation 内既有)。
- Produces:`StoryboardCard`(default export + named),props `{ cardId: string; payload: unknown }`(`cardId` 现留给 F3 编辑,F2 不消费)。

- [ ] **Step 1: 补齐两处 `ChatMessageDTO.kind` 联合**

`apps/web/lib/types.ts` 第 68 行,把:

```ts
  kind: "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR" | "ACTION_CARD" | "BUILD_CARD";
```

改成(尾部加 `| "STORYBOARD_CARD"`):

```ts
  kind: "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR" | "ACTION_CARD" | "BUILD_CARD" | "STORYBOARD_CARD";
```

`apps/web/lib/dto.ts` 第 116 行,把:

```ts
    kind: m.kind as "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR" | "ACTION_CARD" | "BUILD_CARD",
```

改成:

```ts
    kind: m.kind as "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR" | "ACTION_CARD" | "BUILD_CARD" | "STORYBOARD_CARD",
```

- [ ] **Step 2: 写组件**

创建 `apps/web/components/otto/StoryboardCard.tsx`:

```tsx
"use client";
import React from "react";
import { Film } from "lucide-react";
import { parseStoryboardCardPayload } from "@/lib/storyboard-card";

export interface StoryboardCardProps {
  /** 留给 F3 编辑动作;F2 只读,不消费。 */
  cardId: string;
  payload: unknown;
}

/** Otto 的分镜卡。用于 STORYBOARD_CARD 消息(F2 只读)。
 *  渲染有序镜头 —— 每镜头 = 首帧 prompt + 视频 prompt(文字)。
 *  编辑(F3)、首帧图(F4)之后加;这里纯文字。
 *  样式镜像 OttoActionPlanCard:.gb 外壳 → bg-secondary 卡体 → bg-card 行。 */
export function StoryboardCard({ payload }: StoryboardCardProps) {
  const { storyboardTitle, shots } = parseStoryboardCardPayload(payload);
  return (
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Film size={20} className="text-foreground" />
          <span className="font-bold text-[1rem] text-foreground">
            {storyboardTitle || "Storyboard"}
          </span>
        </div>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => (
              <div
                key={shot.index}
                className="bg-card rounded-[14px] flex flex-col gap-1"
                style={{ padding: "10px 12px" }}
              >
                {/* Shot number + optional title */}
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-secondary text-muted-foreground">
                    Shot {shot.index + 1}
                  </span>
                  {shot.title && (
                    <span className="font-semibold text-[0.875rem] text-foreground">
                      {shot.title}
                    </span>
                  )}
                </div>

                {/* First-frame prompt */}
                <div className="text-[0.75rem] text-muted-foreground">
                  <span className="font-semibold text-foreground">First frame · </span>
                  {shot.firstFramePrompt}
                </div>

                {/* Video prompt */}
                <div className="text-[0.75rem] text-muted-foreground">
                  <span className="font-semibold text-foreground">Video · </span>
                  {shot.videoPrompt}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default StoryboardCard;
```

- [ ] **Step 3: 接进 `OttoConversation`(普通用户渲染器)**

`apps/web/components/otto/OttoConversation.tsx`:先在文件顶部的 import 区(紧邻既有 `import { OttoAdBuildCard } from "./OttoAdBuildCard";`)加:

```tsx
import { StoryboardCard } from "./StoryboardCard";
```

再在 `BUILD_CARD` 分支之后(约第 533 行 `}` 之后、下一个渲染逻辑之前)加:

```tsx
  if (m.kind === "STORYBOARD_CARD") {
    return (
      <div className="flex items-start gap-3">
        <OttoAvatar size={32} state="idle" />
        <div className="flex-1 min-w-0">
          <StoryboardCard cardId={m.id} payload={m.payload} />
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: 接进 `OttoChatStream`(founder/admin 流式渲染器)**

`apps/web/components/otto/OttoChatStream.tsx`:先在 import 区(紧邻既有 `import { PackCard } from "./PackCard";` 第 25 行)加:

```tsx
import { StoryboardCard } from "./StoryboardCard";
```

再在 `if (kind === "DENIAL" || kind === "TURN_ERROR") { ... }` 分支之后(约第 687 行)、`// PLAN messages are internal reasoning` 之前,加:

```tsx
            if (kind === "STORYBOARD_CARD") {
              return (
                <WidgetRow key={m.id} animateIn={isNewMessage(m.id)}>
                  <StoryboardCard cardId={m.metadata!.durableId} payload={m.metadata?.payload} />
                </WidgetRow>
              );
            }
```

- [ ] **Step 5: 补 stream 水合占位文案**

`apps/web/lib/otto-ui-messages.ts` 的 `placeholderTextFor` switch,在 `case "BUILD_CARD":` 之后加:

```ts
    case "STORYBOARD_CARD":
      return "Otto laid out a storyboard.";
```

（可选,顺手把该文件顶部两处列举 kind 的注释加上 `STORYBOARD_CARD`,保持文档准确;不改逻辑。）

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: Done(新 kind 已进两处联合;`m.kind === "STORYBOARD_CARD"` 与 `m.metadata.kind` 都收窄通过)。

- [ ] **Step 7: 全量 web 测试(确认没打断既有)**

Run: `pnpm --filter @fikirtive/web exec vitest run`
Expected: 全绿(含 Task 1 的 storyboard-card 测试;既有 otto-ui-messages 等不受影响)。

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/dto.ts apps/web/components/otto/StoryboardCard.tsx apps/web/components/otto/OttoConversation.tsx apps/web/components/otto/OttoChatStream.tsx apps/web/lib/otto-ui-messages.ts
git commit -m "feat(otto): render STORYBOARD_CARD in both chat renderers (read-only)"
```

---

### Task 3: 指令 —— 教 Otto 何时走 `proposeStoryboard`

`instructions.ts` 是 Otto 的系统提示(内联 TS 常量,非运行时读文件)。加一节讲清"多镜头视频/广告 → 逐镜头拼 prompt → `proposeStoryboard`"的编排,并与单张 `propose` 区分。TDD:先在 `instructions.test.ts` 加断言。

**Files:**
- Modify: `packages/otto/src/instructions.ts`(在 "When to call `propose`" 之后加一节)
- Test: `packages/otto/src/instructions.test.ts`(加一个 describe)

**Interfaces:**
- Consumes:`ottoInstructions`(既有导出)。
- Produces:无新导出;仅扩充 prose + 测试。

- [ ] **Step 1: 写失败测试**

在 `packages/otto/src/instructions.test.ts` 末尾追加:

```ts
describe("ottoInstructions — storyboard routing", () => {
  it("names the proposeStoryboard tool", () => {
    expect(ottoInstructions).toMatch(/proposeStoryboard/);
  });
  it("routes multi-shot video/ad requests to a storyboard", () => {
    expect(ottoInstructions).toMatch(/storyboard/i);
    expect(ottoInstructions).toMatch(/multi-shot|multiple shots|several shots|scene/i);
  });
  it("tells Otto to build each shot's prompts with the model skills first", () => {
    // 每镜头先 seedreamPrompt(首帧)+ seedancePrompt(视频)再入卡
    expect(ottoInstructions).toMatch(/seedreamPrompt/);
    expect(ottoInstructions).toMatch(/seedancePrompt/);
  });
  it("makes clear the storyboard itself spends nothing", () => {
    expect(ottoInstructions).toMatch(/no credits|nothing is charged|does not spend|doesn.t spend/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL —— 新 describe 里的断言失败(instructions 还没提 storyboard)。

- [ ] **Step 3: 写指令 prose**

`packages/otto/src/instructions.ts`,在 "When to call `propose`" 那节(以 `Do NOT pick a model or set a price` 结尾,约第 40 行)之后、"Reference rules" 之前,插入:

```ts
## When to call \`proposeStoryboard\` (multi-shot videos / ads)

When the user wants a video or ad that is a SEQUENCE of shots — a short film, a multi-scene ad, "a video with a few scenes", a storyboard — do NOT fire a single \`propose\`. Lay out a storyboard instead:

1. First understand intent (刨根问底) and confirm the goal — \`proposeStoryboard\` requires a \`goal\` and returns \`needMoreInfo\` without one.
2. For EACH shot, build its two prompts with the model skills (never hand-write them): call **seedreamPrompt** for the shot's \`firstFramePrompt\` (the opening still) and **seedancePrompt** for its \`videoPrompt\` (the motion). Supply the craft yourself — subject, camera move, lighting, composition — from the goal and brand context.
3. Call **\`proposeStoryboard\`** with \`storyboardTitle\`, \`goal\`, and the ordered \`shots\` (each: optional \`title\`, \`firstFramePrompt\`, \`videoPrompt\`). This lays out an ordered STORYBOARD_CARD the user can review and edit shot-by-shot.

**\`proposeStoryboard\` spends nothing** — it only lays out the plan; no credits are charged. The user reviews and edits first; the first-frame images and the videos are made later as separate, explicitly-approved steps. Say so plainly — never imply the storyboard itself generated or charged anything.

Use a single \`propose\` (not a storyboard) for a one-off image or a single short clip. Use \`proposeStoryboard\` only when there are genuinely multiple ordered shots.
```

> 注:这段是模板字符串内的内容,`\`…\`` 反引号已转义,与文件既有节一致。插入位置在 `ottoInstructions` 反引号模板串内部。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: PASS(新 describe 4 个 it 全绿,既有断言不受影响)。

- [ ] **Step 5: 全量 otto 测试 + typecheck**

Run: `pnpm --filter @fikirtive/otto exec vitest run && pnpm --filter @fikirtive/otto typecheck`
Expected: 全绿、typecheck Done。

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts
git commit -m "feat(otto): instructions route multi-shot ads to proposeStoryboard (\$0)"
```

---

## Self-Review

**Spec coverage(对 `2026-07-02-otto-storyboard-card-design.md` §9 build 顺序):**
- §9.2「STORYBOARD_CARD 渲染(有序镜头行,文字优先;参考 OttoPlanCard/PackCard 样式)」→ Task 2(组件 + 两渲染器)。✅
- §9.5「指令:告诉 Otto 多镜头视频/广告请求走 proposeStoryboard(先逐镜头调 seedream/seedancePrompt)」→ Task 3。✅
- §9.1(payload schema + skill)+ §9.6(registry + CATALOG)→ 已在 **F1** 完成(#99)。
- §9.3(编辑 $0)= **F3**;§9.4(闸①首帧图,碰钱)= **F4**。不在 F2。
- 首帧图槽位:F2 只读文字,不显示图 —— `firstFrameGenerationId` 由解析函数透传但组件暂不渲染(F4 加图);符合「F 覆盖到首帧图确认为止」按块推进。

**Placeholder scan:** 无 TBD/TODO;每个碰代码的 step 都给了完整代码。

**Type consistency:** `parseStoryboardCardPayload` / `StoryboardCardView` / `StoryboardShotView`(Task 1 定义)在 Task 2 组件里同名消费;`StoryboardCardProps` props `{cardId, payload}` 与两处 dispatch 传参一致(`OttoConversation` 传 `m.id`/`m.payload`,`OttoChatStream` 传 `m.metadata.durableId`/`m.metadata.payload`);`STORYBOARD_CARD` 字面量在 types.ts、dto.ts、两渲染器、placeholderTextFor 五处拼写一致(全大写下划线,对齐 Prisma enum)。

**Money-safety:** 全 $0。无 GenJob、无 reserve/settle、不 import `@fikirtive/generation`、不碰 `generate`/`propose`/`proposePack`。纯渲染 + 指令。

---

## 相关文件

- 设计:`docs/superpowers/specs/2026-07-02-otto-storyboard-card-design.md`
- F1(后端):`packages/otto/src/skills/propose-storyboard.{ts,helpers.ts}`(#99)
- 样式模板:`apps/web/components/otto/OttoActionPlanCard.tsx`(只读展示卡)、`PackCard.tsx`
- 渲染器:`apps/web/components/otto/OttoConversation.tsx`(普通用户)、`OttoChatStream.tsx`(founder/admin,`isFounderAdmin` 门控)
- 水合:`apps/web/lib/otto-ui-messages.ts`(`threadToUiMessages` / `placeholderTextFor`)、`apps/web/lib/dto.ts`(`toChatMessageDTO`)、`apps/web/lib/types.ts`(`ChatMessageDTO`)
- 指令:`packages/otto/src/instructions.ts`
