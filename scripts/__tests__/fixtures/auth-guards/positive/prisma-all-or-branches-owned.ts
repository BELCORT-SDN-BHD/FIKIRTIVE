// Positive class: OR is owner-scoped when every branch carries owner authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function listOwnedUsersAcrossOr(active: boolean) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: {
      OR: [
        { ownerId: gate.ownerId, active },
        { ownerId: gate.ownerId, active: !active },
      ],
    },
  });
}
