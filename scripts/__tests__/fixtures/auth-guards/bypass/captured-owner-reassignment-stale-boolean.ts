// Bypass class: a stale boolean fact cannot erase the live path after a captured owner overwrite.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakThroughStaleBoolean(body: {
  ownerId: string;
  shouldQuery: boolean;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  await prisma.contact.findMany({ where: { ownerId } });
  let shouldQuery = body.shouldQuery;
  function overwriteOwner() {
    ownerId = body.ownerId;
    shouldQuery = false;
  }
  if (shouldQuery) {
    overwriteOwner();
    if (!shouldQuery) {
      return prisma.contact.findMany({ where: { ownerId } });
    }
  }
  return [];
}
