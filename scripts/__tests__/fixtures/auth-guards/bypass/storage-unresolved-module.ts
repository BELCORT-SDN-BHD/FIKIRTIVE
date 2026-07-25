// Bypass class: an unresolved module cannot establish a trusted storage capability.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/missing-storage";

export async function readUnresolvedModuleStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storage.get(storageKey(gate.ownerId, "a".repeat(64), "png"));
}
