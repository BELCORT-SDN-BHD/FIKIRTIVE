import "server-only";
import { prisma } from "@fikirtive/db";

/** Frozen provenance written into every Generation (schema: required, never
 *  null). Shared by the legacy upload action and the direct-upload finalize. */
export async function buildEntitySnapshot(ownerId: string, entityIds: string[]) {
  if (entityIds.length === 0) return { entities: [] };
  const entities = await prisma.entity.findMany({
    where: { id: { in: entityIds }, ownerId },
    include: { referenceImages: { where: { deletedAt: null }, include: { asset: true } } },
  });
  return {
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      refHashes: e.referenceImages.map((r) => r.asset.contentHash),
    })),
  };
}
