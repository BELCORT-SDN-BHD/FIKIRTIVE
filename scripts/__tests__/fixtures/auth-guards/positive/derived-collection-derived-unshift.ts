// Positive class: an unshift that carries only owner-derived values keeps the collection provable.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function ok(input: { extra: boolean }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) keys.unshift(storageKey(gate.ownerId, "b".repeat(64), "png"));
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
