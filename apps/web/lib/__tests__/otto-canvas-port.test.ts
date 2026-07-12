import { describe, it, expect, vi, beforeEach } from "vitest";

// W-B3-A v2 (codex TR1 item 1): the ctx.canvas port pre-validates BEFORE touching the shared
// canvas actions — a forged or cross-project generationId is a hard, structured rejection
// (never a silent downgrade to an empty card), and edit/remove are bound to THIS project.
// The wrapped actions keep their own owner gates (requireOwner) — untouched UI contract.

const { mockGenerationFindFirst, mockCanvasNodeFindFirst, mockCreateCanvasNode, mockUpdateTextNode, mockDeleteCanvasNode, mockResolveCanvasNode, mockListCanvasNodes, mockSync } = vi.hoisted(() => ({
  mockGenerationFindFirst: vi.fn(),
  mockCanvasNodeFindFirst: vi.fn(),
  mockCreateCanvasNode: vi.fn(),
  mockUpdateTextNode: vi.fn(),
  mockDeleteCanvasNode: vi.fn(),
  mockResolveCanvasNode: vi.fn(),
  mockListCanvasNodes: vi.fn(),
  mockSync: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { findFirst: mockGenerationFindFirst },
    canvasNode: { findFirst: mockCanvasNodeFindFirst },
  },
}));
vi.mock("../canvas-actions", () => ({
  listCanvasNodes: mockListCanvasNodes,
  createCanvasNode: mockCreateCanvasNode,
  updateTextNode: mockUpdateTextNode,
  resolveCanvasNode: mockResolveCanvasNode,
  deleteCanvasNode: mockDeleteCanvasNode,
}));
vi.mock("../otto-canvas-bridge", () => ({ syncOttoCanvasNodes: mockSync }));

import { makeOttoCanvasPort } from "../otto-canvas-port";

const port = () => makeOttoCanvasPort("owner-1", "proj-1");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("place — generationId is pre-validated (owner + project), hard reject", () => {
  const base = { type: "image" as const, x: 80, y: 80, w: 320, h: 320 };

  it("a FORGED generationId is rejected with a structured error and never reaches createCanvasNode", async () => {
    mockGenerationFindFirst.mockResolvedValue(null); // no such generation anywhere
    const res = await port().place({ ...base, generationId: "gen-forged" });
    expect(res).toEqual({ error: "That generationId is invalid or belongs to another project." });
    expect(mockCreateCanvasNode).not.toHaveBeenCalled();
  });

  it("a CROSS-PROJECT generationId is rejected: the lookup is scoped ownerId+projectId+live", async () => {
    mockGenerationFindFirst.mockResolvedValue(null); // exists in another project ⇒ scoped query misses
    const res = await port().place({ ...base, generationId: "gen-other-project" });
    expect(res).toEqual({ error: "That generationId is invalid or belongs to another project." });
    expect(mockGenerationFindFirst).toHaveBeenCalledWith({
      where: { id: "gen-other-project", ownerId: "owner-1", projectId: "proj-1", deletedAt: null },
      select: { id: true },
    });
    expect(mockCreateCanvasNode).not.toHaveBeenCalled();
  });

  it("a real in-project generationId passes through to the shared action with the port's projectId", async () => {
    mockGenerationFindFirst.mockResolvedValue({ id: "gen-ok" });
    mockCreateCanvasNode.mockResolvedValue({ id: "node-1" });
    const res = await port().place({ ...base, generationId: "gen-ok", sourceNodeId: "n-src" });
    expect(res).toEqual({ id: "node-1" });
    expect(mockCreateCanvasNode).toHaveBeenCalledWith({ projectId: "proj-1", ...base, generationId: "gen-ok", sourceNodeId: "n-src" });
  });

  it("a text note skips generation validation entirely", async () => {
    mockCreateCanvasNode.mockResolvedValue({ id: "node-2" });
    await port().place({ type: "text", x: 80, y: 80, w: 240, h: 120, text: "note" });
    expect(mockGenerationFindFirst).not.toHaveBeenCalled();
    expect(mockCreateCanvasNode).toHaveBeenCalled();
  });
});

describe("editText / remove — project binding", () => {
  it("editing a CROSS-PROJECT node is rejected and never reaches updateTextNode", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue(null); // node lives in another project
    const res = await port().editText("n-foreign", "new text");
    expect(res).toEqual({ error: "Node not found." });
    expect(mockCanvasNodeFindFirst).toHaveBeenCalledWith({
      where: { id: "n-foreign", ownerId: "owner-1", projectId: "proj-1" },
      select: { id: true },
    });
    expect(mockUpdateTextNode).not.toHaveBeenCalled();
  });

  it("removing a CROSS-PROJECT node is rejected and never reaches deleteCanvasNode", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue(null);
    const res = await port().remove("n-foreign");
    expect(res).toEqual({ error: "Node not found." });
    expect(mockDeleteCanvasNode).not.toHaveBeenCalled();
  });

  it("in-project nodes pass through to the shared actions", async () => {
    mockCanvasNodeFindFirst.mockResolvedValue({ id: "n-1" });
    mockUpdateTextNode.mockResolvedValue({ ok: true });
    mockDeleteCanvasNode.mockResolvedValue({ ok: true });
    expect(await port().editText("n-1", "hello")).toEqual({ ok: true });
    expect(mockUpdateTextNode).toHaveBeenCalledWith("n-1", "hello");
    expect(await port().remove("n-1")).toEqual({ ok: true });
    expect(mockDeleteCanvasNode).toHaveBeenCalledWith("n-1");
  });
});

describe("list / sync / resolve — thin closures over the shared actions", () => {
  it("list and sync carry the port's projectId; resolve passes through unchanged", async () => {
    mockListCanvasNodes.mockResolvedValue([]);
    mockSync.mockResolvedValue([]);
    mockResolveCanvasNode.mockResolvedValue({ ok: true });
    const c = port();
    await c.list();
    expect(mockListCanvasNodes).toHaveBeenCalledWith("proj-1");
    await c.sync();
    expect(mockSync).toHaveBeenCalledWith("proj-1");
    await c.resolve("n-1", { status: "done", generationId: "g-1" });
    expect(mockResolveCanvasNode).toHaveBeenCalledWith("n-1", { status: "done", generationId: "g-1" });
  });
});
