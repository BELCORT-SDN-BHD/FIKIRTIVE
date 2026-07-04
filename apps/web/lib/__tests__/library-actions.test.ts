import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockProjectFindFirst, mockGenFindMany, mockStorageExists } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockGenFindMany: vi.fn(),
  mockStorageExists: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    generation: { findMany: mockGenFindMany },
  },
}));
vi.mock("@fikirtive/core", () => ({
  storageKey: (o: string, h: string, e: string) => `${o}/${h}.${e}`,
  storageKeyToSrc: (k: string) => `https://cdn/${k}`,
}));
vi.mock("../storage", () => ({
  storage: { exists: mockStorageExists },
}));

import { getGenerationHistory } from "../library-actions";

function row(id: string, ext: string, createdAtIso: string, favorite = false) {
  return {
    id, promptText: `p-${id}`, favorite, createdAt: new Date(createdAtIso),
    asset: { ownerId: "u1", contentHash: `h-${id}`, ext },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1" });
  mockStorageExists.mockResolvedValue(true);
});

describe("getGenerationHistory — scoping & errors", () => {
  it("returns the gate error for a non-owner", async () => {
    mockOwner.mockResolvedValue({ error: "Unauthorized." });
    expect(await getGenerationHistory("p1")).toEqual({ error: "Unauthorized." });
    expect(mockGenFindMany).not.toHaveBeenCalled();
  });
  it("rejects an unowned project before querying generations", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await getGenerationHistory("pX")).toEqual({ error: "Project not found." });
    expect(mockGenFindMany).not.toHaveBeenCalled();
  });
  it("always scopes where to owner+project+deletedAt:null, newest-first, over-fetches a scan window", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { take: 10 });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1", projectId: "p1", deletedAt: null }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 31,
      }),
    );
  });
});

describe("getGenerationHistory — filters", () => {
  it("adds favorite:true when favoriteOnly", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { favoriteOnly: true });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ favorite: true }) }),
    );
  });
  it("adds a case-insensitive promptText contains when search is set", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { search: "  sale  " });
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ promptText: { contains: "sale", mode: "insensitive" } }) }),
    );
  });
  it("omits the search filter for blank/whitespace search", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { search: "   " });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect("promptText" in arg.where).toBe(false);
  });
  it("builds the keyset OR clause from a cursor", async () => {
    mockGenFindMany.mockResolvedValue([]);
    await getGenerationHistory("p1", { cursor: "2026-01-02T00:00:00.000Z|gen-9" });
    const arg = mockGenFindMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date("2026-01-02T00:00:00.000Z") } },
      { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: { lt: "gen-9" } },
    ]);
  });
});

describe("getGenerationHistory — paging & mapping", () => {
  it("derives kind from ext, resolves url, maps fields", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "mp4", "2026-01-03T00:00:00.000Z", true),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory("p1", { take: 60 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items[0]).toEqual({ id: "a", url: "https://cdn/u1/h-a.mp4", kind: "video", prompt: "p-a", favorite: true, createdAt: "2026-01-03T00:00:00.000Z" });
    expect(res.items[1].kind).toBe("image");
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBe(null);
  });
  it("filters rows whose storage object is missing", async () => {
    mockStorageExists.mockImplementation(async (key: string) => !key.includes("h-b.png"));
    mockGenFindMany.mockResolvedValue([
      row("a", "png", "2026-01-03T00:00:00.000Z"),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory("p1", { take: 60 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items.map((item) => item.id)).toEqual(["a"]);
    expect(mockStorageExists).toHaveBeenCalledWith("u1/h-a.png");
    expect(mockStorageExists).toHaveBeenCalledWith("u1/h-b.png");
  });
  it("sets hasMore + nextCursor when more visible rows exist than requested", async () => {
    mockGenFindMany.mockResolvedValue([
      row("a", "png", "2026-01-03T00:00:00.000Z"),
      row("b", "png", "2026-01-02T00:00:00.000Z"),
    ]);
    const res = await getGenerationHistory("p1", { take: 1 });
    if ("error" in res) throw new Error("unexpected error");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("a");
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe("2026-01-03T00:00:00.000Z|a");
  });
});
