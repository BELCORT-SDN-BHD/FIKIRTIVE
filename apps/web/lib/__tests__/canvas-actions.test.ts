import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSettleCanvasCards, mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst, mockThreadFindFirst, mockGenerationFindFirst, mockGenerationFindMany, mockCanvasNodeFindFirst, mockGenJobFindFirst, mockGenJobFindMany, mockLedgerFindMany, mockOrganizationFindFirst, mockGetGenerationThumbs, mockNewId, mockPlaceCanvasJobNode, mockTombstoneCanvasNode, mockTransaction, mockFreeCanvasRect } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockTransaction: vi.fn(),
  mockFreeCanvasRect: vi.fn(),
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockThreadFindFirst: vi.fn(),
  mockGenerationFindFirst: vi.fn(),
  mockGenerationFindMany: vi.fn(),
  mockCanvasNodeFindFirst: vi.fn(),
  mockGenJobFindFirst: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockLedgerFindMany: vi.fn(),
  mockOrganizationFindFirst: vi.fn(),
  mockGetGenerationThumbs: vi.fn(),
  mockNewId: vi.fn(),
  mockPlaceCanvasJobNode: vi.fn(),
  mockTombstoneCanvasNode: vi.fn(),
  mockSettleCanvasCards: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({ getGenerationThumbs: mockGetGenerationThumbs }));
vi.mock("../canvas-node-placement", () => ({
  // The one card-column list. Real value, mocked module: the board read must ask for the same
  // columns every other canvas surface asks for, and stubbing it would hide a divergence.
  CANVAS_NODE_SELECT: {
    id: true, type: true, x: true, y: true, w: true, h: true, text: true,
    prompt: true, generationId: true, genJobId: true, status: true,
    batchIndex: true, batchSize: true, layoutAnchorNodeId: true, madeFromNodeId: true,
    threadId: true,
  },
  placeCanvasJobNode: mockPlaceCanvasJobNode,
  tombstoneCanvasNode: mockTombstoneCanvasNode,
  // #549: every new card asks the board for a spot that is free. Stubbed to the identity here
  // so these cases keep testing attribution; the rule itself is proved in
  // canvas-node-placement.test.ts and canvas-overlap-placement.test.ts.
  freeCanvasRectForNewNode: mockFreeCanvasRect,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany, findFirst: mockCanvasNodeFindFirst },
    project: { findFirst: mockProjectFindFirst },
    chatThread: { findFirst: mockThreadFindFirst },
    generation: { findFirst: mockGenerationFindFirst, findMany: mockGenerationFindMany },
    genJob: { findFirst: mockGenJobFindFirst, findMany: mockGenJobFindMany },
    // #547 B4: the board read now also carries each card's lineage (time / settings / cost).
    creditLedger: { findMany: mockLedgerFindMany },
    organization: { findFirst: mockOrganizationFindFirst },
  },
  // #601 r2: the board read no longer repairs a delivered job itself — it calls the ONE
  // settlement the worker calls. Mocked here so these unit cases can prove the delegation.
  settleCanvasCardsForGenJob: mockSettleCanvasCards,
}));
// Only newId is stubbed. The credit conversion stays REAL: a test that hand-rolls
// internal→displayed would happily agree with a broken conversion (#547 B4 reads the ledger).
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: mockNewId,
}));

import { createCanvasNode, deleteCanvasNode, listCanvasNodes, moveCanvasNode, resolveCanvasNode } from "../canvas-actions";
import { normalizeFactoryMaterial } from "../batch-idempotency";

/** The EXACT blob a paid video job persists — built by the function startGen itself uses, so
 *  this fixture cannot drift into a shape production never writes (round-1 review P1-1). */
