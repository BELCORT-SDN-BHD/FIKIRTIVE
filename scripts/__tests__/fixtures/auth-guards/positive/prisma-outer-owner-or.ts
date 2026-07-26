// Positive class: outer owner authority AND-combines with the entire OR.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function listOwnedUsersWithOuterOr(firstId: string, secondId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: {
      ownerId: gate.ownerId,
      OR: [{ id: firstId }, { id: secondId }],
    },
  });
}
