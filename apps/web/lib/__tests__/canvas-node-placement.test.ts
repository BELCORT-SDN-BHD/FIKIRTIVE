import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  jobFindFirst: vi.fn(),
  threadFindFirst: vi.fn(),
  nodeFindFirst: vi.fn(),
  nodeFindMany: vi.fn(),
  nodeCreate: vi.fn(),
  nodeUpdate: vi.fn(),
  nodeUpdateMany: vi.fn(),
  newId: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/core", () => ({ newId: mocks.newId }));
vi.mock("@fikirtive/db", () => {
  const tx = {
    $executeRaw: mocks.executeRaw,
    genJob: { findFirst: mocks.jobFindFirst },
    chatThread: { findFirst: mocks.threadFindFirst },
    canvasNode: {
      findFirst: mocks.nodeFindFirst,
      findMany: mocks.nodeFindMany,
      create: mocks.nodeCreate,
      update: mocks.nodeUpdate,
      updateMany: mocks.nodeUpdateMany,
    },
  };
  return {
    prisma: {
      $transaction: mocks.transaction.mockImplementation(
        async (callback: (client: typeof tx) => unknown) => callback(tx),
      ),
    },
  };
});

const {
  canvasJobPlacementLockKey,
  placeCanvasJobNode,
  tombstoneCanvasNode,
} = await import("../canvas-node-placement");

const base = {
  ownerId: "owner-1",
  projectId: "project-1",
  genJobId: "job-1",
  type: "image" as const,
  x: 10,
  y: 20,
  w: 320,
  h: 320,
  prompt: "product hero",
  status: "pending",
  threadId: "thread-1",
};

const saved = {
  id: "node-1",
  type: "image",
  x: 10,
  y: 20,
  w: 320,
  h: 320,
  text: null,
  prompt: "product hero",
  generationId: null,
  genJobId: "job-1",
  status: "pending",
  sourceNodeId: null,
  threadId: "thread-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockReset();
  mocks.jobFindFirst.mockReset();
  mocks.threadFindFirst.mockReset();
  mocks.nodeFindFirst.mockReset();
  mocks.nodeFindMany.mockReset();
  mocks.nodeCreate.mockReset();
  mocks.nodeUpdate.mockReset();
  mocks.nodeUpdateMany.mockReset();
  mocks.newId.mockReset();
  mocks.executeRaw.mockResolvedValue(0);
  mocks.jobFindFirst.mockResolvedValue({
    id: "job-1",
    generationIds: [],
    sourceGenerationId: null,
    threadId: "thread-1",
  });
  mocks.threadFindFirst.mockResolvedValue({ id: "thread-1" });
  mocks.nodeFindFirst.mockResolvedValue(null);
  mocks.nodeFindMany.mockResolvedValue([]);
  mocks.nodeCreate.mockResolvedValue(saved);
  mocks.nodeUpdate.mockImplementation(async ({ where, data }) => ({ ...saved, id: where.id, ...data }));
  mocks.nodeUpdateMany.mockResolvedValue({ count: 1 });
  mocks.newId.mockReturnValue("node-1");
});

