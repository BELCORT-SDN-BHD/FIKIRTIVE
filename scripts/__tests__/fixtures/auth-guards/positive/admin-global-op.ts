// Positive class: a consumed staff/admin gate authorizes an intentionally global operation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function updateGlobalConfig(clientId: string) {
  const gate = await requireRole("model", "mutate");
  if ("error" in gate) return gate;
  return prisma.runtimeConfig.update({
    where: { id: clientId },
    data: { value: "admin-selected" },
  });
}
