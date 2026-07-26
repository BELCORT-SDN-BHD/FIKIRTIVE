// Positive class: a post-guard non-empty collection contains an owner-derived storage key.
"use server";

import { storageKey } from "@fikirtive/core";
import { storage } from "../support/storage";
import { requireOwner } from "../support/auth-guard";

export async function ok(items: Array<{ hash: string; ext: string }>) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const verified: Array<{ key: string }> = [];
  for (const item of items) {
    const key = storageKey(gate.ownerId, item.hash, item.ext);
    verified.push({ key });
  }
  if (verified.length === 0) return [];
  const out = [];
  for (const { key } of verified) {
    out.push(await storage.get(key));
  }
  return out;
}
