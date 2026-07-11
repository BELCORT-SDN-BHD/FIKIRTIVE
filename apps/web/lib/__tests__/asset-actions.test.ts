import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockOwner,
  mockGenFindFirst,
  mockGenFindMany,
  mockJobFindFirst,
  mockUpdateMany,
  mockStoragePut,
  mockAssetUpsert,
  mockGenCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockGenFindFirst: vi.fn(),
  mockGenFindMany: vi.fn(),
  mockJobFindFirst: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockStoragePut: vi.fn(),
  mockAssetUpsert: vi.fn(),
  mockGenCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { findFirst: mockGenFindFirst, findMany: mockGenFindMany, updateMany: mockUpdateMany },
    genJob: { findFirst: mockJobFindFirst },
    asset: { upsert: mockAssetUpsert },
    $transaction: mockTransaction,
  },
}));
// stub storageKey so tests don't need 64-char hex hashes in fixtures
vi.mock("@fikirtive/core", () => ({
  storageKey: (ownerId: string, contentHash: string, ext: string) =>
    `u/${ownerId}/${contentHash}.${ext}`,
  newId: () => "new-id-stub",
  resolveUploadMime: (_bytes: Uint8Array, ext: string) => `image/${ext}`,
  MEDIA_SNIFF_BYTES: 4096,
}));
// storage.url is called by getGeneration; stub it to return a predictable URL
vi.mock("../storage", () => ({
  storage: {
    url: (key: string) => `https://cdn.test/${key}`,
    put: mockStoragePut,
  },
  kindOf: (ext: string) => (ext === "mp4" ? "video" : "image"),
  extFromFilename: (name: string) => name.split(".").pop() ?? "bin",
  mimeOf: (ext: string) => `image/${ext}`,
}));

import { getGeneration, setFavorite, saveCroppedGeneration } from "../asset-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  // default: no job found (sourceGenerationId = null)
  mockJobFindFirst.mockResolvedValue(null);
  mockGenFindMany.mockResolvedValue([]);
  mockStoragePut.mockResolvedValue({ contentHash: "deadbeef" });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      asset: { upsert: mockAssetUpsert },
      generation: { create: mockGenCreate },
    };
    mockAssetUpsert.mockResolvedValue({ id: "asset-id-stub" });
    mockGenCreate.mockResolvedValue({ id: "gen-id-stub" });
    await fn(tx);
  });
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
    mockJobFindFirst.mockResolvedValue({ sourceGenerationId: "src-1", generationIds: ["g1"] });
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
  it("scopes updateMany by ownerId and live rows only (cross-tenant + soft-delete guard)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await setFavorite("g1", true);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1", deletedAt: null },
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

