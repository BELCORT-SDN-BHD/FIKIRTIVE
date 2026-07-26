// Bypass class: discarding a staff/admin resolver result cannot authorize a global operation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function leak(clientId: string) {
  await requireRole("model", "mutate");
  return prisma.runtimeConfig.update({
    where: { id: clientId },
    data: { value: "attacker-selected" },
  });
}
