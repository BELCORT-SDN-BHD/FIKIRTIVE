// Bypass class: an unresolved workspace-package helper cannot hide a tracked storage capability.
"use server";

import { storageKey } from "@fikirtive/core";
import { readBoundedPrefix } from "@fikirtive/storage";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakWorkspaceStorageHelper() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const key = storageKey(gate.ownerId, "a".repeat(64), "png");
  return readBoundedPrefix(storage, key, 16);
}
