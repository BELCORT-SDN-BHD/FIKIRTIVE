import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_VIDEO_MODEL_OPTIONS, cardQuoteVersion, videoAttachedCap } from "@fikirtive/core";
// FSE-002 复修轮:铸卡层拒绝的**基类** —— 入口接的一直是它(`packages/otto/src/index.ts` 的
// 注释逐字写着这条纪律),所以这里演的拒绝也用它,而不是某一族的具体子类。
import { ProposeRefusal } from "@fikirtive/otto";
import type { StoryboardCardPayload } from "@fikirtive/otto";
// 卡面侧的纯读判据。闸③ 写下的判词只有经过它才变成商家看得见的东西,所以「判词自清洁」
// 这一类断言在这里直接用它来收口,不再另写一份平行的解读。
import { shotsStuckWithoutInheritedFrame } from "../storyboard-card";
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
// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「prepareStoryboardFirstFrames — $0
// 铸卡」「首帧图形状(#643 T2)」「FSE-002 / CREATE-A2 —— 闸① 接得住铸卡层的拒绝」
// 「regenShotFirstFrameCard — $0 重出铸卡」四个 describe(原 318-901 行,约 584 行)随闸①
// 整段报废一并删除 —— 覆盖的每一条钱路纪律(R3① fail-closed、R4① 锁后派生、#656 P2 形状/
// 提示词漂移、spent 侦测、FSE-002 拒绝接法、$0 铁证)在闸②(`prepareStoryboardVideos` /
// `regenShotVideoCard`)的同名测试里逐条镜像覆盖(下方两个 describe 块的注释写着
// "mirror prepareStoryboardFirstFrames" / "mirror regenShotFirstFrameCard"),零覆盖流失。

// ---------------------------------------------------------------------------
// syncStoryboardMedia — $0 reconcile: write back generationId + urls (frame slot kept for
// backward-compat with pre-FSE-208 cards and #782 continuity's free frame inheritance —
// see storyboard-gate1-actions.ts's file-level doc comment)
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
      ctx: { sourceGenerationId?: string; sourceGenerationIds?: string[] },
    ) => {
      // creation §5 :178(判官 r1 P1-②③⑤)—— 真 `buildProposeCard` 会**按名额截断**挂图
      // (propose.helpers.ts:1431-1439),而这个替身从前不截,于是「挂多了会被悄悄丢掉」这件
      // 事在测试里根本不存在。名额读的是 core 里那**同一个**函数,所以这里演的与真卡一致。
      const attached = ctx.sourceGenerationIds ?? [];
      const riding = attached.slice(
        0,
        videoAttachedCap({ attachedImageCount: attached.length, mentionedElementCount: input.entityIds.length }),
      );
      return {
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
          ...(riding.length ? { referenceGenerationIds: riding } : {}),
        },
        shownPriceDisplay: 5,
      };
    },
  );
}

/** 3 shots for video gate (FSE-208:没有首帧这个前置条件了,资格只看 videoGenerationId):
 *  - s0: 没有视频 → ELIGIBLE (mint)
 *  - s1/s2: 已有 videoGenerationId → SKIP(视频已交付) */
