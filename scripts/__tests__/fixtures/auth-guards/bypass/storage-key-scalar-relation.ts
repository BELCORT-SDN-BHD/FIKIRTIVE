// Bypass class: a scalar derived binding cannot authorize a canonical object relation.
"use server";

import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakScalarRelation() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const row = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  if (!row) return null;
  const scalar = row.id;
  const key = storageKey(scalar.asset.ownerId, "a".repeat(64), "png");
  return storage.get(key);
}
