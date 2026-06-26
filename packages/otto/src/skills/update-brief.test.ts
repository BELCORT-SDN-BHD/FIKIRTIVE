import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeUpdateBrief } from "./update-brief.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db so execute tests never hit a real DB.
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: {
      updateMany: vi.fn(),
    },
    // must NEVER be called — no GenJob creation in updateBrief
    genJob: {
      create: vi.fn(),
    },
  },
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

describe("executeUpdateBrief — mock DB", () => {
  let mockPrisma: {
    project: { updateMany: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  });

  it("calls project.updateMany with where.id=ctx.projectId and where.ownerId=ctx.orgId", async () => {
    const ctx = makeCtx({ orgId: "org-A", projectId: "proj-B" });
    const runContext = { context: ctx };

    await executeUpdateBrief({ brief: "Short and punchy brief" }, runContext);

    expect(mockPrisma.project.updateMany).toHaveBeenCalledTimes(1);
    const call = (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where["id"]).toBe("proj-B");
    expect(call.where["ownerId"]).toBe("org-A");
    expect(call.where["deletedAt"]).toEqual(null);
  });

  it("stores trimmed brief text in data.coworkBrief", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executeUpdateBrief({ brief: "  trim me  " }, runContext);

    const call = (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["coworkBrief"]).toBe("trim me");
  });

  it("returns ok:true when update count > 0", async () => {
    (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    const ctx = makeCtx();
    const result = await executeUpdateBrief({ brief: "A brief" }, { context: ctx });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when project not found (count=0)", async () => {
    (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const ctx = makeCtx();
    const result = await executeUpdateBrief({ brief: "A brief" }, { context: ctx });
    expect(result.ok).toBe(false);
  });

  it("I2 anti-spoof: projectId and orgId come exclusively from ctx, not tool input", async () => {
    // The input schema has no orgId/projectId — this test proves ctx is the sole source
    const ctx = makeCtx({ orgId: "org-real", projectId: "proj-real" });
    const runContext = { context: ctx };

    await executeUpdateBrief({ brief: "Some brief" }, runContext);

    const call = (mockPrisma.project.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where["id"]).toBe("proj-real");
    expect(call.where["ownerId"]).toBe("org-real");
  });

  it("never calls prisma.genJob.create ($0 tool)", async () => {
    const ctx = makeCtx();
    await executeUpdateBrief({ brief: "A brief" }, { context: ctx });
    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });
});
