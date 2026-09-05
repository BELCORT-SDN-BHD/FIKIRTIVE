import { prisma } from "@fikirtive/db";
import { storageKey, generationReferenceScope, REFERENCE_IMAGE_EXTS } from "@fikirtive/core";
import type { RefImage } from "@fikirtive/otto";
import { storage, mimeOf } from "./storage";
import { resolveVisionConfig } from "./runtime-config";

/**
 * Resolve the turn's dropped references (Generation ids — already validated owned +
 * image-ext by the caller) to bounded base64 data URLs for Otto's vision.
 * Best-effort: returns [] on disabled-vision / miss / oversize / read error — NEVER throws,
 * so a bad reference degrades to a text-only turn instead of failing the run.
 *
 * ── 2026-09-04,Codex QA-CRE-FE9-013 —— 少掉的那一格 projectId ──────────────────
 *
 * 这里从前还按 `projectId` 过滤。商家在画布 B 引用画布 A 的产品图时,校验器与这里**两处**
 * 都把它滤掉,于是 Otto 明明收到了 id 却看不到那张图,回答「我没看到你说的蓝杯子」。
 * 判据现在只有 `generationReferenceScope` 一份(同一 owner、活着、图片扩展名),与
 * 校验器、付费前守卫、worker 共读 —— 画布是出处,不是权限边界。
 */
export async function gatherReferenceImages(
  ownerId: string,
  sourceGenerationId: string | string[] | null | undefined,
): Promise<RefImage[]> {
  const requestedIds = Array.isArray(sourceGenerationId)
    ? [...new Set(sourceGenerationId.filter(Boolean))]
    : sourceGenerationId ? [sourceGenerationId] : [];
  if (requestedIds.length === 0) return [];
  const { enabled, maxImages, maxBytes } = await resolveVisionConfig();
  if (!enabled) return [];
  const ids = requestedIds.slice(0, Math.max(1, maxImages));
  const scope = generationReferenceScope(ownerId, REFERENCE_IMAGE_EXTS);
  try {
    if (ids.length === 1) {
      const gen = await prisma.generation.findFirst({
        where: { id: ids[0], ...scope },
        include: { asset: { select: { ownerId: true, contentHash: true, ext: true, sizeBytes: true } } },
      });
      const asset = gen?.asset;
      if (!asset) return [];
      if (asset.sizeBytes != null && Number(asset.sizeBytes) > maxBytes) return [];
      const bytes = await storage.get(storageKey(asset.ownerId, asset.contentHash, asset.ext));
      if (bytes.length > maxBytes) return [];
      return [{ label: "reference", dataUrl: `data:${mimeOf(asset.ext)};base64,${Buffer.from(bytes).toString("base64")}` }];
    }

    const gens = await prisma.generation.findMany({
      where: { id: { in: ids }, ...scope },
      include: { asset: { select: { ownerId: true, contentHash: true, ext: true, sizeBytes: true } } },
    });
    const byId = new Map(gens.map((gen) => [gen.id, gen]));
    const refs: RefImage[] = [];
    for (const id of ids) {
      const asset = byId.get(id)?.asset;
      if (!asset) continue;
      if (asset.sizeBytes != null && Number(asset.sizeBytes) > maxBytes) continue;
      try {
        const bytes = await storage.get(storageKey(asset.ownerId, asset.contentHash, asset.ext));
        if (bytes.length > maxBytes) continue;
        refs.push({
          label: `reference ${refs.length + 1}`,
          dataUrl: `data:${mimeOf(asset.ext)};base64,${Buffer.from(bytes).toString("base64")}`,
        });
      } catch {
        // One bad reference should not make Otto blind to the other attached refs.
      }
    }
    return refs;
  } catch {
    return []; // read/query error → skip; NEVER throw the turn
  }
}
