import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_VIDEO_MODEL_OPTIONS, pricedGenCredits, displayCredits } from "@fikirtive/core";
import type { StoryboardCardPayload } from "@fikirtive/otto";
// 卡面侧的纯读判据。闸③ 写下的判词只有经过它才变成商家看得见的东西,所以「判词自清洁」
// 这一类断言在这里直接用它来收口,不再另写一份平行的解读。
import { shotsStuckWithoutInheritedFrame, shotsNeedingMintedFirstFrame } from "../storyboard-card";
import type { ShotMediaSyncReport } from "../storyboard-card";

// ---------------------------------------------------------------------------
// Mocks — mirror F3 storyboard-actions.test.ts style (vi.hoisted + vi.mock).
// Adds: @fikirtive/otto buildProposeCard (deterministic payload), @fikirtive/core
// newId (counter), resolveDisabledModels, and genJob/entity/$transaction on the db mock.
//
// 修复轮 v2 (NODE-282②): the $transaction mock is BUFFERED with REAL lock semantics:
//  • WRITES (chatMessage.create/update) are STAGED into a per-tx buffer and COMMITTED
//    (replayed onto mockChatCreate/mockChatUpdate) only when the callback resolves; a
//    throw DISCARDS the buffer — true rollback semantics, so "zero partial commit" is a
//    real assertion, not an artifact of throwing before the first write.
//    mockTxChatCreate/mockTxChatUpdate record ATTEMPTED (staged) writes — they survive
//    for assertion even when the tx rolls back.
//  • $executeRaw (the card advisory lock, NODE-282①) implements an actual per-key async
//    mutex held until the tx settles — two interleaved $transaction calls on the same
//    card key run strictly serially, mirroring pg_advisory_xact_lock. mockTxLock spies
//    the lock key.
//  • READS (findFirst) pass through to the shared mockChatFindFirst — stateful tests
//    (the concurrency regressions) back it with mutable state that the COMMIT step
//    mutates, so a later tx's post-lock re-read sees what an earlier tx committed.
// ---------------------------------------------------------------------------
const {
  mockOwner,
  mockChatFindFirst,
  mockChatCreate,
  mockChatUpdate,
  mockTxChatCreate,
  mockTxChatUpdate,
  mockTxLock,
  mockGenJobFindFirst,
  mockGenJobCreate,
  mockEntityFindMany,
  mockGenerationFindMany,
  mockAssetFindFirst,
  mockGenerationCreate,
  mockBuildProposeCard,
  mockResolveDisabled,
  mockSuggestModel,
  cardLocks,
  db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn(); // COMMITTED creates (replayed only on tx success)
  const mockChatUpdate = vi.fn(); // COMMITTED updates (replayed only on tx success)
  const mockTxChatCreate = vi.fn(); // ATTEMPTED (staged) creates inside a tx
  const mockTxChatUpdate = vi.fn(); // ATTEMPTED (staged) updates inside a tx
  const mockTxLock = vi.fn(); // advisory-lock spy: called with the card lock key
  const mockGenJobFindFirst = vi.fn();
  const mockGenJobCreate = vi.fn();
  const mockEntityFindMany = vi.fn();
  const mockGenerationFindMany = vi.fn();
  // #782 闸③:末帧 Asset 的只读查询 + 「真的要用它了」那一刻铸的 Generation 行。
  const mockAssetFindFirst = vi.fn();
  const mockGenerationCreate = vi.fn();
  const cardLocks = new Map<string, Promise<void>>();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate },
    genJob: { findFirst: mockGenJobFindFirst, create: mockGenJobCreate },
    entity: { findMany: mockEntityFindMany },
    generation: { findMany: mockGenerationFindMany, create: mockGenerationCreate },
    asset: { findFirst: mockAssetFindFirst },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => {
    const staged: Array<{ kind: "create" | "update"; args: unknown }> = [];
    const heldLocks: Array<() => void> = []; // releases pushed by $executeRaw (array form: TS CFA can't see closure assigns)
    const tx = {
      // pg_advisory_xact_lock mock: a real per-key mutex, held until this tx settles.
      $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const key = String(values[0]);
        mockTxLock(key);
        const tail = cardLocks.get(key) ?? Promise.resolve();
        let mine!: () => void;
        const held = new Promise<void>((r) => (mine = r));
        cardLocks.set(key, tail.then(() => held));
        await tail; // block until every earlier holder of this key releases
        heldLocks.push(mine);
        return 0;
      },
      chatMessage: {
        findFirst: mockChatFindFirst,
        create: async (args: unknown) => {
          mockTxChatCreate(args);
          staged.push({ kind: "create", args });
          return {};
        },
        update: async (args: unknown) => {
          mockTxChatUpdate(args);
          staged.push({ kind: "update", args });
          return {};
        },
      },
      genJob: db.genJob,
      entity: db.entity,
      generation: db.generation,
      asset: db.asset,
    };
    try {
      const result = await fn(tx);
      // COMMIT: replay staged writes onto the committed mocks (stateful impls mutate here).
      for (const w of staged) {
        if (w.kind === "create") await mockChatCreate(w.args);
        else await mockChatUpdate(w.args);
      }
      return result;
    } finally {
      for (const r of heldLocks) r(); // release AFTER commit replay — the next holder re-reads committed state
    }
  };
  return {
    mockOwner: vi.fn(),
    mockChatFindFirst,
    mockChatCreate,
    mockChatUpdate,
    mockTxChatCreate,
    mockTxChatUpdate,
    mockTxLock,
    mockGenJobFindFirst,
    mockGenJobCreate,
    mockEntityFindMany,
    mockGenerationFindMany,
    mockAssetFindFirst,
    mockGenerationCreate,
    mockBuildProposeCard: vi.fn(),
    mockResolveDisabled: vi.fn(),
    mockSuggestModel: vi.fn(),
    cardLocks,
    db,
  };
});

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabled }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {} }));

// newId: deterministic counter so minted child ids are predictable.
// suggestModel: overridden so getStoryboardVideoOptions derives a deterministic
// video model, while GEN_VIDEO_MODEL_OPTIONS (the real durations table) is kept
// via importOriginal — the options action reads the REAL table for that model.
let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => `new-${++idCounter}`,
  suggestModel: mockSuggestModel,
}));

// buildProposeCard: deterministic payload; estimatedCredits 5 so totalCredits math is exact.
// The action passes structuredPrompt/entityIds through the input, which we echo back so the
// returned ChildFrameCard fields can be asserted.
vi.mock("@fikirtive/otto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/otto")>()),
  buildProposeCard: mockBuildProposeCard,
}));

import {
  prepareStoryboardFirstFrames,
  regenShotFirstFrameCard,
  syncStoryboardMedia,
  getStoryboardVideoOptions,
  prepareStoryboardVideos,
  regenShotVideoCard,
} from "../storyboard-gate1-actions";

// #782 r11(判官 r10)—— sync 的答复现在是每镜头两格的**权威状态**。这四个助手让断言保持
// 一样短,但读的是新口径:「有没有地址」是 done 状态自己的一格,「在跑 / 死了 / 没有作业」
// 是状态本身,不再是两格 id 集合。
function reportOf(res: { shots: ShotMediaSyncReport[] }, shotId: string): ShotMediaSyncReport {
  const r = res.shots.find((s) => s.shotId === shotId);
  if (!r) throw new Error(`no media report for ${shotId}`);
  return r;
}
function frameUrl(res: { shots: ShotMediaSyncReport[] }, shotId: string): string | undefined {
  const st = reportOf(res, shotId).frame.status;
  return st.kind === "done" ? st.url : undefined;
}
function videoUrl(res: { shots: ShotMediaSyncReport[] }, shotId: string): string | undefined {
  const st = reportOf(res, shotId).video.status;
  return st.kind === "done" ? st.url : undefined;
}
function frameKind(res: { shots: ShotMediaSyncReport[] }, shotId: string): string {
  return reportOf(res, shotId).frame.status.kind;
}
function videoKind(res: { shots: ShotMediaSyncReport[] }, shotId: string): string {
  return reportOf(res, shotId).video.status.kind;
}

const OWNER = "owner-1";

function card(payload: StoryboardCardPayload) {
  return { id: "card-1", threadId: "t-1", payload, thread: { ownerId: OWNER, deletedAt: null } };
}

/** 3 shots: s0 no image / no child → mint; s1 has firstFrameGenerationId → skip; s2 no image → mint. */
function payload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", entityIds: ["e0"] },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1", firstFrameGenerationId: "gen1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  cardLocks.clear();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockResolvedDefaults();
});

function mockResolvedDefaults() {
  mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>() });
  // suggestModel: 在产那台视频引擎(#647 T6 之后菜单上只剩它)。这个夹具喂的是**真的**
  // GEN_VIDEO_MODEL_OPTIONS 查表(via importOriginal),所以模型名必须是菜单上真有的一格 ——
  // 写一个下架 id 会让 options 读到 undefined。
  mockSuggestModel.mockReturnValue({
    model: "seedance-2-mini",
    params: { durationSeconds: 5, count: 1 },
    reason: "",
    downgraded: false,
    requested: {},
  });
  mockEntityFindMany.mockResolvedValue([{ id: "e0" }]); // e0 owned
  mockChatCreate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockGenJobFindFirst.mockResolvedValue(null); // nothing spent by default
  mockGenerationFindMany.mockResolvedValue([]); // no thumbnails by default
  mockAssetFindFirst.mockResolvedValue(null); // #782: no stored last frame unless a test says so
  mockGenerationCreate.mockImplementation(async (args: { data: { id: string } }) => ({ id: args.data.id }));
  // seq allocation: latest seq in thread +1 (only used for minted children)
  mockChatFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) => {
    // seq lookup (orderBy seq desc) → return a seq; card/child loads are set per-test.
    if (args?.where && !args.where.kind) return { seq: 10 };
    return null;
  });
  // buildProposeCard echoes prompt/entities, fixed 5 credits.
  mockBuildProposeCard.mockImplementation((input: { structuredPrompt: string; entityIds: string[] }) => ({
    cardPayload: {
      kind: "image",
      model: "m",
      params: { count: 1 },
      structuredPrompt: input.structuredPrompt,
      entityIds: input.entityIds,
      estimatedCredits: 5,
      estimatedPriceUsd: 0.2,
      reason: "",
      downgraded: false,
      variantSel: {},
    },
    shownPriceDisplay: 5,
  }));
}

/** Wire mockChatFindFirst to resolve the parent card + optional child-card lookups by id. */
function wireLoads(parent: ReturnType<typeof card>, children: Record<string, { payload: unknown; genJobId: string | null } | null> = {}) {
  mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
    const where = args?.where ?? {};
    // Parent STORYBOARD_CARD load
    if (where.kind === "STORYBOARD_CARD") return where.id === parent.id ? parent : null;
    // Child GEN_CARD load (by id) — attach the lookup id so code reading `existing.id` works.
    if (where.kind === "GEN_CARD" && typeof where.id === "string") {
      const rec = where.id in children ? children[where.id] : null;
      return rec ? { id: where.id, ...rec } : null;
    }
    // seq lookup (orderBy seq desc, no kind)
    if (args?.orderBy) return { seq: 10 };
    return null;
  });
}

/**
 * #656 P2 —— 把「视频那一格现在是什么形状」摆成某个具体值,并让铸卡如实把这个形状冻进
 * 子卡(真 buildProposeCard 就是这么做的:desiredAspect → params.aspectRatio)。
 * 首帧形状的唯一来源是视频侧的选型(firstFrameAspect → suggestModel),所以改这一处
 * 就等于「商家把片子的形状换了」。
 */
function useVideoShape(aspectRatio: string) {
  mockSuggestModel.mockReturnValue({
    model: "seedance-2-mini",
    params: { durationSeconds: 5, count: 1, aspectRatio },
    reason: "",
    downgraded: false,
    requested: {},
  });
  mockBuildProposeCard.mockImplementation(
    (input: { structuredPrompt: string; entityIds: string[]; desiredAspect?: string }) => ({
      cardPayload: {
        kind: "image",
        model: "m",
        params: { count: 1, ...(input.desiredAspect ? { aspectRatio: input.desiredAspect } : {}) },
        structuredPrompt: input.structuredPrompt,
        entityIds: input.entityIds,
        estimatedCredits: 5,
        estimatedPriceUsd: 0.2,
        reason: "",
        downgraded: false,
        variantSel: {},
      },
      shownPriceDisplay: 5,
    }),
  );
}