function videoPayload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, videoPrompt: "vp0", durationSeconds: 5 },
      { shotId: "s1", index: 1, videoPrompt: "vp1", videoGenerationId: "vidgen1" },
      { shotId: "s2", index: 2, videoPrompt: "vp2", videoGenerationId: "vidgen2" },
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
  it("FSE-208: 只给没有视频的镜头铸 kind:video 子卡(已有视频的镜头跳过,资格不再看首帧)", async () => {
    mockVideoProposeCard();
    wireLoads(card(videoPayload3()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect("children" in res).toBe(true);
    if (!("children" in res)) return;

    // exactly 1 child minted (s0 是唯一没有视频的镜头); s1/s2 已有视频 → 跳过
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
    expect(propInput.entityIds).toEqual([]); // 这一镜没 @ 任何元素 → 零参考
    // FSE-208: 首帧这一档已退场 —— 每一镜都直接出片,没有 i2v 起始帧这回事。
    expect(propCtx.sourceGenerationId).toBeUndefined();

    // child payload: 没有 i2v 源 + 正确的回链 + 时长
    expect(data.payload.sourceGenerationId).toBeUndefined();
    expect(data.payload.storyboardCardId).toBe("card-1");
    expect(data.payload.shotId).toBe("s0");
    expect(data.payload.params.durationSeconds).toBe(5);

    // parent write: only s0.videoCardId set; s1/s2 未动
    expect(mockChatUpdate).toHaveBeenCalledTimes(1);
    const updShots = (mockChatUpdate.mock.calls[0][0].data.payload as StoryboardCardPayload).shots;
    expect(updShots[0].videoCardId).toBeTruthy();
    expect(updShots[0].videoGenerationId).toBeUndefined(); // NOT written (I1 semantics)
    expect(updShots[1].videoCardId).toBeUndefined(); // 已有视频:未铸、未写
    expect(updShots[1].videoGenerationId).toBe("vidgen1"); // preserved
    expect(updShots[2].videoCardId).toBeUndefined(); // 已有视频:跳过
    expect(updShots[2].videoGenerationId).toBe("vidgen2"); // preserved

    // return: 1 child, totalCredits 5 (unspent)
    expect(res.children).toHaveLength(1);
    expect(res.children[0].shotId).toBe("s0");
    expect(res.children[0].estimatedCredits).toBe(5);
    expect(res.children[0].structuredPrompt).toBe("vp0");
    expect(res.children[0].spent).toBe(false);
    expect(res.totalCredits).toBe(5);
  });

  it("可重入:videoCardId 子卡未花钱且 prompt/duration 一致 → 复用,不铸、不写", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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

  it("可重入:prompt/duration 任一不一致 → 铸新 + 指针替换,不碰 videoGenerationId", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoCardId = "vchild-0";
    // duration mismatch: child payload duration 8 != would-be (snapped) duration 5
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 8 } },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 } },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2", params: { durationSeconds: 5 } },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        payload: { structuredPrompt: "vp0-OLD-DRIFTED", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        // s0: 没有视频、没有子卡指针 → ELIGIBLE, mint fresh.
        { shotId: "s0", index: 0, videoPrompt: "vp0" },
        // s1: 没有视频、指着一张 MATCHING 但 SPENT 的子卡 → reuse spent:true, excluded.
        { shotId: "s1", index: 1, videoPrompt: "vp1", videoCardId: "vchild-1" },
        // s2: 已有视频 → INELIGIBLE, silently skipped.
        { shotId: "s2", index: 2, videoPrompt: "vp2", videoGenerationId: "vidgen2" },
      ],
    };
    wireLoads(card(p), {
      "vchild-1": {
        payload: { structuredPrompt: "vp1", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        // sA processes FIRST and mints (videoless, no child pointer).
        { shotId: "sA", index: 0, videoPrompt: "vpA" },
        // sB processes SECOND; its child lookup throws mid-batch.
        { shotId: "sB", index: 1, videoPrompt: "vpB", videoCardId: "vchild-boom" },
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

  it("无合格镜头(全部已有视频)→ children:[], totalCredits:0,不写 DB", async () => {
    mockVideoProposeCard();
    const p = videoPayload3();
    p.shots[0].videoGenerationId = "vidgen0"; // 连唯一那一镜也已有视频 → 无合格镜头
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
    // s2 已有视频(vidgen2)+ 指着一张 stale/missing 子卡("old-2")。
    // Regen mints a replacement but must NOT touch the old videoGenerationId — the old video
    // stays valid until the new one lands (via sync).
    p.shots[2].videoCardId = "old-2";
    wireLoads(card(p)); // no children map → "old-2" resolves null → mint fresh

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s2" });
    expect("child" in res).toBe(true);
    if (!("child" in res)) return;

    // one fresh video child minted with s2's CURRENT videoPrompt
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const created = mockChatCreate.mock.calls[0][0].data;
    expect(created.kind).toBe("GEN_CARD");
    expect(created.payload.shotId).toBe("s2");
    expect(created.payload.storyboardCardId).toBe("card-1");
    expect(created.payload.sourceGenerationId).toBeUndefined(); // FSE-208:没有 i2v 起始帧
    expect("genJobId" in created).toBe(false); // $0

    // buildProposeCard: kind:"video", s2's videoPrompt
    const [propInput, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propInput.kind).toBe("video");
    expect(propInput.structuredPrompt).toBe("vp2");
    expect(propCtx.sourceGenerationId).toBeUndefined();

    // parent update: s2.videoCardId replaced (new id); videoGenerationId PRESERVED.
    const upd = mockChatUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "card-1" });
    const shots = (upd.data.payload as StoryboardCardPayload).shots;
    expect(shots[2].videoCardId).toBeTruthy();
    expect(shots[2].videoCardId).not.toBe("old-2");
    expect("videoGenerationId" in shots[2]).toBe(true); // key still present…
    expect(shots[2].videoGenerationId).toBe("vidgen2"); // …with the OLD value intact
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
    // s0 没有视频,指着一张既有的 UNSPENT 子卡,且与 would-be 卡一致。
    p.shots[0].videoCardId = "vchild-0";
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 } },
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
        payload: { structuredPrompt: "vp0-OLD-DRIFTED", model: "seedance-2-mini", params: { durationSeconds: 5 } },
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

// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「#782 闸①:接续开着时,只有第一镜
// 要花钱出首帧」describe(原 1951-1999 行)随闸①整段报废一并删除,连同它专用的三个夹具
// (`FIRST_FRAME_CREDITS` / `useRealFirstFramePricing` / `fourShotsNoFrames`)—— 它测的是
// 「接续模式下闸①只为第一镜铸首帧、真省钱」,而闸①(首帧图那一步)从此对所有镜头都不存在,
// 这条省钱路径本身已随之退场,没有替代覆盖(报废,不是迁移)。
//
// FSE-208 报废清单续记(闸③ 免费传帧 + 卡死判定的消费者已死,机制本身未删,详见 PR 描述的
// 报废物清单):下面原本的 `#782 闸③`(6 test)、`#782 验收句`(1 test)、`#782 r3 A 组`
// (9 test,含 for-loop 的 2 个)三个 describe 整段删除,换成下面一个更小的
// `FSE-208 · #782 接续免费传帧` describe —— 理由不是这些 test 写错了,是它们断言的写入
// **结构性地不会再发生**:
//   `directToVideoShotIds`(storyboard-shot.ts 的 `shotGoesDirectToVideo` 现在恒为 true)
//   让 `storyboard-gate1-actions.ts` 里 `if (p.continuity === true) { … if (directIds.has
//   (to.shotId)) continue; … }`(原 711-762 行)对**任何**镜头都在 719 行的 continue 处
//   退出 —— 719 行之后的整段(免费传帧的写入 `frameWrites[to.shotId]`、以及紧跟着的判词写入
//   `inheritBlockWrites[to.shotId]`)对当前代码再也没有一条输入能让它执行到。`inheritFrameFromClip`
//   因此也失去了唯一调用点。`prepareStoryboardVideos`/`regenShotVideoCard` 那边同理:
//   `minimalCtx` 的 `sourceGenerationId` 永远是 `undefined`(闸②不再读任何首帧字段当 i2v
//   起始帧),所以「闸③ 接上的首帧被闸② 当起始帧送出去」这件事(原 `#782 验收句`)本身也
//   不可能发生。
//
// 这段代码**没有**在本 PR 删除:它与 `GenJob.lastFrameAssetId`(worker 写入,
// `apps/worker/src/jobs/gen.ts` 的 `storeLastFrameBestEffort`)以及 `continuity` 开关本身
// 共享一个更大的 #782 功能边界,退掉它需要碰 schema 邻接字段与 worker 包 —— 超出 FSE-208
// (分镜首帧合成退场)本身的授权范围,是另一件家规 §7.4 意义上的 heavy 工作。这是一个明确
// 报告、不擅自处理的缺口(见 PR 描述与最终报告):Founder/编排者可以选择另开一张票退掉
// #782 的这条死代码,或者明确接受它作为已知残留。
//
// 下面这组新 test 把这件事**钉成回归**:接续开着 + 上一镜片子出完 + 末帧齐全,sync 依然
// 一个字都不写 —— 如果将来有人动了 `shotGoesDirectToVideo` 让它不再恒真,这里会立刻变红,
// 逼着重新审视这段代码是否该复活或者正式删除。

describe("FSE-208 · #782 接续的免费传帧机制现在恒定不跑(消费者已随首帧退场,机制本身未删——见上方报废清单注)", () => {
  it("接续开着 + 上一镜片子出完且末帧齐全 → sync 依然不写任何首帧字段(FSE-208 之前这里会传帧)", async () => {
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, { "vjob-0": { generationIds: ["vid-A"] } });
    mockGenJobFindFirst.mockResolvedValue(doneVideoJob("asset-tail-0"));
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("vid-A", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");

    expect(mockGenerationCreate).not.toHaveBeenCalled(); // 不再有「末帧成为一件作品」这一步
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
    expect(res.payload.shots[2].firstFrameGenerationId).toBeUndefined();
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-A"); // 视频写回这条既有职责照旧
  });

  it("接续开着 + 上一镜作业 FAILED(免费的帧不会来了)→ sync 依然不写判词(判词的消费者——闸①首帧——已退场)", async () => {
    const p = chainPayload();
    p.shots[0].videoCardId = "vchild-0-remake";
    p.shots[0].videoGenerationId = "old-vid";
    wireSync(card(p), { "vchild-0-remake": { genJobId: "vjob-remake" } }, {});
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob(null), status: "FAILED" });
    mockGenerationFindMany.mockResolvedValue([]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(res.payload.shots[1].inheritBlockedByVideoCardId).toBeUndefined();
  });

  it("遗留字段自清洁:旧数据身上手工留着的 inheritBlockedByVideoCardId 一旦不匹配现役子卡 → shotsStuckWithoutInheritedFrame 判它不卡死", () => {
    // 这条不依赖 sync(sync 已经不会再产出这个字段了)—— 纯测 storyboard-card.ts 那个
    // 读取端的纯函数,对着本 PR 之前遗留下来的旧数据形状仍然算对。
    const p = chainPayload();
    p.shots[0].videoCardId = "vchild-0-remake2"; // 现役指针已经换了
    p.shots[1].inheritBlockedByVideoCardId = "vchild-0-remake"; // 旧判词指着一张已经不现役的子卡
    expect(shotsStuckWithoutInheritedFrame(p.shots, true)).toEqual([]);
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

  it("视频侧同一条权威:GEN_RESULT 丢了,片子照样写回(权威回退不靠那一条投递)", async () => {
    // 一条聊天消息没写成(GEN_RESULT 丢了)不该让「片子写回」这件事跟着丢 —— 权威回退
    // (GenJob.generationIds)把它从投递的运气里解出来。FSE-208 之后这条链不再往下游传
    // 免费首帧(见上方「接续的免费传帧机制现在恒定不跑」),所以这里只钉视频写回本身。
    wireSync(card(chainPayload()), { "vchild-0": { genJobId: "vjob-0" } }, {}); // 没有 GEN_RESULT
    mockGenJobFindFirst.mockResolvedValue({ ...doneVideoJob("asset-tail-0"), generationIds: ["vid-PAID"] });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-0", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("vid-PAID", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-PAID"); // 片子写回
    expect(res.payload.shots[1].firstFrameGenerationId).toBeUndefined();
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
    payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
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

  // FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「闸①:首帧子卡作业 dead → 同样铸
  // 新卡」的 for 循环(与上面闸②那一段同类缺口的镜像举证)随闸①整段报废一并删除 —— 首帧那
  // 一步已不存在,没有替代覆盖(报废,不是迁移)。

  it("判官时序:首次失败没有片子 → 有入口重试 → 新卡成功 → 片子落地", async () => {
    mockVideoProposeCard();
    // ① 死局的现场:s0 的片子第一次就失败了(没有 videoGenerationId)。
    const p = chainPayload();

    // ② 入口:Make all videos 为这一镜铸一张新的、要花钱的子卡。
    wireLoads(card(p), {
      "vchild-0": {
        payload: { structuredPrompt: "vp0", model: "seedance-2-mini", params: { durationSeconds: 5 }, estimatedCredits: 5 },
        genJobId: "vjob-0",
      },
    });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-0", status: "FAILED" });
    const prep = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in prep)) throw new Error("expected children");
    const retryCardId = prep.children[0].childCardId;
    expect(retryCardId).not.toBe("vchild-0");
    expect(prep.children[0].spent).toBe(false);

    // ③ 新卡真的出片了(它自己的幂等域、它自己的作业)。
    const p2 = chainPayload();
    p2.shots[0].videoCardId = retryCardId;
    vi.clearAllMocks();
    mockResolvedDefaults();
    wireSync(card(p2), { [retryCardId]: { genJobId: "vjob-retry" } }, { "vjob-retry": { generationIds: ["vid-RETRY"] } });
    mockGenJobFindFirst.mockResolvedValue({ id: "vjob-retry", status: "DONE", generationIds: ["vid-RETRY"], lastFrameAssetId: "asset-tail-r", projectId: "proj-1", threadId: "t-1" });
    mockAssetFindFirst.mockResolvedValue({ id: "asset-tail-r", ext: "png" });
    mockGenerationFindMany.mockResolvedValue([gen("vid-RETRY", "mp4")]);

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoGenerationId).toBe("vid-RETRY"); // ④ 片子落地
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

  // FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 上面三条「视频:…」各自的「首帧:…」
  // 镜像用例(同一条守卫在闸①上的举证)随闸①整段报废一并删除,没有替代覆盖(报废,不是迁移)。

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

  // FSE-208 —— 上一条「视频:替换作业 DONE 却交不出产出」的「首帧:…」镜像用例同样随闸①
  // 报废删除。

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

// ═══════════════════════════════════════════════════════════════════════════
// FSE-001 同族(Founder 2026-09-09 裁)—— 带演员的镜头不出首帧,两张参考直接出片
// ═══════════════════════════════════════════════════════════════════════════
//
// 规格 §5 2026-09-08「FSE-001 同族」那一行钉出的死路:分镜对每一镜都先出一张**付费**首帧,
// 带 @演员的镜头把演员 id 放进那张首帧的 entityIds(图生图)—— 而按 §1 的血统信任,一张带
// 演员的图生图产物送进视频端必被拒收(staging 实测 400 + 退款一次)。商家先为一张必然作废
// 的图付一次钱,再为一条注定失败的片子付一次预扣。
//
// 新规矩一句话:**这一镜 @ 到了演员 ⇒ 它不出首帧**,演员参考照原件与这一镜 @ 到的商品照
// 各作一张 `role:"reference_image"`,走纯文生视频(正路,PR #1273 已落地)。
// 不带演员的镜头一格没动(首帧 → 出片,两步照旧)。
//
// 这一组测的是**钱**:哪一步不该铸卡、哪一步不该报价、哪一步的付费请求里必须没有首帧。
// ═══════════════════════════════════════════════════════════════════════════

/** 演员 + 商品各一,归属都在本店 —— 服务端读得出类型的那一份(`ownedEntitiesFor` 的 select)。 */
function castOwned() {
  mockEntityFindMany.mockResolvedValue([
    { id: "actor-1", type: "CHARACTER", name: "Aisyah" },
    { id: "mug", type: "PRODUCT", name: "Mug" },
  ]);
}

/** FSE-208 之后两镜都直接出片(s0 带演员+商品,s1 一个元素都没 @);两镜都还什么都没做过。 */
function castPayload2(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "vp0", entityIds: ["actor-1", "mug"], durationSeconds: 5 },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "vp1", durationSeconds: 5 },
    ],
  };
}

// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「FSE-001 同族 · 闸① —— 带演员的
// 镜头一分首帧钱都不收」describe(原 2828-2871 行)随闸①整段报废一并删除 —— 它测的是「带演员
// 的镜头不铸首帧,不带演员的照旧要」,而 2026-09-12 S5 批量裁决已经把范围定成**所有镜头**都
// 不铸首帧(见下面 `FSE-208 · 闸②` 系列),这条区分本身不再成立,没有替代覆盖(报废)。
// `castPayload2` 夹具留着 —— 下面「闸②」describe 仍用它举证「带演员 vs 不带演员,现在两者
// 都直接出片、都不需要首帧」。

/** 直接出片的这一镜**身上已经有一张付过钱的首帧**(旧分镜留下的,或商家在新规矩之前
 *  出过的)。守卫钉的正是这一格:有首帧也绝不写进 `ctx.sourceGenerationId` —— 写了就等于
 *  把那张图当第一帧,而带演员的图生图产物送进视频端必被拒收(退过一次款的那条路)。
 *  castPayload2 的 s0 没有首帧,那里的 `toBeUndefined()` 无论守卫在不在都为真;这个夹具
 *  把首帧摆上去,守卫一拆测试就红。 */
function castPayloadFramedDirect(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      {
        shotId: "s0",
        index: 0,
        firstFramePrompt: "ff0",
        videoPrompt: "vp0",
        entityIds: ["actor-1", "mug"],
        firstFrameGenerationId: "ffgen0",
        durationSeconds: 5,
      },
    ],
  };
}

