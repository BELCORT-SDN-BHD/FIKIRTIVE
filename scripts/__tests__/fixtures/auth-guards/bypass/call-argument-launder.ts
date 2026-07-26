// Bypass class: a call result cannot inherit principal taint merely from one safe argument.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function launder(_realOwnerId: string, attackerId: string) {
  return attackerId;
}

export async function leakCallArgument(attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: { ownerId: launder(gate.ownerId, attackerId) },
  });
}
