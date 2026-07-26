// Bypass class: mentioning the owner inside an unmodeled key composition is not authority.
"use server";

import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function readComposedStorageKey(attackerKey: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return storage.get(`${attackerKey}:${gate.ownerId}`);
}
