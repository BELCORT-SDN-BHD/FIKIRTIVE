// Positive class: one owner-scoped AND branch narrows every matching result.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function listOwnedActiveUsers(active: boolean) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: {
      AND: [{ ownerId: gate.ownerId }, { active }],
    },
  });
}