describe("prepareStoryboardFirstFrames — $0 铸卡", () => {
  it("给缺图镜头逐个铸子 GEN_CARD(payload 带 storyboardCardId+shotId 回链),父卡写 firstFrameCardId", async () => {
    wireLoads(card(payload3()));
    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });

    expect("children" in res).toBe(true);
    if (!("children" in res)) return;

    // Exactly 2 children minted (s0, s2); s1 skipped (has firstFrameGenerationId).
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    for (const c of mockChatCreate.mock.calls) {
      const data = c[0].data;
      expect(data.kind).toBe("GEN_CARD");
      expect(data.role).toBe("AGENT");
      expect(data.ownerId).toBe(OWNER);
      expect(data.threadId).toBe("t-1");
      expect(data.text).toBe("");
      expect("genJobId" in data).toBe(false); // $0: genJobId never set
      // backlink stamped on payload
      expect(data.payload.storyboardCardId).toBe("card-1");
      expect(["s0", "s2"]).toContain(data.payload.shotId);
    }
    // shotIds map to the right shots
    const shotIds = mockChatCreate.mock.calls.map((c) => c[0].data.payload.shotId).sort();
    expect(shotIds).toEqual(["s0", "s2"]);

    // Parent update: only s0/s2 got firstFrameCardId; s1 untouched.
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const updShots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameCardId).toBeTruthy();
    expect(updShots[1].firstFrameCardId).toBeUndefined(); // s1 unchanged
    expect(updShots[1].firstFrameGenerationId).toBe("gen1"); // s1 byte-preserved
    expect(updShots[2].firstFrameCardId).toBeTruthy();
    // s0/s2 got DISTINCT child ids
    expect(updShots[0].firstFrameCardId).not.toBe(updShots[2].firstFrameCardId);

    // return: 2 children + totalCredits 10 (both unspent)
    expect(res.children).toHaveLength(2);
    expect(res.totalCredits).toBe(10);
    const returned = res.children.map((c) => c.shotId).sort();
    expect(returned).toEqual(["s0", "s2"]);
    // ChildFrameCard shape
    const s0child = res.children.find((c) => c.shotId === "s0")!;
    expect(s0child.estimatedCredits).toBe(5);
    expect(s0child.structuredPrompt).toBe("ff0");
    expect(s0child.entityIds).toEqual(["e0"]);
    expect(s0child.spent).toBe(false);
    expect(s0child.childCardId).toBeTruthy();
  });

  it("可重入:镜头已有 firstFrameCardId 且子卡 prompt 一致 → 复用,不再铸", async () => {
    const p = payload3();
    // s0 already points at an existing child whose prompt matches ff0.
    p.shots[0].firstFrameCardId = "child-0";
    // Make s2 also already-satisfied so ONLY reuse happens (no minting) for a clean assertion.
    p.shots[2].firstFrameGenerationId = "gen2";
    wireLoads(card(p), {
      "child-0": { payload: { structuredPrompt: "ff0", entityIds: ["e0"], estimatedCredits: 5 }, genJobId: null },
    });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect("children" in res).toBe(true);
    if (!("children" in res)) return;

    // No minting — child-0 reused as-is.
    expect(mockChatCreate).not.toHaveBeenCalled();
    // children includes the reused child, spent:false (no genJobId, no idempotency job)
    expect(res.children).toHaveLength(1);
    expect(res.children[0].shotId).toBe("s0");
    expect(res.children[0].childCardId).toBe("child-0");
    expect(res.children[0].estimatedCredits).toBe(5);
    expect(res.children[0].spent).toBe(false);
    expect(res.totalCredits).toBe(5);
  });

  it("可重入防御:子卡 prompt 已过期(不一致)→ 铸新替换", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate to s0
    wireLoads(card(p), {
      // stale: child prompt != shot.firstFramePrompt("ff0")
      "child-0": { payload: { structuredPrompt: "STALE" }, genJobId: null },
    });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // Minted a replacement for s0.
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.shotId).toBe("s0");
    // parent update replaces firstFrameCardId away from "child-0"
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameCardId).not.toBe("child-0");
    expect(res.children[0].childCardId).not.toBe("child-0");
  });

  /**
   * #656 P2(判词):「首帧形状在 `storyboard-gate1-actions.ts:165` 推导、`:202` 冻入新子卡;
   * 但准备与重生成的复用只比对提示词(`:370`、`:480`)。⇒ 改形状后,未花费的旧形状子卡存活
   * 并可被批准。」
   *
   * 商家视角:片子从方图改成横版,分镜上那张首帧卡还是旧的方图 —— 卡面写着一个形状,批准
   * 之后出的是另一个。提示词一个字没改,所以旧谓词认不出这是两张不同的卡。
   */
  it("#656 P2 形状漂移:子卡冻的形状已不是现在会铸出来的形状 → 不复用,铸新替换", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate to s0
    wireLoads(card(p), {
      // 提示词一致,但冻的是方图 —— 而片子现在是横版。
      "child-0": {
        payload: { structuredPrompt: "ff0", entityIds: ["e0"], estimatedCredits: 5, params: { count: 1, aspectRatio: "1:1" } },
        genJobId: null,
      },
    });
    useVideoShape("16:9");

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // 铸了一张新的,而且冻的是现在这一格形状。
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.params.aspectRatio).toBe("16:9");
    // 父卡指针从旧形状那张移开 —— 旧卡不再是这个镜头的首帧卡。
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameCardId).not.toBe("child-0");
    expect(res.children[0].childCardId).not.toBe("child-0");
  });

  it("#656 P2 对照:形状没变(提示词也没变)→ 照常复用,不铸新", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate to s0
    wireLoads(card(p), {
      "child-0": {
        payload: { structuredPrompt: "ff0", entityIds: ["e0"], estimatedCredits: 5, params: { count: 1, aspectRatio: "16:9" } },
        genJobId: null,
      },
    });
    useVideoShape("16:9");

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(res.children[0].childCardId).toBe("child-0");
  });

  it("spent 侦测:子卡存在幂等 job → spent:true,不计入 totalCredits", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate to s0
    wireLoads(card(p), {
      "child-0": { payload: { structuredPrompt: "ff0" }, genJobId: null },
    });
    // an idempotency job exists for child-0 → spent
    mockGenJobFindFirst.mockResolvedValue({ id: "job-x" });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // read-only guard — mirrors coworkGenerate's guard read
    expect(mockGenJobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: OWNER, idempotencyKey: "cowork:child-0" } }),
    );
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // NEVER writes
    expect(res.children[0].spent).toBe(true);
    expect(res.totalCredits).toBe(0); // spent excluded
  });

  // 微修轮 v4(NODE-282-R3①):锁内重读 fresh 为 null(卡在锁前被删/kind 变更)→ fail-closed
  // 零写返回 "Card not found.",禁止回落锁前旧快照 cur(旧快照路径复活=可按过期指针铸卡)。
  it("R3① fresh-null fail-closed:锁内重读卡已消失 → {error: Card not found.},零暂存零提交、无 cur 回落", async () => {
    const p = payload3(); // s0/s2 缺图 —— 若回落 cur 会错误地铸出 2 张子卡
    let boardLoads = 0;
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        boardLoads += 1;
        return boardLoads === 1 ? card(p) : null; // outer load OK; in-lock re-read: card GONE
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // locked, then failed closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  // ===================================================================================
  // 微修轮 v5 · NODE-282-R4①(数据流完备清扫的点名实例):owned 集不得在锁前派生。
  // 形态:s0 引用 e0+e1;prepare 启动时 owned 集只有 e0,在等锁期间变为 {e0,e1}(如另一
  // session 完成实体创建)。锁后派生(v5)→ 铸卡收到两个元素(buildProposeCard 第三实参
  // =写路径入参);锁前派生(v4)→ 铸卡吃到过期的一个。
  // #774:第三实参从「id 数组」变成「带名字与类型的身份数组」—— 名字要跟归属同一趟读出来
  // 才能冻结到卡上,所以这条锁后派生的纪律现在连名字一起管。
  // ===================================================================================
  it("R4① 回归:等锁期间 owned-entity 集变化 → 锁后按新集派生 owned 身份进铸卡(不吃锁前快照)", async () => {
    const p = payload3();
    p.shots[0].entityIds = ["e0", "e1"]; // s0 references two entities
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate: only s0 mints
    wireLoads(card(p));

    // The owned-entity set CHANGES while prepare waits for the lock.
    let ownedRows = [{ id: "e0", type: "PRODUCT", name: "Bottle" }]; // at call time: only e0 owned
    mockEntityFindMany.mockImplementation(async () => ownedRows);

    // An in-flight card writer holds the lock (manual mutex entry, same map the tx mock uses).
    let releaseLock!: () => void;
    cardLocks.set("card:card-1", new Promise<void>((r) => (releaseLock = r)));

    const prepP = prepareStoryboardFirstFrames({ cardId: "card-1" });
    await new Promise((r) => setTimeout(r, 0)); // let prepare park on the lock

    // e1 becomes owned DURING the lock wait
    ownedRows = [{ id: "e0", type: "PRODUCT", name: "Bottle" }, { id: "e1", type: "CHARACTER", name: "Mia" }];
    releaseLock();

    const res = await prepP;
    if (!("children" in res)) throw new Error("expected children");

    // The owned set was derived AFTER the lock → the mint (buildProposeCard 3rd arg = the
    // owned-entity write-path input) received the NEW set, not the pre-lock snapshot.
    // #774:名字与类型也一起进去了 —— 卡上冻结的就是这一刻的身份。
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // s0 minted once
    const ownedArg = mockBuildProposeCard.mock.calls[0][2];
    expect(ownedArg).toEqual([
      { id: "e0", type: "PRODUCT", name: "Bottle" },
      { id: "e1", type: "CHARACTER", name: "Mia" },
    ]);
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 throughout
  });

  it("$0 铁证:genJob.create 从未被调", async () => {
    wireLoads(card(payload3()));
    await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    wireLoads(card(payload3()));
    const res = await prepareStoryboardFirstFrames({ cardId: "missing" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非 STORYBOARD_CARD(loadCard 返回 null)→ {error},不写 DB", async () => {
    // findFirst always null → not found (kind filter excludes non-storyboard)
    mockChatFindFirst.mockResolvedValue(null);
    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await prepareStoryboardFirstFrames({ cardId: "" } as unknown as { cardId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("全部镜头都有图 → children:[], totalCredits:0,不写 DB", async () => {
    const p = payload3();
    p.shots.forEach((s) => (s.firstFrameGenerationId = "genX"));
    wireLoads(card(p));
    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    expect(res).toEqual({ children: [], totalCredits: 0 });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #643 T2 —— 首帧图的形状 = 这个镜头的片子的形状
//
// 在这之前首帧一律是方图，而它接下来要变成的那条片子是横版的：商家为一张会被重新
// 取景的图付了钱，而且没有一个地方说过这件事。形状不写死 —— 走和铸视频子卡同一条
// 选型路，视频侧换档时首帧自动跟着换。
// ---------------------------------------------------------------------------
describe("首帧图形状(#643 T2)", () => {
  /** 传给 buildProposeCard 的第一个参数（图片方案的输入）。#656 P2 之后每个镜头会走两次
   *  这条纯路：一次算「现在会铸出来的那张卡」用于复用比对，一次真的铸卡 —— 两次同一份输入，
   *  这正是「比的就是会铸出来的东西」。铸了几张看 mockChatCreate。 */
  const mintInputs = () => mockBuildProposeCard.mock.calls.map((call) => call[0] as { desiredAspect?: string });

  it("片子是 16:9 ⇒ 首帧就按 16:9 铸（不再默认方图）", async () => {
    mockSuggestModel.mockReturnValue({
      model: "seedance-2-mini",
      params: { durationSeconds: 5, aspectRatio: "16:9", count: 1 },
      reason: "", downgraded: false, requested: {},
    });
    wireLoads(card(payload3()));
    await prepareStoryboardFirstFrames({ cardId: "card-1" });

    expect(mockChatCreate).toHaveBeenCalledTimes(2); // s0/s2 各铸一张
    for (const input of mintInputs()) expect(input.desiredAspect).toBe("16:9");
  });

  it("视频侧换成竖版 ⇒ 首帧自动跟着换（形状不写死在这个文件里）", async () => {
    mockSuggestModel.mockReturnValue({
      model: "seedance-2-mini",
      params: { durationSeconds: 5, aspectRatio: "9:16", count: 1 },
      reason: "", downgraded: false, requested: {},
    });
    wireLoads(card(payload3()));
    await prepareStoryboardFirstFrames({ cardId: "card-1" });

    for (const input of mintInputs()) expect(input.desiredAspect).toBe("9:16");
  });

  it("这个视频模型压根不暴露形状 ⇒ 不发明一个值，交给图片侧的默认形状", async () => {
    // 默认 mock 的 suggestModel 返回的 params 里就没有 aspectRatio（= 模型不暴露形状）。
    wireLoads(card(payload3()));
    await prepareStoryboardFirstFrames({ cardId: "card-1" });

    for (const input of mintInputs()) expect(input.desiredAspect).toBeUndefined();
  });

  it("视频那一格不在图片菜单上 ⇒ 同样不发明值（引擎收不下的形状到不了付费请求）", async () => {
    mockSuggestModel.mockReturnValue({
      model: "seedance-2-mini",
      params: { durationSeconds: 5, aspectRatio: "adaptive", count: 1 },
      reason: "", downgraded: false, requested: {},
    });
    wireLoads(card(payload3()));
    await prepareStoryboardFirstFrames({ cardId: "card-1" });

    for (const input of mintInputs()) expect(input.desiredAspect).toBeUndefined();
  });

  it("重出一张首帧走的是同一条形状口径", async () => {
    mockSuggestModel.mockReturnValue({
      model: "seedance-2-mini",
      params: { durationSeconds: 5, aspectRatio: "16:9", count: 1 },
      reason: "", downgraded: false, requested: {},
    });
    wireLoads(card(payload3()));
    await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s0" });

    expect(mockChatCreate).toHaveBeenCalledTimes(1); // 只重出这一个镜头
    for (const input of mintInputs()) expect(input.desiredAspect).toBe("16:9");
  });
});

describe("regenShotFirstFrameCard — $0 重出铸卡", () => {
  it("按 shotId 铸新子卡只替换 firstFrameCardId,PRESERVE firstFrameGenerationId(其余镜头不动)", async () => {
    const p = payload3();
    // s1 has an existing stale child ("old-1", not in loads → missing/stale) AND an image
    // (gen1). Regen mints a replacement but must NOT touch the old genId — old frame stays
    // valid until the new one lands (via sync).
    p.shots[1].firstFrameCardId = "old-1";
    wireLoads(card(p)); // no children map → "old-1" resolves null → mint fresh

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    expect("child" in res).toBe(true);
    if (!("child" in res)) return;

    // one fresh child minted with s1's CURRENT prompt
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const created = mockChatCreate.mock.calls[0][0].data;
    expect(created.kind).toBe("GEN_CARD");
    expect(created.payload.shotId).toBe("s1");
    expect(created.payload.storyboardCardId).toBe("card-1");
    expect("genJobId" in created).toBe(false);

    // parent update: s1.firstFrameCardId replaced (new id); firstFrameGenerationId PRESERVED.
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const shots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(shots[1].firstFrameCardId).toBeTruthy();
    expect(shots[1].firstFrameCardId).not.toBe("old-1");
    expect("firstFrameGenerationId" in shots[1]).toBe(true); // key still present…
    expect(shots[1].firstFrameGenerationId).toBe("gen1"); // …with the OLD value intact
    // other shots byte-preserved
    expect(shots[0]).toEqual(p.shots[0]);
    expect(shots[2]).toEqual(p.shots[2]);

    expect(res.child.shotId).toBe("s1");
    expect(res.child.estimatedCredits).toBe(5);
    expect(res.child.structuredPrompt).toBe("ff1");
  });

  it("可重入:镜头已有未花钱且 prompt 一致的子卡 → 复用,不铸新、不写 DB", async () => {
    const p = payload3();
    // s1 has an image (gen1) and an existing unspent child whose prompt matches ff1.
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: null },
    });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");

    // Reused: no mint, no parent write (child already registered on the shot).
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(res.child.childCardId).toBe("child-1");
    expect(res.child.shotId).toBe("s1");
    expect(res.child.estimatedCredits).toBe(5);
    expect(res.child.structuredPrompt).toBe("ff1");
    expect(res.child.spent).toBe(false);
  });

  /** #656 P2 —— 重生成侧的同一条病(`:480`):提示词一致就复用,漏掉冻结的形状。 */
  it("#656 P2 形状漂移:既有未花钱子卡冻的形状已不是现在会铸的 → 不复用,铸新替换", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": {
        payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5, params: { count: 1, aspectRatio: "1:1" } },
        genJobId: null,
      },
    });
    useVideoShape("16:9");

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.params.aspectRatio).toBe("16:9");
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[1].firstFrameCardId).not.toBe("child-1");
    expect(shots[1].firstFrameGenerationId).toBe("gen1"); // 旧图仍然有效,直到新首帧真的落地
    expect(res.child.childCardId).not.toBe("child-1");
  });

  it("可重入:既有子卡已花过钱(有幂等 job)→ 不复用,铸新替换", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1" }, genJobId: null },
    });
    // child-1 already spent (idempotency job exists) → must NOT reuse; mint fresh.
    mockGenJobFindFirst.mockResolvedValue({ id: "job-spent" });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[1].firstFrameCardId).not.toBe("child-1"); // replaced away from the spent child
    expect(shots[1].firstFrameGenerationId).toBe("gen1"); // old genId still preserved
    expect(res.child.childCardId).not.toBe("child-1");
  });

  it("shotId 不存在 → {error},不写 DB", async () => {
    wireLoads(card(payload3()));
    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "nope" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    wireLoads(card(payload3()));
    const res = await regenShotFirstFrameCard({ cardId: "missing", shotId: "s1" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await regenShotFirstFrameCard({ cardId: "card-1" } as unknown as { cardId: string; shotId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("R3① fresh-null fail-closed:锁内重读卡已消失 → {error: Card not found.},零暂存零提交、无 cur 回落", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "old-1"; // 若回落 cur 会走 stale→铸新替换路径
    let boardLoads = 0;
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        boardLoads += 1;
        return boardLoads === 1 ? card(p) : null; // outer load OK; in-lock re-read: card GONE
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // locked, then failed closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("$0 铁证:genJob.create 从未被调", async () => {
    wireLoads(card(payload3()));
    await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncStoryboardFirstFrames — $0 reconcile: write back firstFrameGenerationId + frame urls
// ---------------------------------------------------------------------------

const HASH = "a".repeat(64); // valid 64-hex content hash (real storageKey validates it)

/** A live Generation row shaped for getGenerationThumbs' storageKey derivation. */
function gen(id: string, ext = "png") {
  return { id, asset: { ownerId: OWNER, contentHash: HASH, ext } };
}

/**
 * Wire the sync path's reads:
 *  - parent STORYBOARD_CARD load (findFirst by kind)
 *  - child GEN_CARD load by id → returns its genJobId (best-effort link)
 *  - GEN_RESULT load by genJobId → returns its payload ({ generationIds })
 *  - seq lookups (orderBy, no kind) → { seq }
 * `children` maps childCardId → { genJobId } (the GEN_CARD row).
 * `results` maps genJobId → payload (the GEN_RESULT row's payload), or null if absent.
 */
function wireSync(
  parent: ReturnType<typeof card>,
  children: Record<string, { genJobId: string | null }> = {},
  results: Record<string, unknown> = {},
) {
  mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
    const where = args?.where ?? {};
    if (where.kind === "STORYBOARD_CARD") return where.id === parent.id ? parent : null;
    if (where.kind === "GEN_CARD" && typeof where.id === "string") {
      const rec = where.id in children ? children[where.id] : null;
      return rec ? { id: where.id, genJobId: rec.genJobId } : null;
    }
    if (where.kind === "GEN_RESULT" && typeof where.genJobId === "string") {
      const payload = where.genJobId in results ? results[where.genJobId] : null;
      return payload ? { payload } : null;
    }
    if (args?.orderBy) return { seq: 10 };
    return null;
  });
}

describe("syncStoryboardMedia — $0 对账(帧)", () => {
  it("子卡 job DONE → 读 GEN_RESULT.generationIds[0] 按 shotId 写回 firstFrameGenerationId", async () => {
    const p = payload3();
    // s0 points at a minted child whose job is DONE; s1 already has an image; s2 has no child yet.
    p.shots[0].firstFrameCardId = "child-0";
    delete p.shots[2].firstFrameGenerationId; // s2: no child, no image → not pending
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-A"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A"), gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    expect("payload" in res).toBe(true);
    if (!("payload" in res)) return;

    // wrote gen-A back onto s0 by shotId (transactional RMW)
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const updShots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameGenerationId).toBe("gen-A");
    expect(updShots[1].firstFrameGenerationId).toBe("gen1"); // s1 untouched
    expect(updShots[2].firstFrameGenerationId).toBeUndefined(); // s2 not pending

    // returned payload reflects the write; frames has urls for both resolvable gens
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-A");
    expect(frameUrl(res, "s0")).toContain("gen-A".slice(0, 0) + HASH); // url derived from asset
    expect(frameUrl(res, "s0")).toBeTruthy();
    expect(frameUrl(res, "s1")).toBeTruthy(); // pre-existing gen1 resolves too
  });

  it("重出对账:镜头有旧 genId + 子卡 DONE 出了新 genId → 覆盖写(REPLACE,非删除)", async () => {
    const p = payload3();
    // s0 already shows an OLD frame (gen-OLD) and points at a regen child whose job is DONE
    // with a DIFFERENT new gen (gen-NEW). Sync must OVERWRITE the genId in place.
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[0].firstFrameGenerationId = "gen-OLD";
    delete p.shots[2].firstFrameGenerationId; // isolate: s2 not a candidate
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-NEW"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-NEW"), gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    // exactly one write: s0's genId REPLACED gen-OLD → gen-NEW (key still present).
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect("firstFrameGenerationId" in updShots[0]).toBe(true);
    expect(updShots[0].firstFrameGenerationId).toBe("gen-NEW");
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-NEW");
    expect(frameUrl(res, "s0")).toBeTruthy();
  });

  it("重出对账:子卡 DONE 但 genId 与现值相同 → 不写(幂等,无变更)", async () => {
    const p = payload3();
    // s0's child is DONE producing the SAME gen it already shows → nothing to overwrite.
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[0].firstFrameGenerationId = "gen-A";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-A"] } }, // same as current
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A"), gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // no differing genId staged → no write
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-A");
  });

  it("重出对账:镜头有旧 genId + 子卡未 DONE → 旧 genId 原样(不写)", async () => {
    const p = payload3();
    // s0 shows an old frame; its regen child is still GENERATING → old genId must stay.
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[0].firstFrameGenerationId = "gen-OLD";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p), { "child-0": { genJobId: "job-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "GENERATING" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-OLD"), gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // child not done → no write
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-OLD"); // old genId intact
  });

  it("job 未完成 → 该镜头不写,其他完成的照常写(部分完成可对账)", async () => {
    const p = payload3();
    delete p.shots[1].firstFrameGenerationId; // make s1 pending too
    p.shots[0].firstFrameCardId = "child-0"; // DONE
    p.shots[1].firstFrameCardId = "child-1"; // still generating
    delete p.shots[2].firstFrameGenerationId; // s2: not pending (no child)
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" }, "child-1": { genJobId: "job-1" } },
      { "job-0": { generationIds: ["gen-A"] } }, // only job-0 has a result
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string; idempotencyKey?: string } }) => {
      if (args?.where?.id === "job-0") return { id: "job-0", status: "DONE" };
      if (args?.where?.id === "job-1") return { id: "job-1", status: "GENERATING" };
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    // only s0 written; s1 left alone (still generating)
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameGenerationId).toBe("gen-A");
    expect(updShots[1].firstFrameGenerationId).toBeUndefined();
    // s1 keeps its child pointer (not cleared)
    expect(updShots[1].firstFrameCardId).toBe("child-1");
  });

  it("job FAILED → 该镜头不写(不清字段),兄弟 DONE 镜头照常写", async () => {
    const p = payload3();
    delete p.shots[1].firstFrameGenerationId; // s1 pending too
    p.shots[0].firstFrameCardId = "child-0"; // FAILED job
    p.shots[1].firstFrameCardId = "child-1"; // DONE job
    delete p.shots[2].firstFrameGenerationId; // s2: not pending (no child)
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" }, "child-1": { genJobId: "job-1" } },
      { "job-1": { generationIds: ["gen-B"] } }, // only the DONE job has a result
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string } }) => {
      if (args?.where?.id === "job-0") return { id: "job-0", status: "FAILED" };
      if (args?.where?.id === "job-1") return { id: "job-1", status: "DONE" };
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-B")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    // exactly one write staged (the DONE sibling); the FAILED shot is left untouched
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[1].firstFrameGenerationId).toBe("gen-B"); // DONE sibling written
    expect(updShots[0].firstFrameGenerationId).toBeUndefined(); // FAILED shot: no field written
    expect(updShots[0].firstFrameCardId).toBe("child-0"); // FAILED shot: child pointer not cleared
  });

  it("写回是定点的:只动目标 shot 字段,其余 shot(含正在编辑的文字)原样", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    // s1 carries pre-existing image + an edited prompt we must preserve byte-for-byte
    p.shots[1].firstFramePrompt = "EDITED PROMPT";
    delete p.shots[2].firstFrameGenerationId;
    const before1 = JSON.parse(JSON.stringify(p.shots[1]));
    const before2 = JSON.parse(JSON.stringify(p.shots[2]));
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-A"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A"), gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    // only s0.firstFrameGenerationId changed
    expect(updShots[0].firstFrameGenerationId).toBe("gen-A");
    // s1 and s2 identical to before (edited text preserved)
    expect(updShots[1]).toEqual(before1);
    expect(updShots[2]).toEqual(before2);
  });

  it("无待对账镜头 → 原样返回,不写 DB", async () => {
    const p = payload3();
    // s0/s2 have no child pointer at all; s1 already has an image → nothing pending.
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p));
    mockGenerationFindMany.mockResolvedValue([gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // no DB write
    // frames still resolves the one pre-existing image (s1)
    expect(frameUrl(res, "s1")).toBeTruthy();
    expect(res.payload.shots).toEqual(p.shots); // unchanged payload returned
  });

  it("genJob.create / startGen 从未被调($0)", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-A"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A")]);

    await syncStoryboardMedia({ cardId: "card-1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0: never creates a job
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await syncStoryboardMedia({ cardId: "card-1" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    wireSync(card(payload3()));
    const res = await syncStoryboardMedia({ cardId: "missing" });
    expect("error" in res).toBe(true);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await syncStoryboardMedia({ cardId: "" } as unknown as { cardId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("R3① fresh-null fail-closed:锁内重读卡已消失 → {error: Card not found.},零写、无 cur 回落", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0"; // cur 快照下有一个 DONE 子卡待写回
    delete p.shots[2].firstFrameGenerationId;
    let boardLoads = 0;
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        boardLoads += 1;
        return boardLoads === 1 ? card(p) : null; // outer load OK; in-lock re-read: card GONE
      }
      if (where.kind === "GEN_CARD" && where.id === "child-0") return { id: "child-0", genJobId: "job-0" };
      if (where.kind === "GEN_RESULT" && where.genJobId === "job-0") return { payload: { generationIds: ["gen-A"] } };
      if (args?.orderBy) return { seq: 10 };
      return null;
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: "DONE" });

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    // 若回落 cur:会按旧快照采样 child-0 → 把 gen-A 写回已消失的卡。fail-closed 后:
    expect(res).toEqual({ error: "Card not found." });
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // locked, then failed closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("fallback:子卡无 genJobId → 用 cowork:<childId> 幂等 job 查状态", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: null } }, // best-effort link missing
      { "job-fb": { generationIds: ["gen-A"] } },
    );
    // fallback lookup by idempotencyKey returns the DONE job
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { idempotencyKey?: string } }) => {
      if (args?.where?.idempotencyKey === "cowork:child-0") return { id: "job-fb", status: "DONE" };
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-A")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenJobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: OWNER, idempotencyKey: "cowork:child-0" }) }),
    );
    expect((mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots[0].firstFrameGenerationId).toBe("gen-A");
  });

  it("frames 省略已删除的 generation(不报错)", async () => {
    const p = payload3();
    // s1 has firstFrameGenerationId gen1 but that generation row no longer exists.
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p));
    mockGenerationFindMany.mockResolvedValue([]); // gen1 gone

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(frameUrl(res, "s1")).toBeUndefined(); // omitted, no throw
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

});

