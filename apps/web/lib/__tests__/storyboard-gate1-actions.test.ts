import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoryboardCardPayload } from "@fikirtive/otto";

// ---------------------------------------------------------------------------
// Mocks — mirror F3 storyboard-actions.test.ts style (vi.hoisted + vi.mock).
// Adds: @fikirtive/otto buildProposeCard (deterministic payload), @fikirtive/core
// newId (counter), resolveDisabledModels, and genJob/entity/$transaction on the db mock.
// The db mock's chatMessage/genJob/entity are the SAME object instances the code sees
// inside the (passthrough) $transaction — so tx.chatMessage.create === mockChatCreate.
// ---------------------------------------------------------------------------
const {
  mockOwner,
  mockChatFindFirst,
  mockChatCreate,
  mockChatUpdate,
  mockGenJobFindFirst,
  mockGenJobCreate,
  mockEntityFindMany,
  mockBuildProposeCard,
  mockResolveDisabled,
  db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn();
  const mockChatUpdate = vi.fn();
  const mockGenJobFindFirst = vi.fn();
  const mockGenJobCreate = vi.fn();
  const mockEntityFindMany = vi.fn();
  // $transaction runs its callback with a `tx` that is the SAME db object (passthrough),
  // so assertions on the shared mock fns capture writes made inside the transaction.
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate },
    genJob: { findFirst: mockGenJobFindFirst, create: mockGenJobCreate },
    entity: { findMany: mockEntityFindMany },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return {
    mockOwner: vi.fn(),
    mockChatFindFirst,
    mockChatCreate,
    mockChatUpdate,
    mockGenJobFindFirst,
    mockGenJobCreate,
    mockEntityFindMany,
    mockBuildProposeCard: vi.fn(),
    mockResolveDisabled: vi.fn(),
    db,
  };
});

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabled }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {} }));

// newId: deterministic counter so minted child ids are predictable.
let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => `new-${++idCounter}`,
}));

// buildProposeCard: deterministic payload; estimatedCredits 5 so totalCredits math is exact.
// The action passes structuredPrompt/entityIds through the input, which we echo back so the
// returned ChildFrameCard fields can be asserted.
vi.mock("@fikirtive/otto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/otto")>()),
  buildProposeCard: mockBuildProposeCard,
}));

import { prepareStoryboardFirstFrames, regenShotFirstFrameCard } from "../storyboard-gate1-actions";

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
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockResolvedDefaults();
});

function mockResolvedDefaults() {
  mockResolveDisabled.mockResolvedValue(new Set<string>());
  mockEntityFindMany.mockResolvedValue([{ id: "e0" }]); // e0 owned
  mockChatCreate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockGenJobFindFirst.mockResolvedValue(null); // nothing spent by default
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

describe("regenShotFirstFrameCard — $0 重出铸卡", () => {
  it("按 shotId 铸新子卡替换 firstFrameCardId 并清 firstFrameGenerationId(其余镜头不动)", async () => {
    const p = payload3();
    // give s1 an existing firstFrameCardId too, so we can prove it's untouched
    p.shots[1].firstFrameCardId = "old-1";
    wireLoads(card(p));

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

    // parent update: s1.firstFrameCardId replaced (new id), firstFrameGenerationId dropped
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const shots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(shots[1].firstFrameCardId).toBeTruthy();
    expect(shots[1].firstFrameCardId).not.toBe("old-1");
    expect("firstFrameGenerationId" in shots[1]).toBe(false); // dropped by key-omission
    // other shots byte-preserved
    expect(shots[0]).toEqual(p.shots[0]);
    expect(shots[2]).toEqual(p.shots[2]);

    expect(res.child.shotId).toBe("s1");
    expect(res.child.estimatedCredits).toBe(5);
    expect(res.child.structuredPrompt).toBe("ff1");
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

  it("$0 铁证:genJob.create 从未被调", async () => {
    wireLoads(card(payload3()));
    await regenShotFirstFrameCard({ cardId: "card-1", shotId: "s1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});
