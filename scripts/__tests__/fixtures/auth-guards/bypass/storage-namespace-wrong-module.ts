// Bypass class: a namespace import from an unaudited module cannot borrow trusted storage identity.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import * as storageModule from "../support/wrong/storage";

export async function readNamespacedWrongModuleStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storageModule.storage.get(
    storageKey(gate.ownerId, "a".repeat(64), "png"),
  );
}
