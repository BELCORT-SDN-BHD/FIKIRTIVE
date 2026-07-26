// Bypass class: a multi-binding requireRole destructure cannot authorize a global operation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function leak(clientId: string) {
  const { email, role } = await requireRole("model", "mutate");
  void email;
  void role;
  return prisma.runtimeConfig.update({
    where: { id: clientId },
    data: { value: "attacker-selected" },
  });
}
