import { describe, it, expect, vi, beforeEach } from "vitest";
import { editStoryboardInput, executeEditStoryboard, editStoryboardSkill } from "./edit-storyboard.js";
import { executeProposeStoryboard } from "./propose-storyboard.js";
import { MAX_STORYBOARD_SHOTS, type StoryboardCardPayload } from "./propose-storyboard.helpers.js";
import type { OttoContext } from "../context.js";

const { mockFindFirst, mockUpdate, mockCreate, mockGenJobCreate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockGenJobCreate: vi.fn(), // must NEVER be called — this skill is $0
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: mockFindFirst, update: mockUpdate, create: mockCreate },
    genJob: { create: mockGenJobCreate },
  },
  Prisma: {},
}));
// addShot mints a shotId via newId — deterministic stub (partial mock keeps the real core exports).
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "minted-shot-id",
}));

const OWNER = "org-test";

function makeCtx(over?: Partial<OttoContext>): OttoContext {
  return { orgId: OWNER, userId: "u", projectId: "p", threadId: "t-1", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

function card(payload: StoryboardCardPayload, over?: { threadOwnerId?: string; threadDeletedAt?: Date | null }) {
  return {
    id: "card-1",
    payload,
    thread: { ownerId: over?.threadOwnerId ?? OWNER, deletedAt: over?.threadDeletedAt ?? null },
  };
}

function payload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameCardId: "fc0", firstFrameGenerationId: "fg0", videoCardId: "vc0", videoGenerationId: "vg0" },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe("editStoryboardInput schema", () => {
  it("accepts each op shape", () => {
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "editShot", index: 0, videoPrompt: "x" }).success).toBe(true);
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "addShot", firstFramePrompt: "a", videoPrompt: "b" }).success).toBe(true);
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "deleteShot", index: 1 }).success).toBe(true);
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "reorderShots", order: [1, 0] }).success).toBe(true);
  });
  it("rejects unknown op / missing cardId / out-of-range duration", () => {
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "makeAll" }).success).toBe(false);
    expect(editStoryboardInput.safeParse({ op: "deleteShot", index: 0 }).success).toBe(false);
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "editShot", index: 0, durationSeconds: 61 }).success).toBe(false);
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "editShot", index: 0, durationSeconds: 0 }).success).toBe(false);
  });
});

describe("skill meta (fail-closed declaration)", () => {
  it("is a $0 internal write that needs NO approval", () => {
    expect(editStoryboardSkill.cost).toBe("free");
    expect(editStoryboardSkill.effect).toBe("write");
    expect(editStoryboardSkill.reach).toBe("internal");
    expect(editStoryboardSkill.needsApproval).toBe(false);
  });
});

