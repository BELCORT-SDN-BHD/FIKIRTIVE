// Bypass class: an imported object-valued surface cannot hide a tracked storage capability.
"use server";

import { storageKey } from "@fikirtive/core";
import { boundedReads } from "@fikirtive/storage";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakWorkspaceStorageSurface() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const key = storageKey(gate.ownerId, "a".repeat(64), "png");
  return boundedReads.readBoundedPrefix(storage, key, 16);
}
