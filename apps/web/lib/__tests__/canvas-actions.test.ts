import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst, mockThreadFindFirst, mockGenerationFindFirst, mockCanvasNodeFindFirst, mockGenJobFindFirst, mockGenJobFindMany, mockGetGenerationThumbs } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindFirst: vi.fn(),
  mockGenerationFindFirst: vi.fn(),
  mockCanvasNodeFindFirst: vi.fn(),
  mockGenJobFindFirst: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockGetGenerationThumbs: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({ getGenerationThumbs: mockGetGenerationThumbs }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany, findFirst: mockCanvasNodeFindFirst },
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findFirst: mockThreadFindFirst },
    generation: { findFirst: mockGenerationFindFirst },
    genJob: { findFirst: mockGenJobFindFirst, findMany: mockGenJobFindMany },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "node-1" }));

import { listCanvasNodes, moveCanvasNode, createCanvasNode, resolveCanvasNode } from "../canvas-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockGenJobFindMany.mockResolvedValue([]);
  mockGetGenerationThumbs.mockResolvedValue({});
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
  it("recovers DONE job media from genJobId when the canvas row is stale", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([
      {
        id: "node-1",
        type: "image",
        x: 0,
        y: 0,
        w: 320,
        h: 320,
        text: null,
        prompt: "late image",
        generationId: null,
        genJobId: "job-1",
        status: "timeout",
        sourceNodeId: null,
        threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([{ id: "job-1", status: "DONE", generationIds: ["gen-1"] }]);
    mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/hash.png", kind: "image" } });

    await expect(listCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({
        id: "node-1",
        generationId: "gen-1",
        status: "done",
        url: "/files/u1/hash.png",
      }),
    ]);
    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["job-1"] }, ownerId: "u1", projectId: "p1" } }),
    );
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

describe("createCanvasNode attribution — generationId/genJobId/sourceNodeId owner-scoped", () => {
  beforeEach(() => mockProjectFindFirst.mockResolvedValue({ id: "p1" }));

  it("nulls a generationId the caller does not own", async () => {
    mockGenerationFindFirst.mockResolvedValue(null); // not owned
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, generationId: "g-foreign" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ generationId: null }) }),
    );
  });

  it("keeps generationId when the caller owns it", async () => {
    mockGenerationFindFirst.mockResolvedValue({ id: "g-mine" });
    mockCreate.mockResolvedValue({ id: "node-1" });
    await createCanvasNode({ projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1, generationId: "g-mine" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ generationId: "g-mine" }) }),
    );
  });
});

describe("resolveCanvasNode", () => {
  it("persists a resolved generation only for the owner's node and same project", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockGenerationFindFirst.mockResolvedValue({ id: "g1" });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(resolveCanvasNode("node-1", { status: "done", generationId: "g1" })).resolves.toEqual({ ok: true });

    expect(mockCanvasNodeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-1", ownerId: "u1", type: { in: ["image", "video"] } },
        select: { id: true, projectId: true },
      }),
    );
    expect(mockGenerationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1", projectId: "p1", deletedAt: null },
        select: { id: true },
      }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "node-1", ownerId: "u1" }, data: { status: "done", generationId: "g1" } }),
    );
  });

  it("does not attach a generation from another project", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockGenerationFindFirst.mockResolvedValue(null);

    await expect(resolveCanvasNode("node-1", { status: "done", generationId: "g-foreign" })).resolves.toEqual({ error: "Generation not found." });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("persists terminal failure status without requiring a generation", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(resolveCanvasNode("node-1", { status: "failed" })).resolves.toEqual({ ok: true });

    expect(mockGenerationFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed", generationId: null } }),
    );
  });

  it("rejects unknown resolve statuses", async () => {
    await expect(resolveCanvasNode("node-1", { status: "weird" })).resolves.toEqual({ error: "Invalid status." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("requires a generation when marking a node done", async () => {
    await expect(resolveCanvasNode("node-1", { status: "done" })).resolves.toEqual({ error: "Generation required." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not attach a generation to non-done status", async () => {
    await expect(resolveCanvasNode("node-1", { status: "failed", generationId: "g1" })).resolves.toEqual({ error: "Generation only allowed for done status." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