describe("FSE-208 · 闸② —— 所有镜头都是演员照 + 商品照两张参考,直接出片", () => {
  it("FSE-208 / CREATE-A2: 带演员的镜头没有首帧也能出片,付费请求不带首帧、带着两个元素", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayload2()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    // FSE-208:两镜都直接出片,都铸了一张视频子卡(s1 一个元素都没 @,纯文生视频)。
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(res.children.map((c) => c.shotId).sort()).toEqual(["s0", "s1"]);

    const s0Call = mockBuildProposeCard.mock.calls.find((c) => c[0].structuredPrompt === "vp0")!;
    const [propInput, propCtx, propOwned] = s0Call;
    expect(propInput.kind).toBe("video");
    // 演员与商品都随这张卡上路(它们的参考照就是引擎收到的那两张 reference_image)。
    expect(propInput.entityIds).toEqual(["actor-1", "mug"]);
    expect(propOwned.map((e: { id: string }) => e.id)).toEqual(["actor-1", "mug"]);
    // 首帧那一格必须是空的 —— 有值就等于把某一张图当第一帧,那正是被拒的那条路。
    expect(propCtx.sourceGenerationId).toBeUndefined();

    const s0Data = mockChatCreate.mock.calls.find((c) => c[0].data.payload.shotId === "s0")![0].data;
    expect(s0Data.payload.sourceGenerationId).toBeUndefined();
    expect(s0Data.payload.entityIds).toEqual(["actor-1", "mug"]);
    // 卡上的 entityIds 就是客户端发起生成时带走的那一份(ChildFrameCard.entityIds)。
    expect(res.children.find((c) => c.shotId === "s0")!.entityIds).toEqual(["actor-1", "mug"]);
  });

  it("FSE-208: 只 @ 商品、没有演员的镜头也直接出片 —— 即使镜头身上留着旧首帧图,也不当 i2v 起点", async () => {
    castOwned();
    mockVideoProposeCard();
    const p = castPayload2();
    p.shots[1].firstFrameGenerationId = "ffgen1"; // FSE-208 之前的老卡可能留着这一格
    wireLoads(card(p));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    expect(res.children.map((c) => c.shotId).sort()).toEqual(["s0", "s1"]);
    const s1Call = mockBuildProposeCard.mock.calls.find((c) => c[0].structuredPrompt === "vp1")!;
    // s1 没有 @ 任何元素 —— 纯文生视频,零参考;旧的 firstFrameGenerationId 一格都不流进去。
    expect(s1Call[0].entityIds).toEqual([]);
    expect(s1Call[1].sourceGenerationId).toBeUndefined();
    const s1Data = mockChatCreate.mock.calls.find((c) => c[0].data.payload.shotId === "s1")![0].data;
    expect(s1Data.payload.sourceGenerationId).toBeUndefined();
  });

  it("FSE-208 / CREATE-A9: 混合分镜(带演员 + 只商品 + 什么都没 @)的总报价按镜头数算,不再区分两步/一步", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayload2()));

    const videos = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in videos)) throw new Error("expected children");
    // 两镜都是「这一步」的钱(5 + 5),不再有「先出首帧再出片」那多收的一份。
    expect(videos.totalCredits).toBe(10);
    expect(videos.children.map((c) => c.shotId).sort()).toEqual(["s0", "s1"]);
  });

  it("FSE-208 / CREATE-A2: 闸② 接得住铸卡层的拒绝 —— 一句人话,零写入", async () => {
    castOwned();
    mockBuildProposeCard.mockImplementation(() => {
      throw new ProposeRefusal("Those elements aren't in your library.");
    });
    wireLoads(card(castPayload2()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(res).toEqual({ error: "Those elements aren't in your library." });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("FSE-208 / CREATE-A10: 单镜重出视频对任何镜头都不再要求首帧", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayload2()));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s1" });
    if (!("child" in res)) throw new Error(`expected child, got ${JSON.stringify(res)}`);
    expect(res.child.shotId).toBe("s1");
    expect(mockBuildProposeCard.mock.calls[0][1].sourceGenerationId).toBeUndefined();
  });

  it("FSE-208 / CREATE-A2: 闸② 直接出片的镜头**身上有付过钱的旧首帧**也不写 sourceGenerationId", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayloadFramedDirect()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    expect(res.children.map((c) => c.shotId)).toEqual(["s0"]);

    // 首帧 id 就摆在这一镜身上("ffgen0"),守卫要保证它一格都不流进付费请求。
    expect(mockBuildProposeCard.mock.calls[0][1].sourceGenerationId).toBeUndefined();
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.sourceGenerationId).toBeUndefined();
    // 走的仍是两张参考那条正路(演员 + 商品),不是 i2v。
    expect(mockBuildProposeCard.mock.calls[0][0].entityIds).toEqual(["actor-1", "mug"]);
  });

  it("FSE-208 / CREATE-A2: 单镜重出视频同法 —— 有旧首帧的直接出片镜头照样不写 sourceGenerationId", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayloadFramedDirect()));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    if (!("child" in res)) throw new Error(`expected child, got ${JSON.stringify(res)}`);
    expect(res.child.shotId).toBe("s0");
    expect(mockBuildProposeCard.mock.calls[0][1].sourceGenerationId).toBeUndefined();
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCreate.mock.calls[0][0].data.payload.sourceGenerationId).toBeUndefined();
    expect(mockBuildProposeCard.mock.calls[0][0].entityIds).toEqual(["actor-1", "mug"]);
  });
});

