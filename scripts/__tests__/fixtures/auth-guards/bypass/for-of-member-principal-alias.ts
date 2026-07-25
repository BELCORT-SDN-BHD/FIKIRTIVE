// Bypass class: a for-of member target must invalidate every alias of the principal object.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakThroughMemberLoopTarget(body: { ownerIds: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const alias = gate;
  for (gate.ownerId of body.ownerIds) {
    // The assignment target itself overwrites the shared principal object.
  }
  return prisma.contact.findMany({ where: { ownerId: alias.ownerId } });
}
