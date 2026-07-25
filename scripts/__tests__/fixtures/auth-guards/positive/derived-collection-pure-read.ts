// Positive class: pure allowlisted collection reads never poison an owner-derived collection.
"use server";

import { storageKey } from "@fikirtive/core";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

export async function ok(items: Array<{ hash: string; ext: string }>) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  for (const item of items) {
    keys.push(storageKey(gate.ownerId, item.hash, item.ext));
  }
  const page = keys.slice(0, 10);
  if (page.length === 0) return [];
  const out = [];
  for (const key of page) {
    out.push(await storage.get(key));
  }
  return out;
}
