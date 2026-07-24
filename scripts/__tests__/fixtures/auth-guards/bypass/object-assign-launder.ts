// Bypass class: passing a principal-derived object to an unknown mutator invalidates its taint.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakObjectAssign(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  Object.assign(job, body);
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
