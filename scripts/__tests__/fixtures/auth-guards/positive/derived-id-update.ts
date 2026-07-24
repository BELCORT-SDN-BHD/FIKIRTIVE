// Positive class: principal-scoped read results keep their authority through supported local forms.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function updateByOwnedId(id: string) {
  return prisma.genJob.update({ where: { id }, data: { status: "DONE" } });
}

export async function updateOwnedJobs(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const jobs = await prisma.genJob.findMany({
    where: { ownerId: gate.ownerId },
    select: { id: true },
  });
  const ids = jobs.map((job) => job.id);
  const [firstMappedId] = ids;

  const job = await prisma.genJob.findFirst({
    where: { id: clientId, ownerId: gate.ownerId },
    select: { id: true },
  });
  const { id: ownedId } = job;
  const chainedId = ownedId;

  await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE" } });
  await prisma.genJob.updateMany({
    where: { id: { in: ids } },
    data: { status: "DONE" },
  });
  await updateByOwnedId(chainedId);
  return updateByOwnedId(firstMappedId);
}

export async function updateValidatedClientId(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = await prisma.genJob.findFirst({
    where: { id: clientId, ownerId: gate.ownerId },
    select: { id: true },
  });
  if (!job) return { error: "not found" };
  return prisma.genJob.update({
    where: { id: clientId },
    data: { status: "DONE" },
  });
}
