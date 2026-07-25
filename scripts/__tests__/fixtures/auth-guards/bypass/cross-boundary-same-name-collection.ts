// Bypass class: a same-named callee local cannot sever caller collection invalidation.
"use server";

import { requireOwner } from "../support/auth-guard";
import { appendShadowed } from "../support/append-shadowed-list";
import { storage } from "../support/storage";

export async function leakSameNameCollection(clientKey: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  appendShadowed(keys, clientKey);
  return Promise.all(keys.map((key) => storage.get(key)));
}
