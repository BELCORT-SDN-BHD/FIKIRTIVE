import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_VIDEO_MODEL_OPTIONS } from "@fikirtive/core";
import type { StoryboardCardPayload } from "@fikirtive/otto";

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
  const cardLocks = new Map<string, Promise<void>>();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate },
    genJob: { findFirst: mockGenJobFindFirst, create: mockGenJobCreate },
    entity: { findMany: mockEntityFindMany },
    generation: { findMany: mockGenerationFindMany },
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
  // 微修轮 v5 · NODE-282-R4①(数据流完备清扫的点名实例):ownedIds 不得在锁前派生。
  // 形态:s0 引用 e0+e1;prepare 启动时 owned 集只有 e0,在等锁期间变为 {e0,e1}(如另一
  // session 完成实体创建)。锁后派生(v5)→ 铸卡收到 ["e0","e1"](buildProposeCard 第三实参
  // =写路径入参);锁前派生(v4)→ 铸卡吃到过期的 ["e0"]。
  // ===================================================================================
  it("R4① 回归:等锁期间 owned-entity 集变化 → 锁后按新集派生 ownedIds 进铸卡(不吃锁前快照)", async () => {
    const p = payload3();
    p.shots[0].entityIds = ["e0", "e1"]; // s0 references two entities
    p.shots[2].firstFrameGenerationId = "gen2"; // isolate: only s0 mints
    wireLoads(card(p));

    // The owned-entity set CHANGES while prepare waits for the lock.
    let ownedRows = [{ id: "e0" }]; // at call time: only e0 owned
    mockEntityFindMany.mockImplementation(async () => ownedRows);

    // An in-flight card writer holds the lock (manual mutex entry, same map the tx mock uses).
    let releaseLock!: () => void;
    cardLocks.set("card:card-1", new Promise<void>((r) => (releaseLock = r)));

    const prepP = prepareStoryboardFirstFrames({ cardId: "card-1" });
    await new Promise((r) => setTimeout(r, 0)); // let prepare park on the lock

    ownedRows = [{ id: "e0" }, { id: "e1" }]; // e1 becomes owned DURING the lock wait
    releaseLock();

    const res = await prepP;
    if (!("children" in res)) throw new Error("expected children");

    // ownedIds was derived AFTER the lock → the mint (buildProposeCard 3rd arg = the
    // owned-entity write-path input) received the NEW set, not the pre-lock snapshot.
    expect(mockChatCreate).toHaveBeenCalledTimes(1); // s0 minted once
    const ownedArg = mockBuildProposeCard.mock.calls[0][2];
    expect(ownedArg).toEqual(["e0", "e1"]);
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
    expect(res.frames.s0).toContain("gen-A".slice(0, 0) + HASH); // url derived from asset
    expect(res.frames.s0).toBeTruthy();
    expect(res.frames.s1).toBeTruthy(); // pre-existing gen1 resolves too
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
    expect(res.frames.s0).toBeTruthy();
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
    expect(res.frames.s1).toBeTruthy();
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
    expect("s1" in res.frames).toBe(false); // omitted, no throw
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
    expect(res.videos.s0).toBeTruthy();
    expect(res.videos.s0).toContain(HASH); // url derived from the video asset
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
    expect(res.videos.s0).toBeTruthy(); // still resolves the old video url
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
    expect("s0" in res.videos).toBe(false);
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
    expect(res.videos.s0).toBeTruthy(); // old video still resolves
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
    expect("s0" in res.videos).toBe(false);
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
    expect(res.videos).toEqual({}); // no videos
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
    expect(res.frames.s0).toBeTruthy();
    expect(res.frames.s1).toBeTruthy();
    // videos: s0 only (the one with a videoGenerationId)
    expect(res.videos.s0).toBeTruthy();
    expect("s1" in res.videos).toBe(false);
    // frame and video urls for the same shot are distinct assets
    expect(res.frames.s0).not.toBe(res.videos.s0);
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
    expect("s0" in res.videos).toBe(false); // omitted, no throw
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
