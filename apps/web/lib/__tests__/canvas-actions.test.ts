import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindMany, mockCreate, mockUpdateMany, mockDeleteMany, mockProjectFindFirst } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockProjectFindFirst: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    canvasNode: { findMany: mockFindMany, create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany },
    project: { findFirst: mockProjectFindFirst },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "node-1" }));

import { listCanvasNodes, moveCanvasNode } from "../canvas-actions";

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
