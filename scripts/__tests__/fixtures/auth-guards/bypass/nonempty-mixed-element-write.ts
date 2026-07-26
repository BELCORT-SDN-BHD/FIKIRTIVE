// Bypass class: an element write can make an unsafe collection non-empty before a length guard.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakThroughElementWrite(input: {
  useCallback: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const keys: string[] = [];
  if (input.useCallback) {
    rows.forEach(() => {
      keys[keys.length] = input.clientKey;
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
