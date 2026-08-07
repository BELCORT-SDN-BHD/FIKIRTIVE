import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProposePack } from "./propose-pack.js";
import { proposePackSkill, proposePackInput } from "./propose-pack.js";
import type { OttoContext } from "../context.js";

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

  it("entity-ownership guard: non-owned entity ids are dropped (same as propose)", async () => {
    // Only "owned-entity" is owned; "foreign-entity" is not.
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "owned-entity" }]);

    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeProposePack(
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

    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    const payload = createArg.data["payload"] as Record<string, unknown>;

    // Only owned entity remains; foreign one dropped silently
    expect(payload["entityIds"]).toEqual(["owned-entity"]);
    expect((payload["variantSel"] as Record<string, string>)["foreign-entity"]).toBeUndefined();
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
