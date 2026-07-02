/**
 * validateOwnedGenerationExt — shared owner/project/ext-scoped Generation lookup.
 *
 * Used by both the "sourceGenerationId" (image-ext, i2v source frame) and
 * "referenceVideoGenerationId" (video-ext, whole-clip reference) validators in
 * ottoTurn (lib/otto-actions.ts) and the streaming route (app/api/otto/stream/route.ts).
 * Pure pass-through to prisma.generation.findFirst — no side effects, easy to unit test.
 */
import type { PrismaClient } from "@fikirtive/db";

export async function validateOwnedGenerationExt(
  prisma: Pick<PrismaClient, "generation">,
  { id, ownerId, projectId, exts }: { id: string; ownerId: string; projectId: string; exts: string[] },
): Promise<string | null> {
  const g = await prisma.generation.findFirst({
    where: {
      id,
      ownerId,
      deletedAt: null,
      projectId,
      asset: { ext: { in: exts } },
    },
    select: { id: true },
  });
  return g?.id ?? null;
}