describe("FSE-208 · 闸③ —— sync 把「所有镜头都直接出片」如实报给卡面", () => {
  it("FSE-208 / CREATE-A2: 带演员的镜头、只 @ 商品的镜头、什么都没 @ 的镜头,答复里 directToVideo 全部为真", async () => {
    castOwned();
    wireLoads(card(castPayload2()));

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("shots" in res)) throw new Error("expected shots");
    expect(reportOf(res, "s0").directToVideo).toBe(true); // 带演员+商品
    expect(reportOf(res, "s1").directToVideo).toBe(true); // 一个元素都没 @ —— 2026-09-12 S5 批量裁决之前这里是 false
  });
});

/**
 * FSE-012（`docs/specs/creation-engine.md` §5 :170，Founder 2026-09-10 裁 #1307）——
 * 分镜确认框也是一张确认卡，它的每一处付费点都要交回「商家按下的是哪一版报价」。
 *
 * 与抽屉里那张卡不同的是：**子卡的完整 payload 从不下发给浏览器**（`model` 是供应商机密），
 * 所以浏览器无从自己算这一串，只能由服务端**铸卡的那一刻**算好随子卡交上去。这一族钉的正是
 * 「交上去的那一串，算的是刚写进库的那一份 payload」——算错了对象，服务端拿库里那张卡再算
 * 一次必然对不上，商家会被一道本该放行的闸挡在门外。
 *
 * 追溯落在变更登记行 §5 :170 上，不认领任何 CREATE- 编号（理由与本片其余测试同一把尺子，
 * 见 PR #1333 描述）。
 */
