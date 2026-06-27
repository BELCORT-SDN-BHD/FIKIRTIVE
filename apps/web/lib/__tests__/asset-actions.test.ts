import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockGenFindFirst, mockJobFindFirst, mockUpdateMany } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockGenFindFirst: vi.fn(),
  mockJobFindFirst: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { findFirst: mockGenFindFirst, updateMany: mockUpdateMany },
    genJob: { findFirst: mockJobFindFirst },
  },
}));
// stub storageKey so tests don't need 64-char hex hashes in fixtures
vi.mock("@fikirtive/core", () => ({
  storageKey: (ownerId: string, contentHash: string, ext: string) =>
    `u/${ownerId}/${contentHash}.${ext}`,
}));
// storage.url is called by getGeneration; stub it to return a predictable URL
vi.mock("../storage", () => ({
  storage: { url: (key: string) => `https://cdn.test/${key}` },
  kindOf: (ext: string) => (ext === "mp4" ? "video" : "image"),
}));

import { getGeneration, setFavorite } from "../asset-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  // default: no job found (sourceGenerationId = null)
  mockJobFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// getGeneration
// ---------------------------------------------------------------------------
describe("getGeneration", () => {
  it("scopes generation findFirst by ownerId (cross-tenant guard)", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "abc", ext: "jpg" },
    });
    await getGeneration("g1");
    expect(mockGenFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1", deletedAt: null },
      }),
    );
  });

  it("scopes genJob findFirst by ownerId (cross-tenant guard)", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "abc", ext: "jpg" },
    });
    await getGeneration("g1");
    expect(mockJobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1" }),
      }),
    );
  });

  it("returns the generation with resolved URL and kind", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: true,
      asset: { ownerId: "u1", contentHash: "abc123", ext: "mp4" },
    });
    mockJobFindFirst.mockResolvedValue({ sourceGenerationId: "src-1" });
    const result = await getGeneration("g1");
    expect(result).toMatchObject({
      id: "g1",
      prompt: "hello",
      favorite: true,
      sourceGenerationId: "src-1",
      kind: "video",
    });
    expect((result as { url: string }).url).toMatch(/https:\/\/cdn\.test\//);
  });

  it("returns sourceGenerationId null when no job found", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "abc", ext: "jpg" },
    });
    // mockJobFindFirst already returns null from beforeEach
    const result = await getGeneration("g1");
    expect((result as { sourceGenerationId: string | null }).sourceGenerationId).toBeNull();
  });

  it("returns { error } when generation is not owned by caller", async () => {
    mockGenFindFirst.mockResolvedValue(null);
    expect(await getGeneration("other-g")).toEqual({ error: "Not found." });
  });

  it("returns { error } when requireOwner rejects", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await getGeneration("g1")).toEqual({ error: "Not authorized." });
  });
});

// ---------------------------------------------------------------------------
// setFavorite
// ---------------------------------------------------------------------------
describe("setFavorite", () => {
  it("scopes updateMany by ownerId (cross-tenant guard)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await setFavorite("g1", true);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1" },
        data: { favorite: true },
      }),
    );
  });

  it("returns { favorite } on success", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await setFavorite("g1", false)).toEqual({ favorite: false });
  });

  it("returns { error } when generation is not owned by caller", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect(await setFavorite("other-g", true)).toEqual({ error: "Not found." });
  });

  it("returns { error } when requireOwner rejects", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await setFavorite("g1", true)).toEqual({ error: "Not authorized." });
  });
});
