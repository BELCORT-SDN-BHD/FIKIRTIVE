// Bypass class: an unresolved element callback may mutate a captured principal-derived object.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakElementCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  const handlers = [() => {
    job.id = body.ids[0];
  }];
  body.ids.forEach(handlers[0]);
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
