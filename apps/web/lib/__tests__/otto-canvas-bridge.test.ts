import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOwner,
  mockProjectFindFirst,
  mockCanvasFindMany,
  mockCanvasCount,
  mockCanvasUpdateMany,
  mockChatThreadFindMany,
  mockGenJobFindMany,
  mockExecuteRaw,
  mockGetGenerationThumbs,
  mockPlaceCanvasJobNode,
  mockNewId,
  mockGenerationFindMany,
  mockLedgerFindMany,
  mockOrganizationFindFirst,
  mockSettleCanvasCards,
} = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockCanvasFindMany: vi.fn(),
  mockCanvasCount: vi.fn(),
  mockCanvasUpdateMany: vi.fn(),
  mockChatThreadFindMany: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockGetGenerationThumbs: vi.fn(),
  mockPlaceCanvasJobNode: vi.fn(),
  mockNewId: vi.fn(),
  mockGenerationFindMany: vi.fn(),
  mockLedgerFindMany: vi.fn(),
  mockOrganizationFindFirst: vi.fn(),
  mockSettleCanvasCards: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({
  getGenerationThumbs: mockGetGenerationThumbs,
}));
vi.mock("../canvas-node-placement", () => ({
  canvasJobPlacementLockKey: (ownerId: string, projectId: string, genJobId: string) =>
    `canvas-job-placement:${ownerId}:${projectId}:${genJobId}`,
  placeCanvasJobNode: mockPlaceCanvasJobNode,
}));
// Only newId is stubbed — the credit conversion the lineage read uses stays REAL (#547 B4).
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: mockNewId,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    canvasNode: {
      findMany: mockCanvasFindMany,
      count: mockCanvasCount,
      updateMany: mockCanvasUpdateMany,
    },
    chatThread: { findMany: mockChatThreadFindMany },
    genJob: { findMany: mockGenJobFindMany },
    // #547 B4: the bridge's board read now also carries each card's lineage.
    generation: { findMany: mockGenerationFindMany },
    creditLedger: { findMany: mockLedgerFindMany },
    organization: { findFirst: mockOrganizationFindFirst },
    $executeRaw: mockExecuteRaw,
  },
  // #601 r2: the chat-side reader no longer repairs a delivered job itself — it calls the ONE
  // settlement the canvas reader and the worker call.
  settleCanvasCardsForGenJob: mockSettleCanvasCards,
}));

import { syncOttoCanvasNodes } from "../otto-canvas-bridge";

beforeEach(() => {
  vi.resetAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "owner@example.test" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1" });
  mockCanvasCount.mockResolvedValue(0);
  mockCanvasUpdateMany.mockResolvedValue({ count: 1 });
  mockChatThreadFindMany.mockResolvedValue([]);
  mockGenJobFindMany.mockResolvedValue([]);
  mockGenerationFindMany.mockResolvedValue([]);
  mockLedgerFindMany.mockResolvedValue([]);
  mockOrganizationFindFirst.mockResolvedValue({ settings: {} });
  mockExecuteRaw.mockResolvedValue(1);
  mockSettleCanvasCards.mockResolvedValue({ status: "settled", nodeIds: [], created: 0, updated: 0 });
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
});

