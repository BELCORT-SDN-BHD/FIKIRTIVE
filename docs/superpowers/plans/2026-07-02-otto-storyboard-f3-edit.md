# Otto 分镜 · F3(逐帧编辑,$0)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在渲染出的 `STORYBOARD_CARD` 上**逐帧编辑**(改文字 / 增镜头 / 删镜头 / 重排),全部 **$0、owner-scoped、不碰钱路**。改文字会清掉该镜头的旧首帧图引用(标记需在 F4 重出)。

**Architecture:** 三层,全 $0。(1)纯变换模块 `storyboard-edit.ts`:4 个纯函数把一个 `StoryboardCardPayload` 变成新的(重排 0-based index;editShotPrompt 额外清 `firstFrameGenerationId`),唯一带单测的层。(2)4 个 `'use server'` 动作:`requireOwner` → 按 `{id, ownerId, kind:"STORYBOARD_CARD", deletedAt:null}` 载入卡片(身份来自 session,绝不来自输入)→ 纯变换 → `chatMessage.update` 回写 payload → 返回新 payload。**不产生 GenJob、不 reserve/settle。**(3)把 `StoryboardCard` 变成可交互客户端组件:本地 state 持 payload,每次动作成功后用返回的 payload 更新本地 state(无需全线程刷新)。

**Tech Stack:** React 19 / Next.js(改版 Next,见 `apps/web/AGENTS.md`)、TypeScript、vitest(纯函数 + 动作 mock 测试;JSX 不测)、`requireOwner`(`./auth-guard`)、`prisma`/`Prisma`(`@fikirtive/db`)、Zod。

## Global Constraints

- **$0,零花钱路径。** F3 只改卡片 payload。**绝不** import `@fikirtive/generation`、绝不 `reserveCredits`/`settle`、绝不建 `GenJob`、绝不调 `generate`/`propose`。首帧图生成(碰 `generate`)= **F4**,单独 money-review。
- **严格 owner-scoped,身份来自 session。** 每个动作先 `requireOwner()`;载入卡片用 `where:{ id, ownerId, kind:"STORYBOARD_CARD", deletedAt:null }` 且再校验 `card.thread.ownerId === ownerId && !card.thread.deletedAt`。`ownerId` **绝不**来自客户端输入(anti-spoof,对齐 `coworkGenerate` cowork-actions.ts:499-509)。
- **改文字清首帧图**:`editShotPrompt` 改任一 prompt 后,**删掉该镜头的 `firstFrameGenerationId`**(旧图作废,F4 让用户重出),不自动重生成(spec §7/§8)。
- **镜头数边界**:`addShot` 到 `MAX_STORYBOARD_SHOTS`(=8)即拒;`deleteShot` 不允许删到 0(至少留 1)。这两个策略在**动作层**校验,纯函数保持 total。
- **payload 回写形状**:`data:{ payload: newPayload as unknown as Prisma.InputJsonObject }`(对齐 meta-build-actions.ts:345)。
- **卡片渲染/身份不变**:`cardId` 已由两渲染器传入(F2),F3 **不改** `OttoConversation`/`OttoChatStream`/DTO/水合。
- Zod 校验每个动作入参;非法入参返回 `{ error }`,不抛。

---

### Task 1: 纯编辑变换 + 测试

4 个纯函数,输入一个 `StoryboardCardPayload` + 参数,返回新 payload(不 mutate 入参)。重排镜头后一律重编 0-based index(同 `buildStoryboardPayload`)。这是本计划唯一带单测的层。

**Files:**
- Modify: `packages/otto/src/index.ts`(再导出 `MAX_STORYBOARD_SHOTS`,动作层要用)
- Create: `apps/web/lib/storyboard-edit.ts`
- Test: `apps/web/lib/__tests__/storyboard-edit.test.ts`

**Interfaces:**
- Consumes:`StoryboardCardPayload`(F1 类型,已从 `@fikirtive/otto` 导出);`MAX_STORYBOARD_SHOTS`(F1 常量,本 task 新增导出)。
- Produces:`applyEditShotPrompt` / `applyAddShot` / `applyDeleteShot` / `applyReorderShots`(供 Task 2 动作消费);类型 `ShotPromptPatch`、`NewShotInput`。

