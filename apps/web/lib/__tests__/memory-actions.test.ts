import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireOwner, mockMemoryCreate, mockMemoryFindMany, mockMemoryUpdateMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockMemoryCreate: vi.fn(),
  mockMemoryFindMany: vi.fn(),
  mockMemoryUpdateMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({ prisma: { memory: { create: mockMemoryCreate, findMany: mockMemoryFindMany, updateMany: mockMemoryUpdateMany } } }));
vi.mock("@fikirtive/core", () => ({ newId: () => "m_1" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addMemory, updateMemory, deleteMemory, getBrandContextText } from "../memory-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
});

describe("addMemory", () => {
  it("persists owner-scoped with source 'user'", async () => {
    mockMemoryCreate.mockResolvedValue({ id: "m_1" });
    const res = await addMemory({ category: "voice", content: "warm, family tone" });
    expect(res).toEqual({ ok: true, id: "m_1" });
    expect(mockMemoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: "o1", category: "voice", content: "warm, family tone", source: "user" }),
    });
  });

  it("returns error when category is missing", async () => {
    const res = await addMemory({ content: "something" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns error when content is missing", async () => {
    const res = await addMemory({ category: "voice" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns gate error when requireOwner fails", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authenticated." });
    const res = await addMemory({ category: "voice", content: "test" });
    expect(res).toEqual({ error: "Not authenticated." });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns error on db failure", async () => {
    mockMemoryCreate.mockRejectedValue(new Error("db down"));
    const res = await addMemory({ category: "voice", content: "test" });
    expect(res).toEqual({ error: expect.any(String) });
  });
});

describe("updateMemory", () => {
  it("updates owner-scoped memory by id", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateMemory({ id: "m_1", content: "new text" });
    expect(res).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "m_1", ownerId: "o1" }),
      data: expect.objectContaining({ content: "new text" }),
    });
  });

  it("returns error when memory not found (count 0)", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 0 });
    const res = await updateMemory({ id: "m_1", content: "new text" });
    expect(res).toEqual({ error: expect.any(String) });
  });

  it("returns error for invalid input", async () => {
    const res = await updateMemory({ id: 123, content: "text" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });
});

describe("deleteMemory", () => {
  it("soft-deletes owner-scoped memory", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    const res = await deleteMemory({ id: "m_1" });
    expect(res).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "m_1", ownerId: "o1" }),
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
  });

  it("returns error when memory not found (count 0)", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 0 });
    const res = await deleteMemory({ id: "m_1" });
    expect(res).toEqual({ error: expect.any(String) });
  });

  it("returns error for invalid id", async () => {
    const res = await deleteMemory({});
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });
});

describe("getBrandContextText", () => {
  it("returns empty string when no memory", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    expect(await getBrandContextText("o1", null)).toBe("");
  });

  it("compiles grouped notes", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm" }]);
    const result = await getBrandContextText("o1", null);
    expect(result).toContain("warm");
    expect(result).toContain("voice");
  });

  it("groups multiple entries under the same category", async () => {
    mockMemoryFindMany.mockResolvedValue([
      { category: "voice", content: "warm" },
      { category: "voice", content: "friendly" },
      { category: "colors", content: "blue" },
    ]);
    const result = await getBrandContextText("o1", null);
    expect(result).toContain("warm");
    expect(result).toContain("friendly");
    expect(result).toContain("blue");
  });

  it("queries with ownerId and brandId", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    await getBrandContextText("o1", "brand_1");
    expect(mockMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "o1", brandId: "brand_1" }) })
    );
  });
});
