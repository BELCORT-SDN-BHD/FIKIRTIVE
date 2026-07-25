// Bypass class: a dynamically named member call is not on the pure-read allowlist and poisons.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakAfterDynamicMutatorThenTrustedPush(input: {
  extra: boolean;
  clientKey: string;
  mutator: "unshift";
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) keys[input.mutator](input.clientKey);
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