describe("owner scoping (identity from ctx, never from input)", () => {
  it("loads the card scoped by ctx.orgId + kind + deletedAt", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    await executeEditStoryboard({ cardId: "card-1", op: "deleteShot", index: 1 }, { context: makeCtx() });
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "card-1", ownerId: OWNER, kind: "STORYBOARD_CARD", deletedAt: null },
      }),
    );
  });
  it("returns Card not found for a missing card / deleted thread / foreign thread owner", async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await executeEditStoryboard({ cardId: "x", op: "deleteShot", index: 0 }, { context: makeCtx() })).toEqual({ error: "Card not found." });
    mockFindFirst.mockResolvedValue(card(payload3(), { threadDeletedAt: new Date() }));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "deleteShot", index: 0 }, { context: makeCtx() })).toEqual({ error: "Card not found." });
    mockFindFirst.mockResolvedValue(card(payload3(), { threadOwnerId: "someone-else" }));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "deleteShot", index: 0 }, { context: makeCtx() })).toEqual({ error: "Card not found." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("editShot", () => {
  it("rejects an empty patch and an out-of-range index", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "editShot", index: 0 }, { context: makeCtx() })).toEqual({
      error: "editShot needs at least one of firstFramePrompt, videoPrompt or durationSeconds.",
    });
    expect(await executeEditStoryboard({ cardId: "card-1", op: "editShot", index: 9, videoPrompt: "x" }, { context: makeCtx() })).toEqual({
      error: "That shot no longer exists.",
    });
    expect(await executeEditStoryboard({ cardId: "card-1", op: "editShot", videoPrompt: "x" }, { context: makeCtx() })).toEqual({
      error: "editShot needs a shot index.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("keeps the PAID first frame when only the video prompt changes (G 闸② cascade)", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await executeEditStoryboard({ cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW-V" }, { context: makeCtx() });
    expect(res).toEqual({ cardId: "card-1", shotCount: 3 });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    const s0 = written.shots[0]!;
    expect(s0.videoPrompt).toBe("NEW-V");
    expect(s0.firstFrameCardId).toBe("fc0"); // paid frame preserved
    expect(s0.firstFrameGenerationId).toBe("fg0");
    expect("videoCardId" in s0).toBe(false); // stale video invalidated
    expect("videoGenerationId" in s0).toBe(false);
  });
  it("invalidates frame AND video keys when the first-frame prompt changes", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    await executeEditStoryboard({ cardId: "card-1", op: "editShot", index: 0, firstFramePrompt: "NEW-FF" }, { context: makeCtx() });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    const s0 = written.shots[0]!;
    expect(s0.firstFramePrompt).toBe("NEW-FF");
    expect("firstFrameCardId" in s0).toBe(false);
    expect("firstFrameGenerationId" in s0).toBe(false);
    expect("videoCardId" in s0).toBe(false);
    expect("videoGenerationId" in s0).toBe(false);
  });
});

