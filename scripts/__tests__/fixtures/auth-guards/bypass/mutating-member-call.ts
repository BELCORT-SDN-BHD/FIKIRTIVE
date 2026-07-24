// Bypass class: a mutating member call invalidates the captured principal-derived parent object.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakMutatingMemberCall(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  job.targetIds.push(body.targetId);
  return prisma.genJob.update({
    where: { id: job.id },
    data: { status: "DONE" },
  });
}
