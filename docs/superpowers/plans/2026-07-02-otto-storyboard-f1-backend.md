# Storyboard F1（后端 $0）实现计划 — `proposeStoryboard` + `STORYBOARD_CARD`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal（一句话）：** 加一个 $0 的 `proposeStoryboard` skill，持久化一张有序的 `STORYBOARD_CARD`（每镜头：首帧 prompt + 视频 prompt），作为分镜块 F 的后端地基。

**Architecture：** 完全照 `propose` 的模式（`packages/otto/src/skills/propose.ts`）：一个 helpers 文件（Zod schema + 纯持久化前的整形）+ 一个 skill 文件（`defineOttoSkill` free/write/internal → 不审批 + owner-scoped 持久化）。`kind` 是 `ChatMessage` 上的**自由字符串**（现有 GEN_CARD/ACTION_CARD 都是字符串字面量）——`STORYBOARD_CARD` 是新字符串，**无需 Prisma migration**。无 UI、无花钱、无 GenJob。

**Tech Stack：** TypeScript、Zod、`@fikirtive/db`（Prisma）、`@fikirtive/core`（newId、COWORK caps）、vitest。`packages/otto`。分支 `claude/otto-storyboard`（stacked 在 D/E 上）。

## Global Constraints（每个 task 隐含遵守）

- **不碰钱路/agent-loop/seam**：$0，不建 GenJob、不 import fal/reserveCredits、不碰 startGen/worker。`proposeStoryboard` = free/write/internal → `needsApproval=false`。
- **身份只来自 ctx**：ownerId/threadId 从 `OttoContext`，绝不从 skill 输入（参数里禁 orgId/ownerId/userId —— `defineOttoSkill` 会抛错）。
- **刨根问底一致性**：`proposeStoryboard` 和 `propose`/`proposePack` 一样带 `goal` 资讯门（`requires`）。
- **F1 是后端地基**：只持久化卡片数据 + 注册 skill；**渲染在 F2、编辑在 F3、首帧图（花钱）在 F4**。F1 不改 instructions 路由（避免 Otto 在没渲染前就狂建隐形卡）——路由留 F2。
- **行为保持**：现有 15 skill + 全部既有测试不变；只新增 1 skill（registry 15→16）。
- Spec：`docs/superpowers/specs/2026-07-02-otto-storyboard-card-design.md`。

---

## 文件结构

- `packages/otto/src/skills/propose-storyboard.helpers.ts`（**新建**）— `storyboardShot`/`storyboardCardInput` Zod + `MAX_STORYBOARD_SHOTS` + `buildStoryboardPayload` 纯函数（给每镜头补 `index`）。
- `packages/otto/src/skills/propose-storyboard.ts`（**新建**）— `executeProposeStoryboard`（持久化 STORYBOARD_CARD）+ `proposeStoryboardSkill`（defineOttoSkill）+ 裸 tool 导出。
- `packages/otto/src/skills/propose-storyboard.test.ts`（**新建**）。
- `packages/otto/src/registry.ts`（**改**）— import + `allSkills` 加一项。
- `packages/otto/src/registry.test.ts`（**改**）— 15→16 + 新名。
- `packages/otto/src/skills/migration.test.ts`（**改**）— `proposeStoryboard` gate 断言。
- `packages/otto/src/skills/CATALOG.md`（**生成**）。

**测试命令：** 单文件 `pnpm --filter @fikirtive/otto exec vitest run <相对路径>`；全套 `pnpm --filter @fikirtive/otto exec vitest run`；typecheck `pnpm --filter @fikirtive/otto exec tsc --noEmit`。

---

## Task 1: `propose-storyboard.helpers.ts` — schema + payload 整形

**Files:**
- Create: `packages/otto/src/skills/propose-storyboard.helpers.ts`
- Test: `packages/otto/src/skills/propose-storyboard.test.ts`

**Interfaces:**
- Produces: `storyboardShot`、`storyboardCardInput`（含 `goal?`）、`StoryboardCardInput`、`MAX_STORYBOARD_SHOTS`、`StoryboardCardPayload`(type)、`buildStoryboardPayload(input): StoryboardCardPayload`。