// ---------------------------------------------------------------------------
// syncStoryboardMedia — $0 对账(视频 + 帧覆写级联清视频 + videoUrls)
// ---------------------------------------------------------------------------

describe("syncStoryboardMedia — $0 对账(视频 + 级联 + urls)", () => {
  it("视频子卡 DONE → 按 shotId 写回 videoGenerationId,并返回 videos url", async () => {
    const p = payload3();
    // s0 is framed (gen1-equivalent) and points at a DONE video child; write videoGenerationId.
    p.shots[0].firstFrameGenerationId = "ffgen0";
    p.shots[0].videoCardId = "vchild-0";
    delete p.shots[2].firstFrameGenerationId; // isolate: s2 not a candidate
    wireSync(
      card(p),
      { "vchild-0": { genJobId: "vjob-0" } },
      { "vjob-0": { generationIds: ["vid-A"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE" });
    // video generation resolves via the SAME asset→storageKey mechanism (ext mp4 → video url)
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("gen1"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    // exactly one write: s0.videoGenerationId set (frame keys untouched)
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoGenerationId).toBe("vid-A");
    expect(updShots[0].firstFrameGenerationId).toBe("ffgen0"); // frame key preserved
    expect(updShots[0].videoCardId).toBe("vchild-0"); // pointer preserved
    // returned videos map has the resolved video url for s0
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-A");
    expect(videoUrl(res, "s0")).toBeTruthy();
    expect(videoUrl(res, "s0")).toContain(HASH); // url derived from the video asset
  });

  it("视频重出对账:旧 videoGenerationId + 子卡 DONE 出新 genId → 覆盖写(REPLACE)", async () => {
    const p = payload3();
    p.shots[0].firstFrameGenerationId = "ffgen0";
    p.shots[0].videoCardId = "vchild-0";
    p.shots[0].videoGenerationId = "vid-OLD";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "vchild-0": { genJobId: "vjob-0" } },
      { "vjob-0": { generationIds: ["vid-NEW"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE" });
    mockGenerationFindMany.mockResolvedValue([gen("vid-NEW", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect("videoGenerationId" in updShots[0]).toBe(true); // key present…
    expect(updShots[0].videoGenerationId).toBe("vid-NEW"); // …value replaced
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-NEW");
  });

  it("视频子卡未 DONE / FAILED → 惰性,不写 videoGenerationId", async () => {
    const p = payload3();
    p.shots[0].firstFrameGenerationId = "ffgen0";
    p.shots[0].videoCardId = "vchild-0";
    p.shots[0].videoGenerationId = "vid-OLD"; // old video stays
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "FAILED" });
    mockGenerationFindMany.mockResolvedValue([gen("vid-OLD", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // not DONE → no write
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-OLD"); // old video intact
    // r11 替换语义显式:状态说的是**这次替换**(它死了),previous 说旧片仍然属于商家。
    // r10 把这两件事挤进一格「landed」,于是重出失败在卡面上完全看不见,而 Remake 按钮
    // 又回来了 —— 判官 r10 P1 的第二笔钱正是从那里进来的。
    expect(videoKind(res, "s0")).toBe("dead");
    expect(reportOf(res, "s0").video.previous?.generationId).toBe("vid-OLD");
    expect(reportOf(res, "s0").video.previous?.url).toBeTruthy();
  });

  // CASCADE (spec §3c) — the kill-shot flag from the Task-2 reviewer: a frame REPLACE must clear
  // videoCardId/videoGenerationId for that shot, else a videoCardId survives pointing at a video
  // built off the OLD source frame.
  it("级联:帧被覆写(不同 genId)→ 帧写回 AND 清 videoCardId+videoGenerationId(kill-shot)", async () => {
    const p = payload3();
    // s0 HAD a frame (gen-OLD) and a landed video (vid-OLD); the frame child regenerated a NEW
    // frame (gen-NEW). Frame replace ⇒ drop the old video keys (source frame changed).
    p.shots[0].firstFrameCardId = "child-0";
    p.shots[0].firstFrameGenerationId = "gen-OLD";
    p.shots[0].videoCardId = "vchild-0";
    p.shots[0].videoGenerationId = "vid-OLD";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" } }, // only the FRAME child resolves DONE
      { "job-0": { generationIds: ["gen-NEW"] } },
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string; idempotencyKey?: string } }) => {
      if (args?.where?.id === "job-0") return { id: "job-0", status: "DONE" };
      return null; // the video child (vchild-0) has no job → not done → no video write staged
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-NEW")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameGenerationId).toBe("gen-NEW"); // frame REPLACED
    // cascade: BOTH video keys dropped (key-omission)
    expect("videoCardId" in updShots[0]).toBe(false);
    expect("videoGenerationId" in updShots[0]).toBe(false);
    // returned payload reflects the cascade; no video url for s0
    expect("videoCardId" in res.payload.shots[0]).toBe(false);
    expect("videoGenerationId" in res.payload.shots[0]).toBe(false);
    expect(videoUrl(res, "s0")).toBeUndefined();
  });

  it("首次帧写入(原无 genId)→ 不级联,视频键保持不动", async () => {
    const p = payload3();
    // s0 has NO prior frame genId but (defensively) carries video keys; the frame lands for the
    // first time. First-ever write ⇒ NO cascade: video keys must survive.
    p.shots[0].firstFrameCardId = "child-0";
    delete p.shots[0].firstFrameGenerationId; // first-ever frame write
    p.shots[0].videoCardId = "vchild-0";
    p.shots[0].videoGenerationId = "vid-KEEP";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" }, "vchild-0": { genJobId: null } },
      { "job-0": { generationIds: ["gen-FIRST"] } },
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string; idempotencyKey?: string } }) => {
      if (args?.where?.id === "job-0") return { id: "job-0", status: "DONE" };
      // vchild-0 fallback lookup → nothing done (video not re-landing this pass)
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-FIRST"), gen("vid-KEEP", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameGenerationId).toBe("gen-FIRST"); // first frame written
    expect(updShots[0].videoCardId).toBe("vchild-0"); // NO cascade — video keys survive
    expect(updShots[0].videoGenerationId).toBe("vid-KEEP");
    expect(videoUrl(res, "s0")).toBeTruthy(); // old video still resolves
  });

  // Precedence: a frame write AND a video write staged for the SAME shot in the same pass →
  // the cascade WINS. The just-landed video was built off the OLD source frame, so it is
  // dropped too; the staged video write is NOT applied.
  it("同镜头同批:帧覆写 + 视频写回 → 级联优先(视频键清除,已落地视频写回不生效)", async () => {
    const p = payload3();
    p.shots[0].firstFrameCardId = "child-0"; // frame regen → DONE gen-NEW (replaces gen-OLD)
    p.shots[0].firstFrameGenerationId = "gen-OLD";
    p.shots[0].videoCardId = "vchild-0"; // video child ALSO DONE this pass → vid-NEW
    p.shots[0].videoGenerationId = "vid-OLD";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" }, "vchild-0": { genJobId: "vjob-0" } },
      { "job-0": { generationIds: ["gen-NEW"] }, "vjob-0": { generationIds: ["vid-NEW"] } },
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string } }) => {
      if (args?.where?.id === "job-0") return { id: "job-0", status: "DONE" };
      if (args?.where?.id === "vjob-0") return { id: "vjob-0", status: "DONE" };
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-NEW"), gen("vid-NEW", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].firstFrameGenerationId).toBe("gen-NEW"); // frame replaced
    // cascade precedence: video keys dropped even though a video write was staged
    expect("videoCardId" in updShots[0]).toBe(false);
    expect("videoGenerationId" in updShots[0]).toBe(false);
    // the staged vid-NEW write did NOT land
    expect(videoUrl(res, "s0")).toBeUndefined();
  });

  it("无待对账(无帧无视频候选)→ 原样返回,不写 DB($0)", async () => {
    const p = payload3();
    // s1 already has a frame but no child pointer → nothing to reconcile.
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p));
    mockGenerationFindMany.mockResolvedValue([gen("gen1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // no write
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0
    expect(res.payload.shots).toEqual(p.shots); // unchanged
    expect(res.shots.every((r) => r.video.status.kind === "absent")).toBe(true); // 一格视频都没有
  });

  it("frames + videos url 映射同时正确(两类各解析出各自 url)", async () => {
    const p = payload3();
    // s0: framed + DONE video → both a frame url and a video url.
    p.shots[0].firstFrameGenerationId = "ffgen0";
    p.shots[0].videoCardId = "vchild-0";
    delete p.shots[2].firstFrameGenerationId;
    wireSync(
      card(p),
      { "vchild-0": { genJobId: "vjob-0" } },
      { "vjob-0": { generationIds: ["vid-A"] } },
    );
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE" });
    // ffgen0 = image asset (png), gen1 = s1 image, vid-A = video asset (mp4)
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("gen1"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    // frames: s0 (ffgen0) + s1 (gen1)
    expect(frameUrl(res, "s0")).toBeTruthy();
    expect(frameUrl(res, "s1")).toBeTruthy();
    // videos: s0 only (the one with a videoGenerationId)
    expect(videoUrl(res, "s0")).toBeTruthy();
    expect(videoUrl(res, "s1")).toBeUndefined();
    // frame and video urls for the same shot are distinct assets
    expect(frameUrl(res, "s0")).not.toBe(videoUrl(res, "s0"));
  });

  it("videos 省略已删除的 video generation(不报错)", async () => {
    const p = payload3();
    p.shots[0].firstFrameGenerationId = "ffgen0";
    p.shots[0].videoGenerationId = "vid-GONE"; // row no longer exists
    delete p.shots[2].firstFrameGenerationId;
    wireSync(card(p));
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("gen1")]); // vid-GONE absent

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(videoUrl(res, "s0")).toBeUndefined(); // omitted, no throw
    expect(mockChatUpdate).not.toHaveBeenCalled(); // nothing to reconcile
  });

  // ===================================================================================
  // 修复轮 v3 · NODE-282-R2① 交错回归:sync 的读半段必须在锁内。形态:s0 指向子卡 A
  // (job DONE,generation vid-A);一个在飞 regen 正持有卡锁,并在释放前把指针换成 B
  // (新子卡,无 job)。sync 在锁上等待,得锁后必须按 FRESH 指针(B)derive 写集:B 未
  // DONE → 零写集 → 零写入。v2 的旧行为(锁前按旧快照采样 A → 得锁后按 shotId 套用旧
  // 写集)会把 A 的 generation(vid-A)写到已指向 B 的镜头上——本用例在 v2 实现上红
  // (mockChatUpdate 被调、vid-A 落上),v3 实现上绿。
  // ===================================================================================
  it("R2① 交错回归:sync 等锁期间 regen 换指针 A→B → sync 锁后按 B 行事,A 的 generation 不落上、零写入", async () => {
    // Stateful wiring: parent payload + child cards + GEN_RESULT rows all read live state.
    const state = {
      parentPayload: {
        storyboardTitle: "Ad",
        shots: [
          { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "vp0", firstFrameGenerationId: "ffgen0", videoCardId: "A" },
        ],
      } as StoryboardCardPayload,
      children: {
        A: { payload: { structuredPrompt: "vp0-old" }, genJobId: "job-A" }, // old child: job DONE
      } as Record<string, { payload: unknown; genJobId: string | null }>,
    };
    const results: Record<string, unknown> = { "job-A": { generationIds: ["vid-A"] } };
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") return where.id === "card-1" ? card(state.parentPayload) : null;
      if (where.kind === "GEN_CARD" && typeof where.id === "string") {
        const rec = state.children[where.id];
        return rec ? { id: where.id, ...rec } : null;
      }
      if (where.kind === "GEN_RESULT" && typeof where.genJobId === "string") {
        const payload = where.genJobId in results ? results[where.genJobId] : null;
        return payload ? { payload } : null;
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });
    mockChatUpdate.mockImplementation(async (args: { data: { payload: unknown } }) => {
      state.parentPayload = args.data.payload as StoryboardCardPayload;
      return {};
    });
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string; idempotencyKey?: string } }) => {
      if (args?.where?.id === "job-A") return { id: "job-A", status: "DONE" };
      return null; // B has no job (fresh mint, unspent, pending nothing)
    });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0")]);

    // An in-flight regen HOLDS the card lock (manual mutex entry, same map the tx mock uses).
    let regenCommitsAndReleases!: () => void;
    cardLocks.set("card:card-1", new Promise<void>((r) => (regenCommitsAndReleases = r)));

    // sync starts now: outer load sees pointer A, then PARKS on the card lock.
    const syncP = syncStoryboardMedia({ cardId: "card-1" });
    await new Promise((r) => setTimeout(r, 0)); // let sync run up to the lock

    // While sync waits, the regen COMMITS its pointer swap A → B, then releases the lock.
    state.parentPayload = {
      ...state.parentPayload,
      shots: [{ ...state.parentPayload.shots[0], videoCardId: "B" }],
    };
    state.children.B = { payload: { structuredPrompt: "vp0" }, genJobId: null };
    regenCommitsAndReleases();

    const res = await syncP;
    if (!("payload" in res)) throw new Error("expected payload");

    // sync derived its write-set INSIDE the lock, from the FRESH pointer (B):
    // B has no DONE job → nothing staged → ZERO writes. A's vid-A must NOT land.
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // sync did take the lock
    expect(mockChatUpdate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled(); // zero staged writes either
    expect(res.payload.shots[0].videoCardId).toBe("B"); // fresh pointer honored, NOT dropped
    expect(res.payload.shots[0].videoGenerationId).toBeUndefined(); // vid-A (stale child A) NOT written
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 throughout
  });
});

