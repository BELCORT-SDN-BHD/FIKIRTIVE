import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeRememberBrandFact } from "./remember-brand-fact.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db so execute tests never hit a real DB.
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    memory: {
      create: vi.fn(),
    },
    // must NEVER be called — no GenJob creation in rememberBrandFact
    genJob: {
      create: vi.fn(),
    },
  },
}));

// Mock @fikirtive/core to return a stable id for assertions
vi.mock("@fikirtive/core", () => ({
  newId: vi.fn(() => "test-id-123"),
}));

// ---------------------------------------------------------------------------
// Shared test context factory
// ---------------------------------------------------------------------------
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
// Tests
// ---------------------------------------------------------------------------

describe("executeRememberBrandFact — mock DB", () => {
  let mockPrisma: {
    memory: { create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("calls memory.create with ownerId from ctx.orgId", async () => {
    const ctx = makeCtx({ orgId: "org-real" });
    const runContext = { context: ctx };

    await executeRememberBrandFact({ category: "Voice", content: "Warm and friendly tone" }, runContext);

    expect(mockPrisma.memory.create).toHaveBeenCalledTimes(1);
    const call = (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["ownerId"]).toBe("org-real");
  });

  it("stores source:'otto' — makes the Otto-learned label real", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeRememberBrandFact({ category: "Brand", content: "We are a sustainable sneaker brand" }, runContext);

    const call = (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["source"]).toBe("otto");
  });

  it("stores the given category and content", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeRememberBrandFact({ category: "Audience", content: "Gen Z urban creatives aged 18-25" }, runContext);

    const call = (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["category"]).toBe("Audience");
    expect(call.data["content"]).toBe("Gen Z urban creatives aged 18-25");
  });

  it("stores a non-empty id", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeRememberBrandFact({ category: "Rules", content: "Always use lowercase brand name" }, runContext);

    const call = (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(typeof call.data["id"]).toBe("string");
    expect((call.data["id"] as string).length).toBeGreaterThan(0);
  });

  it("returns { ok: true, id } on success", async () => {
    const ctx = makeCtx();
    const result = await executeRememberBrandFact(
      { category: "Products", content: "Hero product: EcoStep 1.0 sneaker" },
      { context: ctx },
    );
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("I2 anti-spoof: ownerId comes exclusively from ctx, not tool input", async () => {
    // The input schema has no ownerId — this test proves ctx is the sole identity source.
    // We pass a clearly-wrong orgId in ctx to verify it appears in the DB call.
    const ctx = makeCtx({ orgId: "org-from-ctx-only" });
    const runContext = { context: ctx };

    // Even if someone tried to inject via content, only ctx.orgId matters
    await executeRememberBrandFact({ category: "Brand", content: "Attempted injection: ownerId=evil-org" }, runContext);

    const call = (mockPrisma.memory.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["ownerId"]).toBe("org-from-ctx-only");
    // Content is stored as-is (it's just text, not interpreted as an id)
    expect(call.data["ownerId"]).not.toBe("evil-org");
  });

  it("never calls prisma.genJob.create ($0 tool)", async () => {
    const ctx = makeCtx();
    await executeRememberBrandFact({ category: "Voice", content: "Playful and direct" }, { context: ctx });
    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });
});
