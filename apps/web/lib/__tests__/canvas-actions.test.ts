import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst, mockThreadFindFirst } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindFirst: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany },
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findFirst: mockThreadFindFirst },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "node-1" }));

import { listCanvasNodes, moveCanvasNode, createCanvasNode } from "../canvas-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
});

describe("listCanvasNodes", () => {
  it("scopes by ownerId + projectId", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([]);
    await listCanvasNodes("p1");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "u1", projectId: "p1" } }),
    );
  });
  it("rejects when the project is not owned", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await listCanvasNodes("pX")).toEqual({ error: "Project not found." });
  });
});

describe("moveCanvasNode", () => {
  it("updates only the owner's node (updateMany with ownerId in where)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await moveCanvasNode("node-1", { x: 1, y: 2, w: 3, h: 4 });
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "node-1", ownerId: "u1" } }),
    );
  });
});

describe("createCanvasNode attribution", () => {
  beforeEach(() => mockProjectFindFirst.mockResolvedValue({ id: "p1" }));

  it("stamps threadId when the thread is in the same owner+project", async () => {
    mockThreadFindFirst.mockResolvedValue({ id: "t1" });
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, threadId: "t1" });
    expect(mockThreadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1", ownerId: "u1", projectId: "p1", deletedAt: null } }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: "t1" }) }),
    );
  });

  it("clears threadId (null) when the thread is not in this owner+project", async () => {
    mockThreadFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, threadId: "t-other" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) }),
    );
  });

  it("stores null threadId when none is provided (no thread lookup)", async () => {
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "text", x: 0, y: 0, w: 1, h: 1 });
    expect(mockThreadFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) }),
    );
  });
});

describe("listCanvasNodes selects threadId", () => {
  it("includes threadId in the select", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([]);
    await listCanvasNodes("p1");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ threadId: true }) }),
    );
  });
});