// ---------------------------------------------------------------------------
// getStoryboardVideoOptions — $0 read: the SELECTED video model's durations
// ---------------------------------------------------------------------------

describe("getStoryboardVideoOptions — $0 读取模型时长", () => {
  it("返回 suggestModel 选定视频模型在真实能力表里的 durations", async () => {
    const res = await getStoryboardVideoOptions();
    expect("durations" in res).toBe(true);
    if (!("durations" in res)) return;
    // model = the SAME suggestModel path minting uses (kind:"video")
    expect(mockSuggestModel).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video" }),
    );
    expect(res).not.toHaveProperty("model");
    // durations come from the REAL GEN_VIDEO_MODEL_OPTIONS table (not hardcoded)
    expect(res.durations).toEqual([...GEN_VIDEO_MODEL_OPTIONS["seedance-2-mini"].durations]);
    // $0: no writes at all
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("#647 T6:选型说「没有引擎」(null)⇒ 不报档位表,给一句人话", async () => {
    // 这条测试的前身是「换一个选定模型 → 自动返回它的 durations」。菜单上已经没有第二台
    // 引擎可以换了,而同一条「跟着选型走」的性质现在由这条更要紧的路守着:选型说没有,
    // 面板就不许拿一份真的能力表去装点一个做不到的功能。
    mockSuggestModel.mockReturnValue(null);
    const res = await getStoryboardVideoOptions();
    expect(res).toEqual({ error: "Video generation is turned off right now." });
  });

  it("sources disabledModels 走 resolveDisabledModels(与铸卡同一来源)", async () => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set(["some-model"]) });
    await getStoryboardVideoOptions();
    expect(mockResolveDisabled).toHaveBeenCalled();
    // the disabled set threads into suggestModel (same as minting)
    const arg = mockSuggestModel.mock.calls[0][0];
    expect(arg.disabled).toBeInstanceOf(Set);
    expect(arg.disabled.has("some-model")).toBe(true);
  });

  it("requireOwner 失败 → {error},不查库", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await getStoryboardVideoOptions();
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockSuggestModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// prepareStoryboardVideos — $0 铸"视频子卡"(闸②),mirror prepareStoryboardFirstFrames
// ---------------------------------------------------------------------------

/** buildProposeCard video-mock: echo a kind:"video" payload; carry the injected
 *  ctx.sourceGenerationId (i2v start frame) onto the payload so the action's reuse rule
 *  + backlink can be asserted.
 *
 *  Duration is SNAPPED deterministically, mirroring what the real suggestModel does: an
 *  off-menu desiredDuration or undefined snaps to the model default (5s); an on-menu value is
 *  kept. 这里刻意只认 [5,10] 两格 —— 这是**这个 mock 自己的** snap 集合(真菜单是 4–15),
 *  测的是「铸卡与比对用的是同一个吸附结果」,不是菜单本身有哪几格(菜单由
 *  packages/core/src/video-tiers.test.ts 钉)。 */
const MOCK_SNAP_DURATIONS = [5, 10] as const;
const MOCK_DEFAULT_DURATION = 5;
function snapDuration(want: number | undefined): number {
  return want != null && MOCK_SNAP_DURATIONS.includes(want as 5 | 10) ? want : MOCK_DEFAULT_DURATION;
}
function mockVideoProposeCard() {
  mockBuildProposeCard.mockImplementation(
    (
      input: { structuredPrompt: string; entityIds: string[]; desiredDuration?: number },
      ctx: { sourceGenerationId?: string },
    ) => ({
      cardPayload: {
        kind: "video",
        model: "seedance-2-mini",
        params: { count: 1, durationSeconds: snapDuration(input.desiredDuration) },
        structuredPrompt: input.structuredPrompt,
        entityIds: input.entityIds,
        estimatedCredits: 5,
        estimatedPriceUsd: 0.35,
        reason: "",
        downgraded: false,
        variantSel: {},
        ...(ctx.sourceGenerationId ? { sourceGenerationId: ctx.sourceGenerationId } : {}),
      },
      shownPriceDisplay: 5,
    }),
  );
}

/** 3 shots for video gate:
 *  - s0: framed (firstFrameGenerationId) + no video → ELIGIBLE (mint)
 *  - s1: frameless (no firstFrameGenerationId) → SKIP silently
 *  - s2: framed + already has videoGenerationId → SKIP (video exists) */
function videoPayload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "vp0", firstFrameGenerationId: "ffgen0", durationSeconds: 5 },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "vp1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "vp2", firstFrameGenerationId: "ffgen2", videoGenerationId: "vidgen2" },
    ],
  };
}

/** 修复轮 v2:有状态 DB wiring(并发回归测试用)。COMMIT(缓冲事务成功后重放到
 *  mockChatCreate/mockChatUpdate)真实变更 state,于是后一个事务的**锁后重读**能看到前
 *  一个事务已提交的指针与子卡 —— 这正是 pg_advisory_xact_lock 串行化语义在 mock 层的
 *  可观测形态。 */
function wireStatefulLoads(initial: StoryboardCardPayload) {
  const state = {
    parentPayload: initial,
    children: {} as Record<string, { payload: unknown; genJobId: string | null }>,
  };
  mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
    const where = args?.where ?? {};
    if (where.kind === "STORYBOARD_CARD") return where.id === "card-1" ? card(state.parentPayload) : null;
    if (where.kind === "GEN_CARD" && typeof where.id === "string") {
      const rec = state.children[where.id];
      return rec ? { id: where.id, ...rec } : null;
    }
    if (args?.orderBy) return { seq: 10 };
    return null;
  });
  mockChatCreate.mockImplementation(async (args: { data: { id: string; payload: unknown } }) => {
    state.children[args.data.id] = { payload: args.data.payload, genJobId: null };
    return {};
  });
  mockChatUpdate.mockImplementation(async (args: { data: { payload: unknown } }) => {
    state.parentPayload = args.data.payload as StoryboardCardPayload;
    return {};
  });
  return state;
}

