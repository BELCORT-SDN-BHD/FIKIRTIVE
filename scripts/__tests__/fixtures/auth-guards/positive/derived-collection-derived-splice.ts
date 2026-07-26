// Positive class: range-only numeric positions never carry a value, so an owner-derived splice/fill keeps the collection provable.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function okSplice(input: { extra: boolean }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  if (input.extra) keys.splice(0, 0, storageKey(gate.ownerId, "b".repeat(64), "png"));
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}

export async function okFillRange(input: { extra: boolean }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = new Array<string>(2);
  if (input.extra) keys.fill(storageKey(gate.ownerId, "c".repeat(64), "png"), 0, 1);
  keys.push(storageKey(gate.ownerId, "a".repeat(64), "png"));
  return Promise.all(keys.map((key) => storage.get(key)));
}