- [ ] **Step 1: 导出 `MAX_STORYBOARD_SHOTS`**

`packages/otto/src/index.ts` 末尾追加:

```ts
export { MAX_STORYBOARD_SHOTS } from "./skills/propose-storyboard.helpers.js";
```

- [ ] **Step 2: 写失败测试**

创建 `apps/web/lib/__tests__/storyboard-edit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
} from "../storyboard-edit";
import type { StoryboardCardPayload } from "@fikirtive/otto";

function base(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { index: 0, title: "A", firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen0" },
      { index: 1, firstFramePrompt: "ff1", videoPrompt: "v1", firstFrameGenerationId: "gen1" },
      { index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

describe("applyEditShotPrompt", () => {
  it("改 firstFramePrompt → 更新文字并清掉该镜头 firstFrameGenerationId", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[0].firstFramePrompt).toBe("NEW");
    expect(r.shots[0].firstFrameGenerationId).toBeUndefined();
    expect("firstFrameGenerationId" in r.shots[0]).toBe(false);
  });
  it("改 videoPrompt 也清该镜头首帧图引用", () => {
    const r = applyEditShotPrompt(base(), 1, { videoPrompt: "NEWV" });
    expect(r.shots[1].videoPrompt).toBe("NEWV");
    expect(r.shots[1].firstFrameGenerationId).toBeUndefined();
  });
  it("不影响其它镜头的 firstFrameGenerationId", () => {
    const r = applyEditShotPrompt(base(), 0, { firstFramePrompt: "NEW" });
    expect(r.shots[1].firstFrameGenerationId).toBe("gen1");
  });
  it("越界 index → 原样返回", () => {
    const r = applyEditShotPrompt(base(), 9, { firstFramePrompt: "X" });
    expect(r.shots).toEqual(base().shots);
  });
  it("不 mutate 入参", () => {
    const b = base();
    applyEditShotPrompt(b, 0, { firstFramePrompt: "NEW" });
    expect(b.shots[0].firstFramePrompt).toBe("ff0");
    expect(b.shots[0].firstFrameGenerationId).toBe("gen0");
  });
});

describe("applyAddShot", () => {
  it("追加新镜头并重编 index;新镜头无 firstFrameGenerationId", () => {
    const r = applyAddShot(base(), { firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect(r.shots).toHaveLength(4);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.shots[3].firstFramePrompt).toBe("ffN");
    expect(r.shots[3].firstFrameGenerationId).toBeUndefined();
  });
  it("带 title", () => {
    const r = applyAddShot(base(), { title: "T", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect(r.shots[3].title).toBe("T");
  });
});

describe("applyDeleteShot", () => {
  it("删中间镜头 → 其余重编 0-based", () => {
    const r = applyDeleteShot(base(), 1);
    expect(r.shots).toHaveLength(2);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(r.shots.map((s) => s.firstFramePrompt)).toEqual(["ff0", "ff2"]);
  });
  it("越界 index → 原样返回", () => {
    const r = applyDeleteShot(base(), 9);
    expect(r.shots).toHaveLength(3);
  });
});

describe("applyReorderShots", () => {
  it("按给定顺序重排并重编 index", () => {
    const r = applyReorderShots(base(), [2, 0, 1]);
    expect(r.shots.map((s) => s.firstFramePrompt)).toEqual(["ff2", "ff0", "ff1"]);
    expect(r.shots.map((s) => s.index)).toEqual([0, 1, 2]);
  });
  it("order 不是当前 index 的合法排列 → 原样返回", () => {
    expect(applyReorderShots(base(), [0, 1]).shots).toEqual(base().shots);      // 少一个
    expect(applyReorderShots(base(), [0, 1, 5]).shots).toEqual(base().shots);   // 含越界
    expect(applyReorderShots(base(), [0, 0, 1]).shots).toEqual(base().shots);   // 重复
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-edit.test.ts`
Expected: FAIL —— `Cannot find module '../storyboard-edit'`。

- [ ] **Step 4: 写最小实现**

创建 `apps/web/lib/storyboard-edit.ts`:

