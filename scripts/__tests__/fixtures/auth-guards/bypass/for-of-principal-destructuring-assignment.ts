// Bypass class: a destructuring for-of assignment target cannot retain stale owner authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakForOfDestructuringAssignment(body: { rows: Array<[string]> }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  for ([ownerId] of body.rows) {
    await prisma.contact.findMany({ where: { ownerId } });
  }
}