- [ ] **Step 1: 写失败测试** — `propose-storyboard.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { storyboardCardInput, buildStoryboardPayload, MAX_STORYBOARD_SHOTS } from "./propose-storyboard.helpers.js";

describe("storyboardCardInput schema", () => {
  const okShot = { firstFramePrompt: "a cat on a sofa", videoPrompt: "the cat stretches" };
  it("accepts a minimal valid storyboard", () => {
    const r = storyboardCardInput.safeParse({ storyboardTitle: "Cat ad", shots: [okShot] });
    expect(r.success).toBe(true);
  });
  it("requires at least one shot", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [] }).success).toBe(false);
  });
  it("caps shots at MAX_STORYBOARD_SHOTS", () => {
    const many = Array.from({ length: MAX_STORYBOARD_SHOTS + 1 }, () => okShot);
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: many }).success).toBe(false);
  });
  it("goal is optional", () => {
    expect(storyboardCardInput.safeParse({ storyboardTitle: "x", shots: [okShot], goal: "drive signups" }).success).toBe(true);
  });
});

describe("buildStoryboardPayload", () => {
  it("stamps a 0-based index on each shot in order", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "Launch",
      shots: [
        { firstFramePrompt: "wide shot of the product", videoPrompt: "slow dolly in" },
        { firstFramePrompt: "close-up on the label", videoPrompt: "rack focus", title: "Detail" },
      ],
    }));
    expect(p.storyboardTitle).toBe("Launch");
    expect(p.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(p.shots[1]!.title).toBe("Detail");
    expect(p.shots[0]!.firstFrameGenerationId).toBeUndefined();
  });
  it("carries goal onto the payload when present", () => {
    const p = buildStoryboardPayload(storyboardCardInput.parse({
      storyboardTitle: "x", goal: "launch teaser", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }],
    }));
    expect(p.goal).toBe("launch teaser");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose-storyboard.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `propose-storyboard.helpers.ts`**

```ts
import { z } from "zod";

/** 一条分镜最多几个镜头（对齐遗留 CoworkPlan 每场 8 shot 的上限，防跑飞）。 */
export const MAX_STORYBOARD_SHOTS = 8;

/** 一个镜头：首帧 prompt（Seedream）+ 视频 prompt（Seedance），都由 D/E 的 skill 预先拼好（英文）。 */
export const storyboardShot = z.object({
  title: z.string().trim().max(120).optional(),
  firstFramePrompt: z.string().trim().min(1).max(2000),
  videoPrompt: z.string().trim().min(1).max(2000),
});

/** Otto 调 proposeStoryboard 的输入。goal 是刨根问底资讯门（同 propose）。 */
export const storyboardCardInput = z.object({
  storyboardTitle: z.string().trim().min(1).max(120),
  goal: z.string().optional(),
  shots: z.array(storyboardShot).min(1).max(MAX_STORYBOARD_SHOTS),
});
export type StoryboardCardInput = z.infer<typeof storyboardCardInput>;

/** 持久化进 STORYBOARD_CARD 的 payload —— 有序（每镜头带 index），首帧图 id 由 F4 写回。 */
export type StoryboardCardPayload = {
  storyboardTitle: string;
  goal?: string;
  shots: {
    index: number;
    title?: string;
    firstFramePrompt: string;
    videoPrompt: string;
    firstFrameGenerationId?: string;
  }[];
};

/** 纯：输入 → 有序 payload（补 0-based index）。无 DB、无 SDK。 */
export function buildStoryboardPayload(input: StoryboardCardInput): StoryboardCardPayload {
  return {
    storyboardTitle: input.storyboardTitle,
    ...(input.goal ? { goal: input.goal } : {}),
    shots: input.shots.map((s, index) => ({
      index,
      ...(s.title ? { title: s.title } : {}),
      firstFramePrompt: s.firstFramePrompt,
      videoPrompt: s.videoPrompt,
    })),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose-storyboard.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skills/propose-storyboard.helpers.ts packages/otto/src/skills/propose-storyboard.test.ts
git commit -m "feat(otto): storyboard payload schema + buildStoryboardPayload"
```

---

## Task 2: `propose-storyboard.ts` — skill + 持久化

**Files:**
- Create: `packages/otto/src/skills/propose-storyboard.ts`
- Test: `packages/otto/src/skills/propose-storyboard.test.ts`（追加）

**Interfaces:**
- Consumes: `storyboardCardInput`/`buildStoryboardPayload`（Task 1）；`defineOttoSkill`（`../skill.js`）；`newId`（`@fikirtive/core`）；`prisma`（`@fikirtive/db`）。
- Produces: `executeProposeStoryboard(input, runContext): Promise<{ cardId: string }>`、`proposeStoryboardSkill`（OttoSkill）、`proposeStoryboard`（tool）。

- [ ] **Step 1: 写失败测试**（追加到 `propose-storyboard.test.ts`；顶部加 db mock，仿 propose.test.ts）

```ts
import { vi, beforeEach } from "vitest";
import { executeProposeStoryboard, proposeStoryboardSkill } from "./propose-storyboard.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
    genJob: { create: vi.fn() }, // must NEVER be called
  },
}));