describe("prepareStoryboardVideos — $0 铸视频子卡(闸②)", () => {
  it("只给 framed+videoless 镜头铸 kind:video 子卡(frameless 跳过,已有视频跳过)", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect("children" in res).toBe(true);
    if (!("children" in res)) return;

    // exactly 1 child minted (s0); s1 frameless skipped, s2 has-video skipped
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const data = mockChatCreate.mock.calls[0][0].data;
    expect(data.kind).toBe("GEN_CARD");
    expect(data.role).toBe("AGENT");
    expect(data.ownerId).toBe(OWNER);
    expect(data.threadId).toBe("t-1");
    expect("genJobId" in data).toBe(false); // $0

    // buildProposeCard called with kind:"video", the shot's videoPrompt, desiredDuration
    const [propInput, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propInput.kind).toBe("video");
    expect(propInput.structuredPrompt).toBe("vp0");
    expect(propInput.desiredDuration).toBe(5);
    expect(propInput.entityIds).toEqual([]); // video plan carries no entity refs
    // per-shot ctx: sourceGenerationId = the shot's first-frame generation id (i2v source)
    expect(propCtx.sourceGenerationId).toBe("ffgen0");

    // child payload: i2v source frame flowed through + correct backlink + duration
    expect(data.payload.sourceGenerationId).toBe("ffgen0");
    expect(data.payload.storyboardCardId).toBe("card-1");
    expect(data.payload.shotId).toBe("s0");
    expect(data.payload.params.durationSeconds).toBe(5);

    // parent write: only s0.videoCardId set; firstFrame keys + s2 video untouched
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).toBeTruthy();
    expect(updShots[0].firstFrameGenerationId).toBe("ffgen0"); // frame keys untouched
    expect(updShots[0].videoGenerationId).toBeUndefined(); // NOT written (I1 semantics)
    expect(updShots[1].videoCardId).toBeUndefined(); // frameless: no mint, no write
    expect(updShots[2].videoCardId).toBeUndefined(); // has-video: skipped
    expect(updShots[2].videoGenerationId).toBe("vidgen2"); // preserved

    // return: 1 child, totalCredits 5 (unspent)
    expect(res.children).toHaveLength(1);
    expect(res.children[0].shotId).toBe("s0");
    expect(res.children[0].estimatedCredits).toBe(5);
    expect(res.children[0].structuredPrompt).toBe("vp0");
    expect(res.children[0].spent).toBe(false);
    expect(res.totalCredits).toBe(5);
  });

  it("可重入:videoCardId 子卡未花钱且 prompt/source/duration 一致 → 复用,不铸、不写", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(mockChatCreate).not.toHaveBeenCalled(); // reused
    expect(mockChatUpdate).not.toHaveBeenCalled(); // no pointer swap
    expect(res.children).toHaveLength(1);
    expect(res.children[0].childCardId).toBe("vchild-0");
    expect(res.children[0].spent).toBe(false);
    // totalCredits = UNSPENT only; the reused unspent child's stored estimatedCredits (5)
    expect(res.totalCredits).toBe(5);
  });

  it("可重入:prompt/source/duration 任一不一致 → 铸新 + 指针替换,不碰 videoGenerationId", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    // duration mismatch: child payload duration 8 != would-be (snapped) duration 5
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 8 } },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(mockChatCreate).toHaveBeenCalledTimes(1); // fresh mint
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).not.toBe("vchild-0"); // pointer swapped
    expect(updShots[0].videoGenerationId).toBeUndefined(); // NEVER touched
    expect(res.children[0].childCardId).not.toBe("vchild-0");
  });

  it("可重入:source 不一致(首帧被重出换了 genId)→ 铸新替换", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    // source mismatch: child was built off an OLD frame id
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "OLD-frame", model: "seedance-2-mini", params: { durationSeconds: 5 } },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.children[0].childCardId).not.toBe("vchild-0");
  });

  // MONEY CORRECTION (P1): a matching child that is SPENT via its durable cowork:<id>
  // idempotency job MUST be REUSED with spent:true — NOT re-minted. The OLD test asserted
  // spent→mint, which double-paid the same shot on a second prepare (the fresh child got
  // charged on confirm while the spent one was still pending). Now: reuse, no mint, no
  // parent write, excluded from totalCredits.
  it("可重入:matching 子卡已花过钱(有幂等 job)→ 复用 spent:true,不铸、不写、不计费(P1 修正)", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: null,
      },
    });
    // spent: durable cowork:<id> idempotency job exists (matching child already charged)
    mockGenJobFindFirst.mockResolvedValue({ id: "job-spent" });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // matching+spent → reused, NOT re-minted
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled(); // no pointer swap / parent write
    expect(res.children).toHaveLength(1);
    expect(res.children[0].childCardId).toBe("vchild-0");
    expect(res.children[0].spent).toBe(true);
    expect(res.totalCredits).toBe(0); // spent excluded from the quote
  });

  // durationSeconds undefined → suggestModel snaps to the model DEFAULT (5s). The
  // would-be card therefore has params.durationSeconds:5, which matches the child minted at 5
  // → reuse. (The comparison is always snapped-vs-snapped, never against the raw shot field.)
  it("durationSeconds 未定义 → would-be 吸附到模型默认(5s),与子卡一致 → 复用", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    delete p.shots[0].durationSeconds; // no desired duration → snaps to default 5
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 } },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).not.toHaveBeenCalled(); // reused: would-be default 5 == child 5
    expect(res.children[0].childCardId).toBe("vchild-0");
  });

  // P2 (snap-mismatch churn kill): shot.durationSeconds 落在吸附集合之外(7,mock 只认 [5,10])。
  // The child was minted at the SNAPPED value (5). The comparison uses the WOULD-BE card's
  // params.durationSeconds (also snaps 7→5), NOT the raw shot field — so it MATCHES and the
  // child is reused with NO churn. The old raw-field comparison (7 != 5) would have re-minted
  // on every prepare, and combined with a spent pending child that re-opened the P1 double-pay.
  it("P2:shot.durationSeconds 离吸附集合(7)→ would-be 吸附到 5,与吸附值铸的子卡一致 → 复用不 churn", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].durationSeconds = 7; // 离 mock 的吸附集合;snap 7 → 5
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        // child was minted at the SNAPPED duration (5), NOT the raw 7
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // snapped-vs-snapped (5 == 5) → REUSE, no re-mint, no pointer swap
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(res.children).toHaveLength(1);
    expect(res.children[0].childCardId).toBe("vchild-0");
    expect(res.children[0].spent).toBe(false);
  });

  // Model change: the would-be model differs from the child's stored model (e.g. an admin
  // model swap since the child was minted). A model mismatch is a genuine stale-input mismatch
  // → mint fresh + pointer swap; videoGenerationId is NEVER touched (old video survives).
  it("可重入:model 不一致(would-be model != 子卡 model)→ 铸新 + 指针替换,不碰 videoGenerationId", async () => {
    mockVideoProposeCard(); // would-be model = 在产那一台
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        // everything matches EXCEPT model — 子卡是在一台**已下架**的引擎下铸的(#647 T6 之后
        // 库里就是这个样子)。历史模型名必须照旧参与比对:不认作同一张 → 重铸($0),
        // 而不是把一张旧引擎的卡当成新的接着卖。
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2", params: { durationSeconds: 5 } },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // fresh mint
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).not.toBe("vchild-0"); // pointer swapped
    expect(updShots[0].videoGenerationId).toBeUndefined(); // NEVER touched
    expect(res.children[0].childCardId).not.toBe("vchild-0");
  });

  // ===================================================================================
  // P1 KILL-SHOT: the double-pay this whole fix exists to prevent.
  // Flow: make-all → child A minted & CHARGED (spent, but videoGenerationId is still absent
  // because the video takes minutes) → user clicks make-all AGAIN. The SECOND prepare sees a
  // matching+SPENT child. The OLD (broken) code minted a fresh child B, swapped the pointer,
  // and returned B UNSPENT → confirm then charged B → SAME shot, two children, two charges.
  // CORRECTED: a matching+spent child (spent via its best-effort genJobId link) is REUSED with
  // spent:true. NO mint (chatMessage.create NOT called), NO pointer swap / parent write, and it
  // is EXCLUDED from totalCredits — so the second prepare offers ZERO new charges for that shot.
  // ===================================================================================
  it("P1 kill-shot:matching 子卡已花钱(genJobId 链接)→ 复用 spent:true,不铸不写,第二次 prepare 该镜头 0 计费", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: "gj-1", // best-effort link present → spent (charged), video still pending
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // matching+spent → REUSED, never re-minted (kills the second charge)
    expect(mockChatCreate).not.toHaveBeenCalled(); // NO new child card
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 invariant intact
    expect(mockChatUpdate).not.toHaveBeenCalled(); // NO pointer swap / parent write
    // the returned child IS the spent one, surfaced as spent so the UI skips it
    expect(res.children).toHaveLength(1);
    expect(res.children[0].childCardId).toBe("vchild-0");
    expect(res.children[0].spent).toBe(true);
    // the kill-shot: second prepare after a confirm offers ZERO new charges for that shot
    expect(res.totalCredits).toBe(0);
  });

  // W-B3-H-P 修复轮 v2(NODE-282① 后半「spent+mismatch/orphan 未覆盖」):意图钉住 —— 已
  // 花钱子卡在参数**真**漂移(prompt 改写)时铸新换指针是**正确**的新报价(参数变了=真新
  // spend,不是双扣);旧卡不删不动(仍在 thread 里),videoGenerationId 从不触碰。
  it("spent+mismatch:已花钱子卡 prompt 真漂移 → 铸新+换指针(合法新报价),旧卡与 videoGenerationId 不动", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        // SPENT (charged, video still pending) but its prompt has genuinely drifted since.
        payload: { structuredPrompt: "vp0-OLD-DRIFTED", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: "gj-spent",
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // mismatch wins over spent → mint fresh (a REAL new spend offer: params changed).
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" }); // the ONLY write targets the parent — the old child row is untouched
    const updShots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).not.toBe("vchild-0"); // pointer swapped to the fresh child
    expect(updShots[0].videoGenerationId).toBeUndefined(); // NEVER touched (I1)
    expect(res.children[0].childCardId).not.toBe("vchild-0");
    expect(res.children[0].spent).toBe(false);
    expect(res.totalCredits).toBe(5); // the changed-params offer is chargeable — by design, not a double-pay
  });

  it("悬空指针(videoCardId 指向已不存在的子卡)→ 铸新替换,不炸、指针换到新卡", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "ghost-child"; // row is gone (not in the children map)
    wireLoads(card(p), {});

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // replacement minted
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).not.toBe("ghost-child");
    expect(updShots[0].videoCardId).toBeTruthy();
    expect(res.children[0].spent).toBe(false);
  });

  // W-B3-H-P 证明层补测①(§6.1 通项「部分失败只退失败格」映射到本 $0 铸卡层):批内混三态
  // (铸新 / matching 已花钱复用 / ineligible 跳过)必须逐镜头独立结算 —— 一镜头的花钱状态
  // 不得渗漏进另一镜头的铸新判定或计费,镜像批量引擎"只退失败格"的隔离精神(此处零 reserve/
  // refund,隔离体现为:只有真正待铸的镜头计入 totalCredits,已花钱/不合格镜头零渗漏)。
  it("批内三态混合(铸新+matching 已花钱复用+ineligible 跳过)→ 逐镜头独立结算,totalCredits 只计未花钱铸新", async () => {
    mockVideoProposeCard();
    const p: StoryboardCardPayload = {
      storyboardTitle: "Ad",
      shots: [
        // s0: framed + no existing child → ELIGIBLE, mint fresh.
        { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "vp0", firstFrameGenerationId: "ffgen0" },
        // s1: framed + points at a MATCHING but SPENT child → reuse spent:true, excluded.
        { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "vp1", firstFrameGenerationId: "ffgen1", videoCardId: "vchild-1" },
        // s2: frameless → INELIGIBLE, silently skipped (no i2v source).
        { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "vp2" },
      ],
    };
    wireLoads(card(p), {
      "vchild-1": {
        payload: { structuredPrompt: "vp1", sourceGenerationId: "ffgen1", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: "gj-spent-1", // best-effort link present → spent
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // Exactly ONE mint (s0); s1 reused (no create), s2 skipped (no create).
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.shotId).toBe("s0");

    // Parent write touches ONLY s0's pointer; s1's pointer (spent reuse) and s2 (skip) untouched.
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).toBeTruthy();
    expect(updShots[0].videoCardId).not.toBe("vchild-1");
    expect(updShots[1].videoCardId).toBe("vchild-1"); // s1: NOT swapped (reuse leaves pointer as-is)
    expect(updShots[2].videoCardId).toBeUndefined(); // s2: no child ever

    // children: s0 (fresh, unspent) + s1 (reused, spent); s2 absent (ineligible, never quoted).
    expect(res.children).toHaveLength(2);
    const byShot = Object.fromEntries(res.children.map((c) => [c.shotId, c]));
    expect(byShot.s0.spent).toBe(false);
    expect(byShot.s1.spent).toBe(true);
    expect(byShot.s2).toBeUndefined();

    // totalCredits: ONLY s0's unspent 5 credits — s1 excluded (spent), s2 never entered the quote.
    expect(res.totalCredits).toBe(5);
  });

  // W-B3-H-P 修复轮 v2(NODE-282②):fail-closed 升级为「真回滚」证明。缓冲事务 mock 下,
  // 首镜头已在事务内完成铸卡(暂存写 mockTxChatCreate 可见),次镜头的子卡读取抛错 → 整个
  // 事务弃权:整批零提交(已铸的首镜头子卡不落库)、父卡指针零变更、异常原样上抛不吞。
  // 这钉住的是「前一镜头已铸、后一镜头失败」的真实批中失败形态,而非 v1 那种「抛错发生在
  // 任何写之前」的弱形态(codex 指出的 gap)。impl 全文件零 try/catch(已核实,零吞错)。
  it("fail-closed 真回滚:首镜头已铸(暂存)、次镜头读取抛错 → 整批零提交、指针零变更、抛错不吞", async () => {
    mockVideoProposeCard();
    const p: StoryboardCardPayload = {
      storyboardTitle: "Ad",
      shots: [
        // sA processes FIRST and mints (framed, videoless, no child pointer).
        { shotId: "sA", index: 0, firstFramePrompt: "ffA", videoPrompt: "vpA", firstFrameGenerationId: "ffgenA" },
        // sB processes SECOND; its child lookup throws mid-batch.
        { shotId: "sB", index: 1, firstFramePrompt: "ffB", videoPrompt: "vpB", firstFrameGenerationId: "ffgenB", videoCardId: "vchild-boom" },
      ],
    };
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") return where.id === "card-1" ? card(p) : null;
      if (where.kind === "GEN_CARD" && where.id === "vchild-boom") {
        throw new Error("simulated DB failure mid-batch");
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    await expect(prepareStoryboardVideos({ cardId: "card-1" })).rejects.toThrow("simulated DB failure mid-batch");

    // TRUE mid-batch: the FIRST shot's mint DID happen inside the tx (staged write observed)…
    expect(mockTxChatCreate).toHaveBeenCalledTimes(1);
    const stagedCreate = mockTxChatCreate.mock.calls[0][0] as { data: { payload: { shotId: string } } };
    expect(stagedCreate.data.payload.shotId).toBe("sA");
    // …and yet NOTHING was committed: zero child cards, zero parent-pointer writes.
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockTxChatUpdate).not.toHaveBeenCalled(); // the parent write was never even reached
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 invariant intact on the error path
  });

  // ===================================================================================
  // 修复轮 v2 · NODE-282① 并发回归(kill-shot):两个 prepare 交错 —— 都在事务外读到 s0
  // 的空 videoCardId。修复(卡级 pg_advisory_xact_lock)后事务严格串行:先到者铸卡并提交,
  // 后到者在锁上等待、锁后重读到新指针 → 走复用分支 → 全局恰好一次铸卡,两个调用返回同
  // 一张子卡。修复前(无锁 RMW)此形态 = 各铸一张、各自可被下游确认扣费(双扣)。
  // ===================================================================================
  it("并发回归:两个交错 prepare(均先见空指针)→ 锁串行化,恰好一次铸卡,第二个复用同一子卡", async () => {
    mockVideoProposeCard();
    wireStatefulLoads(videoPayload3());

    const [a, b] = await Promise.all([
      prepareStoryboardVideos({ cardId: "card-1" }),
      prepareStoryboardVideos({ cardId: "card-1" }),
    ]);
    if (!("children" in a) || !("children" in b)) throw new Error("expected children");

    // BOTH transactions took the card lock (serialization actually engaged, right key)…
    expect(mockTxLock).toHaveBeenCalledTimes(2);
    expect(mockTxLock).toHaveBeenNthCalledWith(1, "card:card-1");
    expect(mockTxLock).toHaveBeenNthCalledWith(2, "card:card-1");
    // …and EXACTLY ONE child was ever committed — the second call REUSED it.
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatUpdate).toHaveBeenCalledTimes(1); // only the minting call wrote the pointer
    expect(a.children).toHaveLength(1);
    expect(b.children).toHaveLength(1);
    expect(a.children[0].childCardId).toBe(b.children[0].childCardId); // SAME child — not two
    expect(a.children[0].spent).toBe(false);
    expect(b.children[0].spent).toBe(false); // reused unspent (not yet confirmed)
    // Downstream, both quotes point at ONE card → coworkGenerate's once-EVER cowork:<id>
    // key can charge it at most once. Zero double-mint, zero double-charge surface.
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 throughout
  });

  it("R3① fresh-null fail-closed:锁内重读卡已消失 → {error: Card not found.},零暂存零提交、无 cur 回落", async () => {
    mockVideoProposeCard();
    const p = videoPayload3(); // s0 eligible —— 若回落 cur 会错误地铸出视频子卡
    let boardLoads = 0;
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        boardLoads += 1;
        return boardLoads === 1 ? card(p) : null; // outer load OK; in-lock re-read: card GONE
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // locked, then failed closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  // 微修轮 v6(NODE-282-R5①):thread 活性并入锁内 fresh 守卫。锁前 loadCard 校验过
  // thread.deletedAt/ownerId,但等锁期间 thread 可被软删——锁内 fresh 查询带 live-thread
  // 关系过滤,失活→与卡消失同形 fail-closed("Card not found.",零写)。v5 的锁内查询不带
  // thread 过滤,会在死 thread 上照常铸卡(红对照)。
  it("R5① thread 失活:等锁期间 thread 软删 → 锁后 fail-closed 零写(Card not found.)", async () => {
    mockVideoProposeCard();
    const p = videoPayload3(); // s0 eligible —— 若不守卫会照常铸卡
    let threadDeletedAt: string | null = null; // simulated thread row state
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        // Emulate the DB: a query CARRYING the live-thread relation filter finds nothing once
        // the thread is soft-deleted; a query WITHOUT the filter still returns the card row.
        if (where.thread && threadDeletedAt !== null) return null;
        return where.id === "card-1" ? card(p) : null;
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    // An in-flight card writer holds the lock; the THREAD dies while we wait.
    let releaseLock!: () => void;
    cardLocks.set("card:card-1", new Promise<void>((r) => (releaseLock = r)));
    const prepP = prepareStoryboardVideos({ cardId: "card-1" });
    await new Promise((r) => setTimeout(r, 0)); // park on the lock (outer loadCard saw a LIVE thread)
    threadDeletedAt = "2026-07-13T00:00:00Z"; // thread soft-deleted DURING the lock wait
    releaseLock();

    const res = await prepP;
    expect(res).toEqual({ error: "Card not found." }); // same shape as card-vanished fail-closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 throughout
  });

  it("$0 铁证:genJob.create 从未被调", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));
    await prepareStoryboardVideos({ cardId: "card-1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    wireLoads(card(videoPayload3()));
    const res = await prepareStoryboardVideos({ cardId: "missing" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await prepareStoryboardVideos({ cardId: "" } as unknown as { cardId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("无合格镜头(全 frameless 或已有视频)→ children:[], totalCredits:0,不写 DB", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    // strip s0's frame → frameless; s2 already has video; s1 frameless → nothing eligible
    delete p.shots[0].firstFrameGenerationId;
    wireLoads(card(p));
    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(res).toEqual({ children: [], totalCredits: 0 });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// regenShotVideoCard — $0 重出视频子卡(闸②),mirror regenShotFirstFrameCard
// ---------------------------------------------------------------------------

describe("regenShotVideoCard — $0 重出视频子卡", () => {
  it("按 shotId 铸新视频子卡只替换 videoCardId,PRESERVE videoGenerationId(其余镜头不动)", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    // s2 is framed + already has a video (vidgen2) + points at a stale/missing child ("old-2").
    // Regen mints a replacement but must NOT touch the old videoGenerationId — the old video
    // stays valid until the new one lands (via sync).
    p.shots[2].videoCardId = "old-2";
    wireLoads(card(p)); // no children map → "old-2" resolves null → mint fresh

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s2" });
    expect("child" in res).toBe(true);
    if (!("child" in res)) return;

    // one fresh video child minted with s2's CURRENT videoPrompt + i2v source frame
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const created = mockChatCreate.mock.calls[0][0].data;
    expect(created.kind).toBe("GEN_CARD");
    expect(created.payload.shotId).toBe("s2");
    expect(created.payload.storyboardCardId).toBe("card-1");
    expect(created.payload.sourceGenerationId).toBe("ffgen2"); // i2v source = s2's frame
    expect("genJobId" in created).toBe(false); // $0

    // buildProposeCard: kind:"video", s2's videoPrompt, per-shot source ctx
    const [propInput, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propInput.kind).toBe("video");
    expect(propInput.structuredPrompt).toBe("vp2");
    expect(propCtx.sourceGenerationId).toBe("ffgen2");

    // parent update: s2.videoCardId replaced (new id); videoGenerationId PRESERVED.
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const shots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(shots[2].videoCardId).toBeTruthy();
    expect(shots[2].videoCardId).not.toBe("old-2");
    expect("videoGenerationId" in shots[2]).toBe(true); // key still present…
    expect(shots[2].videoGenerationId).toBe("vidgen2"); // …with the OLD value intact
    expect(shots[2].firstFrameGenerationId).toBe("ffgen2"); // frame key untouched
    // other shots byte-preserved
    expect(shots[0]).toEqual(p.shots[0]);
    expect(shots[1]).toEqual(p.shots[1]);

    expect(res.child.shotId).toBe("s2");
    expect(res.child.estimatedCredits).toBe(5);
    expect(res.child.structuredPrompt).toBe("vp2");
  });

  it("可重入:镜头已有未花钱且 matching 的视频子卡 → 复用,不铸新、不写 DB", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    // s0 is framed (ffgen0) and points at an existing UNSPENT child matching the would-be card.
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: null,
      },
    });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");

    // Reused: no mint, no parent write (child already registered on the shot).
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(res.child.childCardId).toBe("vchild-0");
    expect(res.child.shotId).toBe("s0");
    expect(res.child.estimatedCredits).toBe(5);
    expect(res.child.structuredPrompt).toBe("vp0");
    expect(res.child.spent).toBe(false);
  });

  it("可重入:既有视频子卡已花过钱(有幂等 job)→ 不复用,铸新替换", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 } },
        genJobId: null,
      },
    });
    // vchild-0 already spent (idempotency job exists) → must NOT reuse; mint fresh (user redo).
    mockGenJobFindFirst.mockResolvedValue({ id: "job-spent" });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[0].videoCardId).not.toBe("vchild-0"); // replaced away from the spent child
    expect(shots[0].firstFrameGenerationId).toBe("ffgen0"); // frame untouched
    expect(res.child.childCardId).not.toBe("vchild-0");
  });

  // 修复轮 v2:regen 侧 spent+mismatch 意图钉住 —— 已花钱视频子卡在参数真漂移时铸新换
  // 指针;旧视频(videoGenerationId)原样保留到新视频落地(I1 语义)。
  it("spent+mismatch:已花钱视频子卡参数真漂移 → 铸新+换指针,videoGenerationId(旧视频)原样保留", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    p.shots[0].videoGenerationId = "vid-OLD"; // an old landed video exists
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0-OLD-DRIFTED", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 } },
        genJobId: "gj-spent", // spent AND drifted
      },
    });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // mismatch → mint fresh
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[0].videoCardId).not.toBe("vchild-0"); // pointer swapped
    expect(shots[0].videoGenerationId).toBe("vid-OLD"); // old video survives until the new one lands
    expect(res.child.childCardId).not.toBe("vchild-0");
  });

  // 修复轮 v2 · NODE-282① regen 侧并发回归:两个交错 regen(同 shot,双击 Retry 形态)。
  // 锁串行化后:先到者铸卡换指针,后到者锁后重读到新子卡(matching+未花钱)→ 复用 —— 全局
  // 恰好一次铸卡,两次调用返回同一张子卡。
  it("并发回归:两个交错 regen(同 shot)→ 锁串行化,恰好一次铸卡,第二个复用首个的新子卡", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[2].videoCardId = "old-2"; // stale/missing child → the first regen mints a replacement
    wireStatefulLoads(p);

    const [a, b] = await Promise.all([
      regenShotVideoCard({ cardId: "card-1", shotId: "s2" }),
      regenShotVideoCard({ cardId: "card-1", shotId: "s2" }),
    ]);
    if (!("child" in a) || !("child" in b)) throw new Error("expected child");

    expect(mockTxLock).toHaveBeenCalledTimes(2); // both txs locked the card
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // exactly one committed mint
    expect(mockChatUpdate).toHaveBeenCalledTimes(1); // exactly one pointer swap
    expect(a.child.childCardId).toBe(b.child.childCardId); // second reused the first's fresh child
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0 throughout
  });

  it("frameless 镜头(无 firstFrameGenerationId)→ {error},不写 DB", async () => {
    mockVideoProposeCard();
    const p = videoPayload3(); // s1 is frameless
    wireLoads(card(p));
    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s1" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("shotId 不存在 → {error},不写 DB", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));
    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "nope" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));
    const res = await regenShotVideoCard({ cardId: "missing", shotId: "s0" });
    expect("error" in res).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await regenShotVideoCard({ cardId: "card-1" } as unknown as { cardId: string; shotId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
  });

  it("R3① fresh-null fail-closed:锁内重读卡已消失 → {error: Card not found.},零暂存零提交、无 cur 回落", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[2].videoCardId = "old-2"; // 若回落 cur 会走 stale→铸新替换路径
    let boardLoads = 0;
    mockChatFindFirst.mockImplementation(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args?.where ?? {};
      if (where.kind === "STORYBOARD_CARD") {
        boardLoads += 1;
        return boardLoads === 1 ? card(p) : null; // outer load OK; in-lock re-read: card GONE
      }
      if (args?.orderBy) return { seq: 10 };
      return null;
    });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s2" });
    expect(res).toEqual({ error: "Card not found." });
    expect(mockTxLock).toHaveBeenCalledWith("card:card-1"); // locked, then failed closed
    expect(mockTxChatCreate).not.toHaveBeenCalled(); // zero staged writes
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled(); // zero committed writes
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("$0 铁证:genJob.create 从未被调", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));
    await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #782 分镜自动接续 —— 闸③(末帧回灌)与它对闸①/闸② 的影响
