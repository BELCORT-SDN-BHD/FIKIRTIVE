// Bypass class: an object rebuild cannot inherit trust from one principal-derived spread.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakSpreadRebuild(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  const rebuilt = { ...job, targetId: body.targetId };
  return prisma.genJob.update({
    where: { id: rebuilt.targetId },
    data: { status: "DONE" },
  });
}
