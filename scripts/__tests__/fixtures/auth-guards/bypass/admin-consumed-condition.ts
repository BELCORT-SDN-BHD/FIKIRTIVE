// Bypass class: a requireRole result consumed only as a condition cannot authorize a global operation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function leak(clientId: string) {
  if (await requireRole("model", "mutate")) {
    return prisma.runtimeConfig.update({
      where: { id: clientId },
      data: { value: "attacker-selected" },
    });
  }
  return null;
}