// ---------------------------------------------------------------------------
//
// 这一组钉的是**一条链**,不是一个函数:
//   闸① 接续开着时只为第一镜出图(其余镜头一分钱不花)
//   → 第一镜出片,worker 把引擎免费附送的末帧接住(GenJob.lastFrameAssetId)
//   → 闸③ 在 sync 里把那张末帧变成第二镜的首帧(只填空,永不覆盖)
//   → 闸② 铸第二镜的视频子卡时,**送进引擎的起始帧就是第一镜的末帧**。
//
// 最后一条是这张票的验收句:「第 N+1 镜头的输入包含第 N 镜头末帧」。前面几条都是为了让
// 它可信 —— 少了任何一环,它就会红。

/** 3 shots,接续开着:s0 有帧且视频子卡在跑;s1/s2 等着上一镜交棒。 */
function chainPayload(): StoryboardCardPayload {
  return {
    storyboardTitle: "One take",
    continuity: true,
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "vp0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0" },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "vp1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "vp2" },
    ],
  };
}

/** 一条出完的视频作业,带(或不带)引擎免费附送的末帧。 */
function doneVideoJob(lastFrameAssetId: string | null) {
  return { id: "vjob-0", status: "DONE", lastFrameAssetId, projectId: "proj-1", threadId: "t-1" };
}

/**
 * #782 r2(判官 r1 P2)—— 省钱这句话必须用**真价**说。
 *
 * 这个文件的通用夹具把每张首帧固定 mock 成 5 credits(纯粹为了让别处的加法好算),于是
 * 「四镜 20cr → 5cr」看着惊人,却是一个不存在的价目表里的数。中央定价的商家口径是
 * **每张图 1 credit**(`pricedGenCredits({kind:"IMAGE",count:1})`),真实的省钱是 4cr → 1cr。
 *
 * 所以这一组不写数字:价钱从中央配置**算**出来,断言写成「N 张 × 真价」与「1 张 × 真价」。
 * 哪天 Founder 改图片单价,这里跟着变,不会再有一条测试替产品说一个假价。
 */
const FIRST_FRAME_CREDITS = displayCredits(
  pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }),
);

/** 把铸卡报价换成**真价**(真 buildProposeCard 走的就是这一条 displayCredits∘pricedGenCredits)。 */
function useRealFirstFramePricing() {
  mockBuildProposeCard.mockImplementation((input: { structuredPrompt: string; entityIds: string[] }) => ({
    cardPayload: {
      kind: "image",
      model: "seedream",
      params: { count: 1 },
      structuredPrompt: input.structuredPrompt,
      entityIds: input.entityIds,
      estimatedCredits: FIRST_FRAME_CREDITS,
      estimatedPriceUsd: 0.2,
      reason: "",
      downgraded: false,
      variantSel: {},
    },
    shownPriceDisplay: FIRST_FRAME_CREDITS,
  }));
}

/** 四镜全缺帧 —— PR 正文那句省钱的原型(接续关 4 张,接续开 1 张)。 */
function fourShotsNoFrames(continuity: boolean): StoryboardCardPayload {
  return {
    storyboardTitle: "One take",
    ...(continuity ? { continuity: true } : {}),
    shots: [0, 1, 2, 3].map((i) => ({
      shotId: `s${i}`, index: i, firstFramePrompt: `ff${i}`, videoPrompt: `vp${i}`,
    })),
  };
}

describe("#782 闸①:接续开着时,只有第一镜要花钱出首帧", () => {
  it("接续开 → 只铸第一镜的首帧子卡,其余镜头零子卡零 credits", async () => {
    const p = chainPayload();
    delete p.shots[0].firstFrameGenerationId; // 三镜全缺帧:接续关时会铸三张
    delete p.shots[0].videoCardId;
    wireLoads(card(p));

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.shotId).toBe("s0");
    expect(res.children.map((c) => c.shotId)).toEqual(["s0"]);
  });

  it("接续关 → 老行为逐字不变(三镜三张)", async () => {
    const p = chainPayload();
    delete p.continuity;
    delete p.shots[0].firstFrameGenerationId;
    delete p.shots[0].videoCardId;
    wireLoads(card(p));

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).toHaveBeenCalledTimes(3);
  });

  it("省下的是真钱:四镜按**中央定价**从 4×真价 降到 1×真价(不是夹具里那个 5)", async () => {
    useRealFirstFramePricing();

    wireLoads(card(fourShotsNoFrames(false)));
    const off = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in off)) throw new Error("expected children");
    expect(off.children).toHaveLength(4);
    expect(off.totalCredits).toBe(4 * FIRST_FRAME_CREDITS);

    vi.clearAllMocks();
    mockResolvedDefaults();
    useRealFirstFramePricing();
    wireLoads(card(fourShotsNoFrames(true)));
    const on = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in on)) throw new Error("expected children");
    expect(on.children).toHaveLength(1);
    expect(on.totalCredits).toBe(FIRST_FRAME_CREDITS);

    // 省下的正是「多出来的那三张图」的真实价钱 —— 这句话现在由定价配置自己说了算。
    expect(off.totalCredits - on.totalCredits).toBe(3 * FIRST_FRAME_CREDITS);
  });
});

describe("#782 闸③:第 N 镜的末帧成为第 N+1 镜的首帧", () => {
  it("第一镜出片 → 第二镜拿到首帧(用末帧 Asset 铸的 Generation),第三镜还得等", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-tail-0"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4"), gen("new-1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    // 末帧那一刻才成为一件作品,而且指的就是 worker 存下的那一行 Asset。
    expect(mockGenerationCreate).toHaveBeenCalledTimes(1);
    const created = mockGenerationCreate.mock.calls[0][0].data;
    expect(created.assetId).toBe("asset-tail-0");
    expect(created.ownerId).toBe(OWNER);
    expect(created.projectId).toBe("proj-1"); // 与那条片子同一个 project(worker 会按此复核源图)
    expect(created.threadId).toBe("t-1"); // 跟着片子走 → 不进候选区/素材面
    expect(created.source).toBe("GENERATED");

    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[1].firstFrameGenerationId).toBe(created.id); // s1 接上了
    expect(updShots[2].firstFrameGenerationId).toBeUndefined(); // s2 的上一镜还没出片
    expect(updShots[0].videoGenerationId).toBe("vid-A"); // 视频写回照旧
    expect(updShots[0].firstFrameGenerationId).toBe("ffgen0"); // 第一镜的帧一格没动
    expect(res.payload.shots[1].firstFrameGenerationId).toBe(created.id);
  });

  it("下一镜已经有首帧 → 一格不动(自动接续绝不覆盖商家看过的东西)", async () => {
    const p = chainPayload();
    p.shots[1].firstFrameGenerationId = "merchant-own-frame";
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-tail-0"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4"), gen("merchant-own-frame")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenerationCreate).not.toHaveBeenCalled();
    expect(res.payload.shots[1].firstFrameGenerationId).toBe("merchant-own-frame");
  });

  it("接续关 → 闸③ 根本不跑(老卡行为逐字不变)", async () => {
    const p = chainPayload();
    delete p.continuity;
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-tail-0"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenerationCreate).not.toHaveBeenCalled();
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
  });

  it("这一单没有末帧(老作业 / 引擎没给 / 存失败)→ 这一环接不上,但什么都不坏", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob(null));
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenerationCreate).not.toHaveBeenCalled();
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-A"); // 视频照常写回
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
  });

  it("末帧那一行不是图片 → 拒绝指过去(首帧绝不能是一段视频)", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-weird"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-weird", ext: "mp4" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenerationCreate).not.toHaveBeenCalled();
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
  });

  it("上一镜的片子还没出完 → 不猜,等下一轮", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob("asset-tail-0"), status: "GENERATING" });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockGenerationCreate).not.toHaveBeenCalled();
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
  });
});

describe("#782 验收句:第 N+1 镜头的输入包含第 N 镜头末帧", () => {
  it("闸② 为第二镜铸视频子卡时,起始帧就是第一镜的末帧", async () => {
    // 闸③ 已经把第一镜的末帧写成第二镜的首帧(上面那组测的就是这一步)。这里从那个状态
    // 出发,断言闸② 真的把它当 i2v 起始帧送出去 —— 「接得上」在执行层的最后一站。
    const INHERITED = "gen-from-shot0-tail";
    mockVideoProposeCard();
    const p = chainPayload();
    p.shots[0].videoGenerationId = "vid-A";
    p.shots[1].firstFrameGenerationId = INHERITED;
    wireLoads(card(p));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // 只有 s1 够格(s0 已有片子,s2 还没帧)
    expect(res.children.map((c) => c.shotId)).toEqual(["s1"]);
    const propCtx = mockBuildProposeCard.mock.calls[0][1] as { sourceGenerationId?: string };
    expect(propCtx.sourceGenerationId).toBe(INHERITED); // ← 验收句
    // 子卡上冻的也是同一个 id(付费那一刻读的就是这个字段)
    expect(mockChatCreate.mock.calls[0][0].data.payload.sourceGenerationId).toBe(INHERITED);
  });
});

// ---------------------------------------------------------------------------
// #782 r2b —— 判官 r1 剩下的两个 P1
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #782 r3 —— 判官 r2 的两条 P1:一条判断,两个错法
// ---------------------------------------------------------------------------
//
// 要回答的始终是同一个问题:**这一镜还有没有免费的帧在路上?** 有 → 什么都别做;
// 没有 → 商家必须看得见一个自己出一张的入口。r2b 让卡面与动作层各自从**指针形状**去猜,
// 于是往两个相反方向各错了一次:
//   • 有 firstFrameCardId 就当在生成 → 商家一按 Cancel(或启动失败、或刷新崩溃),恢复
//     入口整个消失:Generate all 数不到它,也没有单镜按钮,比 r1 那条死路更深一层;
//   • 有旧 videoGenerationId 就当交棒已结束 → 上一镜重出、新片还在跑时提前开放付费首帧,
//     商家为一张本该继承的帧多花一次钱。
//
// 修法是把这条判断收回它唯一能被诚实做出的地方:闸③(sync)—— 那是唯一看得见视频作业
// 真实状态的位置。判词 `inheritBlockedByVideoCardId` 点名**是哪一张视频子卡**交不出末帧,
// 于是上一镜一重出,判词自动失效,零清理逻辑。
//   A 组钉闸③ 什么时候写判词、什么时候**不**写(P1-b 的三个形状全在里面);
//   B 组钉有了判词之后,闸① 的恢复入口在准备卡的每一个分叉上都还在,且绝不二次收费(P1-a)。

/** 从 shots 里取那条判词(测试只读这一个字段,写在一处好改)。 */
function verdictOf(shots: StoryboardCardPayload["shots"], i: number): string | undefined {
  return shots[i].inheritBlockedByVideoCardId;
}

describe("#782 r3 A 组 —— 闸③ 才有资格判「免费的帧不会来了」", () => {
  it("片子出完但交不出末帧 → 判词落在下一镜,点名是**哪一张**视频子卡", async () => {
    // s0 的片子这一轮刚落地(vid-A),但作业上没有末帧(引擎没给 / 旧 worker 没存 / 下载失败)。
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob(null));
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    expect(mockGenerationCreate).not.toHaveBeenCalled(); // 没有末帧可铸
    expect(verdictOf(res.payload.shots, 1)).toBe("vchild-0"); // 判词点着 s0 现役的那张视频子卡
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
    // 判词只落在**下一镜**;s2 的上一镜(s1)还没出片,不该被判死。
    expect(verdictOf(res.payload.shots, 2)).toBeUndefined();
    expect(verdictOf(res.payload.shots, 0)).toBeUndefined();
  });

  it("判词值没变 → 一个字都不写(no-op sync 仍然是零写入)", async () => {
    const p = chainPayload();
    p.shots[0].videoGenerationId = "vid-A"; // 片子早先就落地了,这一轮没有新写入
    p.shots[1].inheritBlockedByVideoCardId = "vchild-0"; // 上一轮 sync 已经判过
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob(null));
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(verdictOf(res.payload.shots, 1)).toBe("vchild-0");
  });

  it("接上了 → 不写判词(判词只描述接不上这件事)", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-tail-0"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-A", "mp4"), gen("new-1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[1].firstFrameGenerationId).toBeTruthy();
    expect(verdictOf(res.payload.shots, 1)).toBeUndefined();
  });

  // ── 判官 r2 P1-b:重出视频的三个形状 ─────────────────────────────────────────
  //
  // 重出会把 videoCardId 换成新的一张,而**故意保留**旧的 videoGenerationId(旧片有效到
  // 新片落地)。r2b 的判据只看那个旧 ID,于是这三个形状里最要紧的一个被判成了「卡死 +
  // 可铸」——免费的末帧正在路上,商家却被请去付费出一张。

  /** 重出后的形状:s0 指着一张新的视频子卡,旧片(old-vid)还挂在那儿。 */
  function remakeInFlightPayload(): StoryboardCardPayload {
    const p = chainPayload();
    p.shots[0].videoCardId = "vchild-0-remake";
    p.shots[0].videoGenerationId = "old-vid";
    return p;
  }

  it("形状一 {旧 videoGenerationId + 新 job 在跑} → 不接、也不判词(免费的帧正在路上)", async () => {
    wireSync(card(remakeInFlightPayload()), { "vchild-0-remake": { genJobId: "vjob-remake" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob("asset-tail-0"), status: "GENERATING" });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("old-vid", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // 零写入
    expect(verdictOf(res.payload.shots, 1)).toBeUndefined();
  });

  // ── 判官 r3 P1-b:片子**失败**也是一个交代,不是「还在等」 ─────────────────────
  //
  // r3 只在「作业 DONE」那一条路上写判词,其余一律 null → 什么都不写。于是重出失败之后:
  // 新 job 是 FAILED(永远不会再交出末帧了),而旧判词点着**旧**的那张子卡、与现役子卡对不
  // 上,下一镜于是永远停在「等上一镜交棒」——界面上连一个自己出帧的入口都没有。
  // 「宁可多等」在这里变成了「永远不动」,那不是谨慎,那是死路。
  //
  // 终态(FAILED / CANCELLED)与 DONE-却交不出末帧是同一件事:这张子卡这一生结束了,免费的
  // 帧不会来了。所以它一样落判词,点名现役这张子卡 —— 下一镜立刻拿回恢复入口,而上一镜自己
  // 的旧片和「Remake video」入口一格没动。
  for (const dead of ["FAILED", "CANCELLED"] as const) {
    it(`形状二 {旧 videoGenerationId + 新 job ${dead}} → 判词落下,点名**新**的那张子卡(恢复入口不许消失)`, async () => {
      wireSync(card(remakeInFlightPayload()), { "vchild-0-remake": { genJobId: "vjob-remake" } }, {});
      mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob(null), status: dead });
      mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("old-vid", "mp4")]);

      const res = await syncStoryboardMedia({ cardId: "card-1" });
      if (!("payload" in res)) throw new Error("expected payload");
      expect(verdictOf(res.payload.shots, 1)).toBe("vchild-0-remake");
      expect(mockGenerationCreate).not.toHaveBeenCalled(); // 判词不是一次继承,零铸行
      // 商家的出路在**上一镜**也在:旧片还在,单镜「Remake video」入口没有被这次失败拿走。
      expect(res.payload.shots[0].videoGenerationId).toBe("old-vid");
      // s2 的上一镜(s1)连片子都没有 → 不该被这次失败连坐。
      expect(verdictOf(res.payload.shots, 2)).toBeUndefined();
    });
  }

  it(`失败的判词也认现役子卡:上一镜再重出一次 → 这一镜回到「还在等」,不再被开成付费`, async () => {
    // 判词自清洁在失败这条路上必须同样成立 —— 否则一次失败就把这一镜永久钉在付费首帧上。
    const p = remakeInFlightPayload();
    p.shots[0].videoCardId = "vchild-0-remake2"; // 又重出了一次,新子卡在跑
    p.shots[1].inheritBlockedByVideoCardId = "vchild-0-remake"; // 上一张失败子卡留下的判词
    wireSync(card(p), { "vchild-0-remake2": { genJobId: "vjob-remake2" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob(null), status: "GENERATING" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("old-vid", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // 零写入:旧判词留着,但它已经指不着现役子卡
    // 判词自清洁:卡面这一侧读出来就是「还在等」,一个字的清理逻辑都没写。
    expect(shotsStuckWithoutInheritedFrame(res.payload.shots, true)).toEqual([]);
  });

  it("上一镜连片子都没有、作业失败 → 不判词(它的出路是把自己那条片子再出一次)", async () => {
    // 上一镜从来没交付过片子(没有 videoGenerationId),这一镜的正解是等上一镜先出片,
    // 不是替它宣布「继承没戏了」——那会在链条第一环就把接续悄悄关掉。
    const p = chainPayload();
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob(null), status: "FAILED" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(verdictOf(res.payload.shots, 1)).toBeUndefined();
  });

  it("闭环:重出的新片落地了、依然没有末帧 → 判词改点**新**的那一张子卡(这一镜重新卡死)", async () => {
    // P1-b 的另一半:重出期间不判死是对的,但新片一旦落地还是交不出末帧,这一镜必须重新
    // 拿回它的恢复入口 —— 否则「不许提前收费」就变成了「永远没有出口」。
    const p = remakeInFlightPayload();
    p.shots[1].inheritBlockedByVideoCardId = "vchild-0"; // 旧子卡留下的判词
    wireSync(card(p), { "vchild-0-remake": { genJobId: "vjob-remake" } }, { "vjob-remake": { generationIds: ["new-vid"] } });
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob(null), id: "vjob-remake" }); // 新片出完了,但没有末帧
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("new-vid", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoGenerationId).toBe("new-vid"); // 新片写回
    expect(verdictOf(res.payload.shots, 1)).toBe("vchild-0-remake"); // 判词跟着现役子卡走
  });

  it("形状三 {旧 videoGenerationId + 没有新 job} → 判词落下(现役子卡就是交不出末帧的那一张)", async () => {
    const p = chainPayload();
    p.shots[0].videoGenerationId = "old-vid"; // 早先就落地,videoCardId 仍是当初那一张
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["old-vid"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob(null));
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("old-vid", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(verdictOf(res.payload.shots, 1)).toBe("vchild-0");
  });
});

/** #782 r3:闸③ 已经判过「s0 那条片子交不出末帧」——s1 卡死,s2 仍在真的等 s1。 */
function stuckChainPayload(): StoryboardCardPayload {
  const p = chainPayload();
  p.shots[0].videoGenerationId = "vid-A"; // s0 的片子出完了
  p.shots[1].inheritBlockedByVideoCardId = "vchild-0"; // 闸③ 的判词:那条片子没有可用末帧
  return p;
}

describe("#782 r3 B 组 —— 判官 r2 P1-a:恢复入口在准备卡的每个分叉上都还在", () => {
  it("有判词、还没准备过 → 闸① 照普通首帧路径为它铸卡、真花钱", async () => {
    wireLoads(card(stuckChainPayload()));

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // s0 已有帧 → 不铸;s1 卡死 → 铸;s2 的上一镜(s1)还没出片,真的在等 → 不铸。
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.shotId).toBe("s1");
    expect(res.children.map((c) => c.shotId)).toEqual(["s1"]);
    expect(res.totalCredits).toBeGreaterThan(0); // 真花钱 —— 不是接续那条 $0 免费路径

    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[2].firstFrameCardId).toBeUndefined(); // s2 一格不动
  });

  // 判官 r2 P1-a 的三个分叉。它们在服务端看到的是**同一个**状态:指针在、子卡一分钱没花、
  // 什么都没在跑。r2b 把这个状态当「在途」,于是三条路一起断在同一处 —— 卡面永远显示
  // "Generating first frame…",Generate all 消失,服务端再 prepare 也不复用那张未消费子卡。
  for (const branch of ["准备→取消", "准备→启动失败", "准备→崩溃刷新"] as const) {
    it(`${branch}:未消费的准备卡不算在途 → 入口还在,而且复用同一张卡(不铸第二张、不多报一次价)`, async () => {
      const p = stuckChainPayload();
      p.shots[1].firstFrameCardId = "child-1"; // 上一次 prepare 留下的准备卡
      wireLoads(card(p), {
        // 一分钱没花:没有 genJobId,也查不到幂等 job(mockGenJobFindFirst 默认 null)。
        "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: null },
      });

      const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
      if (!("children" in res)) throw new Error("expected children");

      expect(res.children.map((c) => c.shotId)).toEqual(["s1"]); // 恢复入口:s1 仍在集合里
      expect(res.children[0].childCardId).toBe("child-1"); // 复用那张准备卡
      expect(res.children[0].spent).toBe(false);
      expect(res.totalCredits).toBe(5); // 真报价,一次
      expect(mockChatCreate).not.toHaveBeenCalled(); // 不铸第二张 → 没有 $0 孤儿堆积
      expect(mockChatUpdate).not.toHaveBeenCalled(); // 指针没变 → 零写入
    });
  }

  it("准备卡已经花过钱(崩溃发生在付款之后)→ 入口照样在,但那一镜 spent:true、零计费", async () => {
    // 入口回来了不等于可以再收一次钱。这条是那句话的机器形状。
    const p = stuckChainPayload();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: "job-paid" },
    });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(res.children.map((c) => c.shotId)).toEqual(["s1"]);
    expect(res.children[0].spent).toBe(true);
    expect(res.totalCredits).toBe(0); // 二次收费的路在这里被堵死
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("准备卡的提示词已经过期 → 铸一张新的替换(恢复入口不因为指针脏了就消失)", async () => {
    const p = stuckChainPayload();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), { "child-1": { payload: { structuredPrompt: "STALE" }, genJobId: null } });

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.children[0].childCardId).not.toBe("child-1");
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[1].firstFrameCardId).not.toBe("child-1");
  });

  it("没有判词 → 仍是「还在等」,闸① 不为它铸卡(死路修复不许误杀免费接棒)", async () => {
    const p = chainPayload(); // s0 的片子还没出完,闸③ 也就没判过
    wireLoads(card(p));

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(res.children).toEqual([]);
  });

  it("判官 r2 P1-b 在闸①:上一镜重出、新片在跑 → 旧判词不匹配,一张都不铸、零 credits", async () => {
    const p = stuckChainPayload();
    p.shots[0].videoCardId = "vchild-0-remake"; // 商家重出了 s0 的视频,新片还在跑
    wireLoads(card(p));

    const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(res.children).toEqual([]); // 免费的末帧正在路上 —— 不请商家多花这一次钱
    expect(res.totalCredits).toBe(0);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });
});

