// Bypass class: a non-empty guard cannot turn a client key into owner-derived storage authority.
"use server";

import { storage } from "../support/storage";
import { requireOwner } from "../support/auth-guard";

export async function leak(keys: string[]) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const verified: Array<{ key: string }> = [];
  for (const key of keys) verified.push({ key });
  if (verified.length === 0) return [];
  const out = [];
  for (const { key } of verified) {
    out.push(await storage.get(key));
  }
  return out;
}