describe("creation §5 :170 FSE-012 分镜子卡的报价版本", () => {
  it("creation §5 :170 FSE-012 铸出来的子卡:交上去那一串算的是**刚写进库的那一份 payload**", async () => {
    mockVideoProposeCard();
    wireLoads(card(payload3()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error(`expected children, got ${JSON.stringify(res)}`);

    // FSE-208:三镜都没有视频 → 都铸(s0/s1/s2)。逐张把「交上去的那一串」与「那一次
    // chatMessage.create 写进库的 payload」对签。
    expect(mockChatCreate).toHaveBeenCalledTimes(3);
    const writtenByCardId = new Map<string, unknown>(
      mockChatCreate.mock.calls.map((c) => [c[0].data.id as string, c[0].data.payload]),
    );
    expect(res.children).toHaveLength(3);
    for (const child of res.children) {
      const written = writtenByCardId.get(child.childCardId);
      expect(written, `子卡 ${child.childCardId} 没有对应的入库写入`).toBeTruthy();
      expect(child.quoteVersion).toBe(cardQuoteVersion(written));
    }
    // 这一串描述的是**那份报价**,不是「这是哪一张卡」:三镜的价钱那几格一模一样(同 kind、
    // 同张数、同时长、同 5 credits;quoteVersion 不读 entityIds,所以 s0 带元素、s1/s2 不带
    // 也不影响这条断言),所以三串本来就该相同。「批的是哪一张」由 cardId 那一格
    // 管 —— 服务端两处判据都是「拿**这个 cardId 的那张卡**再算一次」(`card-quote-version.ts`
    // 按 id 读卡;`generate.ts` 那一步还额外要求 `approvedQuoteVersion.cardId === input.cardId`),
    // 版本串从来不用来认卡。把这条写下来,是免得日后有人误以为它是一枚身份令牌。
    expect(new Set(res.children.map((c) => c.quoteVersion)).size).toBe(1);
  });

  it("creation §5 :170 FSE-012 复用的那一张:版本从**库里那份 payload** 算,不是另铸一份", async () => {
    mockVideoProposeCard();
    const p = payload3();
    p.shots[0].videoCardId = "child-0";
    p.shots[1].videoGenerationId = "vidgen1"; // 已交付 → 不合格,断言干净
    p.shots[2].videoGenerationId = "vidgen2"; // 已交付 → 不合格,断言干净
    const stored = { structuredPrompt: "v0", entityIds: ["e0"], estimatedCredits: 5, model: "seedance-2-mini", params: { count: 1, durationSeconds: 5 } };
    wireLoads(card(p), { "child-0": { payload: stored, genJobId: null } });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error(`expected children, got ${JSON.stringify(res)}`);

    expect(mockChatCreate).not.toHaveBeenCalled(); // 复用,没铸新
    expect(res.children).toHaveLength(1);
    expect(res.children[0].childCardId).toBe("child-0");
    expect(res.children[0].quoteVersion).toBe(cardQuoteVersion(stored));
  });

  it("creation §5 :170 FSE-012 卡上改了一格价钱相关的:交上去那一串跟着换(不是一个常数)", async () => {
    // 同一镜、同一条铸卡路,只把「时长」换掉(durationSeconds 是决定价格的那几格之一)——
    // 铸出来的子卡形状跟着换,版本必须换一串。
    mockVideoProposeCard();
    const p1 = payload3();
    p1.shots[0].durationSeconds = 5;
    wireLoads(card(p1));
    const short = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in short)) throw new Error("expected children");
    const shortVersion = short.children.find((c) => c.shotId === "s0")!.quoteVersion;

    vi.clearAllMocks();
    idCounter = 0;
    cardLocks.clear();
    mockOwner.mockResolvedValue({ ownerId: OWNER });
    mockResolvedDefaults();
    mockVideoProposeCard();
    const p2 = payload3();
    p2.shots[0].durationSeconds = 10;
    wireLoads(card(p2));
    const long = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in long)) throw new Error("expected children");
    const longVersion = long.children.find((c) => c.shotId === "s0")!.quoteVersion;

    expect(longVersion).not.toBe(shortVersion);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// creation §5 :172④ —— 直接出片的镜头 @ 到已删/非本店的非演员元素:整卡 fail closed
// ═══════════════════════════════════════════════════════════════════════════
//
// 登记那一条钉的是**代价**:整卡零写入(同卡其余镜头也铸不出)。这一组把它变成测试,并且
// 把那句话本身也钉住 —— 一张分镜卡上八个镜头,通用的「有一个引用对不上」让商家没法知道该去
// 改哪一格,而 fail closed 的代价正是其余镜头一起铸不出来。
//
// 钱的三条线一起断言:零子卡(ChatMessage)、零 GenJob、零账本行。后两条在这一层的形状是
// 「这个文件从头到尾就不该碰 genJob.create」—— 铸卡是 $0 的,预扣与账本发生在客户端确认之后
// 的 coworkGenerate 那一趟,而拒绝这一路根本走不到那里(连子卡都没有,点不出那一次确认)。
/** s0 = 直接出片(演员 + 商品),带标题;s1 = 普通两步镜头 —— 用来证明「同卡其余镜头也铸不出」。 */
function directShotWithDeadElement(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      {
        shotId: "s0",
        index: 0,
        title: "Opening",
        firstFramePrompt: "ff0",
        videoPrompt: "vp0",
        entityIds: ["actor-1", "mug"],
        durationSeconds: 5,
      },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "vp1", firstFrameGenerationId: "ffgen1", durationSeconds: 5 },
    ],
  };
}

