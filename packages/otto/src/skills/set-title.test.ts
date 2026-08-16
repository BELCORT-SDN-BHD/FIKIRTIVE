import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSetTitle } from "./set-title.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db
//
// #952 item 13 — executeSetTitle no longer calls prisma.chatThread.updateMany directly; it
// delegates to the shared renameChatThread (packages/db/src/chat-thread-rename.ts), the same
// function the human-facing coworkRenameThread action calls. Mocked at that seam instead.
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  renameChatThread: vi.fn(),
  prisma: {
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
  let mockRenameChatThread: ReturnType<typeof vi.fn>;
  let mockGenJobCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockRenameChatThread = db.renameChatThread as unknown as ReturnType<typeof vi.fn>;
    mockGenJobCreate = (db.prisma as unknown as { genJob: { create: ReturnType<typeof vi.fn> } }).genJob.create;
    mockRenameChatThread.mockResolvedValue({ count: 1 });
  });

  it("calls renameChatThread with threadId=ctx.threadId and ownerId=ctx.orgId", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thread-B" });
    await executeSetTitle({ title: "My Campaign" }, { context: ctx });

    expect(mockRenameChatThread).toHaveBeenCalledTimes(1);
    const call = mockRenameChatThread.mock.calls[0]![0] as Record<string, unknown>;
    expect(call["threadId"]).toBe("thread-B");
    expect(call["ownerId"]).toBe("org-A");
  });

  it("stores trimmed title", async () => {
    const ctx = makeCtx();
    await executeSetTitle({ title: "  Padded Title  " }, { context: ctx });

    const call = mockRenameChatThread.mock.calls[0]![0] as Record<string, unknown>;
    expect(call["title"]).toBe("Padded Title");
  });

  it("returns ok:true", async () => {
    const ctx = makeCtx();
    const result = await executeSetTitle({ title: "A Title" }, { context: ctx });
    expect(result.ok).toBe(true);
  });

  it("I2 anti-spoof: threadId and orgId come exclusively from ctx, not tool input", async () => {
    const ctx = makeCtx({ orgId: "org-real", threadId: "thread-real" });
    await executeSetTitle({ title: "Campaign launch" }, { context: ctx });

    const call = mockRenameChatThread.mock.calls[0]![0] as Record<string, unknown>;
    expect(call["threadId"]).toBe("thread-real");
    expect(call["ownerId"]).toBe("org-real");
  });

  it("never calls prisma.genJob.create ($0 tool)", async () => {
    const ctx = makeCtx();
    await executeSetTitle({ title: "Title" }, { context: ctx });
    expect(mockGenJobCreate).not.toHaveBeenCalled();
  });
});
