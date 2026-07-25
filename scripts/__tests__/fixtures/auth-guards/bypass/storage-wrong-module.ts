// Bypass class: a same-name export from an unaudited module is not a trusted storage capability.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/wrong/storage";

export async function readWrongModuleStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storage.get(storageKey(gate.ownerId, "a".repeat(64), "png"));
}
