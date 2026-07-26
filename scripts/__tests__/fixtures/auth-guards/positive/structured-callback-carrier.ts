// Positive class: statically analyzable callback carrier forms preserve untouched derived authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function invoke(input: { mutate: () => void }) {
  input.mutate();
}

export async function updateAfterSafeStructuredCallbacks() {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  await invoke({ mutate() {} });
  await invoke({ mutate: function mutate() {} });
  const mutate = () => {};
  await invoke({ mutate });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
