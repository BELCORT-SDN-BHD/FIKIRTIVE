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
  mockGenerationFindMany,
  mockBuildProposeCard,
  mockResolveDisabled,
  mockSuggestModel,
  db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn();
  const mockChatUpdate = vi.fn();
  const mockGenJobFindFirst = vi.fn();
  const mockGenJobCreate = vi.fn();
  const mockEntityFindMany = vi.fn();
  const mockGenerationFindMany = vi.fn();
  // $transaction runs its callback with a `tx` that is the SAME db object (passthrough),
  // so assertions on the shared mock fns capture writes made inside the transaction.
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate },
    genJob: { findFirst: mockGenJobFindFirst, create: mockGenJobCreate },
    entity: { findMany: mockEntityFindMany },
    generation: { findMany: mockGenerationFindMany },
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
    mockGenerationFindMany,
    mockBuildProposeCard: vi.fn(),
    mockResolveDisabled: vi.fn(),
    mockSuggestModel: vi.fn(),
    db,
  };
});

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
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
  syncStoryboardFirstFrames,
  getStoryboardVideoOptions,
  prepareStoryboardVideos,
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
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockResolvedDefaults();
});

function mockResolvedDefaults() {
  mockResolveDisabled.mockResolvedValue(new Set<string>());
  // suggestModel: deterministic video model "kling" (real durations table = [5,10]).
  // The action passes the SAME suggestModel path minting uses; options reads the REAL
  // GEN_VIDEO_MODEL_OPTIONS[model].durations (kept via importOriginal).
  mockSuggestModel.mockReturnValue({
    model: "kling",
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

describe("syncStoryboardFirstFrames — $0 对账", () => {
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    await syncStoryboardFirstFrames({ cardId: "card-1" });
    expect(mockGenJobCreate).not.toHaveBeenCalled(); // $0: never creates a job
  });

  it("requireOwner 失败 → {error},不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockChatFindFirst).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("卡不存在 → {error},不写 DB", async () => {
    wireSync(card(payload3()));
    const res = await syncStoryboardFirstFrames({ cardId: "missing" });
    expect("error" in res).toBe(true);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → {error},不碰 DB", async () => {
    const res = await syncStoryboardFirstFrames({ cardId: "" } as unknown as { cardId: string });
    expect("error" in res).toBe(true);
    expect(mockChatFindFirst).not.toHaveBeenCalled();
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
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

    const res = await syncStoryboardFirstFrames({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect("s1" in res.frames).toBe(false); // omitted, no throw
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getStoryboardVideoOptions — $0 read: the SELECTED video model's durations
// ---------------------------------------------------------------------------

describe("getStoryboardVideoOptions — $0 读取模型时长", () => {
  it("返回 suggestModel 选定视频模型在真实能力表里的 durations(kling → [5,10])", async () => {
    const res = await getStoryboardVideoOptions();
    expect("model" in res).toBe(true);
    if (!("model" in res)) return;
    // model = the SAME suggestModel path minting uses (kind:"video")
    expect(mockSuggestModel).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video" }),
    );
    expect(res.model).toBe("kling");
    // durations come from the REAL GEN_VIDEO_MODEL_OPTIONS table (not hardcoded)
    expect(res.durations).toEqual([5, 10]);
    // $0: no writes at all
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("模型驱动:换一个选定模型 → 自动返回该模型的真实 durations(veo3.1-lite → [4,6,8])", async () => {
    mockSuggestModel.mockReturnValue({
      model: "veo3.1-lite",
      params: { durationSeconds: 4, count: 1 },
      reason: "",
      downgraded: false,
      requested: {},
    });
    const res = await getStoryboardVideoOptions();
    if (!("model" in res)) throw new Error("expected model");
    expect(res.model).toBe("veo3.1-lite");
    expect(res.durations).toEqual([4, 6, 8]); // real table, zero hardcoding
  });

  it("sources disabledModels 走 resolveDisabledModels(与铸卡同一来源)", async () => {
    mockResolveDisabled.mockResolvedValue(new Set(["some-model"]));
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
 *  Duration is SNAPPED deterministically, mirroring the real suggestModel snap for "kling"
 *  (durations [5,10], default 5): an off-menu desiredDuration (e.g. 7) or undefined snaps to
 *  5; an on-menu value (5 or 10) is kept. This is what makes the action's snapped-vs-snapped
 *  comparison faithful — the would-be card's params.durationSeconds is ALWAYS the snapped
 *  value, never the raw shot field (P2: no snap-mismatch churn). */
const KLING_DURATIONS = [5, 10] as const;
const KLING_DEFAULT_DURATION = 5;
function snapDuration(want: number | undefined): number {
  return want != null && KLING_DURATIONS.includes(want as 5 | 10) ? want : KLING_DEFAULT_DURATION;
}
function mockVideoProposeCard() {
  mockBuildProposeCard.mockImplementation(
    (
      input: { structuredPrompt: string; entityIds: string[]; desiredDuration?: number },
      ctx: { sourceGenerationId?: string },
    ) => ({
      cardPayload: {
        kind: "video",
        model: "kling",
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
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 8 } },
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
        payload: { structuredPrompt: "vp0", sourceGenerationId: "OLD-frame", model: "kling", params: { durationSeconds: 5 } },
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
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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

  // durationSeconds undefined → suggestModel snaps to the model DEFAULT (kling → 5s). The
  // would-be card therefore has params.durationSeconds:5, which matches the child minted at 5
  // → reuse. (The comparison is always snapped-vs-snapped, never against the raw shot field.)
  it("durationSeconds 未定义 → would-be 吸附到模型默认(5s),与子卡一致 → 复用", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    delete p.shots[0].durationSeconds; // no desired duration → snaps to default 5
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 5 } },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(mockChatCreate).not.toHaveBeenCalled(); // reused: would-be default 5 == child 5
    expect(res.children[0].childCardId).toBe("vchild-0");
  });

  // P2 (snap-mismatch churn kill): shot.durationSeconds is OFF-MENU (7; kling offers [5,10]).
  // The child was minted at the SNAPPED value (5). The comparison uses the WOULD-BE card's
  // params.durationSeconds (also snaps 7→5), NOT the raw shot field — so it MATCHES and the
  // child is reused with NO churn. The old raw-field comparison (7 != 5) would have re-minted
  // on every prepare, and combined with a spent pending child that re-opened the P1 double-pay.
  it("P2:shot.durationSeconds 离菜单(7)→ would-be 吸附到 5,与吸附值铸的子卡一致 → 复用不 churn", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].durationSeconds = 7; // off-menu; suggestModel snaps 7 → 5
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        // child was minted at the SNAPPED duration (5), NOT the raw 7
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
    mockVideoProposeCard(); // would-be model = "kling"
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        // everything matches EXCEPT model — child was minted under a different (old) model
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
        payload: { structuredPrompt: "vp0", sourceGenerationId: "ffgen0", model: "kling", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
