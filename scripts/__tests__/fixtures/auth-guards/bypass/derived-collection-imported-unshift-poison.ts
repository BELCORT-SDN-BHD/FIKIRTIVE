// Bypass class: an imported helper that unshifts poisons the caller's collection.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";
import { unshiftKey } from "../support/unshift-keys";

export async function leakAfterImportedUnshiftThenTrustedPush(input: {
  extra: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) unshiftKey(keys, input.clientKey);
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
