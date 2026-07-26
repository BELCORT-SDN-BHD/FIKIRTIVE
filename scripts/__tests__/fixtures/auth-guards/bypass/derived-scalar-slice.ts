// Bypass class: slice on a derived scalar cannot preserve owner authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakSlicedDerivedScalar() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  if (!job) return null;
  const ownerId = job.id.slice(0, 8);
  return prisma.contact.findMany({ where: { ownerId } });
}
