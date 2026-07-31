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

  it("bridges GEN_RESULT generations from every live thread in the project", async () => {
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
      { id: "job-1", generationIds: ["gen-1"] },
      { id: "job-2", generationIds: ["gen-2"] },
    ]);

    await syncOttoCanvasNodes("p1");

    expect(mockPlaceCanvasJobNode).toHaveBeenCalledTimes(2);
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ownerId: "u1",
      projectId: "p1",
      generationId: "gen-1",
      genJobId: "job-1",
      threadId: "thread-1",
      type: "image",
    }));
    expect(mockPlaceCanvasJobNode).toHaveBeenNthCalledWith(2, expect.objectContaining({
      ownerId: "u1",
      projectId: "p1",
      generationId: "gen-2",
      genJobId: "job-2",
      threadId: "thread-2",
      type: "video",
    }));
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
      { id: "job-1", generationIds: ["gen-1"] },
    ]);

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([]);
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

  it("recovers missing sibling nodes for a completed multi-variant promptbar job", async () => {
    mockNewId
      .mockReturnValueOnce("node-sib-1")
      .mockReturnValueOnce("node-sib-2")
      .mockReturnValueOnce("node-sib-3");
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
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.jpeg", kind: "image" },
      "gen-2": { src: "/files/u1/two.jpeg", kind: "image" },
      "gen-3": { src: "/files/u1/three.jpeg", kind: "image" },
      "gen-4": { src: "/files/u1/four.jpeg", kind: "image" },
    });

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({ id: "node-primary", generationId: "gen-1", status: "done", url: "/files/u1/one.jpeg" }),
      expect.objectContaining({ id: "node-sib-1", generationId: "gen-2", status: "done", url: "/files/u1/two.jpeg", x: 440, y: 50 }),
      expect.objectContaining({ id: "node-sib-2", generationId: "gen-3", status: "done", url: "/files/u1/three.jpeg", x: 100, y: 390 }),
      expect.objectContaining({ id: "node-sib-3", generationId: "gen-4", status: "done", url: "/files/u1/four.jpeg", x: 440, y: 390 }),
    ]);
    expect(mockCanvasUpdateMany).toHaveBeenCalledWith({
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
        sourceNodeId: "node-primary",
        threadId: "thread-1",
        x: 440,
        y: 50,
    }));
  });

  it("still delegates missing siblings to the idempotent placement layer when another reload repaired the primary", async () => {
    mockCanvasUpdateMany.mockResolvedValue({ count: 0 });
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
    mockGetGenerationThumbs.mockResolvedValue({
      "gen-1": { src: "/files/u1/one.jpeg", kind: "image" },
      "gen-2": { src: "/files/u1/two.jpeg", kind: "image" },
      "gen-3": { src: "/files/u1/three.jpeg", kind: "image" },
      "gen-4": { src: "/files/u1/four.jpeg", kind: "image" },
    });

    await expect(syncOttoCanvasNodes("p1")).resolves.toEqual([
      expect.objectContaining({ id: "node-primary", generationId: "gen-1", status: "done", url: "/files/u1/one.jpeg" }),
      expect.objectContaining({ generationId: "gen-2", genJobId: "job-1" }),
      expect.objectContaining({ generationId: "gen-3", genJobId: "job-1" }),
      expect.objectContaining({ generationId: "gen-4", genJobId: "job-1" }),
    ]);
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledTimes(3);
    expect(mockPlaceCanvasJobNode).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "u1",
      projectId: "p1",
      genJobId: "job-1",
      generationId: "gen-2",
    }));
  });
});
