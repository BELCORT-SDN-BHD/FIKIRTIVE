// Bypass class: non-empty correlation cannot erase all states after a callback-side push.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakAfterCallbackPush(input: { contactId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const keys: string[] = [];
  rows.forEach((row) => {
    keys.push(storageKey(gate.ownerId, row.contentHash, row.ext));
  });
  if (keys.length === 0) return [];
  return prisma.contact.deleteMany({ where: { id: input.contactId } });
}