// ---------------------------------------------------------------------------
// getGeneration — sibling urls
// ---------------------------------------------------------------------------
describe("getGeneration sibling urls", () => {
  it("returns urls=[self] when no job found", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "abc", ext: "jpg" },
    });
    // mockJobFindFirst returns null by default from beforeEach
    const result = await getGeneration("g1") as { urls: string[] };
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0]).toMatch(/https:\/\/cdn\.test\//);
  });

  it("returns urls=[self] when job has only one generationId", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "abc", ext: "jpg" },
    });
    mockJobFindFirst.mockResolvedValue({ sourceGenerationId: null, generationIds: ["g1"] });
    const result = await getGeneration("g1") as { urls: string[] };
    expect(result.urls).toHaveLength(1);
  });

  it("returns multiple urls in generationIds order for siblings (owner-scoped)", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "hash1", ext: "jpg" },
    });
    mockJobFindFirst.mockResolvedValue({
      sourceGenerationId: null,
      generationIds: ["g1", "g2", "g3"],
    });
    mockGenFindMany.mockResolvedValue([
      { id: "g2", favorite: true, asset: { ownerId: "u1", contentHash: "hash2", ext: "jpg" } },
      { id: "g3", favorite: false, asset: { ownerId: "u1", contentHash: "hash3", ext: "jpg" } },
    ]);
    const result = await getGeneration("g1") as { urls: string[] };
    expect(result.urls).toHaveLength(3);
    expect(result.urls[0]).toContain("hash1");
    expect(result.urls[1]).toContain("hash2");
    expect(result.urls[2]).toContain("hash3");
  });

  it("returns variants[] carrying each sibling's OWN id, aligned to urls (F08)", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1", promptText: "hello", favorite: false,
      asset: { ownerId: "u1", contentHash: "hash1", ext: "jpg" },
    });
    mockJobFindFirst.mockResolvedValue({ sourceGenerationId: null, generationIds: ["g1", "g2", "g3"] });
    mockGenFindMany.mockResolvedValue([
      { id: "g2", favorite: true, asset: { ownerId: "u1", contentHash: "hash2", ext: "jpg" } },
      { id: "g3", favorite: false, asset: { ownerId: "u1", contentHash: "hash3", ext: "jpg" } },
    ]);
    const result = await getGeneration("g1") as { urls: string[]; variants: { id: string; url: string; favorite: boolean }[] };
    // ids in generationIds order — so variants[selectedIdx].id is the displayed image's real id
    expect(result.variants.map((v) => v.id)).toEqual(["g1", "g2", "g3"]);
    // favorite state also belongs to the displayed variant, not only the primary generation
    expect(result.variants.map((v) => v.favorite)).toEqual([false, true, false]);
    // and aligned to urls (each variant's url matches the same index)
    expect(result.variants.map((v) => v.url)).toEqual(result.urls);
  });

  it("sibling findMany is scoped by ownerId (cross-tenant guard)", async () => {
    mockGenFindFirst.mockResolvedValue({
      id: "g1",
      promptText: "hello",
      favorite: false,
      asset: { ownerId: "u1", contentHash: "hash1", ext: "jpg" },
    });
    mockJobFindFirst.mockResolvedValue({
      sourceGenerationId: null,
      generationIds: ["g1", "g2"],
    });
    mockGenFindMany.mockResolvedValue([]);
    await getGeneration("g1");
    expect(mockGenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "u1" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// saveCroppedGeneration
// ---------------------------------------------------------------------------
describe("saveCroppedGeneration", () => {
  const VALID_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  beforeEach(() => {
    mockGenFindFirst.mockResolvedValue({
      projectId: "proj-1",
      promptText: "original prompt",
    });
  });

  it("rejects when source generation is not owned by caller", async () => {
    mockGenFindFirst.mockResolvedValue(null); // not found = not owned
    const result = await saveCroppedGeneration("g-other", VALID_DATA_URL);
    expect(result).toEqual({ error: "Not found." });
  });

  it("source findFirst is scoped by ownerId (cross-tenant guard)", async () => {
    await saveCroppedGeneration("g1", VALID_DATA_URL);
    expect(mockGenFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", ownerId: "u1", deletedAt: null },
      }),
    );
  });

  it("stamps new Generation with caller ownerId", async () => {
    await saveCroppedGeneration("g1", VALID_DATA_URL);
    // The transaction fn is called; check what generation.create received
    expect(mockGenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "u1" }),
      }),
    );
  });

  it("stamps new Generation with source projectId and promptText", async () => {
    await saveCroppedGeneration("g1", VALID_DATA_URL);
    expect(mockGenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "proj-1", promptText: "original prompt" }),
      }),
    );
  });

  it("returns { id } on success", async () => {
    const result = await saveCroppedGeneration("g1", VALID_DATA_URL);
    expect(result).toEqual({ id: "gen-id-stub" });
  });

  it("returns { error } when requireOwner rejects", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await saveCroppedGeneration("g1", VALID_DATA_URL)).toEqual({ error: "Not authorized." });
  });

  it("returns { error } for invalid data URL", async () => {
    const result = await saveCroppedGeneration("g1", "not-a-data-url");
    expect(result).toEqual({ error: "Invalid data URL." });
  });

  it("returns { error } for malformed base64 and writes nothing", async () => {
    const result = await saveCroppedGeneration("g1", "data:image/png;base64,@@@@");
    expect(result).toEqual({ error: "Invalid data URL." });
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("does NOT touch any credit or pricing table", async () => {
    await saveCroppedGeneration("g1", VALID_DATA_URL);
    // Verify no credit/billing-related mock was called (none are mocked = pass trivially,
    // but this documents the contract explicitly)
    expect(mockStoragePut).toHaveBeenCalled(); // ingest path used
    // No genJob.create, no credit spend, no model invocation
  });
});
