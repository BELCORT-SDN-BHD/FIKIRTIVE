// Bypass class: AND cannot rescue a nested OR unless every OR branch is owner-scoped.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakNestedUnscopedOr(attackerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: {
      AND: [
        {
          OR: [{ ownerId: gate.ownerId }, { id: attackerId }],
        },
      ],
    },
  });
}
