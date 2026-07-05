import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@fikirtive/db", () => ({ prisma: { generation: { findFirst: vi.fn(), findMany: vi.fn() } } }));
vi.mock("../storage", () => ({
  storage: { get: vi.fn() },
  mimeOf: (ext: string) => (ext === "png" ? "image/png" : "image/jpeg"),
}));
vi.mock("@fikirtive/core", () => ({ storageKey: () => "k/e/y" }));
vi.mock("../runtime-config", () => ({ resolveVisionConfig: vi.fn() }));

import { gatherReferenceImages } from "../otto-ref-images.js";
import { prisma } from "@fikirtive/db";
import { storage } from "../storage";
import { resolveVisionConfig } from "../runtime-config";

const genFindFirst = prisma.generation.findFirst as ReturnType<typeof vi.fn>;
const genFindMany = prisma.generation.findMany as ReturnType<typeof vi.fn>;
const storageGet = storage.get as ReturnType<typeof vi.fn>;
const visionCfg = resolveVisionConfig as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  visionCfg.mockResolvedValue({ enabled: true, policy: "C", maxImages: 3, maxBytes: 5_000_000 });
});

describe("gatherReferenceImages", () => {
  it("returns [] when no sourceGenerationId", async () => {
    expect(await gatherReferenceImages("o", "p", null)).toEqual([]);
    expect(genFindFirst).not.toHaveBeenCalled();
    expect(genFindMany).not.toHaveBeenCalled();
  });

  it("returns [] when vision disabled", async () => {
    visionCfg.mockResolvedValue({ enabled: false, policy: "C", maxImages: 3, maxBytes: 5_000_000 });
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
    expect(genFindFirst).not.toHaveBeenCalled();
  });

  it("returns [] when the generation/asset is not found", async () => {
    genFindFirst.mockResolvedValue(null);
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
  });

  it("returns [] when the asset is oversize (by sizeBytes)", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 9_000_000 } });
    expect(await gatherReferenceImages("o", "p", "gen-1")).toEqual([]);
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("returns a data URL on success", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 1234 } });
    storageGet.mockResolvedValue(Buffer.from([0xde, 0xad]));
    const out = await gatherReferenceImages("o", "p", "gen-1");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("reference");
    expect(out[0]!.dataUrl).toBe(`data:image/png;base64,${Buffer.from([0xde, 0xad]).toString("base64")}`);
  });

  it("returns multiple data URLs for multiple sourceGenerationIds in input order", async () => {
    genFindMany.mockResolvedValue([
      { id: "gen-b", asset: { ownerId: "o", contentHash: "hb", ext: "jpg", sizeBytes: 1234 } },
      { id: "gen-a", asset: { ownerId: "o", contentHash: "ha", ext: "png", sizeBytes: 1234 } },
    ]);
    storageGet
      .mockResolvedValueOnce(Buffer.from([0xaa]))
      .mockResolvedValueOnce(Buffer.from([0xbb]));

    const out = await gatherReferenceImages("o", "p", ["gen-a", "gen-b"]);

    expect(genFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["gen-a", "gen-b"] } }),
    }));
    expect(out.map((r) => r.label)).toEqual(["reference 1", "reference 2"]);
    expect(out.map((r) => r.dataUrl)).toEqual([
      `data:image/png;base64,${Buffer.from([0xaa]).toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from([0xbb]).toString("base64")}`,
    ]);
  });

  it("never throws — returns [] on a storage error", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 1234 } });
    storageGet.mockRejectedValue(new Error("s3 down"));
    await expect(gatherReferenceImages("o", "p", "gen-1")).resolves.toEqual([]);
  });
});