function makeCtx(over?: Partial<OttoContext>): OttoContext {
  return { orgId: "org-test", userId: "u", projectId: "p", threadId: "t-1", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

describe("executeProposeStoryboard — mock DB", () => {
  let m: { chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }; genJob: { create: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as typeof m;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 4 });
    m.chatMessage.create.mockResolvedValue({});
  });

  it("persists a STORYBOARD_CARD with ordered shots, ownerId+threadId from ctx, seq=last+1", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thr-A" });
    const res = await executeProposeStoryboard(
      { storyboardTitle: "Raya ad", goal: "festive launch", shots: [
        { firstFramePrompt: "family at the door", videoPrompt: "they smile and wave" },
        { firstFramePrompt: "close-up of the cookies", videoPrompt: "steam rises" },
      ] },
      { context: ctx },
    );
    expect(m.chatMessage.create).toHaveBeenCalledTimes(1);
    const data = (m.chatMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.kind).toBe("STORYBOARD_CARD");
    expect(data.ownerId).toBe("org-A");
    expect(data.threadId).toBe("thr-A");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(5);
    const payload = data.payload as { storyboardTitle: string; goal?: string; shots: { index: number }[] };
    expect(payload.storyboardTitle).toBe("Raya ad");
    expect(payload.goal).toBe("festive launch");
    expect(payload.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(res.cardId).toEqual(expect.any(String));
  });

  it("never creates a GenJob ($0)", async () => {
    await executeProposeStoryboard({ storyboardTitle: "x", shots: [{ firstFramePrompt: "a", videoPrompt: "b" }] }, { context: makeCtx() });
    expect(m.genJob.create).not.toHaveBeenCalled();
  });
});

