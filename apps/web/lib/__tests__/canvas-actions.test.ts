import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst, mockThreadFindFirst, mockGenerationFindFirst, mockCanvasNodeFindFirst, mockGenJobFindFirst, mockGenJobFindMany, mockGetGenerationThumbs, mockNewId, mockPlaceCanvasJobNode, mockTombstoneCanvasNode } = vi.hoisted(() => ({
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
  mockNewId: vi.fn(),
  mockPlaceCanvasJobNode: vi.fn(),
  mockTombstoneCanvasNode: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({ getGenerationThumbs: mockGetGenerationThumbs }));
vi.mock("../canvas-node-placement", () => ({
  placeCanvasJobNode: mockPlaceCanvasJobNode,
  tombstoneCanvasNode: mockTombstoneCanvasNode,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany, findFirst: mockCanvasNodeFindFirst },
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findFirst: mockThreadFindFirst },
    generation: { findFirst: mockGenerationFindFirst },
    genJob: { findFirst: mockGenJobFindFirst, findMany: mockGenJobFindMany },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: mockNewId }));

import { createCanvasNode, deleteCanvasNode, listCanvasNodes, moveCanvasNode, resolveCanvasNode } from "../canvas-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockGenJobFindMany.mockResolvedValue([]);
  mockGetGenerationThumbs.mockResolvedValue({});
  mockNewId.mockReturnValue("node-1");
  mockPlaceCanvasJobNode.mockImplementation(async (input: {
    type: string; x: number; y: number; w: number; h: number; prompt?: string | null;
    generationId?: string | null; genJobId: string; status?: string;
    sourceNodeId?: string | null; threadId?: string | null;
  }) => ({
    inserted: true,
    node: {
      id: mockNewId(), type: input.type, x: input.x, y: input.y, w: input.w, h: input.h,
      text: null, prompt: input.prompt ?? null, generationId: input.generationId ?? null,
      genJobId: input.genJobId, status: input.status ?? "done",
      sourceNodeId: input.sourceNodeId ?? null, threadId: input.threadId ?? null,
    },
  }));
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockTombstoneCanvasNode.mockResolvedValue(true);
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
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "u1", projectId: "p1", status: "timeout", generationId: null },
      data: { status: "done", generationId: "gen-1" },
    });
  });

  it("recovers stale promptbar nodes from the first displayable job generation", async () => {
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
        prompt: "four variants",
        generationId: null,
        genJobId: "job-1",
        status: "pending",
        sourceNodeId: null,
        threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([{ id: "job-1", status: "DONE", generationIds: ["gen-missing", "gen-good"] }]);
    mockGetGenerationThumbs.mockResolvedValue({ "gen-good": { src: "/files/u1/good.jpeg", kind: "image" } });

    await expect(listCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({
        id: "node-1",
        generationId: "gen-good",
        status: "done",
        url: "/files/u1/good.jpeg",
      }),
    ]);
    expect(mockGetGenerationThumbs).toHaveBeenCalledWith("u1", expect.arrayContaining(["gen-missing", "gen-good"]));
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "u1", projectId: "p1", status: "pending", generationId: null },
      data: { status: "done", generationId: "gen-good" },
    });
  });

  it("recovers missing sibling nodes for a completed multi-variant canvas job", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockNewId
      .mockReturnValueOnce("node-sib-1")
      .mockReturnValueOnce("node-sib-2")
      .mockReturnValueOnce("node-sib-3");
    mockFindMany.mockResolvedValue([
      {
        id: "node-primary",
        type: "image",
        x: 100,
        y: 50,
        w: 320,
        h: 320,
        text: null,
        prompt: "four variants",
        generationId: null,
        genJobId: "job-1",
        status: "pending",
        sourceNodeId: null,
        threadId: "thread-1",
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([
      { id: "job-1", status: "DONE", generationIds: ["gen-1", "gen-2", "gen-3", "gen-4"] },
    ]);
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.jpeg", kind: "image" },
      "gen-2": { src: "/files/u1/two.jpeg", kind: "image" },
      "gen-3": { src: "/files/u1/three.jpeg", kind: "image" },
      "gen-4": { src: "/files/u1/four.jpeg", kind: "image" },
    });

    await expect(listCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({ id: "node-primary", generationId: "gen-1", status: "done", url: "/files/u1/one.jpeg" }),
      expect.objectContaining({ id: "node-sib-1", generationId: "gen-2", status: "done", url: "/files/u1/two.jpeg", x: 440, y: 50 }),
      expect.objectContaining({ id: "node-sib-2", generationId: "gen-3", status: "done", url: "/files/u1/three.jpeg", x: 100, y: 390 }),
      expect.objectContaining({ id: "node-sib-3", generationId: "gen-4", status: "done", url: "/files/u1/four.jpeg", x: 440, y: 390 }),
    ]);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-primary", ownerId: "u1", projectId: "p1", status: "pending", generationId: null },
      data: { status: "done", generationId: "gen-1" },
    });
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledTimes(3);
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(1, expect.objectContaining({
        ownerId: "u1",
        projectId: "p1",
        generationId: "gen-2",
        genJobId: "job-1",
        status: "done",
        threadId: "thread-1",
        x: 440,
        y: 50,
    }));
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(2, expect.objectContaining({ generationId: "gen-3", x: 100, y: 390 }));
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(3, expect.objectContaining({ generationId: "gen-4", x: 440, y: 390 }));
  });

  it("does not create duplicate siblings when another reload already claimed the primary repair", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindMany.mockResolvedValue([
      {
        id: "node-primary",
        type: "image",
        x: 100,
        y: 50,
        w: 320,
        h: 320,
        text: null,
        prompt: "four variants",
        generationId: null,
        genJobId: "job-1",
        status: "pending",
        sourceNodeId: null,
        threadId: "thread-1",
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([
      { id: "job-1", status: "DONE", generationIds: ["gen-1", "gen-2", "gen-3", "gen-4"] },
    ]);
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.jpeg", kind: "image" },
      "gen-2": { src: "/files/u1/two.jpeg", kind: "image" },
      "gen-3": { src: "/files/u1/three.jpeg", kind: "image" },
      "gen-4": { src: "/files/u1/four.jpeg", kind: "image" },
    });
    for (const [index, generationId] of ["gen-2", "gen-3", "gen-4"].entries()) {
      mockPlaceCanvasJobNode.mockResolvedValueOnce({
        inserted: false,
        node: {
          id: `node-existing-${index + 2}`,
          type: "image",
          x: index % 2 === 0 ? 440 : 100,
          y: index < 1 ? 50 : 390,
          w: 320,
          h: 320,
          text: null,
          prompt: "four variants",
          generationId,
          genJobId: "job-1",
          status: "done",
          sourceNodeId: "node-primary",
          threadId: "thread-1",
        },
      });
    }

    await expect(listCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({ id: "node-primary", generationId: "gen-1", status: "done", url: "/files/u1/one.jpeg" }),
      expect.objectContaining({ id: "node-existing-2", generationId: "gen-2", url: "/files/u1/two.jpeg" }),
      expect.objectContaining({ id: "node-existing-3", generationId: "gen-3", url: "/files/u1/three.jpeg" }),
      expect.objectContaining({ id: "node-existing-4", generationId: "gen-4", url: "/files/u1/four.jpeg" }),
    ]);
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledTimes(3);
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(1, expect.objectContaining({ generationId: "gen-2" }));
  });
});

