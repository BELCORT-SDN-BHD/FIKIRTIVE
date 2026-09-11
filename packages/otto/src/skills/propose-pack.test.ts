import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProposePack } from "./propose-pack.js";
import { proposePackSkill, proposePackInput } from "./propose-pack.js";
import type { OttoContext } from "../context.js";
import { minimumUsableReferenceSide, tooSmallReferenceSentence } from "@fikirtive/core";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db — proposePack must never touch genJob (no spend).
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: {
      findMany: vi.fn(),
    },
    chatMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    genJob: {
      create: vi.fn(),
    },
    // FSE-001 —— 付费前的尺寸闸也在这一面查商品图宽高(第 3 轮判官打回后接上)。
    generation: {
      findMany: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Shared test context factory
// ---------------------------------------------------------------------------
/** #647 T6:`executeProposePack` 现在也可能回一句「引擎关掉了」。下面这一段测的都是
 *  引擎开着的路 —— 拿到 error 当场就是失败,而不是被 `as` 掩盖过去。 */
function minted<T extends object>(r: T | { error: string }): T {
  if ("error" in r) throw new Error(`意外的空态:${(r as { error: string }).error}`);
  return r;
}

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gate fields
// ---------------------------------------------------------------------------

describe("proposePackSkill — gate fields", () => {
  it("cost is free", () => {
    expect(proposePackSkill.cost).toBe("free");
  });

  it("effect is write", () => {
    expect(proposePackSkill.effect).toBe("write");
  });

  it("reach is internal", () => {
    expect(proposePackSkill.reach).toBe("internal");
  });

  it("needsApproval is false (free + internal write = no approval needed)", () => {
    expect(proposePackSkill.needsApproval).toBe(false);
  });

  it("has a built SDK tool", () => {
    expect(proposePackSkill.tool).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Execute tests — mock DB
// ---------------------------------------------------------------------------

describe("executeProposePack — mock DB", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;

    // Default: no entities, last seq = 10
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockPrisma.chatMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ seq: 10 });
    (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("creates one GEN_CARD per item", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    const result = await executeProposePack(
      {
        packTitle: "Summer Campaign",
        items: [
          { kind: "image", structuredPrompt: "Product shot on white", entityIds: [], variantSel: {} },
          { kind: "image", structuredPrompt: "Model wearing the jacket", entityIds: [], variantSel: {} },
          { kind: "video", structuredPrompt: "Brand reveal animation", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(3);
    expect(minted(result).cardIds).toHaveLength(3);
  });

  it("all cards share the same packId", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    const result = await executeProposePack(
      {
        packTitle: "Carousel Pack",
        items: [
          { kind: "image", structuredPrompt: "Slide 1", entityIds: [], variantSel: {} },
          { kind: "image", structuredPrompt: "Slide 2", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    // packId is a non-empty string
    expect(minted(result).packId).toBeTruthy();
    expect(typeof minted(result).packId).toBe("string");

    // Every card persisted carries the same packId in its payload
    const calls = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      const payload = data["payload"] as Record<string, unknown>;
      expect(payload["packId"]).toBe(minted(result).packId);
      expect(payload["packTitle"]).toBe("Carousel Pack");
    }
  });

  it("each card is a GEN_CARD with correct identity from ctx (not params)", async () => {
    const ctx = makeCtx({ orgId: "org-B", threadId: "thread-B" });
    const runContext = { context: ctx };

    await executeProposePack(
      {
        packTitle: "Identity Test Pack",
        items: [
          { kind: "image", structuredPrompt: "Test shot", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    // Identity comes from ctx, never from params
    expect(createArg.data["ownerId"]).toBe("org-B");
    expect(createArg.data["threadId"]).toBe("thread-B");
    expect(createArg.data["kind"]).toBe("GEN_CARD");
    expect(createArg.data["role"]).toBe("AGENT");
  });

  it("never calls prisma.genJob.create (proposePack is $0 — no spend)", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeProposePack(
      {
        packTitle: "Free Pack",
        items: [
          { kind: "image", structuredPrompt: "A sneaker", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });

  /**
   * FSE-002 / CREATE-A2(Founder 2026-09-08 裁「显式报错替代静默丢弃」)——
   * 这条从前钉的是「non-owned entity ids are dropped」。整包与单张走同一条纪律:一件引用
   * 对不上,**整包一张都不落库**,交回一句话。半截包里每一张都是点得下去的付费卡。
   */
  it("FSE-002 / CREATE-A2 entity-ownership guard：对不上的 id ⇒ 整包回一句话，零卡落库", async () => {
    // Only "owned-entity" is owned; "foreign-entity" is not.
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "owned-entity" }]);

    const ctx = makeCtx();
    const runContext = { context: ctx };

    const out = await executeProposePack(
      {
        packTitle: "Ownership Guard Pack",
        items: [
          {
            kind: "image",
            structuredPrompt: "Brand shoot",
            entityIds: ["owned-entity", "foreign-entity"],
            variantSel: { "owned-entity": "var-a", "foreign-entity": "var-b" },
          },
        ],
      },
      runContext,
    );

    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("couldn't match one of the references");
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it("single-item pack returns one cardId and the shared packId", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    const result = await executeProposePack(
      {
        packTitle: "Solo Shot",
        items: [
          { kind: "image", structuredPrompt: "One image", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    expect(minted(result).cardIds).toHaveLength(1);
    expect(minted(result).packId).toBeTruthy();
    expect(typeof minted(result).cardIds[0]).toBe("string");
  });

  it("cards are GEN_CARD rows, not GenJob rows — the payload carries gen fields, not job metadata", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeProposePack(
      {
        packTitle: "Type Check Pack",
        items: [
          { kind: "image", structuredPrompt: "Checking payload shape", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    const payload = createArg.data["payload"] as Record<string, unknown>;

    // Payload carries card fields (same as a normal propose)
    expect(payload["kind"]).toBe("image");
    expect(typeof payload["model"]).toBe("string");
    expect(typeof payload["estimatedCredits"]).toBe("number");
    // Pack grouping fields
    expect(typeof payload["packId"]).toBe("string");
    expect(payload["packTitle"]).toBe("Type Check Pack");
  });
});

// ---------------------------------------------------------------------------
// Goal info-gate (closes the 刨根问底 hard-gate bypass via proposePack)
// ---------------------------------------------------------------------------

describe("proposePackSkill — goal info-gate", () => {
  it("requires field list contains goal", () => {
    const fields = proposePackSkill.requires.map((r) => r.field);
    expect(fields).toContain("goal");
  });

  it("proposePackInput parses with goal", () => {
    const parsed = proposePackInput.parse({
      packTitle: "Summer Campaign",
      items: [{ kind: "image", structuredPrompt: "Product shot", entityIds: [], variantSel: {} }],
      goal: "drive signups for the summer sale",
    });
    expect(parsed.goal).toBe("drive signups for the summer sale");
  });

  it("proposePackInput parses without goal", () => {
    const parsed = proposePackInput.parse({
      packTitle: "Summer Campaign",
      items: [{ kind: "image", structuredPrompt: "Product shot", entityIds: [], variantSel: {} }],
    });
    expect(parsed.goal).toBeUndefined();
  });
});

describe("executeProposePack — goal persisted onto every card payload", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;

    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockPrisma.chatMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ seq: 10 });
    (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("with goal — every persisted GEN_CARD payload carries goal", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeProposePack(
      {
        packTitle: "Summer Campaign",
        goal: "drive signups for the summer sale",
        items: [
          { kind: "image", structuredPrompt: "Product shot", entityIds: [], variantSel: {} },
          { kind: "image", structuredPrompt: "Model shot", entityIds: [], variantSel: {} },
          { kind: "video", structuredPrompt: "Brand reveal", entityIds: [], variantSel: {} },
        ],
      },
      runContext,
    );

    const calls = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      const payload = data["payload"] as Record<string, unknown>;
      expect(payload["goal"]).toBe("drive signups for the summer sale");
    }
  });

  it("without goal — payload has no goal key", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeProposePack(
      {
        packTitle: "No Goal Pack",
        items: [{ kind: "image", structuredPrompt: "A sneaker", entityIds: [], variantSel: {} }],
      },
      runContext,
    );

    const calls = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const data = (calls[0]![0] as { data: Record<string, unknown> }).data;
    const payload = data["payload"] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("goal");
  });
});

// ---------------------------------------------------------------------------
// FSE-001 —— 整包这一面的付费前尺寸闸(第 3 轮判官打回)
//
// 判官实证:`executeProposePack` 用的是同一个 `buildProposeCard`、同一份 ctx(因此同样带
// `referenceGenerationIds`),却整条绕过尺寸闸 —— 既不拒绝、也不说「已放大」。商家从整包
// 这一面点下去,照旧是预扣 → 供应商 300px 闸弹回 → 退款,正是 :176⑥ 要消灭的那一次。
// 闸只有一份口径(`applyReferenceUpscaleGate`),两个入口读的是同一个函数。
// ---------------------------------------------------------------------------
describe("executeProposePack —— 付费前的参考图尺寸闸", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
    generation: { findMany: ReturnType<typeof vi.fn> };
  };

  const AISYAH = { id: "entity-aisyah", type: "CHARACTER" as const, name: "Aisyah" };
  const MUG_RECEIPT = {
    generationId: "gen_mug",
    kind: "image" as const,
    label: "A coral travel mug",
    sourceProjectId: "proj-library",
    sourceProjectName: "Product shots",
    sameCanvas: false,
    previewUrl: "/files/mug.png",
  };

  const runContext = () => ({
    context: makeCtx({
      sourceGenerationId: MUG_RECEIPT.generationId,
      sourceGenerationIds: [MUG_RECEIPT.generationId],
      mediaReferences: [MUG_RECEIPT],
    }),
  });

  const videoItem = (prompt: string) => ({
    kind: "video" as const,
    structuredPrompt: prompt,
    entityIds: [AISYAH.id],
    variantSel: {} as Record<string, string>,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    mockPrisma.entity.findMany.mockResolvedValue([AISYAH]);
    mockPrisma.chatMessage.findFirst.mockResolvedValue({ seq: 5 });
    mockPrisma.chatMessage.create.mockResolvedValue({});
  });

  it("creation §5 :176⑥: 整包这一面同样在付费前拒绝 —— 短边 99 ⇒ 零 GEN_CARD,句子说出他这张图现在多大", async () => {
    mockPrisma.generation.findMany.mockResolvedValue([{ asset: { width: 99, height: 500 } }]);

    const out = await executeProposePack(
      { packTitle: "Summer Campaign", items: [videoItem("She lifts the coral mug to camera")] },
      runContext(),
    );

    expect(out).toEqual({
      error: tooSmallReferenceSentence({ width: 99, height: 500, minSide: minimumUsableReferenceSide(true) }),
    });
    expect(out).toEqual({ error: expect.stringContaining("99×500") });
    expect(out).toEqual({ error: expect.stringContaining("at least 100 pixels") });
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });

  it("creation §5 :176⑥ / CREATE-A10: 整包这一面,带演员血统的小图门槛也说 300 不说 100", async () => {
    mockPrisma.generation.findMany.mockResolvedValue([
      {
        asset: { width: 299, height: 400 },
        entitySnapshot: { entities: [{ id: AISYAH.id, type: "CHARACTER", name: AISYAH.name }] },
      },
    ]);

    const out = await executeProposePack(
      { packTitle: "Summer Campaign", items: [videoItem("She lifts the coral mug to camera")] },
      runContext(),
    );

    expect(out).toEqual({
      error: tooSmallReferenceSentence({ width: 299, height: 400, minSide: minimumUsableReferenceSide(false) }),
    });
    expect(out).toEqual({ error: expect.stringContaining("at least 300 pixels") });
    expect(out).not.toEqual({ error: expect.stringContaining("at least 100") });
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  // 整包的既有硬性质:一张撑不起,整包一张都不落库(半截包里每一张都是点得下去的付费卡)。
  it("creation §5 :176⑥: 包里第二条撑不起 ⇒ 整包零 GEN_CARD(第一条也不落库)", async () => {
    mockPrisma.generation.findMany.mockResolvedValue([{ asset: { width: 80, height: 500 } }]);

    const out = await executeProposePack(
      {
        packTitle: "Summer Campaign",
        items: [
          { kind: "image", structuredPrompt: "Product shot on white", entityIds: [], variantSel: {} },
          videoItem("She lifts the coral mug to camera"),
        ],
      },
      runContext(),
    );

    expect(out).toHaveProperty("error");
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it("creation §5 :176④: 整包这一面也把「已放大」说在卡上(400×200 ⇒ 照铸 + 自己那一格)", async () => {
    mockPrisma.generation.findMany.mockResolvedValue([{ asset: { width: 400, height: 200 } }]);

    const out = await executeProposePack(
      { packTitle: "Summer Campaign", items: [videoItem("She lifts the coral mug to camera")] },
      runContext(),
    );

    expect(minted(out).cardIds).toHaveLength(1);
    const payload = (mockPrisma.chatMessage.create.mock.calls[0]![0] as {
      data: { payload: Record<string, unknown> };
    }).data.payload;
    expect(payload["referenceUpscaleNote"]).toContain("product reference photo");
    expect(payload["referenceUpscaleNote"]).toContain("your original stays untouched");
    // 整包那一格照旧在(闸不吃掉 packId)。
    expect(payload["packId"]).toEqual(expect.any(String));
  });
});