const STORED_VIDEO_OPTIONS = normalizeFactoryMaterial({
  prompt: "a cup steaming",
  model: "seedance-2-mini",
  kind: "video",
  count: 1,
  durationSeconds: 5,
  resolution: "720p",
  aspectRatio: "16:9",
}).videoOptions;

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockGenJobFindMany.mockResolvedValue([]);
  mockGenerationFindMany.mockResolvedValue([]);
  mockLedgerFindMany.mockResolvedValue([]);
  mockOrganizationFindFirst.mockResolvedValue({ settings: {} });
  mockSettleCanvasCards.mockResolvedValue({ status: "settled", nodeIds: [], created: 0, updated: 0 });
  mockGetGenerationThumbs.mockResolvedValue({});
  mockNewId.mockReturnValue("node-1");
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    canvasNode: { findMany: mockFindMany, create: mockCreate },
  }));
  mockFreeCanvasRect.mockImplementation(async (
    _tx: unknown,
    _ownerId: string,
    _projectId: string,
    requested: { x: number; y: number; w: number; h: number },
  ) => requested);
  mockPlaceCanvasJobNode.mockImplementation(async (input: {
    type: string; x: number; y: number; w: number; h: number; prompt?: string | null;
    generationId?: string | null; genJobId: string; status?: string;
    batchIndex?: number | null; batchSize?: number | null;
    layoutAnchorNodeId?: string | null; madeFromNodeId?: string | null; threadId?: string | null;
  }) => ({
    inserted: true,
    node: {
      id: mockNewId(), type: input.type, x: input.x, y: input.y, w: input.w, h: input.h,
      text: null, prompt: input.prompt ?? null, generationId: input.generationId ?? null,
      genJobId: input.genJobId, status: input.status ?? "done",
      batchIndex: input.batchIndex ?? null, batchSize: input.batchSize ?? null,
      layoutAnchorNodeId: input.layoutAnchorNodeId ?? null,
      madeFromNodeId: input.madeFromNodeId ?? null, threadId: input.threadId ?? null,
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

  it("carries each card's traceability record — time, settings, cost, batch (#547 B4)", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([
      {
        id: "node-1", type: "video", x: 0, y: 0, w: 320, h: 320, text: null,
        prompt: "a cup steaming", generationId: "gen-1", genJobId: "job-1",
        status: "done", batchIndex: 0, batchSize: 1,
        layoutAnchorNodeId: null, madeFromNodeId: "node-0", threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([
      {
        id: "job-1", status: "DONE", generationIds: ["gen-1"], idempotencyKey: null,
        // A video made FROM an image: the paid job recorded the generation it was conditioned
        // on. That, not the CanvasNode column, is what "Made from" is allowed to rely on.
        sourceGenerationId: "gen-0",
        videoOptions: STORED_VIDEO_OPTIONS,
        createdAt: new Date("2026-07-30T06:00:00Z"), finishedAt: new Date("2026-07-30T06:02:00Z"),
      },
    ]);
    mockGenerationFindMany.mockResolvedValue([
      { id: "gen-1", createdAt: new Date("2026-07-30T06:02:00Z"), source: "RENDER" },
    ]);
    // A settled video job: RESERVE holds 80 internal credits, SETTLE closes it at the same
    // amount (balanceDelta 0). Net charged = 80 internal = 8 displayed.
    mockLedgerFindMany.mockResolvedValue([
      { refId: "job-1", balanceDelta: -80 },
      { refId: "job-1", balanceDelta: 0 },
    ]);
    mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/h.mp4", kind: "video" } });

    const rows = await listCanvasNodes("p1");

    expect(Array.isArray(rows)).toBe(true);
    const card = (rows as Array<{ id: string; lineage?: unknown }>)[0]!;
    expect(card.lineage).toEqual({
      madeAtLabel: expect.stringMatching(/Jul 30/),
      settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" },
      costCredits: 8,
      batchSize: 1,
      batchPosition: 1,
    });
    // Owner-scoped, every table: a merchant can only ever read their own workspace's record.
    expect(mockLedgerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "u1", refId: { in: ["job-1"] } } }),
    );
    expect(mockGenerationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["gen-1"] }, ownerId: "u1", projectId: "p1", deletedAt: null },
      }),
    );
  });
  it("tells a batch's cards apart from a card made from another card (review P2-2)", async () => {
    // Two cards of ONE "make 2 images" press. The sibling records the batch anchor it was laid
    // out around, in the column that means exactly that — and neither was made FROM the other.
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([
      {
        id: "node-primary", type: "image", x: 0, y: 0, w: 320, h: 320, text: null,
        prompt: "two takes", generationId: "gen-1", genJobId: "job-1",
        status: "done", batchIndex: 0, batchSize: 2,
        layoutAnchorNodeId: null, madeFromNodeId: null, threadId: null,
      },
      {
        id: "node-sibling", type: "image", x: 340, y: 0, w: 320, h: 320, text: null,
        prompt: "two takes", generationId: "gen-2", genJobId: "job-1",
        status: "done", batchIndex: 1, batchSize: 2,
        layoutAnchorNodeId: "node-primary", madeFromNodeId: null, threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([
      {
        id: "job-1", status: "DONE", generationIds: ["gen-1", "gen-2"], idempotencyKey: null,
        sourceGenerationId: null, videoOptions: null,
        createdAt: new Date("2026-07-30T06:00:00Z"), finishedAt: new Date("2026-07-30T06:01:00Z"),
      },
    ]);
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.png", kind: "image" },
      "gen-2": { src: "/files/u1/two.png", kind: "image" },
    });

    const rows = await listCanvasNodes("p1") as Array<{
      id: string;
      madeFromNodeId: string | null;
      layoutAnchorNodeId: string | null;
      lineage: { batchSize: number; batchPosition: number | null } | null;
    }>;

    expect(rows.map((row) => row.madeFromNodeId)).toEqual([null, null]);
    expect(rows.map((row) => row.layoutAnchorNodeId)).toEqual([null, "node-primary"]);
    // What they ARE is same-batch cards, and the record still says which is which.
    expect(rows.map((row) => [row.lineage?.batchPosition, row.lineage?.batchSize])).toEqual([[1, 2], [2, 2]]);
  });

  /**
   * A card is the merchant's paid work; its record is a nicety. If the record lookup falls over
   * — the ledger read times out, the workspace row is briefly unreadable — the board must still
   * come back. Losing the whole canvas because a caption could not be looked up would read as
   * "my work is gone" for something that was never load-bearing.
   */
  describe("when the traceability lookup fails", () => {
    const board = [{
      id: "node-1", type: "image", x: 0, y: 0, w: 320, h: 320, text: null,
      prompt: "a cup steaming", generationId: "gen-1", genJobId: "job-1",
      status: "done", batchIndex: 0, batchSize: 1,
      layoutAnchorNodeId: null, madeFromNodeId: null, threadId: null,
    }];
    /** The board's OWN job read stays healthy; only the lineage-shaped one is broken. */
    const breakLineageJobRead = () => {
      mockGenJobFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
        if (args.select?.videoOptions) throw new Error("lineage job read failed");
        return [{ id: "job-1", status: "DONE", generationIds: ["gen-1"], idempotencyKey: null }];
      });
    };

    beforeEach(() => {
      mockProjectFindFirst.mockResolvedValue({ id: "p1" });
      mockFindMany.mockResolvedValue(board);
      mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/one.png", kind: "image" } });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    const cases: Array<[string, () => void]> = [
      ["the workspace row", () => mockOrganizationFindFirst.mockRejectedValue(new Error("organization read failed"))],
      ["the paid job", breakLineageJobRead],
      ["the generations", () => mockGenerationFindMany.mockRejectedValue(new Error("generation read failed"))],
      ["the credit ledger", () => mockLedgerFindMany.mockRejectedValue(new Error("ledger read failed"))],
    ];

    for (const [what, breakIt] of cases) {
      it(`still returns the cards when ${what} cannot be read`, async () => {
        breakIt();

        const rows = await listCanvasNodes("p1");

        expect(rows).toEqual([
          expect.objectContaining({ id: "node-1", url: "/files/u1/one.png", status: "done", lineage: null }),
        ]);
      });
    }
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
        batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
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
    // #613 T2d: the ROW is nobody's business here. What the merchant sees above is resolved for
    // display only; the row itself is written by the job's completion path and, if that fell over,
    // by the backfill sweep. Opening a board settles nothing and writes nothing.
    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
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
        batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
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
    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves a batch with missing cards alone — it places nothing and settles nothing", async () => {
    // The read path used to plan and place the missing siblings itself, with its own idea of where
    // they go and what they hang off. That second opinion is what made an open tab produce a
    // different board from a closed one (#601 r2 P2②). #601 T2b replaced it with a call to the ONE
    // settlement; #613 T2d removes even that — a board read is a read.
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
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
        batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
        threadId: "thread-1",
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([
      { id: "job-1", status: "DONE", generationIds: ["gen-1", "gen-2", "gen-3", "gen-4"] },
    ]);
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.jpeg", kind: "image" },
    });

    await listCanvasNodes("p1");

    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not ask the settlement for a job whose board already matches it either", async () => {
    // The board that needs nothing and the board that needs everything now cost the same: a read.
    mockProjectFindFirst.mockResolvedValue({ id: "p1" });
    mockFindMany.mockResolvedValue([
      {
        id: "node-1",
        type: "image", x: 0, y: 0, w: 320, h: 320, text: null, prompt: "one",
        generationId: "gen-1", genJobId: "job-1", status: "done",
        batchIndex: 0, batchSize: 1, layoutAnchorNodeId: null, madeFromNodeId: null, threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([{ id: "job-1", status: "DONE", generationIds: ["gen-1"] }]);
    mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/one.jpeg", kind: "image" } });

    await listCanvasNodes("p1");

    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
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

describe("createCanvasNode attribution — generationId/genJobId owner-scoped", () => {
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

  it("keeps genJobId only when it belongs to the same owner+project, and takes no source from the caller", async () => {
    mockGenJobFindFirst.mockResolvedValue({ id: "job-mine" });
    mockCreate.mockResolvedValue({ id: "node-1" });

    await createCanvasNode({
      projectId: "p1", type: "video", x: 0, y: 0, w: 1, h: 1,
      genJobId: "job-mine",
    });

    expect(mockGenJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-mine", ownerId: "u1", projectId: "p1" },
    }));
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledWith(expect.objectContaining({
      genJobId: "job-mine",
    }));
    // Parentage is the paid job's own record; no caller may name it (#603 T4).
    expect(mockPlaceCanvasJobNode.mock.calls[0]![0]).not.toHaveProperty("sourceNodeId");
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

    await expect(resolveCanvasNode("p1", "node-1", { status: "done", generationId: "g1" })).resolves.toEqual({ ok: true, applied: true });

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
        // The late-write barrier (#612 r2): a resolve may only change a card that is still in
        // one of the states a browser owns, and may never erase or re-point a paid output. A
        // report from a tab that has fallen behind therefore matches no row at all.
        where: { id: "node-1", ownerId: "u1", projectId: "p1", status: { in: ["pending", "timeout"] }, generationId: null },
        data: { status: "done", generationId: "g1" },
      }),
    );
  });

  it("tells the caller its report was refused, and what the card actually says", async () => {
    // #612 r2: silence here is what let a stale tab paint "Still working…" over a settled card.
    mockCanvasNodeFindFirst
      .mockResolvedValueOnce({ id: "node-1", projectId: "p1" })
      .mockResolvedValueOnce({ status: "failed" });
    mockUpdateMany.mockResolvedValue({ count: 0 }); // the barrier matched no row

    await expect(resolveCanvasNode("p1", "node-1", { status: "timeout" }))
      .resolves.toEqual({ ok: true, applied: false, status: "failed" });
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

    await expect(resolveCanvasNode("p1", "node-1", { status: "failed" })).resolves.toEqual({ ok: true, applied: true });

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
