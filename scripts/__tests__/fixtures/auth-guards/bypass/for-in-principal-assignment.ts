// Bypass class: a for-in assignment target cannot retain stale authenticated owner authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakForInAssignment(body: { contactsByOwner: Record<string, unknown> }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  for (ownerId in body.contactsByOwner) {
    await prisma.contact.findMany({ where: { ownerId } });
  }
}
