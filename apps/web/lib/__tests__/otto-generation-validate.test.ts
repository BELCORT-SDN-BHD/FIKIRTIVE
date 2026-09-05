/**
 * otto-generation-validate.test.ts — unit tests for the shared owned+ext Generation
 * validator used by both sourceGenerationId (image-ext) and referenceVideoGenerationId
 * (video-ext) validation in otto-actions.ts and stream/route.ts.
 *
 * Codex QA-CRE-FE9-013(CREATE-A2)—— 这里最要紧的一条是 `projectId` **不在** where 里:
 * 它进去过一次,跨画布的引用就是从那一格开始被静默丢掉的。
 */
import { describe, it, expect, vi } from "vitest";
import { validateOwnedGenerationExt } from "../otto-generation-validate";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];

const row = (id: string, projectId: string, ext: string) => ({
  id,
  projectId,
  promptText: "blue ceramic cup",
  asset: { ownerId: "owner_1", contentHash: "h".repeat(64), ext },
});

describe("validateOwnedGenerationExt", () => {
  it("accepts a generation whose asset ext matches the video-ext allowlist (reference video)", async () => {
    const findFirst = vi.fn().mockResolvedValue(row("gen_vid", "proj_1", "mp4"));
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_vid",
      ownerId: "owner_1",
      exts: VIDEO_EXTS,
    });

    expect(result?.id).toBe("gen_vid");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "gen_vid",
        ownerId: "owner_1",
        deletedAt: null,
        asset: { ext: { in: VIDEO_EXTS } },
      },
      select: {
        id: true,
        projectId: true,
        promptText: true,
        asset: { select: { ownerId: true, contentHash: true, ext: true } },
      },
    });
  });

  it("CREATE-A2 Codex QA-CRE-FE9-013:引用范围是租户,不是画布 —— where 里一格 projectId 都不许有", async () => {
    const findFirst = vi.fn().mockResolvedValue(row("gen_cup", "canvas_a", "png"));
    const prisma = { generation: { findFirst } };

    // 画布 B 的这一轮引用画布 A 生成的杯子:校验器解得出来,而且解出来的那一行会把它的
    // 出处(canvas_a)带回去当回执,不是拿它当过滤条件。
    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_cup",
      ownerId: "owner_1",
      exts: IMAGE_EXTS,
    });

    expect(result).toEqual({
      id: "gen_cup",
      projectId: "canvas_a",
      prompt: "blue ceramic cup",
      asset: { ownerId: "owner_1", contentHash: "h".repeat(64), ext: "png" },
    });
    expect(JSON.stringify(findFirst.mock.calls[0]?.[0]?.where)).not.toContain("projectId");
  });

  it("CREATE-A2:租户那一格没有松 —— ownerId 与软删仍然逐字在 where 里", async () => {
    const findFirst = vi.fn().mockResolvedValue(row("gen_img", "canvas_a", "png"));
    const prisma = { generation: { findFirst } };

    await validateOwnedGenerationExt(prisma, { id: "gen_img", ownerId: "owner_1", exts: IMAGE_EXTS });

    const where = findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.ownerId).toBe("owner_1");
    expect(where.deletedAt).toBeNull();
  });

  it("rejects (returns null) when the id's asset ext is image-ext, not video-ext", async () => {
    // Simulate the DB query itself filtering out non-matching ext (findFirst finds nothing).
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_img",
      ownerId: "owner_1",
      exts: VIDEO_EXTS,
    });

    expect(result).toBeNull();
  });

  it("still accepts image-ext lookups (sourceGenerationId behavior unchanged)", async () => {
    const findFirst = vi.fn().mockResolvedValue(row("gen_img", "proj_1", "png"));
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_img",
      ownerId: "owner_1",
      exts: IMAGE_EXTS,
    });

    expect(result?.id).toBe("gen_img");
  });

  it("returns null when no matching owned generation is found at all", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { generation: { findFirst } };

    const result = await validateOwnedGenerationExt(prisma, {
      id: "gen_missing",
      ownerId: "owner_1",
      exts: VIDEO_EXTS,
    });

    expect(result).toBeNull();
  });
});
