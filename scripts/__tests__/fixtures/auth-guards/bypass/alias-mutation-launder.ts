// Bypass class: writing through an alias invalidates the whole principal-derived object group.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakAliasMutation(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  const alias = job;
  alias.targetId = body.targetId;
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
