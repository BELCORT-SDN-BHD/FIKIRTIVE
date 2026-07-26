// Bypass class: a non-terminating requireRole denial branch cannot authorize later work.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function leak(clientId: string) {
  const gate = await requireRole("model", "mutate");
  if ("error" in gate) {
    console.error(gate.error);
  }
  return prisma.runtimeConfig.update({
    where: { id: clientId },
    data: { value: "attacker-selected" },
  });
}
