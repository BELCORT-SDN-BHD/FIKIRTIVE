// Bypass class: an alias push can make an unsafe collection non-empty before a length guard.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakThroughAliasPush(input: {
  useCallback: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const keys: string[] = [];
  const alias = keys;
  if (input.useCallback) {
    rows.forEach(() => {
      alias.push(input.clientKey);
    });
  } else {
    keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  }
  if (keys.length === 0) return [];
  const out = [];
  for (const key of keys) {
    out.push(await storage.get(key));
  }
  return out;
}
