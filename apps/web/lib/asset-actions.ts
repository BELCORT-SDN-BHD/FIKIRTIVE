"use server";

import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage, kindOf } from "./storage";

export type GenerationDTO = {
  id: string;
  url: string;
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
    select: { sourceGenerationId: true },
  });

  const { asset } = gen;
  const url = storage.url(storageKey(asset.ownerId, asset.contentHash, asset.ext));

  return {
    id: gen.id,
    url,
    kind: kindOf(asset.ext),
    prompt: gen.promptText,
    favorite: gen.favorite,
    sourceGenerationId: job?.sourceGenerationId ?? null,
  };
}

export async function setFavorite(
  generationId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const result = await prisma.generation.updateMany({
    where: { id: generationId, ownerId },
    data: { favorite },
  });

  return result.count === 1 ? { favorite } : { error: "Not found." };
}
