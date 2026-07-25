// Positive class: owner-scoped rows retain storage-key authority inside a map callback.

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { storage } from "../support/storage";

export async function readOwnedStorageRows(ownerId: string) {
  const rows = await prisma.generation.findMany({
    where: { ownerId },
    include: { asset: true },
  });
  return Promise.all(
    rows.map(async (row) =>
      storage.get(storageKey(row.asset.ownerId, row.asset.contentHash, row.asset.ext)),
    ),
  );
}