describe("syncOttoCanvasNodes project scoping", () => {
  it("does not repair a canvas node from an owned GenJob in another project", async () => {
    mockCanvasFindMany.mockResolvedValue([
      {
        id: "node-1",
        type: "image",
        x: 0,
        y: 0,
        w: 320,
        h: 320,
        text: null,
        prompt: "wrong project job",
        generationId: null,
        genJobId: "job-other-project",
        status: "pending",
        sourceNodeId: null,
        threadId: null,
      },
    ]);

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({
        id: "node-1",
        generationId: null,
        status: "pending",
        url: null,
      }),
    ]);
    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["job-other-project"] }, ownerId: "u1", projectId: "p1" },
      }),
    );
    expect(mockCanvasUpdateMany).not.toHaveBeenCalled();
  });

  it("looks up GEN_RESULT jobs within the active project before bridging nodes", async () => {
    mockChatThreadFindMany.mockResolvedValue([
      {
        id: "thread-1",
        messages: [
          { kind: "GEN_RESULT", genJobId: "job-1", seq: 1, payload: { kind: "image" }, text: "prompt" },
        ],
      },
    ]);
    mockCanvasFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await syncOttoCanvasNodes("p1");

    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", projectId: "p1", OR: [{ id: { in: ["job-1"] } }] },
      }),
    );
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
  });

  it("hands every live thread's GEN_RESULT job to the one settlement, and places nothing itself", async () => {
    // #601 r3 (judge P2②): this reader used to write a delivered batch itself — one card per
    // output, left to right — and its own writes then told the shared pre-check the board was
    // finished, so the settlement never saw the job. A merchant got a 1×4 row with a chat open
    // and the settlement's 2×2 grid without one.
    mockChatThreadFindMany.mockResolvedValue([
      {
        id: "thread-1",
        messages: [
          { kind: "GEN_RESULT", genJobId: "job-1", seq: 1, payload: { kind: "image" }, text: "first" },
        ],
      },
      {
        id: "thread-2",
        messages: [
          { kind: "GEN_RESULT", genJobId: "job-2", seq: 1, payload: { kind: "video" }, text: "second" },
        ],
      },
    ]);
    mockCanvasFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockGenJobFindMany.mockResolvedValueOnce([
      { id: "job-1", status: "DONE", generationIds: ["gen-1"] },
      { id: "job-2", status: "DONE", generationIds: ["gen-2"] },
    ]);

    await syncOttoCanvasNodes("p1");

    expect(mockSettleCanvasCards.mock.calls).toEqual([["job-1", "u1"], ["job-2", "u1"]]);
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
  });

  it("never recreates a job after its in-flight Canvas anchor was deleted", async () => {
    mockChatThreadFindMany.mockResolvedValue([
      {
        id: "thread-1",
        messages: [
          { kind: "GEN_RESULT", genJobId: "job-1", seq: 1, payload: { kind: "image" }, text: "deleted result" },
        ],
      },
    ]);
    mockCanvasFindMany
      .mockResolvedValueOnce([
        { generationId: null, genJobId: "job-1", status: "deleted" },
      ])
      .mockResolvedValueOnce([]);
    mockGenJobFindMany.mockResolvedValueOnce([
      { id: "job-1", status: "DONE", generationIds: ["gen-1"] },
    ]);

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([]);
    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
  });

  it("creates a pending canvas node for an approved GEN_CARD before the worker result lands", async () => {
    mockChatThreadFindMany.mockResolvedValue([
      {
        id: "thread-1",
        messages: [
          {
            id: "card-1",
            kind: "GEN_CARD",
            genJobId: "job-1",
            seq: 1,
            payload: { kind: "video", structuredPrompt: "make the portrait walk through rain" },
            text: "",
          },
        ],
      },
    ]);
    mockCanvasFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "node-pending",
          type: "video",
          x: 80,
          y: 80,
          w: 320,
          h: 320,
          text: null,
          prompt: "make the portrait walk through rain",
          generationId: null,
          genJobId: "job-1",
          status: "pending",
          sourceNodeId: null,
          threadId: "thread-1",
        },
      ]);
    mockGenJobFindMany
      .mockResolvedValueOnce([{ id: "job-1", status: "QUEUED", generationIds: [] }])
      .mockResolvedValueOnce([{ id: "job-1", status: "QUEUED", generationIds: [] }]);

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({
        id: "node-pending",
        type: "video",
        genJobId: "job-1",
        generationId: null,
        status: "pending",
        url: null,
        threadId: "thread-1",
      }),
    ]);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockExecuteRaw.mock.calls[0]).toEqual(expect.arrayContaining([
      "canvas-job-placement:u1:p1:job-1",
      "p1",
      "video",
      "job-1",
      "thread-1",
      "make the portrait walk through rain",
    ]));
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
  });

  it("falls back to cowork idempotency when the GEN_CARD genJobId stamp is missing", async () => {
    mockChatThreadFindMany.mockResolvedValue([
      {
        id: "thread-1",
        messages: [
          {
            id: "card-1",
            kind: "GEN_CARD",
            genJobId: null,
            seq: 1,
            payload: { kind: "video", structuredPrompt: "make the portrait walk through rain" },
            text: "",
          },
        ],
      },
    ]);
    mockCanvasFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "node-pending",
          type: "video",
          x: 80,
          y: 80,
          w: 320,
          h: 320,
          text: null,
          prompt: "make the portrait walk through rain",
          generationId: null,
          genJobId: "job-fallback",
          status: "pending",
          sourceNodeId: null,
          threadId: "thread-1",
        },
      ]);
    mockGenJobFindMany
      .mockResolvedValueOnce([{ id: "job-fallback", idempotencyKey: "cowork:card-1", status: "QUEUED", generationIds: [] }])
      .mockResolvedValueOnce([{ id: "job-fallback", idempotencyKey: "cowork:card-1", status: "QUEUED", generationIds: [] }]);

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({
        id: "node-pending",
        genJobId: "job-fallback",
        status: "pending",
      }),
    ]);
    expect(mockChatThreadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        messages: expect.objectContaining({
          where: { kind: { in: ["GEN_CARD", "GEN_RESULT"] }, deletedAt: null },
        }),
      }),
    }));
    expect(mockGenJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: "u1", projectId: "p1", OR: [{ idempotencyKey: { in: ["cowork:card-1"] } }] },
    }));
    expect(mockExecuteRaw.mock.calls[0]).toEqual(expect.arrayContaining(["job-fallback"]));
  });

  it("hands a batch with missing cards to the one settlement instead of placing its own", async () => {
    // Whether a chat was open must not change the board a merchant gets (#601 r2 P2②): this
    // reader delegates to exactly the same settlement the canvas reader and the worker use.
    mockCanvasFindMany.mockResolvedValue([
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
    mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/one.jpeg", kind: "image" } });

    await syncOttoCanvasNodes("p1");

    expect(mockSettleCanvasCards).toHaveBeenCalledWith("job-1", "u1");
    expect(mockCanvasUpdateMany).not.toHaveBeenCalled();
    expect(mockPlaceCanvasJobNode).not.toHaveBeenCalled();
  });

  it("does not ask the settlement for a job whose board already matches it", async () => {
    mockCanvasFindMany.mockResolvedValue([
      {
        id: "node-1",
        type: "image", x: 0, y: 0, w: 320, h: 320, text: null, prompt: "one",
        generationId: "gen-1", genJobId: "job-1", status: "done", sourceNodeId: null, threadId: null,
      },
    ]);
    mockGenJobFindMany.mockResolvedValue([{ id: "job-1", status: "DONE", generationIds: ["gen-1"] }]);
    mockGetGenerationThumbs.mockResolvedValue({ "gen-1": { src: "/files/u1/one.jpeg", kind: "image" } });

    await syncOttoCanvasNodes("p1");

    expect(mockSettleCanvasCards).not.toHaveBeenCalled();
    expect(mockCanvasUpdateMany).not.toHaveBeenCalled();
  });
});