```ts
/**
 * storyboard-edit — PURE 编辑变换:一个 StoryboardCardPayload → 新 payload。
 * 不 mutate 入参;重排镜头后一律重编 0-based index(同 buildStoryboardPayload)。
 * editShotPrompt 额外清掉被改镜头的 firstFrameGenerationId(旧首帧图作废,F4 重出)。
 * 无 React / 无 DB / 无 I/O —— 边界策略(镜头数上限/下限)在动作层,不在这里。
 */
import type { StoryboardCardPayload } from "@fikirtive/otto";

type Shot = StoryboardCardPayload["shots"][number];

export interface ShotPromptPatch {
  firstFramePrompt?: string;
  videoPrompt?: string;
}

export interface NewShotInput {
  title?: string;
  firstFramePrompt: string;
  videoPrompt: string;
}

/** 重编 0-based index(不 mutate 入参数组元素)。 */
function restamp(shots: Shot[]): Shot[] {
  return shots.map((s, index) => ({ ...s, index }));
}

/** 改某镜头文字 + 清其 firstFrameGenerationId。越界 index → 原样返回。 */
export function applyEditShotPrompt(
  payload: StoryboardCardPayload,
  index: number,
  patch: ShotPromptPatch,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  const shots = payload.shots.map((s, i) => {
    if (i !== index) return s;
    // 丢弃 firstFrameGenerationId:解构剔除该键,不是设成 undefined。
    const { firstFrameGenerationId: _drop, ...rest } = s;
    return {
      ...rest,
      ...(patch.firstFramePrompt !== undefined ? { firstFramePrompt: patch.firstFramePrompt } : {}),
      ...(patch.videoPrompt !== undefined ? { videoPrompt: patch.videoPrompt } : {}),
    };
  });
  return { ...payload, shots: restamp(shots) };
}

/** 末尾追加一个镜头(无首帧图)+ 重编 index。 */
export function applyAddShot(
  payload: StoryboardCardPayload,
  shot: NewShotInput,
): StoryboardCardPayload {
  const added: Shot = {
    index: payload.shots.length,
    ...(shot.title ? { title: shot.title } : {}),
    firstFramePrompt: shot.firstFramePrompt,
    videoPrompt: shot.videoPrompt,
  };
  return { ...payload, shots: restamp([...payload.shots, added]) };
}

/** 删某镜头 + 重编 index。越界 index → 原样返回。 */
export function applyDeleteShot(
  payload: StoryboardCardPayload,
  index: number,
): StoryboardCardPayload {
  if (index < 0 || index >= payload.shots.length) return payload;
  return { ...payload, shots: restamp(payload.shots.filter((_, i) => i !== index)) };
}

/** 按 order(当前 index 的一个排列)重排 + 重编 index。
 *  order 不是 [0..n-1] 的合法排列(缺项/越界/重复)→ 原样返回。 */
export function applyReorderShots(
  payload: StoryboardCardPayload,
  order: number[],
): StoryboardCardPayload {
  const n = payload.shots.length;
  const valid =
    order.length === n &&
    new Set(order).size === n &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (!valid) return payload;
  return { ...payload, shots: restamp(order.map((i) => payload.shots[i])) };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-edit.test.ts`
Expected: PASS(全绿)。若报找不到 `MAX_STORYBOARD_SHOTS`/类型,先 `pnpm --filter @fikirtive/otto build` 再重试(dist gotcha)。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @fikirtive/otto typecheck && pnpm --filter @fikirtive/web typecheck`
Expected: 两个都 Done。

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/index.ts apps/web/lib/storyboard-edit.ts apps/web/lib/__tests__/storyboard-edit.test.ts
git commit -m "feat(otto): pure storyboard edit transforms (edit/add/delete/reorder, \$0)"
```

---

### Task 2: 4 个编辑 server actions($0)+ 测试

薄包装:`requireOwner` → owner-scoped 载入 STORYBOARD_CARD → 纯变换 → 回写 payload → 返回新 payload。$0、无 GenJob。

**Files:**
- Create: `apps/web/lib/storyboard-actions.ts`
- Test: `apps/web/lib/__tests__/storyboard-actions.test.ts`

