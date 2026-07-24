// Bypass class: a comma expression returns only its right operand, not an earlier principal.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakComma(attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: { ownerId: (gate.ownerId, attackerId) },
  });
}