describe("placeCanvasJobNode", () => {
  it("uses one job-wide lock key for primary and sibling placement", () => {
    expect(canvasJobPlacementLockKey("o", "p", "j")).toBe("canvas-job-placement:o:p:j");
  });

  it("creates one owner/project/job-scoped primary placement", async () => {
    await expect(placeCanvasJobNode(base)).resolves.toEqual({ inserted: true, node: saved });

    expect(mocks.jobFindFirst).toHaveBeenCalledWith({
      where: { id: "job-1", ownerId: "owner-1", projectId: "project-1" },
      select: { id: true, generationIds: true, sourceGenerationId: true, threadId: true },
    });
    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "owner-1",
        projectId: "project-1",
        genJobId: "job-1",
        generationId: null,
        threadId: "thread-1",
      }),
    }));
  });

  it("reuses the earliest job node after a lost primary create response", async () => {
    mocks.nodeFindFirst.mockResolvedValue(saved);

    await expect(placeCanvasJobNode(base)).resolves.toEqual({ inserted: false, node: saved });
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("resolves the existing primary instead of duplicating the first output", async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: "job-1", generationIds: ["gen-1", "gen-2"], sourceGenerationId: null, threadId: "thread-1" });
    mocks.nodeFindFirst.mockResolvedValue(saved);
    const resolved = { ...saved, generationId: "gen-1", status: "done" };
    mocks.nodeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.nodeFindFirst.mockResolvedValueOnce(saved).mockResolvedValue(resolved);

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-1", status: "done" }))
      .resolves.toEqual({ inserted: false, node: resolved });

    // The write carries the tombstone rule in its own WHERE (#602 r2, judge P2): a card the
    // merchant deleted between the read and this write must not be resurrected.
    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "owner-1", projectId: "project-1", status: { not: "deleted" } },
      data: { generationId: "gen-1", status: "done" },
    });
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("reuses a sibling by the same job and generation identity", async () => {
    const sibling = {
      ...saved,
      id: "node-2",
      generationId: "gen-2",
      sourceNodeId: "node-primary",
      status: "done",
    };
    mocks.jobFindFirst.mockResolvedValue({ id: "job-1", generationIds: ["gen-1", "gen-2"], sourceGenerationId: null, threadId: "thread-1" });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(sibling)
      .mockResolvedValueOnce({ id: "node-primary", generationId: "gen-1", genJobId: "job-1" });

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-2", status: "done" }))
      .resolves.toEqual({ inserted: false, node: sibling });

    expect(mocks.nodeFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerId: "owner-1",
        projectId: "project-1",
        genJobId: "job-1",
        status: { not: "deleted" },
        generationId: "gen-2",
      },
    }));
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("rejects a same-project generation that is not an output of the job", async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: "job-1", generationIds: ["gen-1"], sourceGenerationId: null, threadId: "thread-1" });

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-other" }))
      .resolves.toEqual({ error: "Generation does not belong to that job." });

    expect(mocks.nodeFindFirst).not.toHaveBeenCalled();
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("rejects a same-project source node that does not match the job source", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: [],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "node-correct-source" });

    await expect(placeCanvasJobNode({ ...base, sourceNodeId: "node-wrong-source" }))
      .resolves.toEqual({ error: "Source node does not match that job." });

    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("allows a base-job sibling to point to that job's primary node", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-1", "gen-2"],
      sourceGenerationId: null,
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "node-primary", generationId: "gen-1", genJobId: "job-1" });
    mocks.nodeCreate.mockResolvedValue({
      ...saved,
      id: "node-sibling",
      generationId: "gen-2",
      sourceNodeId: "node-primary",
      status: "done",
    });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-2",
      sourceNodeId: "node-primary",
      status: "done",
    })).resolves.toMatchObject({ inserted: true, node: { sourceNodeId: "node-primary" } });

    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceNodeId: "node-primary" }),
    }));
  });

  it("rejects client thread attribution that differs from the job", async () => {
    mocks.nodeFindFirst.mockResolvedValue(saved);

    await expect(placeCanvasJobNode({ ...base, threadId: "thread-other" }))
      .resolves.toEqual({ error: "Thread does not belong to that job." });

    expect(mocks.threadFindFirst).not.toHaveBeenCalled();
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("accepts the exact selected source when another valid card for that generation is older", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "node-selected-source",
        generationId: "gen-source",
        genJobId: "source-job",
      });
    mocks.nodeCreate.mockResolvedValue({
      ...saved,
      generationId: "gen-out",
      sourceNodeId: "node-selected-source",
      status: "done",
    });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-out",
      sourceNodeId: "node-selected-source",
      status: "done",
    })).resolves.toMatchObject({
      inserted: true,
      node: { sourceNodeId: "node-selected-source" },
    });

    expect(mocks.nodeFindFirst).toHaveBeenNthCalledWith(3, {
      where: { id: "node-selected-source", ownerId: "owner-1", projectId: "project-1" },
      select: { id: true, generationId: true, genJobId: true },
    });
  });

  it("accepts a selected source whose node repair is racing its completed owner-scoped job", async () => {
    mocks.jobFindFirst
      .mockResolvedValueOnce({
        id: "job-1",
        generationIds: ["gen-out"],
        sourceGenerationId: "gen-source",
        threadId: "thread-1",
      })
      .mockResolvedValueOnce({ generationIds: ["gen-source"] });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "node-racing-source",
        generationId: null,
        genJobId: "source-job",
      });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-out",
      sourceNodeId: "node-racing-source",
      status: "done",
    })).resolves.toMatchObject({ inserted: true });

    expect(mocks.jobFindFirst).toHaveBeenNthCalledWith(2, {
      where: { id: "source-job", ownerId: "owner-1", projectId: "project-1" },
      select: { generationIds: true },
    });
  });

  it("resolves a pending primary and backfills canonical source and thread attribution", async () => {
    const pending = { ...saved, threadId: null };
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    const resolved = { ...pending, generationId: "gen-out", sourceNodeId: "node-source", threadId: "thread-1", status: "done" };
    mocks.nodeFindFirst
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        id: "node-source",
        generationId: "gen-source",
        genJobId: "source-job",
      })
      // …and the re-read after the guarded write.
      .mockResolvedValueOnce(resolved);
    mocks.nodeUpdateMany.mockResolvedValue({ count: 1 });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-out",
      sourceNodeId: "node-source",
      status: "done",
    })).resolves.toMatchObject({
      inserted: false,
      node: {
        generationId: "gen-out",
        sourceNodeId: "node-source",
        threadId: "thread-1",
        status: "done",
      },
    });

    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "owner-1", projectId: "project-1", status: { not: "deleted" } },
      data: {
        generationId: "gen-out",
        status: "done",
        sourceNodeId: "node-source",
        threadId: "thread-1",
      },
    });
  });

  it("refuses to resurrect a card tombstoned between the read and the write (#602 r2, judge P2)", () => {
    // The guard lives in the WHERE, so the write itself matches nothing once the merchant has
    // deleted the card — and a deletion is a durable owner instruction, not a lost update.
    const pending = { ...saved, threadId: null };
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1", generationIds: ["gen-out"], sourceGenerationId: null, threadId: "thread-1",
    });
    mocks.nodeFindFirst.mockResolvedValueOnce(pending);
    mocks.nodeUpdateMany.mockResolvedValue({ count: 0 }); // the tombstone won

    return expect(placeCanvasJobNode({ ...base, generationId: "gen-out", status: "done" }))
      .resolves.toEqual({ suppressed: true, scope: "generation" });
  });

  it("does not let an existing placement bypass a mismatched source replay", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce({
        ...saved,
        generationId: "gen-out",
        sourceNodeId: "node-source",
        status: "done",
      })
      .mockResolvedValueOnce({
        id: "node-wrong-source",
        generationId: "gen-other",
        genJobId: "other-job",
      });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-out",
      sourceNodeId: "node-wrong-source",
      status: "done",
    })).resolves.toEqual({ error: "Source node does not match that job." });

    expect(mocks.nodeUpdate).not.toHaveBeenCalled();
  });

  it("suppresses every later placement after an in-flight job anchor is deleted", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-1", "gen-2"],
      sourceGenerationId: null,
      threadId: "thread-1",
    });
    mocks.nodeFindMany.mockResolvedValue([{ generationId: null }]);

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-2", status: "done" }))
      .resolves.toEqual({ suppressed: true, scope: "job" });
    expect(mocks.nodeFindFirst).not.toHaveBeenCalled();
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
    expect(mocks.nodeUpdate).not.toHaveBeenCalled();
  });

  it("suppresses only the explicitly deleted settled generation", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-1", "gen-2"],
      sourceGenerationId: null,
      threadId: "thread-1",
    });
    mocks.nodeFindMany.mockResolvedValue([{ generationId: "gen-2" }]);

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-2", status: "done" }))
      .resolves.toEqual({ suppressed: true, scope: "generation" });

    mocks.nodeFindFirst.mockResolvedValue(null);
    mocks.nodeCreate.mockResolvedValue({ ...saved, generationId: "gen-1", status: "done" });
    await expect(placeCanvasJobNode({ ...base, generationId: "gen-1", status: "done" }))
      .resolves.toMatchObject({ inserted: true, node: { generationId: "gen-1" } });
  });
});

describe("tombstoneCanvasNode", () => {
  it("uses the job placement lock and preserves an in-flight job-wide marker", async () => {
    mocks.nodeFindFirst.mockResolvedValue({ id: "node-1", genJobId: "job-1", generationId: null });

    await expect(tombstoneCanvasNode("owner-1", "project-1", "node-1")).resolves.toBe(true);

    expect(mocks.executeRaw.mock.calls[0]).toEqual(expect.arrayContaining([
      "canvas-job-placement:owner-1:project-1:job-1",
    ]));
    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "node-1",
        ownerId: "owner-1",
        projectId: "project-1",
        status: { not: "deleted" },
      },
      data: { status: "deleted", generationId: null },
    });
  });

  it("keeps a settled tombstone generation-specific", async () => {
    mocks.nodeFindFirst.mockResolvedValue({ id: "node-2", genJobId: "job-1", generationId: "gen-2" });

    await expect(tombstoneCanvasNode("owner-1", "project-1", "node-2")).resolves.toBe(true);
    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "deleted" },
    }));
  });
});
