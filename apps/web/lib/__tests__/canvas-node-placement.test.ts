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
    // #549: the board-wide placement lock. Real string, mocked module — the key's shape is the
    // thing every placement writer must agree on, so it is not re-invented here.
    canvasBoardPlacementLockKey: (ownerId: string, projectId: string) =>
      `canvas-board-placement:${ownerId}:${projectId}`,
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
  batchIndex: null,
  batchSize: null,
  layoutAnchorNodeId: null,
  madeFromNodeId: null,
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
        // An in-flight anchor carries no output yet, so it has no position in the batch — and
        // "not known" is written as null rather than assumed to be the first (#603 T4).
        batchIndex: null,
        layoutAnchorNodeId: null,
        madeFromNodeId: null,
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
      // Binding the anchor to its first output is also what tells it where in the batch it sits.
      data: { generationId: "gen-1", status: "done", batchIndex: 0, batchSize: 2 },
    });
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("reuses a sibling by the same job and generation identity", async () => {
    const sibling = {
      ...saved,
      id: "node-2",
      generationId: "gen-2",
      batchIndex: 1,
      batchSize: 2,
      layoutAnchorNodeId: "node-primary",
      status: "done",
    };
    mocks.jobFindFirst.mockResolvedValue({ id: "job-1", generationIds: ["gen-1", "gen-2"], sourceGenerationId: null, threadId: "thread-1" });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(sibling)
      .mockResolvedValueOnce({ id: "node-primary" });

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

  it("gives a plain batch's sibling a layout anchor and NO parentage (#603 T4)", async () => {
    // Four images out of one press. The sibling is laid out around the batch's anchor — and that
    // is all it is. This function used to DEMAND a "source" here and reject the write without
    // one, which is how a press became a family tree the merchant never created.
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-1", "gen-2"],
      sourceGenerationId: null,
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "node-anchor" });
    mocks.nodeCreate.mockResolvedValue({
      ...saved,
      id: "node-sibling",
      generationId: "gen-2",
      batchIndex: 1,
      batchSize: 2,
      layoutAnchorNodeId: "node-anchor",
      status: "done",
    });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-2",
      status: "done",
    })).resolves.toMatchObject({
      inserted: true,
      node: { layoutAnchorNodeId: "node-anchor", madeFromNodeId: null },
    });

    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        batchIndex: 1,
        batchSize: 2,
        layoutAnchorNodeId: "node-anchor",
        madeFromNodeId: null,
      }),
    }));
  });

  it("gives every card of an EDITED batch the same recorded parent", async () => {
    // The job WAS conditioned on an earlier output, so its parent is the job's, and the whole
    // batch shares it. The browser is not asked and cannot say otherwise.
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-1", "gen-2"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "node-source" })
      .mockResolvedValueOnce({ id: "node-anchor" });
    mocks.nodeCreate.mockResolvedValue({ ...saved, id: "node-sibling", generationId: "gen-2" });

    await placeCanvasJobNode({ ...base, generationId: "gen-2", status: "done" });

    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        batchIndex: 1,
        batchSize: 2,
        layoutAnchorNodeId: "node-anchor",
        madeFromNodeId: "node-source",
      }),
    }));
  });

  it("rejects client thread attribution that differs from the job", async () => {
    mocks.nodeFindFirst.mockResolvedValue(saved);

    await expect(placeCanvasJobNode({ ...base, threadId: "thread-other" }))
      .resolves.toEqual({ error: "Thread does not belong to that job." });

    expect(mocks.threadFindFirst).not.toHaveBeenCalled();
    expect(mocks.nodeCreate).not.toHaveBeenCalled();
  });

  it("resolves the parent card itself, from the job's own record", async () => {
    // The browser no longer names it. Two cards can carry the same output; the oldest one is the
    // parent, chosen by the server so no caller can point the line somewhere else (#603 T4).
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst
      // The anchor lookup and its fallback both come up empty; the third read is the parent.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "node-oldest-source" });
    mocks.nodeCreate.mockResolvedValue({ ...saved, generationId: "gen-out", status: "done" });

    await placeCanvasJobNode({ ...base, generationId: "gen-out", status: "done" });

    expect(mocks.nodeFindFirst).toHaveBeenNthCalledWith(3, {
      where: { ownerId: "owner-1", projectId: "project-1", generationId: "gen-source" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ madeFromNodeId: "node-oldest-source", batchIndex: 0, batchSize: 1 }),
    }));
  });

  it("says nothing rather than guessing when the parent has no card yet", async () => {
    // The browser can see a generation finish before its card is repaired. A missing line for a
    // moment is honest; the settlement fills it in when the card exists.
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    mocks.nodeFindFirst.mockResolvedValue(null);
    mocks.nodeCreate.mockResolvedValue({ ...saved, generationId: "gen-out", status: "done" });

    await placeCanvasJobNode({ ...base, generationId: "gen-out", status: "done" });

    expect(mocks.nodeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ madeFromNodeId: null }),
    }));
  });

  it("resolves a pending primary and backfills its batch identity, parent and thread", async () => {
    const pending = { ...saved, threadId: null };
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    const resolved = {
      ...pending,
      generationId: "gen-out",
      batchIndex: 0,
      batchSize: 1,
      madeFromNodeId: "node-source",
      threadId: "thread-1",
      status: "done",
    };
    mocks.nodeFindFirst
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ id: "node-source" })
      // …and the re-read after the guarded write.
      .mockResolvedValueOnce(resolved);
    mocks.nodeUpdateMany.mockResolvedValue({ count: 1 });

    await expect(placeCanvasJobNode({
      ...base,
      generationId: "gen-out",
      status: "done",
    })).resolves.toMatchObject({
      inserted: false,
      node: {
        generationId: "gen-out",
        madeFromNodeId: "node-source",
        threadId: "thread-1",
        status: "done",
      },
    });

    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "owner-1", projectId: "project-1", status: { not: "deleted" } },
      data: {
        generationId: "gen-out",
        status: "done",
        // The anchor learns where it sits the moment the job names an output for it.
        batchIndex: 0,
        batchSize: 1,
        madeFromNodeId: "node-source",
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

  it("corrects a settled card whose recorded parent has drifted", async () => {
    // A replay cannot point the line anywhere the job did not: the parent is re-resolved from
    // the job's record and the row is brought back to it.
    mocks.jobFindFirst.mockResolvedValue({
      id: "job-1",
      generationIds: ["gen-out"],
      sourceGenerationId: "gen-source",
      threadId: "thread-1",
    });
    const settled = {
      ...saved,
      generationId: "gen-out",
      batchIndex: 0,
      batchSize: 1,
      madeFromNodeId: "node-stale",
      status: "done",
    };
    mocks.nodeFindFirst
      .mockResolvedValueOnce(settled)
      .mockResolvedValueOnce({ id: "node-source" })
      .mockResolvedValueOnce({ ...settled, madeFromNodeId: "node-source" });
    mocks.nodeUpdateMany.mockResolvedValue({ count: 1 });

    await expect(placeCanvasJobNode({ ...base, generationId: "gen-out", status: "done" }))
      .resolves.toMatchObject({ inserted: false, node: { madeFromNodeId: "node-source" } });

    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith({
      where: { id: "node-1", ownerId: "owner-1", projectId: "project-1", status: { not: "deleted" } },
      data: { madeFromNodeId: "node-source" },
    });
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
