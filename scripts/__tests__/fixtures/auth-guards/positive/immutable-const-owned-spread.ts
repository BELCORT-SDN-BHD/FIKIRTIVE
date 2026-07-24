// Positive class: a never-mutated const owner filter retains authority through object spread.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readWithImmutableOwnedSpread(id: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  return prisma.genJob.findFirst({
    where: { ...OWNED, id },
  });
}
