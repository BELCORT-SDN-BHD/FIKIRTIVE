// Positive class: object storage accepts a key derived from the authenticated owner.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readOwnedStorage() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const key = storageKey(gate.ownerId, "content-hash", "png");
  return storage.get(key);
}
