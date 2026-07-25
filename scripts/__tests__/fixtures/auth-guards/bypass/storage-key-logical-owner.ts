// Bypass class: storageKey owner authority does not accept logical composition.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readLogicalOwnerStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storage.get(
    storageKey(gate.ownerId || gate.ownerId, "a".repeat(64), "png"),
  );
}
