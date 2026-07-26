// Bypass class: poisoning a derived Map revokes owner authority from later get results.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakPoisonedMap(
  attackerId: string,
  attackerOwnerId: string,
) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const entries = rows.map((row) => [row.id, row] as const);
  const byId = new Map(entries);
  byId.set(attackerId, {
    id: attackerId,
    ownerId: attackerOwnerId,
    contentHash: "a".repeat(64),
    ext: "png",
  });
  const selected = byId.get(attackerId);
  if (!selected) return null;
  return storage.get(
    storageKey(selected.ownerId, selected.contentHash, selected.ext),
  );
}
