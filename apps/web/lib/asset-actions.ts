"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage, kindOf, extFromFilename, mimeOf } from "./storage";

export type GenerationDTO = {
  id: string;
  projectId: string;
  url: string;
  urls: string[];
  // Sibling variants aligned to `urls`, each with its OWN generation id (F08) and saved state.
  // The panel must
  // act on the SELECTED variant's id — not the primary `id` — for animate/delete/favorite/edit,
  // or it spends on / mutates the wrong image when a sibling variant is displayed.
  variants: { id: string; url: string; favorite: boolean }[];
  kind: string;
  prompt: string;
  favorite: boolean;
  sourceGenerationId: string | null;
};

export async function getGeneration(
  generationId: string,
): Promise<GenerationDTO | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      promptText: true,
      favorite: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true } },
    },
  });
  if (!gen) return { error: "Not found." };

  // Resolve the source generation ID: find the GenJob that produced this
  // generation and carried a sourceGenerationId (i.e., this was an i2v result).
  const job = await prisma.genJob.findFirst({
    where: { generationIds: { has: generationId }, ownerId },
    select: { sourceGenerationId: true, generationIds: true },
  });

  const { asset } = gen;
  const url = storage.url(storageKey(asset.ownerId, asset.contentHash, asset.ext));

  // Resolve sibling variants (id + url) from the producing GenJob's generationIds array
  // (owner-scoped). Kept as an aligned {id, url}[] so the panel can act on the SELECTED
  // variant's own generation id, not just show its url (F08).
  let variants: { id: string; url: string; favorite: boolean }[] = [{ id: gen.id, url, favorite: gen.favorite }];
  if (job && job.generationIds.length > 1) {
    const siblingIds = job.generationIds.filter((id) => id !== generationId);
    const siblings = await prisma.generation.findMany({
      where: { id: { in: siblingIds }, ownerId, deletedAt: null },
      select: { id: true, favorite: true, asset: { select: { ownerId: true, contentHash: true, ext: true } } },
    });
    const siblingMap = new Map(siblings.map((s) => [s.id, s]));
    // Preserve the original generationIds order; each entry carries its own id (a missing
    // sibling — soft-deleted — is dropped as a whole {id,url} pair, so id/url never misalign).
    variants = job.generationIds.flatMap((id) => {
      if (id === generationId) return [{ id, url, favorite: gen.favorite }];
      const sib = siblingMap.get(id);
      if (!sib) return [];
      return [{ id, url: storage.url(storageKey(sib.asset.ownerId, sib.asset.contentHash, sib.asset.ext)), favorite: sib.favorite }];
    });
    if (!variants.some((v) => v.id === generationId)) variants = [{ id: gen.id, url, favorite: gen.favorite }, ...variants];
  }

  return {
    id: gen.id,
    projectId: gen.projectId,
    url,
    urls: variants.map((v) => v.url),
    variants,
    kind: kindOf(asset.ext),
    prompt: gen.promptText,
    favorite: gen.favorite,
    sourceGenerationId: job?.sourceGenerationId ?? null,
  };
}

/**
 * Ingest a cropped image (data URL) as a derived Generation row.
 * No paid model is called — this is a pure upload/ingest path.
 */
export async function saveCroppedGeneration(
  sourceGenerationId: string,
  dataUrl: string,
): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  // Verify ownership of the source generation
  const source = await prisma.generation.findFirst({
    where: { id: sourceGenerationId, ownerId, deletedAt: null },
    select: { projectId: true, promptText: true },
  });
  if (!source) return { error: "Not found." };

  // Parse the data URL: data:image/<ext>;base64,<data>
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!match) return { error: "Invalid data URL." };
  const mimeType = `image/${match[1]}`;
  const base64Data = match[2];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) {
    return { error: "Invalid data URL." };
  }
  const bytes = Uint8Array.from(Buffer.from(base64Data, "base64"));
  if (bytes.byteLength === 0) return { error: "Invalid data URL." };

  // Build a File so we can reuse the ingestFile path via storage.put directly
  // (ingestFile is not exported, so replicate its logic inline)
  const ext = extFromFilename(`cropped.${match[1]}`);
  const { contentHash } = await storage.put(ownerId, bytes, ext);

  const assetCreate = {
    id: newId(),
    ownerId,
    contentHash,
    ext,
    mime: mimeType || mimeOf(ext),
    sizeBytes: BigInt(bytes.byteLength),
    originalFilename: `cropped.${ext}`,
    source: "UPLOAD" as const,
  };

  let newGenId = "";
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.upsert({
      where: { ownerId_contentHash: { ownerId, contentHash } },
      update: { deletedAt: null },
      create: assetCreate,
    });
    const gen = await tx.generation.create({
      data: {
        id: newId(),
        ownerId,
        projectId: source.projectId,
        shotId: null,
        assetId: asset.id,
        source: "UPLOAD",
        promptText: source.promptText || "cropped",
        entitySnapshot: { entities: [] },
      },
    });
    newGenId = gen.id;
  });

  return { id: newGenId };
}

export async function setFavorite(
  generationId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const result = await prisma.generation.updateMany({
    where: { id: generationId, ownerId, deletedAt: null },
    data: { favorite },
  });

  return result.count === 1 ? { favorite } : { error: "Not found." };
}
