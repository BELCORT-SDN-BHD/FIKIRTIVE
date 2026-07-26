// Bypass class: a trusted push cannot erase an earlier spliced attacker-controlled element.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakAfterSpliceThenTrustedPush(input: {
  extra: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) keys.splice(0, 0, input.clientKey);
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
