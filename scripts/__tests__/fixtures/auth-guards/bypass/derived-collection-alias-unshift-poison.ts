// Bypass class: an aliased unshift poisons the whole lexical alias group, not just the alias.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function leakAfterAliasUnshiftThenTrustedPush(input: {
  extra: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  const alias = keys;
  if (input.extra) alias.unshift(input.clientKey);
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