describe("proposeStoryboardSkill gate", () => {
  it("free/write/internal → not gated; declares a goal requirement", () => {
    expect(proposeStoryboardSkill.cost).toBe("free");
    expect(proposeStoryboardSkill.effect).toBe("write");
    expect(proposeStoryboardSkill.needsApproval).toBe(false);
    expect(proposeStoryboardSkill.requires.map((r) => r.field)).toContain("goal");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose-storyboard.test.ts`
Expected: FAIL — `propose-storyboard.js` 不存在。

- [ ] **Step 3: 实现 `propose-storyboard.ts`**

```ts
/**
 * proposeStoryboard — $0 skill
 *
 * Persists an ordered STORYBOARD_CARD (per shot: first-frame prompt + video prompt).
 * Otto assembles each shot's prompts via the D/E skills (seedreamPrompt / seedancePrompt)
 * BEFORE calling this. Spends NO money, creates NO GenJob. Identity from ctx only.
 * First-frame images (gate ①) are generated later (block F4), never here.
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { storyboardCardInput, buildStoryboardPayload, type StoryboardCardInput } from "./propose-storyboard.helpers.js";

export async function executeProposeStoryboard(
  input: StoryboardCardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const payload = buildStoryboardPayload(input);

  const last = await prisma.chatMessage.findFirst({
    where: { threadId: ctx.threadId, ownerId: ctx.orgId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const cardId = newId();
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: ctx.threadId,
      ownerId: ctx.orgId,
      role: "AGENT",
      kind: "STORYBOARD_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload,
    },
  });

  return { cardId };
}

export const proposeStoryboardSkill = defineOttoSkill({
  name: "proposeStoryboard",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Lay out an ordered STORYBOARD for a video/ad the user can review and edit before anything is generated. " +
    "Provide storyboardTitle and shots (1–8), each with firstFramePrompt + videoPrompt. Build each shot's prompts " +
    "by calling seedreamPrompt (first frame) and seedancePrompt (video) FIRST — do not hand-write them. " +
    "$0: this only drafts the storyboard; first-frame images and videos are generated later after the user approves.",
  parameters: storyboardCardInput,
  requires: [
    {
      field: "goal",
      question:
        "What is this storyboard/video for — its goal/purpose (e.g. a festive launch ad to drive store visits)?",
    },
  ],
  execute: executeProposeStoryboard,
});

export const proposeStoryboard = proposeStoryboardSkill.tool;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose-storyboard.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skills/propose-storyboard.ts packages/otto/src/skills/propose-storyboard.test.ts
git commit -m "feat(otto): proposeStoryboard skill — persist an ordered STORYBOARD_CARD (\$0)"
```

---

## Task 3: 注册 + registry/migration 测试 + catalog

**Files:**
- Modify: `packages/otto/src/registry.ts`
- Modify: `packages/otto/src/registry.test.ts`
- Modify: `packages/otto/src/skills/migration.test.ts`
- Modify: `packages/otto/src/skills/CATALOG.md`（生成）

**Interfaces:**
- Consumes: `proposeStoryboardSkill`（Task 2）。
- Produces: `allSkills` 含 proposeStoryboard（共 16）。

- [ ] **Step 1: 写失败测试** — 改 `registry.test.ts` 的计数断言为 16 + 加名

将 "collects all fifteen skills" 测试的名单替换为 16 个（在排序数组里加入 `"proposeStoryboard"`；JS 默认排序位置：`propose-meta-action` 之后、`proposePack` 之前 —— 因为 `propose-` 的 `-`(45) < `propose` 后接的 `S`(83)/`P`(80)，而 `proposeStoryboard` 的 `S`(83) > `proposePack` 的 `P`(80)，所以顺序是 …`propose-meta-action`, `proposePack`, `proposeStoryboard`, `rememberBrandFact`…）：

```ts
  it("collects all sixteen skills", () => {
    const names = allSkills.map((s) => s.name).sort();
    expect(names).toEqual(["describeRefs", "generate", "list-meta-pages", "meta-insights", "meta-list-objects", "propose", "propose-ad-build", "propose-meta-action", "proposePack", "proposeStoryboard", "rememberBrandFact", "researchWeb", "seedancePrompt", "seedreamPrompt", "setTitle", "updateBrief"]);
  });
```

在 `migration.test.ts` 末尾追加（import 到顶部 import 区）：

```ts
import { proposeStoryboardSkill } from "./propose-storyboard.js";

describe("proposeStoryboard gate", () => {
  it("free/write/internal → not gated", () => {
    expect(proposeStoryboardSkill.cost).toBe("free");
    expect(proposeStoryboardSkill.effect).toBe("write");
    expect(proposeStoryboardSkill.needsApproval).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts src/skills/migration.test.ts`
Expected: FAIL — registry 仍 15。

- [ ] **Step 3: 改 `registry.ts`** — import + array 项

import 区末尾加：
```ts
import { proposeStoryboardSkill } from "./skills/propose-storyboard.js";
```
`allSkills` 数组末尾加：
```ts
  proposeStoryboardSkill,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts src/skills/migration.test.ts`
Expected: PASS。

- [ ] **Step 5: 重生成 catalog + 全套 + typecheck**

Run: `pnpm --filter @fikirtive/otto run catalog`（CATALOG.md 多出 proposeStoryboard 一行 free/write/internal ❌，若列宽截断可能无 diff —— 两者皆可）
Run: `pnpm --filter @fikirtive/otto exec vitest run`（全绿）
Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit`（干净）

- [ ] **Step 6: commit**

```bash
git add packages/otto/src/registry.ts packages/otto/src/registry.test.ts packages/otto/src/skills/migration.test.ts packages/otto/src/skills/CATALOG.md
git commit -m "feat(otto): register proposeStoryboard (registry 15→16)"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖（F1 部分）：** §4 `proposeStoryboard` skill + `STORYBOARD_CARD` → Task 1/2 ✓；§5 payload 有序 shots（index/title?/firstFramePrompt/videoPrompt/firstFrameGenerationId?）→ Task 1 ✓；§3 决策"新卡、$0、goal 门"→ Task 2 ✓。**F2 渲染 / F3 编辑 / F4 闸① 首帧图 = 后续 plan，不在 F1。** 指令路由刻意留到 F2（渲染就绪后再引导 Otto 用），F1 只注册（inert-ish）。

**2. 占位符：** 无 TBD；每步完整代码。

**3. 类型一致：** `storyboardCardInput`/`buildStoryboardPayload`/`StoryboardCardPayload`/`executeProposeStoryboard`/`proposeStoryboardSkill`、`STORYBOARD_CARD` kind、16-skill 排序数组全程一致。

**4. 待复审取舍：** `STORYBOARD_CARD` 作为新 kind 字符串在 F2 渲染前不显示（Otto 建了看不见）——所以 F1 不加指令路由，Otto 暂不会主动用；F2 落地渲染 + 路由后才真正启用。
