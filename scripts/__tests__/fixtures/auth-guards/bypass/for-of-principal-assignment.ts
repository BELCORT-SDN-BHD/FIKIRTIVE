// Bypass class: a for-of assignment target cannot retain stale authenticated owner authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakForOfAssignment(body: { ownerIds: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  for (ownerId of body.ownerIds) {
    await prisma.contact.findMany({ where: { ownerId } });
  }
}
