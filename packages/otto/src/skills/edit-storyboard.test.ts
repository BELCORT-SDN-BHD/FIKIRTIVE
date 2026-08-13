import { describe, it, expect, vi, beforeEach } from "vitest";
import { editStoryboardInput, executeEditStoryboard, editStoryboardSkill } from "./edit-storyboard.js";
import { executeProposeStoryboard } from "./propose-storyboard.js";
import { MAX_STORYBOARD_SHOTS, type StoryboardCardPayload } from "./propose-storyboard.helpers.js";
import type { OttoContext } from "../context.js";

const { mockFindFirst, mockUpdate, mockCreate, mockGenJobCreate, mockGenJobFindFirst, mockExecuteRaw } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockGenJobCreate: vi.fn(), // must NEVER be called — this skill is $0
  mockGenJobFindFirst: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

// #782 r15:editShot 变成「卡锁 + 锁内重读 + 在途闸 + 写」的一笔事务,所以替身多了
// $transaction / $executeRaw / genJob.findFirst。tx 与顶层共用同一组 mock。
vi.mock("@fikirtive/db", () => {
  const client = {
    chatMessage: { findFirst: mockFindFirst, update: mockUpdate, create: mockCreate },
    genJob: { create: mockGenJobCreate, findFirst: mockGenJobFindFirst },
    $executeRaw: mockExecuteRaw,
  };
  return {
    prisma: { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) },
    Prisma: {},
  };
});
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
  mockExecuteRaw.mockResolvedValue(1);
  mockGenJobFindFirst.mockResolvedValue(null); // 默认:子卡背后没有任何作业
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

// ---------------------------------------------------------------------------
// #782 接续开关的 Otto 那一面 —— 与人工动作层共用同一条纯变换
// ---------------------------------------------------------------------------

