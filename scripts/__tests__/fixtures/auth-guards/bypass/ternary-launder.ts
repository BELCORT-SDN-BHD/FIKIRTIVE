// Bypass class: one principal-derived ternary branch cannot launder an attacker-controlled branch.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakAssignedTernary(attackerFlag: boolean, attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = attackerFlag ? attackerId : gate.ownerId;
  return prisma.user.findMany({ where: { ownerId } });
}

export async function leakInlineTernary(attackerFlag: boolean, attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: { ownerId: attackerFlag ? attackerId : gate.ownerId },
  });
}
