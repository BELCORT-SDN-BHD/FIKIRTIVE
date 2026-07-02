/**
 * otto-generation-validate.test.ts — unit tests for the shared owned+ext Generation
 * validator used by both sourceGenerationId (image-ext) and referenceVideoGenerationId
 * (video-ext) validation in otto-actions.ts and stream/route.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { validateOwnedGenerationExt } from "../otto-generation-validate";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];

describe("validateOwnedGenerationExt", () => {
  it("accepts a generation whose asset ext matches the video-ext allowlist (reference video)", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "gen_vid" });
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_vid",
      ownerId: "owner_1",
      projectId: "proj_1",
      exts: VIDEO_EXTS,
    });

    expect(result).toBe("gen_vid");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "gen_vid",
        ownerId: "owner_1",
        deletedAt: null,
        projectId: "proj_1",
        asset: { ext: { in: VIDEO_EXTS } },
      },
      select: { id: true },
    });
  });

  it("rejects (returns null) when the id's asset ext is image-ext, not video-ext", async () => {
    // Simulate the DB query itself filtering out non-matching ext (findFirst finds nothing).
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_img",
      ownerId: "owner_1",
      projectId: "proj_1",
      exts: VIDEO_EXTS,
    });

    expect(result).toBeNull();
  });

  it("still accepts image-ext lookups (sourceGenerationId behavior unchanged)", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "gen_img" });
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_img",
      ownerId: "owner_1",
      projectId: "proj_1",
      exts: IMAGE_EXTS,
    });

    expect(result).toBe("gen_img");
  });

  it("returns null when no matching owned generation is found at all", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_missing",
      ownerId: "owner_1",
      projectId: "proj_1",
      exts: VIDEO_EXTS,
    });

    expect(result).toBeNull();
  });
});
