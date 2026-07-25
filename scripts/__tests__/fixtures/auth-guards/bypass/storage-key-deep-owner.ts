// Bypass class: an arbitrary deep path ending in ownerId is not storage-key authority.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readClientMetadataOwner() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const row = await prisma.asset.findFirst({
    where: { ownerId: gate.ownerId },
  });
  if (!row) return null;
  return storage.get(
    storageKey(row.metadata.ownerId, row.contentHash, row.ext),
  );
}
