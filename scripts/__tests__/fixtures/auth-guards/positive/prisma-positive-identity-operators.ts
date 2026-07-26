// Positive class: equality, in, and hasSome are positive identity constraints over owned values.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function updateWithPositiveIdentityOperators() {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  await prisma.genJob.updateMany({
    where: { id: { equals: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { in: [job.id] } },
    data: { state: "DONE" },
  });
  await prisma.broadcastAudienceMember.upsert({
    where: {
      ownerId_broadcastRunId_contactIdentityId: {
        ownerId: gate.ownerId,
        broadcastRunId: job.id,
        contactIdentityId: job.contactIdentityId,
      },
    },
    create: {
      ownerId: gate.ownerId,
      broadcastRunId: job.id,
      contactIdentityId: job.contactIdentityId,
    },
    update: {},
  });
  return prisma.genJob.updateMany({
    where: { generationIds: { hasSome: job.generationIds } },
    data: { state: "DONE" },
  });
}
