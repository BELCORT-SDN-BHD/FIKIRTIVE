import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@fikirtive/db", () => ({ prisma: { generation: { findFirst: vi.fn() } } }));
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

  it("never throws — returns [] on a storage error", async () => {
    genFindFirst.mockResolvedValue({ asset: { ownerId: "o", contentHash: "h", ext: "png", sizeBytes: 1234 } });
    storageGet.mockRejectedValue(new Error("s3 down"));
    await expect(gatherReferenceImages("o", "p", "gen-1")).resolves.toEqual([]);
  });
});