/** 演员还在,商品**已被这家店删掉**:owner-scoped 的活元素查询读不出它,而按 id 点名时
 *  名字还查得到(软删)—— 拒绝那句话就是靠这一趟把「哪个元素」说出来的。 */
function actorLiveMugDeleted() {
  mockEntityFindMany.mockImplementation(async (args: { where: { deletedAt?: null; ownerId: string } }) => {
    if (args.where.ownerId !== OWNER) return [];
    // 活元素查询(ownedEntitiesFor)带 deletedAt:null ⇒ 只剩演员。
    if (args.where.deletedAt === null) return [{ id: "actor-1", type: "CHARACTER", name: "Aisyah" }];
    // 拒绝那一路的点名查询(不带 deletedAt)⇒ 软删的商品名字还在。
    return [{ name: "Mug" }];
  });
}

describe("creation §5 :172④ —— 直接出片镜头 @ 到不可用元素 ⇒ 整卡零写入", () => {
  it("creation §5 :172④ / CREATE-A10: 闸② 整卡 fail closed —— 零子卡、零 GenJob、零账本行,一句话点名是哪一镜哪个元素", async () => {
    actorLiveMugDeleted();
    mockVideoProposeCard();
    wireLoads(card(directShotWithDeadElement()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });

    expect(res).toEqual({
      error:
        'Shot 1 "Opening" uses "Mug", which isn\'t in your Library any more — take it out of that shot, or pick another one. Nothing was made and nothing was charged.',
    });
    // 零写入:提交的、以及事务里**试着**写的,都是零(拒绝抛在第一次写之前)。
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockTxChatCreate).not.toHaveBeenCalled();
    expect(mockTxChatUpdate).not.toHaveBeenCalled();
    // 零 GenJob ⇒ 零预扣 ⇒ 零账本行(这一层根本不建作业,建作业的那一趟点不出来)。
    expect(mockGenJobCreate).not.toHaveBeenCalled();
    // 代价照登记那一行:同卡另一镜(s1,自己一格问题都没有)也没铸出子卡。
    expect(mockBuildProposeCard).not.toHaveBeenCalledWith(
      expect.objectContaining({ structuredPrompt: "vp1" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("creation §5 :172④ / CREATE-A10: 双租户 —— 别家店的元素 id 在这家店数出 0,同样整卡拒绝且不泄露对方的名字", async () => {
    // 真库里 "mug" 那一行属于 owner-2。这家店的每一趟读都带自己的 ownerId ⇒ 一律读不出来。
    mockEntityFindMany.mockImplementation(async (args: { where: { deletedAt?: null; ownerId: string } }) => {
      if (args.where.ownerId === "owner-2") return [{ id: "mug", type: "PRODUCT", name: "Other shop mug" }];
      return args.where.deletedAt === null ? [{ id: "actor-1", type: "CHARACTER", name: "Aisyah" }] : [];
    });
    mockVideoProposeCard();
    wireLoads(card(directShotWithDeadElement()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });

    expect(res).toEqual({
      error:
        'Shot 1 "Opening" uses an element that isn\'t in your Library any more — take it out of that shot, or pick another one. Nothing was made and nothing was charged.',
    });
    // 别家的名字一个字都不出现 —— 这句话不是存在性问答机。
    expect(JSON.stringify(res)).not.toContain("Other shop mug");
    // 每一趟元素读都带这家店的 ownerId。
    for (const call of mockEntityFindMany.mock.calls) expect(call[0].where.ownerId).toBe(OWNER);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  /** s0 直接出片、一格问题都没有(会先铸出一张视频子卡);s1 也直接出片,但它 @ 的那件
   *  商品已被这家店删掉 —— 出事的是**第二镜**。 */
  function secondShotHasDeadElement(): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [
        { shotId: "s0", index: 0, title: "Opening", firstFramePrompt: "ff0", videoPrompt: "vp0", entityIds: ["actor-1", "mug"], durationSeconds: 5 },
        { shotId: "s1", index: 1, title: "Close", firstFramePrompt: "ff1", videoPrompt: "vp1", entityIds: ["actor-1", "ghost"], durationSeconds: 5 },
      ],
    };
  }

  it("creation §5 :172④ / CREATE-A10: 出事的是第二镜 —— 第一镜已经写进事务里了,回滚之后照样零卡、零 GenJob、零账本行", async () => {
    // 判官第 2 轮 P2-⑥:上面那三条的第一镜就是出事那一镜,于是「零写入」也可能只是
    // 「还没走到第一次写」——次序依赖的假强证据。这一条把出事的镜头挪到第二个:
    // s0 先真的把一张视频子卡**暂存**进事务($0 铸卡),s1 才抛。于是断言分成两半:
    //   • 事务里**试着**写过(mockTxChatCreate 有记录)—— 证明我们真的越过了第一次写;
    //   • 提交出去的是零(mockChatCreate / mockChatUpdate 一次都没有)—— 回滚是真的。
    // 这个 $transaction 替身是带缓冲的:写只在回调 resolve 之后才回放到 committed 那两个
    // 替身上,抛出即丢弃缓冲(见文件头注释),所以这两半合起来才是「整卡零写入」的真证据。
    mockEntityFindMany.mockImplementation(async (args: { where: { deletedAt?: null; ownerId: string } }) => {
      if (args.where.ownerId !== OWNER) return [];
      // 活元素:演员与 mug 都在;ghost 不在(商家已经把它删了)。
      if (args.where.deletedAt === null) {
        return [
          { id: "actor-1", type: "CHARACTER", name: "Aisyah" },
          { id: "mug", type: "PRODUCT", name: "Mug" },
        ];
      }
      // 拒绝那一路的点名查询(不带 deletedAt)⇒ 软删的那件东西名字还在。
      return [{ name: "Ghost tote" }];
    });
    mockVideoProposeCard();
    wireLoads(card(secondShotHasDeadElement()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });

    expect(res).toEqual({
      error:
        'Shot 2 "Close" uses "Ghost tote", which isn\'t in your Library any more — take it out of that shot, or pick another one. Nothing was made and nothing was charged.',
    });
    // 前半:第一镜确实已经把一张子卡暂存进了这次事务(不是「还没走到第一次写」)。
    expect(mockTxChatCreate).toHaveBeenCalled();
    expect(mockBuildProposeCard).toHaveBeenCalledWith(
      expect.objectContaining({ structuredPrompt: "vp0" }),
      expect.anything(),
      expect.anything(),
    );
    // 后半:提交出去的是零 —— 零子卡、零父卡指针改动。
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    // 零 GenJob ⇒ 零预扣 ⇒ 零账本行(这一层根本不建作业,而建作业的那一趟点不出来)。
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("creation §5 :172④ / CREATE-A10: 单镜重出走同一条口径 —— 一句点名的话,零写入", async () => {
    actorLiveMugDeleted();
    mockVideoProposeCard();
    wireLoads(card(directShotWithDeadElement()));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });

    expect(res).toEqual({
      error:
        'Shot 1 "Opening" uses "Mug", which isn\'t in your Library any more — take it out of that shot, or pick another one. Nothing was made and nothing was charged.',
    });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// creation §5 :172⑤ —— firstFramePrompt 对带元素的镜头不再必填
// ═══════════════════════════════════════════════════════════════════════════
describe("creation §5 :172⑤ —— 没有 firstFramePrompt 的镜头", () => {
  it("creation §5 :172⑤ / CREATE-A2: 带演员的镜头没有首帧文字也照样直接出片(那一步整个不存在)", async () => {
    castOwned();
    mockVideoProposeCard();
    wireLoads(
      card({
        storyboardTitle: "Ad",
        shots: [
          { shotId: "s0", index: 0, videoPrompt: "vp0", entityIds: ["actor-1", "mug"], durationSeconds: 5 },
        ],
      }),
    );

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error(`expected children, got ${JSON.stringify(res)}`);
    expect(res.children.map((c) => c.shotId)).toEqual(["s0"]);
    expect(mockBuildProposeCard.mock.calls[0][0].entityIds).toEqual(["actor-1", "mug"]);
  });

  // FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「creation §5 :172⑤ / CREATE-A10:
  // 演员离场后这一镜要走两步却没有首帧文字 ⇒ 点名拒绝」随闸①整段报废一并删除:它测的整个
  // 前提——「演员离场 ⇒ 这一镜回落成两步 ⇒ 两步的第一步(首帧)没有稿子 ⇒ 拒绝」——不再可能
  // 发生。「两步」这一档已经不存在,任何镜头(带不带演员、演员在不在)都直接出片,没有
  // 首帧文字这一格可以缺席,也就没有这条拒绝的立足之地(报废,不是迁移)。
});

// ═══════════════════════════════════════════════════════════════════════════
// creation §5 :178(Founder 2026-09-10 裁)—— 分镜「挂 Library 图」通道
// ═══════════════════════════════════════════════════════════════════════════
//
// 验收口径逐字:「分镜卡镜头可 @ 选 Library 里的图作参考并**进入报价材料**,跨租户不可选」。
// 名额与计价沿「直接出片」那一档(FSE-001 正路)——所以这一组钉的是三件事:
//   ① 挂图真的进了报价材料(ctx → buildProposeCard → 冻在子卡上 → 付费时的 videoOptions);
//   ② 跨租户读不出来 ⇒ 花钱之前点名拒绝、零卡零预扣(CREATE-A10 归属围栏 + CREATE-A2 诚实拒绝);
//   ③ 带不上车的形状(不直接出片的镜头)同样是花钱之前的点名拒绝,不是悄悄不带上路。
// ═══════════════════════════════════════════════════════════════════════════

/** 这家店真有的几张 Library 图 —— `attachShotLibraryImages` 那一趟 owner-scoped 读的回行。 */
function libraryImagesOwned(ids: string[] = ["lib-1", "lib-2"]) {
  mockGenerationFindMany.mockImplementation(async (args: { where: { ownerId?: string; id?: { in?: string[] } } }) => {
    // 跨租户:查询里带的 ownerId 不是本店 ⇒ 一行都读不出来(真库的行为,这里如实复刻)。
    if (args.where.ownerId !== OWNER) return [];
    const wanted = args.where.id?.in ?? [];
    return wanted
      .filter((id: string) => ids.includes(id))
      .map((id: string) => ({
        id,
        projectId: "p-src",
        promptText: `prompt ${id}`,
        asset: { ownerId: OWNER, contentHash: HASH, ext: "png" },
        project: { name: "Canvas A" },
      }));
  });
}

/** s0 带演员(直接出片)并挂了两张 Library 图;s1 不带演员(两步),什么都没挂。 */
function libraryPayload(): StoryboardCardPayload {
  const p = castPayload2();
  p.shots[0]!.referenceGenerationIds = ["lib-1", "lib-2"];
  return p;
}

describe("creation §5 :178 —— 分镜挂 Library 图,进报价材料", () => {
  it("creation §5 :178 / CREATE-A2: 挂上的 Library 图进这一镜的报价材料,并冻在子卡上", async () => {
    castOwned();
    libraryImagesOwned();
    mockVideoProposeCard();
    wireLoads(card(libraryPayload()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");

    const [, propCtx] = mockBuildProposeCard.mock.calls[0];
    // 次序 = 商家挂的次序,也就是引擎收到参考图的次序。
    expect(propCtx.sourceGenerationIds).toEqual(["lib-1", "lib-2"]);
    // 回执与 id 同一趟读出来 —— 卡上有 id 却没有回执时 planCardGate 判这张卡不可批准。
    expect(propCtx.mediaReferences.map((r: { generationId: string }) => r.generationId)).toEqual(["lib-1", "lib-2"]);
    // 首帧那一格仍然是空的:挂图是参考照,不是第一帧(FSE-001 正路)。
    expect(propCtx.sourceGenerationId).toBeUndefined();
  });

  it("creation §5 :178 / CREATE-A10: 别家店的那张图在这家店读不出来 ⇒ 花钱之前点名拒绝,零卡零预扣", async () => {
    castOwned();
    // 本店只有 lib-1;payload 上那张 lib-of-owner-2 属于别家店 —— owner-scoped 读回不来。
    libraryImagesOwned(["lib-1"]);
    mockVideoProposeCard();
    const p = castPayload2();
    p.shots[0]!.referenceGenerationIds = ["lib-1", "lib-of-owner-2"];
    wireLoads(card(p));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    expect("error" in res && res.error).toContain("isn't in your Library any more");
    expect("error" in res && res.error).toContain("Shot 1");
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
    // 那一趟读带着本店的 ownerId —— 归属围栏就在这一格上(它当不了存在性问答机)。
    const call = mockGenerationFindMany.mock.calls.find(
      (c) => (c[0] as { where?: { id?: { in?: string[] } } }).where?.id?.in?.includes("lib-of-owner-2"),
    );
    expect((call![0] as { where: { ownerId: string } }).where.ownerId).toBe(OWNER);
  });

  // FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「creation §5 :178 / CREATE-A2:
  // 不直接出片的镜头挂着图 ⇒ 花钱之前点名拒绝」随闸①整段报废一并删除:它测的前提——
  // 「有的镜头走两步(i2v),挂图上不了这类镜头的车」——不再成立。所有镜头现在都走同一条
  // 直接出片的铸卡路,挂图对每一镜都无条件进 ctx(`attachShotLibraryImages` 无条件调用,
  // 见 storyboard-gate1-actions.ts),没有「这一镜不合格」这一档可拒绝(报废,不是迁移)。

  it("creation §5 :178 / CREATE-A2: 单镜重出视频同法 —— 挂图照样进材料", async () => {
    castOwned();
    libraryImagesOwned();
    mockVideoProposeCard();
    wireLoads(card(libraryPayload()));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });
    expect("child" in res).toBe(true);
    const [, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propCtx.sourceGenerationIds).toEqual(["lib-1", "lib-2"]);
  });

  it("creation §5 :178 / CREATE-A2: 没挂图的分镜一格没动 —— 那一趟读一次都不发", async () => {
    castOwned();
    libraryImagesOwned();
    mockVideoProposeCard();
    wireLoads(card(castPayload2()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    const [, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propCtx.sourceGenerationIds).toBeUndefined();
    expect(propCtx.mediaReferences).toBeUndefined();
    expect(mockGenerationFindMany).not.toHaveBeenCalled();
  });

  it("creation §5 :178 / CREATE-A2: 换掉挂图 ⇒ 旧的视频子卡不算同一张,不许复用", async () => {
    castOwned();
    libraryImagesOwned();
    mockVideoProposeCard();
    const p = libraryPayload();
    p.shots[0]!.videoCardId = "old-video-child";
    p.shots[1]!.videoGenerationId = "vidgen1"; // s1 已交付 → 不合格,断言只落在 s0 上
    wireLoads(card(p), {
      "old-video-child": {
        // 这张旧卡按**另一组**挂图铸的:其余每一格(话/时长/模型/首帧)都一样。
        payload: {
          structuredPrompt: "vp0",
          model: "seedance-2-mini",
          params: { durationSeconds: 5 },
          entityIds: ["actor-1", "mug"],
          referenceGenerationIds: ["lib-9"],
          estimatedCredits: 5,
        },
        genJobId: null,
      },
    });

    const res = await prepareStoryboardVideos({ cardId: "card-1" });
    if (!("children" in res)) throw new Error("expected children");
    // 复用会把旧卡端回去;这里必须是一张新铸的卡,而且父卡指针换了。
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(res.children[0]!.childCardId).not.toBe("old-video-child");
  });

  it("creation §5 :178: sync 把这一镜挂着的图如实报给卡面(取不到地址就只回 id)", async () => {
    castOwned();
    libraryImagesOwned(["lib-1"]); // lib-2 这一刻取不到(删了 / 读不回来)
    wireLoads(card(libraryPayload()));

    const res = await syncStoryboardMedia({ cardId: "card-1" });
    if (!("shots" in res)) throw new Error("expected shots");
    const imgs = reportOf(res, "s0").libraryImages!;
    expect(imgs.map((r) => r.generationId)).toEqual(["lib-1", "lib-2"]);
    expect(imgs[0]!.url).toBeTruthy();
    expect(imgs[1]!.url).toBeUndefined();
    expect(reportOf(res, "s1").libraryImages).toEqual([]);
  });
});

/**
 * creation §5 :178(判官 r1 P1-②③⑤)—— 挂多了**不许悄悄丢**。
 *
 * 引擎的 `image_url` 名额只有 9 个,而这一镜 @ 到的每个元素先占 1 格(`videoAttachedCap`)。
 * 聊天那一面挂多了会在卡面上逐字说出来(`buildReferenceBudgetNotes`:「You attached N images —
 * only the first M go to the engine…」),分镜铸卡这条路却从不经过那一层:商家在镜头上看着 8 个
 * 缩略图、批准、付费,引擎收到 7 张,卡面与确认框零提示。
 *
 * 这一组钉的是那一刀现在**停在花钱之前**:卡上真会上路的少于商家挂的 ⇒ 点名拒绝、零卡零预扣。
 * 判据不在这里另算一份 —— 读的就是 `buildProposeCard` 铸出来的那张卡自己那一列,所以「卡上说的」
 * 与「引擎真收的」不可能分家。
 */
describe("creation §5 :178 —— 挂图带不全就不许开工", () => {
  /** 这一镜 @ 了 2 个元素 ⇒ 名额 9−2=7;挂 8 张 ⇒ 第 8 张上不了车。 */
  function overCapPayload(): StoryboardCardPayload {
    const p = castPayload2();
    p.shots[0]!.referenceGenerationIds = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];
    return p;
  }

  it("creation §5 :178 / CREATE-A2: 挂 8 张只带得上 7 张 ⇒ 花钱之前点名拒绝,零卡零预扣", async () => {
    castOwned();
    libraryImagesOwned(["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"]);
    mockVideoProposeCard();
    wireLoads(card(overCapPayload()));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });

    expect("error" in res && res.error).toContain("Shot 1");
    expect("error" in res && res.error).toContain("8 Library images");
    expect("error" in res && res.error).toContain("only 7 of them fit");
    expect("error" in res && res.error).toContain("Nothing was made and nothing was charged");
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });

  it("creation §5 :178 / CREATE-A2: 单镜重出同法 —— 带不全就不铸卡", async () => {
    castOwned();
    libraryImagesOwned(["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"]);
    mockVideoProposeCard();
    wireLoads(card(overCapPayload()));

    const res = await regenShotVideoCard({ cardId: "card-1", shotId: "s0" });

    expect("error" in res && res.error).toContain("Shot 1");
    expect("error" in res && res.error).toContain("only 7 of them fit");
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("creation §5 :178 / CREATE-A2: 名额刚好装得下 ⇒ 照常铸卡,一张不少地进材料", async () => {
    castOwned();
    libraryImagesOwned(["l1", "l2", "l3", "l4", "l5", "l6", "l7"]);
    mockVideoProposeCard();
    const p = castPayload2();
    p.shots[0]!.referenceGenerationIds = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"];
    wireLoads(card(p));

    const res = await prepareStoryboardVideos({ cardId: "card-1" });

    if (!("children" in res)) throw new Error("expected children");
    const [, propCtx] = mockBuildProposeCard.mock.calls[0];
    expect(propCtx.sourceGenerationIds).toHaveLength(7);
  });
});
