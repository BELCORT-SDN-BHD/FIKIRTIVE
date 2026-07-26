// Bypass class: an array element selection is not principal-derived when another element is attacker-controlled.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakArrayPick(attackerId: string, index: number) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: { ownerId: [attackerId, gate.ownerId][index] },
  });
}
