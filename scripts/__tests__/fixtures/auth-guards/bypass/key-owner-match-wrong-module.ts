// Bypass class: a same-named keyOwnerMatches from the wrong module grants no key authority.
"use server";

import { requireOwner } from "../support/auth-guard";
import { keyOwnerMatches } from "../support/wrong/key-owner-match";
import { storage } from "../support/storage";

export async function readWrongModuleCheckedKey(key: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!keyOwnerMatches(key, gate.ownerId)) return null;
  return storage.get(key);
}
