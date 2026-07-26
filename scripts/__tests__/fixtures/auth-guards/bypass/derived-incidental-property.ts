// Bypass class: a shared value from an owned row is not an identity key for a later operation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakIncidentalProperty(attackerId: string) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  return prisma.genJob.updateMany({
    where: {
      status: job.status,
      OR: [{ id: attackerId }, { archived: true }],
    },
    data: { state: "DONE" },
  });
}

export async function leakDerivedIdInValueField(attackerId: string) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  return prisma.genJob.updateMany({
    where: {
      status: job.id,
      OR: [{ id: attackerId }, { archived: true }],
    },
    data: { state: "DONE" },
  });
}
