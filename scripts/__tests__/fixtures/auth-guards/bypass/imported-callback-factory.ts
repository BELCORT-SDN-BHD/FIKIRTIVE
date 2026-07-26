// Bypass class: an imported callback factory return remains unresolved and fail-closed.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { makeMutatingCallback } from "../support/imported-callbacks";

export async function leakAfterImportedCallbackFactory(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const row = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  if (!row) return { error: "not found" };
  const callback = makeMutatingCallback(row);
  body.ids.forEach(callback);
  return prisma.genJob.update({
    where: { id: row.id },
    data: { status: "DONE" },
  });
}
