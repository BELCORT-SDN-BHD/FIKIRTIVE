import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOwner,
  mockProjectFindFirst,
  mockCanvasFindMany,
  mockCanvasCount,
  mockCanvasCreate,
  mockCanvasUpdateMany,
  mockGenJobFindMany,
  mockGetCoworkThread,
  mockGetGenerationThumbs,
  mockCreateCanvasNode,
  mockNewId,
} = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockCanvasFindMany: vi.fn(),
  mockCanvasCount: vi.fn(),
  mockCanvasCreate: vi.fn(),
  mockCanvasUpdateMany: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockGetCoworkThread: vi.fn(),
  mockGetGenerationThumbs: vi.fn(),
  mockCreateCanvasNode: vi.fn(),
  mockNewId: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({
  getCoworkThread: mockGetCoworkThread,
  getGenerationThumbs: mockGetGenerationThumbs,
}));
vi.mock("../canvas-actions", () => ({
  createCanvasNode: mockCreateCanvasNode,
}));
vi.mock("@fikirtive/core", () => ({ newId: mockNewId }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    canvasNode: {
      findMany: mockCanvasFindMany,
      count: mockCanvasCount,
      create: mockCanvasCreate,
      updateMany: mockCanvasUpdateMany,
    },
    genJob: { findMany: mockGenJobFindMany },
  },
}));

import { syncOttoCanvasNodes } from "../otto-canvas-bridge";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "owner@example.test" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1" });
  mockCanvasCount.mockResolvedValue(0);
  mockCanvasCreate.mockResolvedValue({});
  mockCanvasUpdateMany.mockResolvedValue({ count: 1 });
  mockGenJobFindMany.mockResolvedValue([]);
  mockGetGenerationThumbs.mockResolvedValue({});
  mockNewId.mockReturnValue("node-1");
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
    mockGetCoworkThread.mockResolvedValue({
      projectId: "p1",
      messages: [
        { kind: "GEN_RESULT", genJobId: "job-1", seq: 1, payload: { kind: "image" }, text: "prompt" },
      ],
    });
    mockCanvasFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await syncOttoCanvasNodes("p1", "thread-1");

    expect(mockGenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["job-1"] }, ownerId: "u1", projectId: "p1" },
      }),
    );
    expect(mockCreateCanvasNode).not.toHaveBeenCalled();
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
    expect(mockCanvasCreate).toHaveBeenCalledTimes(3);
    expect(mockCanvasCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        id: "node-sib-1",
        ownerId: "u1",
        projectId: "p1",
        generationId: "gen-2",
        genJobId: null,
        status: "done",
        threadId: "thread-1",
        x: 440,
        y: 50,
      }),
    });
  });

  it("does not create duplicate siblings when another reload already claimed the primary repair", async () => {
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
    ]);
    expect(mockCanvasCreate).not.toHaveBeenCalled();
  });
});
