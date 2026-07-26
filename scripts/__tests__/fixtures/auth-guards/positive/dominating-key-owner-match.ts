// Positive class: a dominating owner-key match authorizes the checked storage key.
"use server";

import { keyOwnerMatches } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readCheckedStorage(key: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!keyOwnerMatches(key, gate.ownerId)) return null;
  return storage.get(key);
}
