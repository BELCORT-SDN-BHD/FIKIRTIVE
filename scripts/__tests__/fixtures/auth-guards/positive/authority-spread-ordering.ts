// Positive class: ordered spreads preserve authority when a later proven key remains.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readWithLeadingUntrustedSpread(
  untrustedFilter: Record<string, unknown>,
) {
  const gate = await requireOwner();
  return prisma.genJob.findMany({
    where: {
      ...untrustedFilter,
      OR: [{ ownerId: gate.ownerId }, { ownerId: gate.ownerId }],
    },
  });
}

export async function readWithTrailingKnownNeutralSpread() {
  const gate = await requireOwner();
  return prisma.genJob.findMany({
    where: {
      OR: [{ ownerId: gate.ownerId }, { ownerId: gate.ownerId }],
      ...{ status: "READY" },
    },
  });
}

export async function readWithTrailingDerivedSpread(attackerId: string) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { id: attackerId, ownerId: gate.ownerId },
    select: { ownerId: true },
  });
  const { ownerId } = job;
  const OWNED = { ownerId } as const;
  return prisma.genJob.findMany({
    where: {
      OR: [{ id: attackerId }, { archived: true }],
      ...OWNED,
    },
  });
}
