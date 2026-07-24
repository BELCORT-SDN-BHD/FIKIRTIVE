// Bypass class: one owner-scoped OR branch cannot scope its unowned sibling.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakPartiallyOwnedOr(attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  return prisma.user.findMany({
    where: {
      OR: [{ ownerId }, { id: attackerId }],
    },
  });
}
