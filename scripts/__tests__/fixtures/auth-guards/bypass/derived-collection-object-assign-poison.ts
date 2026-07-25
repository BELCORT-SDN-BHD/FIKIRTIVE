// Bypass class: a trusted push cannot erase an Object.assign-written attacker-controlled element.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakAfterObjectAssignThenTrustedPush(input: {
  extra: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) Object.assign(keys, { 0: input.clientKey, length: 1 });
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
