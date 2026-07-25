// Positive class: a namespace import from the audited storage module retains capability identity.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import * as storageModule from "../support/storage";

export async function readNamespacedStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storageModule.storage.get(
    storageKey(gate.ownerId, "a".repeat(64), "png"),
  );
}
