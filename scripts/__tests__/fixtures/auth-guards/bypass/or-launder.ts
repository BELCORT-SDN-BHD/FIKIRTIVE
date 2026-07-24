// Bypass class: a principal-derived right operand cannot launder an attacker-controlled left operand.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakOr(attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = attackerId || gate.ownerId;
  return prisma.user.findMany({ where: { ownerId } });
}