describe("#782 r2b P1 之二 —— 重出某镜的视频,绝不改动下游已经写好的首帧", () => {
  it("重出 s0 的视频 → s1 已经接上的首帧一格不动(闸③ 只填空,永不覆盖,重出也不例外)", async () => {
    mockVideoProposeCard();
    const p = chainPayload();
    p.shots[0].videoGenerationId = "vid-A"; // s0 的片子已出完
    p.shots[1].firstFrameGenerationId = "inherited-from-old-tail"; // s1 已经接上了(闸③ 早先填的)
    wireLoads(card(p));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");

    expect(mockChatCreate).toHaveBeenCalledTimes(1); // 铸了一张新视频子卡替换
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).toBeTruthy();
    expect(updShots[0].videoGenerationId).toBe("vid-A"); // 旧视频原样保留到新片子落地(I1 语义)
    // 下游一个字没变 —— 这正是文案现在如实说的那句话("won't change a later shot's first frame")。
    expect(updShots[1].firstFrameGenerationId).toBe("inherited-from-old-tail");
    expect(updShots[1]).toEqual(p.shots[1]);
  });
});

// ---------------------------------------------------------------------------
// #782 r4(判官 r3 P3)—— 「生成中」必须由一条真的作业撑着
// ---------------------------------------------------------------------------
//
// 卡面靠 `firstFrameCardId` 这个指针判「正在生成」。指针在 ≠ 有东西在跑:准备卡在商家按
// Cancel、启动失败、或崩溃刷新之后照样留在 payload 里,一分钱没花、什么都没在跑。于是卡面
// 转着 "Generating first frame…"、轮询白转两分钟,而那一镜其实需要商家自己按一下。
//
// 这是 P1-b 那条判词的同一味药:能看见作业真实状态的只有 sync。所以 sync 顺手把
// 「哪些镜头的首帧子卡背后真的有一条没死的作业」一起报回去,卡面读它,不再从指针形状猜。
// 这一份是**只读**的,不进 payload —— 它描述的是此刻,没有需要清理的过去。
describe("#782 r4 —— sync 报回「首帧子卡真的有活作业吗」", () => {
  /** 一镜:s0 有首帧子卡、还没出图。作业的状态由每条测试自己给。 */
  function pendingFramePayload(): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameCardId: "child-0" }],
    };
  }

  it("准备卡在、但没有任何作业 → 不算在跑(崩溃刷新后的假 spinner 断根)", async () => {
    wireSync(card(pendingFramePayload()), { "child-0": { genJobId: null } }, {});
    mockGenJobFindFirst.mockResolvedValue(null); // 幂等键也查不到 → 一分钱没花,什么都没跑
    mockGenerationFindMany.mockResolvedValue([]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    // r11:这一格的权威答复就是「没有作业」——卡面据此显示诚实的空态,不是 spinner。
    expect(frameKind(res, "s0")).toBe("absent");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // 只读:一个字都不写
  });

  for (const live of ["QUEUED", "GENERATING"] as const) {
    it(`作业 ${live} → 算在跑(真的在等,spinner 该转)`, async () => {
      wireSync(card(pendingFramePayload()), { "child-0": { genJobId: "job-0" } }, {});
      mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: live, lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
      mockGenerationFindMany.mockResolvedValue([]);

      const res = await syncStoryboardMedia({ cardId: "card-1" });
      if (!("payload" in res)) throw new Error("expected payload");
      expect(frameKind(res, "s0")).toBe(live === "QUEUED" ? "queued" : "generating");
    });
  }

  for (const dead of ["FAILED", "CANCELLED"] as const) {
    it(`作业 ${dead} → 不算在跑(转下去也永远不会有图)`, async () => {
      wireSync(card(pendingFramePayload()), { "child-0": { genJobId: "job-0" } }, {});
      mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: dead, lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
      mockGenerationFindMany.mockResolvedValue([]);

      const res = await syncStoryboardMedia({ cardId: "card-1" });
      if (!("payload" in res)) throw new Error("expected payload");
      expect(frameKind(res, "s0")).toBe("dead");
    });
  }

  // r4 在这里钉的是「DONE 但结果行还没落 → 仍算在跑」,理由是「宁可多转一圈」。r5 把那一圈
  // 取消了:结算落库的 generationIds 在 DONE **之前**就写好了(见 B 组),所以 DONE 的那一刻
  // 已经拿得到产出,不需要靠 spinner 多等。DONE 因此是终态,不是「在跑」——见 A 组。
});

// ---------------------------------------------------------------------------
// #782 r5(判官 r4 的两条 P1)
// ---------------------------------------------------------------------------
//
// 两条判词讲的是同一件事的两面:**商家的钱换来的东西,必须永远到得了分镜上**。
//   ① 到得了:出产的那一行在结算事务里就落库了(GenJob.generationIds),对话里那条
//      GEN_RESULT 只是投递。投递丢了,分镜以前就再也读不到它 —— 付过钱、图存在,
//      firstFrameGenerationId 永远不写,spinner 永远转。
//   ② 到不了的时候有出路:作业死了(FAILED / CANCELLED)、预扣已按退款协议退回,商家
//      一分钱没花也什么都没拿到。那一镜必须能再出一次,而不是被一张烧掉了幂等键的子卡
//      永久占住。

/** 一镜:s0 有首帧子卡、还没出图。作业状态由每条测试自己给(与 r4 那组同形,块内自持)。 */
function r5PendingFramePayload(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [{ shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameCardId: "child-0" }],
  };
}

/** 一条 DONE 的作业行,带它在结算事务里落库的产出。 */
function doneJob(id: string, generationIds: string[], lastFrameAssetId: string | null = null) {
  return { id, status: "DONE", generationIds, lastFrameAssetId, projectId: "proj-1", threadId: "t-1" };
}

