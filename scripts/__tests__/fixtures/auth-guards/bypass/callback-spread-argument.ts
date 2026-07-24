// Bypass class: a spread in a known callback slot can hide a mutator callback.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakSpreadCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  const mutators = {
    corrupt() {
      job.id = body.ids[0];
    },
  };
  body.ids.forEach(...([mutators.corrupt] as const));
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