describe("#782 op=setContinuity", () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    mockUpdate.mockResolvedValue({});
  });

  it("开 → 回写 continuity:true,镜头一格不动(不碰任何已生成的帧/片键)", async () => {
    const res = await executeEditStoryboard(
      { cardId: "card-1", op: "setContinuity", continuity: true },
      { context: makeCtx() },
    );
    expect(res).toEqual({ cardId: "card-1", shotCount: 3 });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    expect(written.continuity).toBe(true);
    expect(written.shots).toEqual(payload3().shots);
  });

  it("关 → 不落键", async () => {
    mockFindFirst.mockResolvedValue(card({ ...payload3(), continuity: true }));
    await executeEditStoryboard({ cardId: "card-1", op: "setContinuity", continuity: false }, { context: makeCtx() });
    const written = mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload;
    expect("continuity" in written).toBe(false);
  });

  it("没说开还是关 → 拒绝,零写入(绝不替商家猜一个方向)", async () => {
    const res = await executeEditStoryboard({ cardId: "card-1", op: "setContinuity" }, { context: makeCtx() });
    expect(res).toEqual({ error: "setContinuity needs continuity true or false." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("跨租户的卡照旧进不来", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await executeEditStoryboard(
      { cardId: "card-1", op: "setContinuity", continuity: true },
      { context: makeCtx({ orgId: "someone-else" }) },
    );
    expect(res).toEqual({ error: "Card not found." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("$0:这条路同样不建 GenJob", async () => {
    await executeEditStoryboard({ cardId: "card-1", op: "setContinuity", continuity: true }, { context: makeCtx() });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
    expect(editStoryboardInput.safeParse({ cardId: "c", op: "setContinuity", continuity: true }).success).toBe(true);
    expect(editStoryboardSkill.cost).toBe("free");
  });
});

// ---------------------------------------------------------------------------
// #782 r15(判官 r14 P1)—— Otto 那一面也必须让路
// ---------------------------------------------------------------------------
//
// 双面产品哲学:同一个业务动作,人工与 Otto 走同一条规矩。这道闸只装在人工那一面,等于
// 商家换个入口就能把同一笔钱的产出变成孤儿 —— 只关一扇门等于没关。判定与话术都从
// ../storyboard-child-job.js 来,两面不可能漂移。
describe("#782 r15 editShot —— 在途付费作业面前,Otto 的编辑同样让路", () => {
  const VIDEO_BUSY = "That video is still being made — wait for it to finish, then edit this shot.";
  const FRAME_BUSY = "That first frame is still being made — wait for it to finish, then edit this shot.";

  function paid(): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [
        { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameCardId: "fc0", firstFrameGenerationId: "fg0", videoCardId: "vc0" },
        { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      ],
    };
  }

  function route(p: StoryboardCardPayload) {
    mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const w = args.where;
      if (w.kind === "STORYBOARD_CARD") return card(p);
      if (w.kind === "GEN_CARD") return { genJobId: null };
      return null; // GEN_RESULT 缺席 → 回落到作业行自己的 generationIds
    });
  }

  it("视频作业还在跑 → 拒绝、零写入(指针留着,产出回得来,第二个幂等域铸不出来)", async () => {
    route(paid());
    mockGenJobFindFirst.mockResolvedValue({ id: "j1", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p", threadId: "t-1" });

    const res = await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW" },
      { context: makeCtx() },
    );

    expect(res).toEqual({ error: VIDEO_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("视频作业 DONE 但产出还没落到 payload → 同样拒绝(钱已收、产出未消费)", async () => {
    route(paid());
    mockGenJobFindFirst.mockResolvedValue({ id: "j1", status: "DONE", generationIds: ["g9"], lastFrameAssetId: null, projectId: "p", threadId: "t-1" });

    const res = await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, durationSeconds: 10 },
      { context: makeCtx() },
    );

    expect(res).toEqual({ error: VIDEO_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("首帧作业在途 + 改 firstFramePrompt → 拒绝;同一状态下只改 videoPrompt → 放行", async () => {
    const p = paid();
    delete p.shots[0]!.videoCardId; // 只剩帧指针
    route(p);
    mockGenJobFindFirst.mockResolvedValue({ id: "jf", status: "QUEUED", generationIds: [], lastFrameAssetId: null, projectId: "p", threadId: "t-1" });

    expect(await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, firstFramePrompt: "NEW" },
      { context: makeCtx() },
    )).toEqual({ error: FRAME_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();

    // 帧两键这次不会被删 → 别人的在途不挡这一次编辑。
    const ok = await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW" },
      { context: makeCtx() },
    );
    expect(ok).toEqual({ cardId: "card-1", shotCount: 2 });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("死作业 / 产出已消费 / 根本没作业 → 一律放行,三条既有路一格没少", async () => {
    for (const job of [
      { id: "j", status: "FAILED", generationIds: [], lastFrameAssetId: null, projectId: "p", threadId: "t-1" },
      null,
    ]) {
      vi.clearAllMocks();
      mockUpdate.mockResolvedValue({});
      mockExecuteRaw.mockResolvedValue(1);
      route(paid());
      mockGenJobFindFirst.mockResolvedValue(job);
      const res = await executeEditStoryboard(
        { cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW" },
        { context: makeCtx() },
      );
      expect(res).toEqual({ cardId: "card-1", shotCount: 2 });
    }

    // 产出已经落在 payload 上 = 商家看着成品说「再做一个」。
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockExecuteRaw.mockResolvedValue(1);
    const consumed = paid();
    consumed.shots[0]!.videoGenerationId = "g9";
    route(consumed);
    mockGenJobFindFirst.mockResolvedValue({ id: "j", status: "DONE", generationIds: ["g9"], lastFrameAssetId: null, projectId: "p", threadId: "t-1" });
    expect(await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW" },
      { context: makeCtx() },
    )).toEqual({ cardId: "card-1", shotCount: 2 });
  });

  it("先取卡锁、锁内重读父卡才判断 —— 不是 check-then-act", async () => {
    route(paid());
    mockGenJobFindFirst.mockResolvedValue(null);

    await executeEditStoryboard(
      { cardId: "card-1", op: "editShot", index: 0, videoPrompt: "NEW" },
      { context: makeCtx() },
    );

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const reads = mockFindFirst.mock.calls.filter(
      (c) => (c[0] as { where: Record<string, unknown> }).where.kind === "STORYBOARD_CARD",
    );
    expect(reads.length).toBe(2); // 锁前存在性 + 锁内权威
  });

  it("其余四个 op 一格不变:仍是不取锁的 last-write-wins 写回", async () => {
    route(paid());
    await executeEditStoryboard({ cardId: "card-1", op: "setContinuity", continuity: true }, { context: makeCtx() });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
