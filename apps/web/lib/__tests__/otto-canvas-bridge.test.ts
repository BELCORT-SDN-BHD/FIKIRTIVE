import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOwner,
  mockProjectFindFirst,
  mockCanvasFindMany,
  mockCanvasCount,
  mockCanvasUpdateMany,
  mockGenJobFindMany,
  mockGetCoworkThread,
  mockGetGenerationThumbs,
  mockCreateCanvasNode,
} = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockCanvasFindMany: vi.fn(),
  mockCanvasCount: vi.fn(),
  mockCanvasUpdateMany: vi.fn(),
  mockGenJobFindMany: vi.fn(),
  mockGetCoworkThread: vi.fn(),
  mockGetGenerationThumbs: vi.fn(),
  mockCreateCanvasNode: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../data", () => ({
  getCoworkThread: mockGetCoworkThread,
  getGenerationThumbs: mockGetGenerationThumbs,
}));
vi.mock("../canvas-actions", () => ({
  createCanvasNode: mockCreateCanvasNode,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    canvasNode: {
      findMany: mockCanvasFindMany,
      count: mockCanvasCount,
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
  mockGenJobFindMany.mockResolvedValue([]);
  mockGetGenerationThumbs.mockResolvedValue({});
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
});