describe("#782 r5 A 组 —— 付费的产出永远可达:GEN_RESULT 是投递,GenJob.generationIds 是权威", () => {
  it("DONE + GEN_RESULT 从未落地(append 吞了错)→ 首帧照样写回", async () => {
    // 判官 r4 的时序:worker 结算 + 落 generationIds → 写 DONE → best-effort 写 GEN_RESULT
    // 失败并被吞掉 → 重投看到 DONE 直接返回,没有补写后盾。以前 sync 只读 GEN_RESULT,
    // 于是这张已经付过钱、行也真的存在的图,永远回不到分镜上。
    wireSync(card(r5PendingFramePayload()), { "child-0": { genJobId: "job-0" } }, {}); // 没有 GEN_RESULT
    mockGenJobFindFirst.mockResolvedValue(doneJob("job-0", ["gen-PAID"]));
    mockGenerationFindMany.mockResolvedValue([gen("gen-PAID")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-PAID");
    expect(frameUrl(res, "s0")).toBeTruthy(); // 图真的回到卡面上
  });

  it("DONE + GEN_RESULT 从未落地 → 这一镜不再报「在跑」(spinner 不可能永远转)", async () => {
    // 有了回退,DONE 的那一刻产出就已经拿得到,没有任何理由继续转。轮询因此自然停在
    // 「帧落地」那一格,而不是转满上限再带着一个不会更新的 spinner 收工。
    wireSync(card(r5PendingFramePayload()), { "child-0": { genJobId: "job-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue(doneJob("job-0", ["gen-PAID"]));
    mockGenerationFindMany.mockResolvedValue([gen("gen-PAID")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(frameKind(res, "s0")).toBe("done"); // 到终点了,不是「还在跑」
  });

  it("GEN_RESULT 在 → 仍以它为准(投递正常时行为逐字不变)", async () => {
    wireSync(
      card(r5PendingFramePayload()),
      { "child-0": { genJobId: "job-0" } },
      { "job-0": { generationIds: ["gen-DELIVERED"] } },
    );
    // 两处不一致时以投递为准:它是商家在对话里看见的那一条,权威回退只在投递缺席时说话。
    mockGenJobFindFirst.mockResolvedValue(doneJob("job-0", ["gen-OTHER"]));
    mockGenerationFindMany.mockResolvedValue([gen("gen-DELIVERED")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-DELIVERED");
  });

  it("DONE 但 generationIds 也是空(遗留行)→ 不写,也不说 absent:钱已经收了,不许假装什么都没发生", async () => {
    // #782 r13(判官 r12 P1-F1)—— r5 在这里答 `absent`,而 `absent` 在类型里写着
    // 「从未启动、一分钱没花」。判官 r12 钉出的时序正是从这一格长出来的:卡面于是渲染成空白,
    // 商家按整包按钮 → prepare 判「未耗尽」复用同一张已花钱的子卡 → 全 spent → 回去轮询 →
    // 下一次 sync 还是 absent。零新卡、零退款说明、零有效重试,一个死循环。
    //
    // 现役 worker 已经造不出这个形状(写入点的零产出闸,apps/worker/src/jobs/gen.ts),而这一格
    // 仍然要有一个**诚实**的答案:过渡态 —— 对钱不做任何主张,让卡面继续问(轮询本来就有上限),
    // 而 worker 的自愈巡检会在宽限期内把这一行翻成 FAILED + 退款,那之后这里回的是如实的 dead。
    wireSync(card(r5PendingFramePayload()), { "child-0": { genJobId: "job-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue(doneJob("job-0", []));
    mockGenerationFindMany.mockResolvedValue([]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].firstFrameGenerationId).toBeUndefined();
    expect(frameKind(res, "s0"), "DONE-空被折叠成「什么都没开始」—— 那是关于商家的钱的假话").toBe("generating");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // 只读:一个字都不写
  });

  it("替换形状的 DONE-空:状态说过渡,previous 说旧产出仍然属于商家(不折叠成旧 done)", async () => {
    // 判官 r12 的第二种形状:重出的那条作业 DONE 却交不出东西,r11 把这一格答成旧产出的
    // `done` —— 卡面因此说「替换成功了」,把 Remake 按钮放回来,再确认一次就是第二笔账。
    const p = r5PendingFramePayload();
    p.shots[0].firstFrameGenerationId = "gen-OLD"; // 商家手上已经有一张
    wireSync(card(p), { "child-0": { genJobId: "job-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue(doneJob("job-0", []));
    mockGenerationFindMany.mockResolvedValue([gen("gen-OLD")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    const report = res.shots.find((s) => s.shotId === "s0")!.frame;
    expect(report.status.kind, "替换其实什么都没交出来,却被说成 done").toBe("generating");
    expect(report.previous).toEqual({ generationId: "gen-OLD", url: expect.any(String) });
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-OLD"); // 旧的一格没动
  });

  it("视频侧同一条权威:GEN_RESULT 丢了,片子照样写回、末帧照样交给下一镜", async () => {
    // 接续链最怕的就是这一处:上一镜的片子出完了、末帧也存好了,只因为一条聊天消息没写成,
    // 下一镜就永远等不到交棒。权威回退把整条链从投递的运气里解出来。
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, {}); // 没有 GEN_RESULT
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob("asset-tail-0"), generationIds: ["vid-PAID"] });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-PAID", "mp4"), gen("new-1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-PAID"); // 片子写回
    expect(res.payload.shots[1].firstFrameGenerationId).toBeTruthy(); // 下一镜接上了
    expect(verdictOf(res.payload.shots, 1)).toBeUndefined(); // 不是「交不出末帧」
  });
});

describe("#782 r5 B 组 —— 死掉的作业不占着这一镜:重试入口必须存在", () => {
  /** 闸② 的形状:s0 有帧、没有片子,指着一张已经启动过的视频子卡。 */
  function spentVideoChildPayload(): StoryboardCardPayload {
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    return p;
  }
  const matchingVideoChild = {
    payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
    genJobId: "vjob-0",
  };

  for (const dead of ["FAILED", "CANCELLED"] as const) {
    it(`闸②:子卡作业 ${dead} 且这一镜没有片子 → 铸一张新子卡(新幂等域),旧卡不再复用`, async () => {
      // 旧卡的 cowork:<id> 幂等键已经烧掉了 —— 把它当「已交付」端回去,客户端会把它过滤掉,
      // 一次 coworkGenerate 都不会发;真发了也只会拿回那条死作业的 id。所以出路不是「报
      // spent:false 让它再点一次」,而是**换一张卡**:重出按钮走的就是这条路,不发明第二套。
      mockVideoProposeCard();
      wireLoads(card(spentVideoChildPayload()), { "vchild-0": matchingVideoChild });
      mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: dead });

      const res = await prepareStoryboardVideos({ cardId: "card-1" });
      if (!("children" in res)) throw new Error("expected children");
      expect(mockChatCreate).toHaveBeenCalledTimes(1); // 铸了新卡
      expect(res.children).toHaveLength(1);
      expect(res.children[0].childCardId).not.toBe("vchild-0");
      expect(res.children[0].spent).toBe(false); // 这一次是真的要花钱,报价必须说出来
      expect(res.totalCredits).toBe(5);
      // 父卡指针换到新子卡 —— 否则下一次 prepare 还会看见那张死卡。
      const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
      expect(updShots[0].videoCardId).toBe(res.children[0].childCardId);
      expect(updShots[0].videoGenerationId).toBeUndefined(); // 没有片子可保,I1 语义不受影响
    });
  }

  for (const alive of ["QUEUED", "GENERATING", "DONE"] as const) {
    it(`闸②:子卡作业 ${alive} → 照旧复用 spent:true、零铸卡(exactly-once 一格没松)`, async () => {
      // 「还没结束」和「结束了但什么都没交付」是两件事。前者重铸就是同一镜付两次钱 ——
      // 这正是 P1 kill-shot 当初修的那条,r5 一个字都不许动它。
      mockVideoProposeCard();
      wireLoads(card(spentVideoChildPayload()), { "vchild-0": matchingVideoChild });
      mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: alive });

      const res = await prepareStoryboardVideos({ cardId: "card-1" });
      if (!("children" in res)) throw new Error("expected children");
      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(mockChatUpdate).not.toHaveBeenCalled();
      expect(res.children[0].childCardId).toBe("vchild-0");
      expect(res.children[0].spent).toBe(true);
      expect(res.totalCredits).toBe(0);
    });
  }

  it("闸②:换卡之后再 prepare 一次 → 新卡还没花钱 → 复用,不会越铸越多", async () => {
    // 重铸必须是**一次**,不是每次 prepare 都来一张。新卡没有幂等 job → 走既有的
    // reuse-if-fresh 分支,$0 卡不会堆积。
    mockVideoProposeCard();
    const p = spentVideoChildPayload();
    p.shots[0].videoCardId = "vchild-fresh"; // 上一轮刚换上的新卡
    wireLoads(card(p), { "vchild-fresh": { ...matchingVideoChild, genJobId: null } });
    mockGenJobFindFirst.mockResolvedValue(null); // 还没启动

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(res.children[0].childCardId).toBe("vchild-fresh");
    expect(res.children[0].spent).toBe(false);
  });

  for (const dead of ["FAILED", "CANCELLED"] as const) {
    it(`闸①:首帧子卡作业 ${dead} → 同样铸新卡(同类缺口一并修)`, async () => {
      const p = payload3();
      p.shots[0].firstFrameCardId = "child-0";
      wireLoads(card(p), {
        "child-0": { payload: { structuredPrompt: "ff0", entityIds: ["e0"], estimatedCredits: 5 }, genJobId: "job-0" },
      });
      mockGenJobFindFirst.mockResolvedValue({ id: "job-0", status: dead });

      const res = await prepareStoryboardFirstFrames({ cardId: "card-1" });
      if (!("children" in res)) throw new Error("expected children");
      const s0 = res.children.find((c) => c.shotId === "s0");
      expect(s0).toBeTruthy();
      expect(s0!.childCardId).not.toBe("child-0");
      expect(s0!.spent).toBe(false);
      const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
      expect(updShots[0].firstFrameCardId).toBe(s0!.childCardId);
    });
  }

  it("判官时序:首次失败没有片子 → 有入口重试 → 新卡成功 → 下一镜解锁", async () => {
    mockVideoProposeCard();
    // ① 死局的现场:s0 有帧、片子第一次就失败了(没有 videoGenerationId);s1 在等交棒。
    const p = chainPayload();
    expect(shotsNeedingMintedFirstFrame(p.shots, true).map((s) => s.shotId)).toEqual([]);
    // s0 已经有帧、s1 只能等 —— 闸① 一格都不给,唯一的出路只能在闸②。

    // ② 入口:Make all videos 为这一镜铸一张新的、要花钱的子卡。
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: "vjob-0",
      },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "FAILED" });
    const prep = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in prep)) throw new Error("expected children");
    const retryCardId = prep.children[0].childCardId;
    expect(retryCardId).not.toBe("vchild-0");
    expect(prep.children[0].spent).toBe(false);

    // ③ 新卡真的出片了(它自己的幂等域、它自己的作业),末帧也存下了。
    const p2 = chainPayload();
    p2.shots[0].videoCardId = retryCardId;
    vi.clearAllMocks();
    mockResolvedDefaults();
    wireSync(card(p2), { [retryCardId]: { genJobId: "vjob-retry" } }, { "vjob-retry": { generationIds: ["vid-RETRY"] } });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-retry", status: "DONE", generationIds: ["vid-RETRY"], lastFrameAssetId: "asset-tail-r", projectId: "proj-1", threadId: "t-1" });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-r", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-RETRY", "mp4"), gen("new-1")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-RETRY"); // ④ 片子落地
    expect(res.payload.shots[1].firstFrameGenerationId).toBeTruthy(); // ⑤ 下一镜解锁
  });

  it("sync 如实报回「哪些镜头的片子已经死了」(卡面据此停掉假 spinner)", async () => {
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireSync(card(p), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "FAILED", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("ffgen2"), gen("vidgen2", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(videoKind(res, "s0")).toBe("dead");
    expect(mockChatUpdate).not.toHaveBeenCalled(); // 只读
  });
});

// ---------------------------------------------------------------------------
// #782 r11(判官 r10 P1 的 kill-shot)—— **一次替换只许收一次钱**
//
// r6 核销过「整包 prepare 遇到在途子卡不许再铸」。单镜重出走的是另一条路,它把「这张卡花过
// 钱」直接读作「商家在显式再做一次」,于是照铸新卡。判官 r10 钉出的时序里,卡面因为旧产出
// 还在而把 Remake 按钮放了回来 —— 按下去就是同一次替换的第二笔账,而第一笔的产出落地之后
// 没有任何指针指着它。
//
// 这里逐格钉住新守卫的边界:在途(QUEUED/GENERATING/DONE-未消费)一律零铸卡零写入,把在途
// 那一张原样端回去;已经了结的(DONE-已消费 / FAILED / CANCELLED)照旧铸新卡 —— r5/r7 的
// 单镜救援与正常重出一格不动。
// ---------------------------------------------------------------------------
describe("#782 r11 exactly-once:在途的替换不许再铸一张卡", () => {
  /** 视频侧:s0 有首帧、指着 vchild-0。 */
  function videoShotWithChild(videoGenerationId?: string) {
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    if (videoGenerationId) p.shots[0].videoGenerationId = videoGenerationId;
    return p;
  }
  const matchingVideoChild = {
    payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
    genJobId: "vjob-0",
  };

  for (const status of ["QUEUED", "GENERATING"] as const) {
    it(`视频:替换作业 ${status} → 端回在途那一张(spent),零铸卡零写入`, async () => {
      mockVideoProposeCard();
      wireLoads(card(videoShotWithChild("vid-OLD")), { "vchild-0": matchingVideoChild });
      mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status, generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

      const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
      if (!("child" in res)) throw new Error("expected child");
      expect(res.child.childCardId).toBe("vchild-0"); // 在途那一张
      expect(res.child.spent).toBe(true); // 已经付过钱 —— 卡面据此不开确认框
      expect(mockChatCreate, "同一次替换铸了第二张卡 = 第二笔账").not.toHaveBeenCalled();
      expect(mockTxChatCreate).not.toHaveBeenCalled(); // 连事务内都没铸过
      expect(mockChatUpdate).not.toHaveBeenCalled();
    });
  }

  it("视频:替换作业 DONE 但产出还没进 payload → 仍算在途(铸新卡会把那笔产出孤立)", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoShotWithChild("vid-OLD")), { "vchild-0": matchingVideoChild });
    // 结算已经把 vid-NEW 落库,payload 还停在 vid-OLD —— 下一次 sync 才会消费它。
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE", generationIds: ["vid-NEW"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");
    expect(res.child.childCardId).toBe("vchild-0");
    expect(res.child.spent).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("视频:替换作业 DONE 且产出已经在 payload 上 → 这才是「再做一个」,照旧铸新卡", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoShotWithChild("vid-DONE")), { "vchild-0": matchingVideoChild });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE", generationIds: ["vid-DONE"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.child.childCardId).not.toBe("vchild-0");
    expect(res.child.spent).toBe(false);
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[0].videoGenerationId).toBe("vid-DONE"); // 旧片活到新片落地(I1 语义不变)
  });

  for (const status of ["FAILED", "CANCELLED"] as const) {
    it(`视频:替换作业 ${status} → 不算在途,照旧铸新卡救这一镜(r5/r7 资产不退)`, async () => {
      mockVideoProposeCard();
      wireLoads(card(videoShotWithChild()), { "vchild-0": matchingVideoChild });
      mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status, generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

      const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
      if (!("child" in res)) throw new Error("expected child");
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(res.child.childCardId).not.toBe("vchild-0");
    });
  }

  it("首帧:替换作业 GENERATING → 端回在途那一张(spent),零铸卡零写入", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1"; // s1 已有 gen1,这是一次替换
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: "job-1" },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");
    expect(res.child.childCardId).toBe("child-1");
    expect(res.child.spent).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("首帧:替换作业 DONE 但产出还没进 payload → 仍算在途", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: "job-1" },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "DONE", generationIds: ["gen-NEW"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");
    expect(res.child.childCardId).toBe("child-1");
    expect(res.child.spent).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("首帧:替换作业 DONE 且产出已经在 payload 上 → 照旧铸新卡(商家看着成品说再来一张)", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1"; // payload 的 firstFrameGenerationId 就是 gen1
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: "job-1" },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "DONE", generationIds: ["gen1"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.child.childCardId).not.toBe("child-1");
    const shots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(shots[1].firstFrameGenerationId).toBe("gen1"); // 旧图活到新图落地
  });

  // ── #782 r13(判官 r12 P1-F1 的第二种形状)——────────────────────────────────
  // 「DONE 却指不出任何产出」是这道守卫最不该放行的一格,而 r11 恰好在这里放行:
  // `producedGenerationId === null` 落进 `!== landedGenerationId` 之外,守卫回 false,
  // 服务端于是铸新卡 —— 商家再确认一次就是**同一件事的第二笔账**,而第一笔的钱已经收了。

  it("视频:替换作业 DONE 却交不出产出 → 仍算在途,零铸卡(钱已经收了,这一格最不该开收费入口)", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoShotWithChild("vid-OLD")), { "vchild-0": matchingVideoChild });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");
    expect(res.child.childCardId, "DONE-空被当成「可以再做一个」→ 铸了第二张卡").toBe("vchild-0");
    expect(res.child.spent).toBe(true); // 卡面据此回去等,不开确认框
    expect(mockChatCreate, "同一次替换被收了第二次钱").not.toHaveBeenCalled();
    expect(mockTxChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("首帧:替换作业 DONE 却交不出产出 → 同一条守卫,同样零铸卡", async () => {
    const p = payload3();
    p.shots[1].firstFrameCardId = "child-1";
    wireLoads(card(p), {
      "child-1": { payload: { structuredPrompt: "ff1", entityIds: [], estimatedCredits: 5 }, genJobId: "job-1" },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "DONE", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error("expected child");
    expect(res.child.childCardId).toBe("child-1");
    expect(res.child.spent).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("自愈之后:同一张子卡被 worker 翻成 FAILED → 铸新卡的救援路径原样接住(能力一格没少)", async () => {
    // 这一条是上面两条的**出口**:守卫在 DONE-空 上只是「暂时别动钱」,不是永久封死。
    // worker 的自愈巡检把那一行翻成 FAILED + 退款之后,`isExhausted` 照旧放行 —— 单镜重出
    // 铸一张新卡(新幂等域),这正是 r5/r7 给死作业修的那条路,一个字都没改。
    mockVideoProposeCard();
    wireLoads(card(videoShotWithChild()), { "vchild-0": matchingVideoChild });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "FAILED", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error("expected child");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.child.childCardId).not.toBe("vchild-0");
    expect(res.child.spent).toBe(false); // 这一次是真的要花钱,报价必须说出来
  });
});

// ---------------------------------------------------------------------------
// #782 r11 —— sync 回传的**权威状态**本身(卡面的唯一真相来源)
// ---------------------------------------------------------------------------
describe("#782 r11 sync 权威状态:五个枚举 + 显式替换语义", () => {
  function shotWithVideoChild(videoGenerationId?: string): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [
        {
          shotId: "s0",
          index: 0,
          firstFramePrompt: "ff0",
          videoPrompt: "vp0",
          firstFrameGenerationId: "ffgen0",
          videoCardId: "vchild-0",
          ...(videoGenerationId ? { videoGenerationId } : {}),
        },
      ],
    };
  }

  it("没有子卡也没有产出 → absent", async () => {
    wireSync(card({ storyboardTitle: "Ad", shots: [{ shotId: "s0", index: 0, firstFramePrompt: "f", videoPrompt: "v" }] }));
    mockGenerationFindMany.mockResolvedValue([]);
    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(frameKind(res, "s0")).toBe("absent");
    expect(videoKind(res, "s0")).toBe("absent");
  });

  it("子卡在、作业不存在 → absent(判官 r10 P2:准备→取消→重开,不许说成生成中)", async () => {
    wireSync(card(shotWithVideoChild()), { "vchild-0": { genJobId: null } }, {});
    mockGenJobFindFirst.mockResolvedValue(null);
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0")]);
    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(videoKind(res, "s0")).toBe("absent");
    expect(reportOf(res, "s0").video.previous).toBeUndefined();
  });

  it("QUEUED / GENERATING 各自回自己的名字(卡面不必再猜「没被判死 = 在跑」)", async () => {
    for (const [status, kind] of [["QUEUED", "queued"], ["GENERATING", "generating"]] as const) {
      vi.clearAllMocks();
      mockResolvedDefaults();
      wireSync(card(shotWithVideoChild()), { "vchild-0": { genJobId: "vjob-0" } }, {});
      mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status, generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
      mockGenerationFindMany.mockResolvedValue([gen("ffgen0")]);
      const res = await syncStoryboardMedia({ cardId: "card-1" });
      if (!("payload" in res)) throw new Error("expected payload");
      expect(videoKind(res, "s0")).toBe(kind);
    }
  });

  it("替换在途:状态 = 新作业,previous = 商家仍然拥有的旧片(判官 r10 P1 缺的那两个事实)", async () => {
    wireSync(card(shotWithVideoChild("vid-OLD")), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-OLD", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(videoKind(res, "s0")).toBe("generating");
    expect(reportOf(res, "s0").video.previous?.generationId).toBe("vid-OLD");
    expect(reportOf(res, "s0").video.previous?.url).toBeTruthy();
  });

  it("替换落地:状态 = done 带新产出,previous 消失(旧的已经不是「还在等的那件事」)", async () => {
    wireSync(card(shotWithVideoChild("vid-OLD")), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-NEW"] } });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE", generationIds: ["vid-NEW"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
    mockGenerationFindMany.mockResolvedValue([gen("ffgen0"), gen("vid-NEW", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    const video = reportOf(res, "s0").video;
    expect(video.status).toMatchObject({ kind: "done", generationId: "vid-NEW" });
    expect(video.previous).toBeUndefined();
  });

  it("产出在、地址取不到 → done 但没有 url(卡面据此给手动入口,而不是假装没有)", async () => {
    wireSync(card(shotWithVideoChild("vid-OLD")), { "vchild-0": { genJobId: "vjob-0" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "DONE", generationIds: ["vid-OLD"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" });
    mockGenerationFindMany.mockResolvedValue([]); // 那两条 generation 行都取不到

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(reportOf(res, "s0").video.status).toEqual({ kind: "done", generationId: "vid-OLD" });
    expect(reportOf(res, "s0").frame.status).toEqual({ kind: "done", generationId: "ffgen0" });
  });

  it("帧被替换触发级联删掉视频键 → 那一格如实回 absent(采样不属于它了)", async () => {
    const p: StoryboardCardPayload = {
      storyboardTitle: "Ad",
      shots: [
        {
          shotId: "s0",
          index: 0,
          firstFramePrompt: "ff0",
          videoPrompt: "vp0",
          firstFrameCardId: "child-0",
          firstFrameGenerationId: "gen-OLD",
          videoCardId: "vchild-0",
          videoGenerationId: "vid-OLD",
        },
      ],
    };
    wireSync(
      card(p),
      { "child-0": { genJobId: "job-0" }, "vchild-0": { genJobId: "vjob-0" } },
      { "job-0": { generationIds: ["gen-NEW"] } },
    );
    mockGenJobFindFirst.mockImplementation(async (args: { where?: { id?: string; idempotencyKey?: string } }) => {
      const id = args?.where?.id;
      if (id === "job-0") return { id: "job-0", status: "DONE", generationIds: ["gen-NEW"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" };
      if (id === "vjob-0") return { id: "vjob-0", status: "DONE", generationIds: ["vid-OLD"], lastFrameAssetId: null, projectId: "proj-1", threadId: "t-1" };
      return null;
    });
    mockGenerationFindMany.mockResolvedValue([gen("gen-NEW")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    // 级联:新帧写回 + 视频两键被删 → 视频那一格没有子卡、没有产出。
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen-NEW");
    expect("videoCardId" in res.payload.shots[0]).toBe(false);
    expect(videoKind(res, "s0")).toBe("absent");
    expect(reportOf(res, "s0").video.previous).toBeUndefined();
  });
});
