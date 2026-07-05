import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import type { RefImage } from "@fikirtive/otto";
import { storage, mimeOf } from "./storage";
import { resolveVisionConfig } from "./runtime-config";

/**
 * Resolve the turn's dropped reference (a Generation id — already validated owned +
 * in-project + image-ext by the caller) to a bounded base64 data URL for Otto's vision.
 * Best-effort: returns [] on disabled-vision / miss / oversize / read error — NEVER throws,
 * so a bad reference degrades to a text-only turn instead of failing the run.
 */
export async function gatherReferenceImages(
  ownerId: string,
  projectId: string,
  sourceGenerationId: string | string[] | null | undefined,
): Promise<RefImage[]> {
  const requestedIds = Array.isArray(sourceGenerationId)
    ? [...new Set(sourceGenerationId.filter(Boolean))]
    : sourceGenerationId ? [sourceGenerationId] : [];
  if (requestedIds.length === 0) return [];
  const { enabled, maxImages, maxBytes } = await resolveVisionConfig();
  if (!enabled) return [];
  const ids = requestedIds.slice(0, Math.max(1, maxImages));
  try {
    if (ids.length === 1) {
      const gen = await prisma.generation.findFirst({
        where: {
          id: ids[0],
          ownerId,
          projectId,
          deletedAt: null,
          asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } },
        },
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
      where: {
        id: { in: ids },
        ownerId,
        projectId,
        deletedAt: null,
        asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } },
      },
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