describe("addShot", () => {
  it("requires both prompts and enforces the MAX_STORYBOARD_SHOTS cap", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "addShot", firstFramePrompt: "a" }, { context: makeCtx() })).toEqual({
      error: "addShot needs both firstFramePrompt and videoPrompt.",
    });
    const full: StoryboardCardPayload = {
      storyboardTitle: "Full",
      shots: Array.from({ length: MAX_STORYBOARD_SHOTS }, (_, i) => ({ shotId: `s${i}`, index: i, firstFramePrompt: `f${i}`, videoPrompt: `v${i}` })),
    };
    mockFindFirst.mockResolvedValue(card(full));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "addShot", firstFramePrompt: "a", videoPrompt: "b" }, { context: makeCtx() })).toEqual({
      error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.`,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("appends a shot with a server-minted shotId and restamped indexes", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await executeEditStoryboard(
      { cardId: "card-1", op: "addShot", title: "Closer", firstFramePrompt: "closing frame", videoPrompt: "closing move" },
      { context: makeCtx() },
    );
    expect(res).toEqual({ cardId: "card-1", shotCount: 4 });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    expect(written.shots[3]).toMatchObject({ shotId: "minted-shot-id", index: 3, title: "Closer", firstFramePrompt: "closing frame", videoPrompt: "closing move" });
  });
});

describe("deleteShot", () => {
  it("refuses to delete the last remaining shot", async () => {
    mockFindFirst.mockResolvedValue(card({ storyboardTitle: "One", shots: [{ shotId: "s0", index: 0, firstFramePrompt: "f", videoPrompt: "v" }] }));
    expect(await executeEditStoryboard({ cardId: "card-1", op: "deleteShot", index: 0 }, { context: makeCtx() })).toEqual({
      error: "A storyboard needs at least one shot.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("removes the shot and restamps the rest", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await executeEditStoryboard({ cardId: "card-1", op: "deleteShot", index: 1 }, { context: makeCtx() });
    expect(res).toEqual({ cardId: "card-1", shotCount: 2 });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    expect(written.shots.map((s) => s.shotId)).toEqual(["s0", "s2"]);
    expect(written.shots.map((s) => s.index)).toEqual([0, 1]);
  });
});

describe("reorderShots", () => {
  it("rejects a non-permutation (missing / duplicate / out-of-range)", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    for (const order of [[0, 1], [0, 1, 1], [0, 1, 9]]) {
      expect(await executeEditStoryboard({ cardId: "card-1", op: "reorderShots", order }, { context: makeCtx() })).toEqual({
        error: "That reorder isn't valid.",
      });
    }
    expect(await executeEditStoryboard({ cardId: "card-1", op: "reorderShots" }, { context: makeCtx() })).toEqual({
      error: "reorderShots needs the new order.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("applies a valid permutation and restamps indexes", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await executeEditStoryboard({ cardId: "card-1", op: "reorderShots", order: [2, 0, 1] }, { context: makeCtx() });
    expect(res).toEqual({ cardId: "card-1", shotCount: 3 });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    expect(written.shots.map((s) => s.shotId)).toEqual(["s2", "s0", "s1"]);
    expect(written.shots.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

/**
 * 锚 S1 · $0 子旅程(B3 spec §三 S1:brief → draft scenes($0)→ 改脚本 → 保存)——
 * 双执行器里的 Otto 侧全链走查:proposeStoryboard 起草卡片 → editStoryboard 改镜头文字 →
 * 重排 → 保存(payload 持久化),全程 **零 GenJob、零 reserve**(付费 Make all 属批2 W-B3-H)。
 */
describe("S1 $0 sub-journey: draft → edit script → save (never spends)", () => {
  it("walks the chain against one simulated persisted card and never creates a GenJob", async () => {
    // draft scenes ($0): proposeStoryboard persists the card
    let persisted: { id: string; payload: StoryboardCardPayload } | null = null;
    mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ("kind" in args.where) {
        // editStoryboard's owner-scoped card load
        if (!persisted || args.where.id !== persisted.id || args.where.ownerId !== OWNER) return null;
        return { id: persisted.id, payload: persisted.payload, thread: { ownerId: OWNER, deletedAt: null } };
      }
      return null; // proposeStoryboard's seq lookup (no prior message)
    });
    mockCreate.mockImplementation(async (args: { data: { id: string; payload: StoryboardCardPayload } }) => {
      persisted = { id: args.data.id, payload: args.data.payload };
      return args.data;
    });
    mockUpdate.mockImplementation(async (args: { where: { id: string }; data: { payload: StoryboardCardPayload } }) => {
      if (persisted && args.where.id === persisted.id) persisted = { ...persisted, payload: args.data.payload };
      return {};
    });

    const ctx = makeCtx();
    const { cardId } = await executeProposeStoryboard(
      {
        storyboardTitle: "Festive launch ad",
        goal: "drive store visits",
        shots: [
          { firstFramePrompt: "hook frame", videoPrompt: "hook move" },
          { firstFramePrompt: "reveal frame", videoPrompt: "reveal move" },
        ],
      },
      { context: ctx },
    );
    expect(persisted!.payload.shots).toHaveLength(2);

    // 改脚本: rewrite shot 2's video prompt
    const edit = await executeEditStoryboard({ cardId, op: "editShot", index: 1, videoPrompt: "slower reveal, close-up" }, { context: ctx });
    expect(edit).toEqual({ cardId, shotCount: 2 });
    expect(persisted!.payload.shots[1]!.videoPrompt).toBe("slower reveal, close-up");

    // 改结构: put the reveal first, then save is the same persisted write
    const reorder = await executeEditStoryboard({ cardId, op: "reorderShots", order: [1, 0] }, { context: ctx });
    expect(reorder).toEqual({ cardId, shotCount: 2 });
    expect(persisted!.payload.shots.map((s) => s.videoPrompt)).toEqual(["slower reveal, close-up", "hook move"]);
    expect(persisted!.payload.shots.map((s) => s.index)).toEqual([0, 1]);

    // $0 全链断言:分镜起草/编辑绝不建 GenJob(Make all 付费管线在批2 W-B3-H,不在此)
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});