/**
 * The bridge is the OTHER board reader (#547 B4 loads the same record through both). A card is
 * the merchant's paid work; its record is a nicety — if the record lookup falls over, the board
 * must still come back, or a failed caption reads as "my work is gone". Round-1 review P3: the
 * degrade was written but never proven, on either reader.
 */
describe("syncOttoCanvasNodes when the traceability lookup fails", () => {
  const board = [{
    id: "node-1",
    type: "image",
    x: 0,
    y: 0,
    w: 320,
    h: 320,
    text: null,
    prompt: "a cup steaming",
    generationId: "gen-1",
    genJobId: "job-1",
    status: "done",
    sourceNodeId: null,
    threadId: null,
  }];

  /** The bridge's OWN job reads stay healthy; only the lineage-shaped one is broken. */
  const breakLineageJobRead = () => {
    mockGenJobFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args.select?.videoOptions) throw new Error("lineage job read failed");
      return [{ id: "job-1", status: "DONE", generationIds: ["gen-1"], idempotencyKey: null }];
    });
  };

  beforeEach(() => {
    mockCanvasFindMany.mockResolvedValue(board);
    mockGenJobFindMany.mockResolvedValue([
      { id: "job-1", status: "DONE", generationIds: ["gen-1"], idempotencyKey: null },
    ]);
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

      await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
        expect.objectContaining({ id: "node-1", url: "/files/u1/one.png", status: "done", lineage: null }),
      ]);
    });
  }
});
