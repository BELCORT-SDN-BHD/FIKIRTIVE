// Bypass class: a for-of declaration cannot inherit authority from an outer same-named principal.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakLoopShadow(body: { ownerIds: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = gate.ownerId;
  for (const ownerId of body.ownerIds) {
    await prisma.contact.findMany({ where: { ownerId } });
  }
  return ownerId;
}
