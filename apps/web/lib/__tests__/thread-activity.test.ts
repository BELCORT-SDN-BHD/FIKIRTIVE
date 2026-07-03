import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockProjectFindFirst, mockThreadFindMany, mockGenJobFindMany, mockNodeFindMany } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindMany: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockNodeFindMany: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findMany: mockThreadFindMany },
    genJob: { findMany: mockGenJobFindMany },
    canvasNode: { findMany: mockNodeFindMany },
  },
}));

import { listProjectThreadActivity } from "../thread-activity";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
});

describe("listProjectThreadActivity", () => {
  it("rejects when the project is not owned", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await listProjectThreadActivity("pX")).toEqual({ error: "Project not found." });
  });

  it("marks threads pending from an in-flight GenJob or a pending CanvasNode without a linked job", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockThreadFindMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
    mockGenJobFindMany.mockResolvedValue([{ id: "j1", threadId: "t1" }]);
    mockNodeFindMany.mockResolvedValue([{ threadId: "t2", genJobId: null }]);
    const res = await listProjectThreadActivity("p1");
    expect(res).toEqual([
      { threadId: "t1", pending: true },
      { threadId: "t2", pending: true },
      { threadId: "t3", pending: false },
    ]);
  });

  it("does not mark a thread pending from a stale pending CanvasNode linked to a settled job", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockThreadFindMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    mockGenJobFindMany.mockResolvedValue([{ id: "j-live", threadId: "t1" }]);
    mockNodeFindMany.mockResolvedValue([
      { threadId: "t1", genJobId: "j-live" },
      { threadId: "t2", genJobId: "j-done" },
    ]);
    const res = await listProjectThreadActivity("p1");
    expect(res).toEqual([
      { threadId: "t1", pending: true },
      { threadId: "t2", pending: false },
    ]);
  });

  it("scopes GenJob query to owner+project and in-flight statuses", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockThreadFindMany.mockResolvedValue([]);
    mockGenJobFindMany.mockResolvedValue([]);
    mockNodeFindMany.mockResolvedValue([]);
    await listProjectThreadActivity("p1");
    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", projectId: "p1", status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
        select: { id: true, threadId: true },
      }),
    );
    expect(mockNodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", projectId: "p1", status: "pending", threadId: { not: null } },
        select: { threadId: true, genJobId: true },
      }),
    );
  });
});
