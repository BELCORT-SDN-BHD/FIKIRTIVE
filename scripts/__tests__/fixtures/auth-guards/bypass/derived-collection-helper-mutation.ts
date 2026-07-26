// Bypass class: opaque helper mutation revokes owner authority from a derived collection.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { poisonRows } from "../support/mutate-rows";
import { storage } from "../support/storage";

export async function leakMutatedCollection(attackerOwnerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const sliced = rows.slice();
  const copied = sliced.map((row) => row);
  poisonRows(copied, attackerOwnerId);
  return Promise.all(
    copied.map((row) =>
      storage.get(storageKey(row.ownerId, row.contentHash, row.ext)),
    ),
  );
}