describe("moveCanvasNode", () => {
  it("updates only the owner's node (updateMany with ownerId in where)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await moveCanvasNode("p1", "node-1", { x: 1, y: 2, w: 3, h: 4 });
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-1", ownerId: "u1", projectId: "p1", status: { not: "deleted" } },
      }),
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
    expect(mockGenerationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "g-mine", ownerId: "u1", projectId: "p1", deletedAt: null },
    }));
  });

  it("keeps sourceNodeId and genJobId only when they belong to the same owner+project", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "source-mine" });
    mockGenJobFindFirst.mockResolvedValue({ id: "job-mine" });
    mockCreate.mockResolvedValue({ id: "node-1" });

    await createCanvasNode({
      projectId: "p1", type: "video", x: 0, y: 0, w: 1, h: 1,
      sourceNodeId: "source-mine", genJobId: "job-mine",
    });

    expect(mockCanvasNodeFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "source-mine", ownerId: "u1", projectId: "p1" },
    }));
    expect(mockGenJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-mine", ownerId: "u1", projectId: "p1" },
    }));
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: "source-mine", genJobId: "job-mine",
    }));
  });

  it("reuses a paid job's primary node after a lost create response", async () => {
    mockGenJobFindFirst.mockResolvedValue({ id: "job-mine" });
    mockPlaceCanvasJobNode.mockResolvedValue({
      inserted: false,
      node: { id: "node-already-saved", x: 42, y: 43, w: 320, h: 320 },
    });

    await expect(createCanvasNode({
      projectId: "p1", type: "image", x: 0, y: 0, w: 1, h: 1,
      genJobId: "job-mine", status: "pending",
    })).resolves.toEqual({ id: "node-already-saved", x: 42, y: 43, w: 320, h: 320 });

    expect(mockPlaceCanvasJobNode).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "u1", projectId: "p1", genJobId: "job-mine", generationId: null,
    }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("deduplicates a settled sibling by job and generation identity", async () => {
    mockGenJobFindFirst.mockResolvedValue({ id: "job-mine" });
    mockGenerationFindFirst.mockResolvedValue({ id: "gen-2" });
    mockPlaceCanvasJobNode.mockResolvedValue({
      inserted: false,
      node: { id: "node-variant-2", x: 90, y: 20, w: 1, h: 1 },
    });

    await expect(createCanvasNode({
      projectId: "p1", type: "image", x: 20, y: 20, w: 1, h: 1,
      genJobId: "job-mine", generationId: "gen-2", status: "done",
    })).resolves.toEqual({ id: "node-variant-2", x: 90, y: 20, w: 1, h: 1 });

    expect(mockPlaceCanvasJobNode).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "u1", projectId: "p1", genJobId: "job-mine", generationId: "gen-2",
    }));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("resolveCanvasNode", () => {
  it("persists a resolved generation only for the owner's node and same project", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockGenerationFindFirst.mockResolvedValue({ id: "g1" });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(resolveCanvasNode("p1", "node-1", { status: "done", generationId: "g1" })).resolves.toEqual({ ok: true });

    expect(mockCanvasNodeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "node-1",
          ownerId: "u1",
          projectId: "p1",
          type: { in: ["image", "video"] },
          status: { not: "deleted" },
        },
        select: { id: true, projectId: true, genJobId: true },
      }),
    );
    expect(mockGenerationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1", projectId: "p1", deletedAt: null },
        select: { id: true },
      }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-1", ownerId: "u1", projectId: "p1", status: { not: "deleted" } },
        data: { status: "done", generationId: "g1" },
      }),
    );
  });

  it("does not resolve a paid job node to an unrelated same-project generation", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1", genJobId: "job-1" });
    mockGenerationFindFirst.mockResolvedValue({ id: "g-other" });
    mockGenJobFindFirst.mockResolvedValue({ generationIds: ["g-1", "g-2"] });

    await expect(resolveCanvasNode("p1", "node-1", { status: "done", generationId: "g-other" }))
      .resolves.toEqual({ error: "Generation does not belong to this canvas job." });

    expect(mockGenJobFindFirst).toHaveBeenCalledWith({
      where: { id: "job-1", ownerId: "u1", projectId: "p1" },
      select: { generationIds: true },
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not attach a generation from another project", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockGenerationFindFirst.mockResolvedValue(null);

    await expect(resolveCanvasNode("p1", "node-1", { status: "done", generationId: "g-foreign" })).resolves.toEqual({ error: "Generation not found." });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("persists terminal failure status without requiring a generation", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "node-1", projectId: "p1" });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(resolveCanvasNode("p1", "node-1", { status: "failed" })).resolves.toEqual({ ok: true });

    expect(mockGenerationFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed", generationId: null } }),
    );
  });

  it("rejects unknown resolve statuses", async () => {
    await expect(resolveCanvasNode("p1", "node-1", { status: "weird" })).resolves.toEqual({ error: "Invalid status." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("requires a generation when marking a node done", async () => {
    await expect(resolveCanvasNode("p1", "node-1", { status: "done" })).resolves.toEqual({ error: "Generation required." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not attach a generation to non-done status", async () => {
    await expect(resolveCanvasNode("p1", "node-1", { status: "failed", generationId: "g1" })).resolves.toEqual({ error: "Generation only allowed for done status." });
    expect(mockCanvasNodeFindFirst).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe("deleteCanvasNode", () => {
  it("writes a project-scoped tombstone instead of hard-deleting a recoverable result", async () => {
    await expect(deleteCanvasNode("p1", "node-1")).resolves.toEqual({ ok: true });

    expect(mockTombstoneCanvasNode).toHaveBeenCalledWith("u1", "p1", "node-1");
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
