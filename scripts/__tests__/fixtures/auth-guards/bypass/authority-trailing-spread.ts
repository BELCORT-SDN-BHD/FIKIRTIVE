// Bypass class: an untrusted trailing spread may overwrite a previously owned OR filter.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakTrailingSpread(
  untrustedFilter: Record<string, unknown>,
) {
  const gate = await requireOwner();
  return prisma.genJob.updateMany({
    where: {
      OR: [{ ownerId: gate.ownerId }, { ownerId: gate.ownerId }],
      ...untrustedFilter,
    },
    data: { state: "DONE" },
  });
}
