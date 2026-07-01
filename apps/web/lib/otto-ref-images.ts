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
  sourceGenerationId: string | null | undefined,
): Promise<RefImage[]> {
  if (!sourceGenerationId) return [];
  const { enabled, maxBytes } = await resolveVisionConfig();
  if (!enabled) return [];
  try {
    const gen = await prisma.generation.findFirst({
      where: {
        id: sourceGenerationId,
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
  } catch {
    return []; // read/query error → skip; NEVER throw the turn
  }
}
