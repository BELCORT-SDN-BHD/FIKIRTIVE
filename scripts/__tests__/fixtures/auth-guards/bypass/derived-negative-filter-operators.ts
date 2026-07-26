// Bypass class: negative, relational, quantified, and unknown filters cannot turn an owned id into positive authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakNegativeFilters() {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });

  await prisma.genJob.updateMany({
    where: { id: { not: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { notIn: [job.id] } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { gt: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { gte: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { lt: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { id: { lte: job.id } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { project: { isNot: { id: job.projectId } } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { children: { none: { id: job.id } } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { children: { every: { id: job.id } } },
    data: { state: "DONE" },
  });
  await prisma.genJob.updateMany({
    where: { generationIds: { hasEvery: job.generationIds } },
    data: { state: "DONE" },
  });
  return prisma.genJob.updateMany({
    where: { id: { unknownOperator: job.id } },
    data: { state: "DONE" },
  });
}