**Interfaces:**
- Consumes:`applyEditShotPrompt`/`applyAddShot`/`applyDeleteShot`/`applyReorderShots`(Task 1);`MAX_STORYBOARD_SHOTS`、`StoryboardCardPayload`(`@fikirtive/otto`);`requireOwner`(`./auth-guard`);`prisma`、`Prisma`(`@fikirtive/db`)。
- Produces:`editShotPrompt`/`addShot`/`deleteShot`/`reorderShots`,每个返回 `Promise<{ payload: StoryboardCardPayload } | { error: string }>`(供 Task 3 UI 调用)。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/lib/__tests__/storyboard-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoryboardCardPayload } from "@fikirtive/otto";

const { mockOwner, mockFindFirst, mockUpdate } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { chatMessage: { findFirst: mockFindFirst, update: mockUpdate } },
  Prisma: {},
}));

import { editShotPrompt, addShot, deleteShot, reorderShots } from "../storyboard-actions";

const OWNER = "owner-1";
function card(payload: StoryboardCardPayload) {
  return { id: "card-1", threadId: "t-1", payload, thread: { ownerId: OWNER, deletedAt: null } };
}
function payload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen0" },
      { index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      { index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockUpdate.mockResolvedValue({});
});

describe("editShotPrompt", () => {
  it("owner-scoped 载入 + 回写清了 firstFrameGenerationId 的 payload", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    // 载入必须按 id + ownerId + kind owner-scoped
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "card-1", ownerId: OWNER, kind: "STORYBOARD_CARD", deletedAt: null }) }),
    );
    expect("payload" in res).toBe(true);
    if ("payload" in res) {
      expect(res.payload.shots[0].firstFramePrompt).toBe("NEW");
      expect(res.payload.shots[0].firstFrameGenerationId).toBeUndefined();
    }
    // 回写到同一 cardId,且不碰 genJob
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "card-1" } }));
    const data = mockUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["payload"]); // 只改 payload,绝不动 genJobId
  });

  it("requireOwner 失败 → 直接返回 error,不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("卡片不存在(或非本人)→ error,不回写", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → error,不碰 DB", async () => {
    const res = await editShotPrompt({ cardId: "", index: -1 } as unknown as { cardId: string; index: number });
    expect("error" in res).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("addShot", () => {
  it("追加并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await addShot({ cardId: "card-1", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect("payload" in res && res.payload.shots).toHaveLength(4);
  });
  it("到上限(8)拒绝", async () => {
    const full = payload3();
    full.shots = Array.from({ length: 8 }, (_, i) => ({ index: i, firstFramePrompt: `ff${i}`, videoPrompt: `v${i}` }));
    mockFindFirst.mockResolvedValue(card(full));
    const res = await addShot({ cardId: "card-1", firstFramePrompt: "x", videoPrompt: "y" });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteShot", () => {
  it("删并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await deleteShot({ cardId: "card-1", index: 1 });
    expect("payload" in res && res.payload.shots).toHaveLength(2);
  });
  it("不允许删到 0(只剩 1 时拒绝)", async () => {
    const one = payload3();
    one.shots = [one.shots[0]];
    mockFindFirst.mockResolvedValue(card(one));
    const res = await deleteShot({ cardId: "card-1", index: 0 });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("reorderShots", () => {
  it("重排并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await reorderShots({ cardId: "card-1", order: [2, 0, 1] });
    expect("payload" in res && res.payload.shots.map((s) => s.firstFramePrompt)).toEqual(["ff2", "ff0", "ff1"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-actions.test.ts`
Expected: FAIL —— `Cannot find module '../storyboard-actions'`。

- [ ] **Step 3: 写实现**

创建 `apps/web/lib/storyboard-actions.ts`:

```ts
"use server";
/**
 * storyboard-actions — STORYBOARD_CARD 的 $0 编辑动作(改文字/增/删/重排)。
 * 全部 owner-scoped(身份来自 requireOwner 的 session,绝不来自客户端输入)。
 * 只改卡片 payload —— 不产生 GenJob、不 reserve/settle、不碰任何花钱路径。
 * 首帧图生成(碰 generate)在 F4,不在这里。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { MAX_STORYBOARD_SHOTS } from "@fikirtive/otto";
import type { StoryboardCardPayload } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
} from "./storyboard-edit";

type Ok = { payload: StoryboardCardPayload };
type Err = { error: string };

const cardIdSchema = z.string().min(1);

/** owner-scoped 载入一张 STORYBOARD_CARD;身份来自 session。 */
async function loadCard(cardId: string, ownerId: string) {
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, thread: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return null;
  return card;
}

/** 回写新 payload(只改 payload,绝不动 genJobId)。 */
async function persist(cardId: string, payload: StoryboardCardPayload): Promise<Ok> {
  await prisma.chatMessage.update({
    where: { id: cardId },
    data: { payload: payload as unknown as Prisma.InputJsonObject },
  });
  return { payload };
}

const editInput = z.object({
  cardId: cardIdSchema,
  index: z.number().int().min(0),
  firstFramePrompt: z.string().trim().min(1).max(2000).optional(),
  videoPrompt: z.string().trim().min(1).max(2000).optional(),
});

export async function editShotPrompt(raw: unknown): Promise<Ok | Err> {
  const parsed = editInput.safeParse(raw);
  if (!parsed.success || (parsed.data.firstFramePrompt === undefined && parsed.data.videoPrompt === undefined)) {
    return { error: "That edit isn't valid." };
  }
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, index, firstFramePrompt, videoPrompt } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (index >= cur.shots.length) return { error: "That shot no longer exists." };
  return persist(cardId, applyEditShotPrompt(cur, index, { firstFramePrompt, videoPrompt }));
}

const addInput = z.object({
  cardId: cardIdSchema,
  title: z.string().trim().max(120).optional(),
  firstFramePrompt: z.string().trim().min(1).max(2000),
  videoPrompt: z.string().trim().min(1).max(2000),
});

export async function addShot(raw: unknown): Promise<Ok | Err> {
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { error: "That shot isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, title, firstFramePrompt, videoPrompt } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (cur.shots.length >= MAX_STORYBOARD_SHOTS) return { error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.` };
  return persist(cardId, applyAddShot(cur, { title, firstFramePrompt, videoPrompt }));
}

const deleteInput = z.object({ cardId: cardIdSchema, index: z.number().int().min(0) });

export async function deleteShot(raw: unknown): Promise<Ok | Err> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { error: "That delete isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, index } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (index >= cur.shots.length) return { error: "That shot no longer exists." };
  if (cur.shots.length <= 1) return { error: "A storyboard needs at least one shot." };
  return persist(cardId, applyDeleteShot(cur, index));
}

const reorderInput = z.object({ cardId: cardIdSchema, order: z.array(z.number().int().min(0)).min(1) });

export async function reorderShots(raw: unknown): Promise<Ok | Err> {
  const parsed = reorderInput.safeParse(raw);
  if (!parsed.success) return { error: "That reorder isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, order } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  const next = applyReorderShots(cur, order);
  if (next === cur) return { error: "That reorder isn't valid." }; // 非合法排列 → 纯函数原样返回
  return persist(cardId, next);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-actions.test.ts`
Expected: PASS(全绿)。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: Done。

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/storyboard-actions.ts apps/web/lib/__tests__/storyboard-actions.test.ts
git commit -m "feat(otto): storyboard edit server actions — owner-scoped, \$0, no GenJob"
```

---

### Task 3: 让 `StoryboardCard` 可交互(编辑 UI)

把 F2 的只读 `StoryboardCard` 变成可编辑客户端组件:本地 state 持 payload,每镜头可**改文字/删**,卡片可**增镜头/重排(上下移)**;每次动作成功后用返回的 payload 更新本地 state(不需全线程刷新)。样式沿用 F2/`OttoActionPlanCard` 惯例。**只读渲染路径不变**(两渲染器仍只传 `cardId`+`payload`)。

**Files:**
- Modify: `apps/web/components/otto/StoryboardCard.tsx`

**Interfaces:**
- Consumes:`editShotPrompt`/`addShot`/`deleteShot`/`reorderShots`(Task 2,直接 import 现役 server actions,同 PackCard 直接 import `coworkGenerate` 的模式);`parseStoryboardCardPayload`/`StoryboardCardView`(F2)。
- Produces:交互式 `StoryboardCard`(props 不变:`{ cardId: string; payload: unknown }`,现在**消费** `cardId`)。

- [ ] **Step 1: 重写组件为可交互**

把 `apps/web/components/otto/StoryboardCard.tsx` 整体替换为:

```tsx
"use client";
import React, { useState } from "react";
import { Film, Pencil, Trash2, Plus, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseStoryboardCardPayload, type StoryboardCardView, type StoryboardShotView } from "@/lib/storyboard-card";
import { editShotPrompt, addShot, deleteShot, reorderShots } from "@/lib/storyboard-actions";

export interface StoryboardCardProps {
  cardId: string;
  payload: unknown;
}

type ActionResult = { payload: unknown } | { error: string };

/** Otto 的分镜卡(F3:可逐帧编辑,$0)。本地 state 持 payload;每个编辑动作
 *  成功后用返回的 payload 更新本地 state。改文字会清该镜头首帧图(F4 重出)。
 *  样式沿用 OttoActionPlanCard:.gb 壳 → bg-secondary 卡体 → bg-card 行。 */
export function StoryboardCard({ cardId, payload }: StoryboardCardProps) {
  const [view, setView] = useState<StoryboardCardView>(() => parseStoryboardCardPayload(payload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftFf, setDraftFf] = useState("");
  const [draftV, setDraftV] = useState("");

  async function run(fn: () => Promise<ActionResult>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if ("error" in res) { setError(res.error); return false; }
      setView(parseStoryboardCardPayload(res.payload));
      return true;
    } catch {
      setError("Couldn't save — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit(shot: StoryboardShotView) {
    setEditing(shot.index);
    setDraftFf(shot.firstFramePrompt);
    setDraftV(shot.videoPrompt);
    setError(null);
  }

  async function saveEdit(index: number) {
    const ok = await run(() => editShotPrompt({ cardId, index, firstFramePrompt: draftFf, videoPrompt: draftV }));
    if (ok) setEditing(null);
  }

  const shots = view.shots;

  return (
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Film size={20} className="text-foreground" />
          <span className="font-bold text-[1rem] text-foreground">
            {view.storyboardTitle || "Storyboard"}
          </span>
        </div>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => {
              const isEditing = editing === shot.index;
              return (
                <div key={shot.index} className="bg-card rounded-[14px] flex flex-col gap-1" style={{ padding: "10px 12px" }}>
                  {/* Row header: shot number + optional title + controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-secondary text-muted-foreground">
                      Shot {shot.index + 1}
                    </span>
                    {shot.title && (
                      <span className="font-semibold text-[0.875rem] text-foreground">{shot.title}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" aria-label="Move up" disabled={busy || shot.index === 0}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index - 1) }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <ChevronUp size={15} />
                      </button>
                      <button type="button" aria-label="Move down" disabled={busy || shot.index === shots.length - 1}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index + 1) }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <ChevronDown size={15} />
                      </button>
                      <button type="button" aria-label="Edit shot" disabled={busy}
                        onClick={() => (isEditing ? setEditing(null) : startEdit(shot))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <Pencil size={14} />
                      </button>
                      <button type="button" aria-label="Delete shot" disabled={busy || shots.length <= 1}
                        onClick={() => run(() => deleteShot({ cardId, index: shot.index }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-2 mt-1">
                      <label className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">First frame</span>
                        <textarea value={draftFf} onChange={(e) => setDraftFf(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-[10px] border border-border bg-card p-2 text-[0.8125rem] text-foreground" />
                      </label>
                      <label className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">Video</span>
                        <textarea value={draftV} onChange={(e) => setDraftV(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-[10px] border border-border bg-card p-2 text-[0.8125rem] text-foreground" />
                      </label>
                      <div className="flex gap-2">
                        <Button variant="default" disabled={busy} onClick={() => saveEdit(shot.index)}>
                          {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Save"}
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">First frame · </span>{shot.firstFramePrompt}
                      </div>
                      <div className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">Video · </span>{shot.videoPrompt}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add shot */}
        <div className="mt-3">
          <Button variant="secondary" disabled={busy || shots.length >= 8}
            onClick={() => run(() => addShot({ cardId, firstFramePrompt: "New shot — describe the opening frame", videoPrompt: "New shot — describe the motion" }))}>
            <span className="flex items-center gap-1"><Plus size={14} /> Add shot</span>
          </Button>
        </div>

        {error && <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">{error}</div>}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** 交换数组两个位置(用于上下移的 order[])。 */
function swap(arr: number[], i: number, j: number): number[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default StoryboardCard;
```

> 说明:上下移用 `reorderShots`,`order` 传"当前 index 序列交换两项后的数组"(纯函数按 order 重排)。新增镜头给占位英文 prompt,用户随后编辑(改文字动作会清首帧图 —— 新镜头本就没图,无副作用)。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: Done。若报找不到 `StoryboardShotView` 的具名导出,确认 F2 的 `apps/web/lib/storyboard-card.ts` 已 `export interface StoryboardShotView`(F2 已导出)。

- [ ] **Step 3: 全量 web 测试(确认没打断既有 + F3 前两 task 测试仍绿)**

Run: `pnpm --filter @fikirtive/web exec vitest run`
Expected:storyboard-edit / storyboard-actions / storyboard-card 全绿;既有 15 个 auth/租户环境性失败不变(与本改动无关)。

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/otto/StoryboardCard.tsx
git commit -m "feat(otto): interactive storyboard editing UI (edit/add/delete/reorder, \$0)"
```

---

## Self-Review

**Spec coverage(对 `2026-07-02-otto-storyboard-card-design.md` §8 编辑动作 + §9.3):**
- §8 `editShotPrompt`(改文字 + 清 firstFrameGenerationId,$0)→ Task 1 `applyEditShotPrompt` + Task 2 `editShotPrompt` + Task 3 编辑 UI。✅
- §8 `addShot` / `deleteShot`(增/删,重排 index,$0)→ 三层齐。✅
- §8 `reorderShots`(重排,$0)→ 三层齐。✅
- §8「全部严格 owner-scoped(身份来自 session)」→ Task 2 `requireOwner` + owner-scoped `loadCard`,测试断言。✅
- §7「改文字清 firstFrameGenerationId、不自动重生成」→ Task 1 剔除键 + 测试;`regenShotFirstFrame`(单帧重出,**碰钱**)明确留 **F4**。✅
- §8 `regenShotFirstFrame`(碰钱)**不在 F3** —— 那是闸①,归 F4。本计划零花钱。

**Placeholder scan:** 无 TBD/TODO;每个碰代码 step 都有完整代码。

**Type consistency:** `applyEditShotPrompt/applyAddShot/applyDeleteShot/applyReorderShots`(Task 1)在 Task 2 同名消费;动作返回 `{ payload } | { error }`,Task 3 UI 按此判别;`StoryboardCardView`/`StoryboardShotView`(F2 导出)在 Task 3 消费;`MAX_STORYBOARD_SHOTS`(Task 1 导出)在 Task 2 用;`cardId`+`payload` props 不变(两渲染器 F2 已传)。

**Money-safety:** 全 $0。纯 payload 变换 + owner-scoped 回写。无 GenJob(测试断言 `update` 只改 `payload` 键)、无 reserve/settle、不 import `@fikirtive/generation`、不调 `generate`/`propose`。闸①(首帧图,碰钱)= F4。

---

## 相关文件

- 设计:`docs/superpowers/specs/2026-07-02-otto-storyboard-card-design.md`(§7 money-safety、§8 编辑动作)
- owner-scoping 先例:`apps/web/lib/cowork-actions.ts`(coworkGenerate:requireOwner + findFirst{id,ownerId,kind,deletedAt} + 校验 thread owner)、payload 回写:`apps/web/lib/meta-build-actions.ts:345`
- 客户端直接 import server action 先例:`apps/web/components/otto/PackCard.tsx`(import `coworkGenerate`)
- action 测试 mock 先例:`apps/web/lib/__tests__/asset-actions.test.ts`(`vi.hoisted` + `vi.mock` auth-guard/@fikirtive/db)
- F1/F2:`packages/otto/src/skills/propose-storyboard.helpers.ts`(payload/MAX)、`apps/web/lib/storyboard-card.ts`(parse)、`apps/web/components/otto/StoryboardCard.tsx`(F2 只读版)
