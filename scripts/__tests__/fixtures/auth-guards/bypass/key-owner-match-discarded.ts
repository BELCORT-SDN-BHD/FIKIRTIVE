// Bypass class: a discarded plain-key owner match does not dominate later storage I/O.
"use server";

import { keyOwnerMatches } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readAfterDiscardedKeyMatch(key: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  keyOwnerMatches(key, gate.ownerId);
  return storage.get(key);
}
