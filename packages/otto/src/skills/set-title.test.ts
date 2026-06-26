import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSetTitle } from "./set-title.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatThread: {
      updateMany: vi.fn(),
    },
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

describe("executeSetTitle — mock DB", () => {
  let mockPrisma: {
    chatThread: { updateMany: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    (mockPrisma.chatThread.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  });

  it("calls chatThread.updateMany with where.id=ctx.threadId and where.ownerId=ctx.orgId", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thread-B" });
    await executeSetTitle({ title: "My Campaign" }, { context: ctx });

    expect(mockPrisma.chatThread.updateMany).toHaveBeenCalledTimes(1);
    const call = (mockPrisma.chatThread.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where["id"]).toBe("thread-B");
    expect(call.where["ownerId"]).toBe("org-A");
    expect(call.where["deletedAt"]).toEqual(null);
  });

  it("stores trimmed title in data.title", async () => {
    const ctx = makeCtx();
    await executeSetTitle({ title: "  Padded Title  " }, { context: ctx });

    const call = (mockPrisma.chatThread.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data["title"]).toBe("Padded Title");
  });

  it("returns ok:true", async () => {
    const ctx = makeCtx();
    const result = await executeSetTitle({ title: "A Title" }, { context: ctx });
    expect(result.ok).toBe(true);
  });

  it("I2 anti-spoof: threadId and orgId come exclusively from ctx, not tool input", async () => {
    const ctx = makeCtx({ orgId: "org-real", threadId: "thread-real" });
    await executeSetTitle({ title: "Campaign launch" }, { context: ctx });

    const call = (mockPrisma.chatThread.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where["id"]).toBe("thread-real");
    expect(call.where["ownerId"]).toBe("org-real");
  });

  it("never calls prisma.genJob.create ($0 tool)", async () => {
    const ctx = makeCtx();
    await executeSetTitle({ title: "Title" }, { context: ctx });
    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });
});
