// Bypass class: a nested carrier cannot launder an owner-derived collection through a traced helper.
"use server";

import { requireOwner } from "../support/auth-guard";
import { appendVia } from "../support/append-via";
import { storage } from "../support/storage";

export async function leakNestedCollection(clientKey: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const keys: string[] = [];
  appendVia({ list: keys }, clientKey);
  return Promise.all(keys.map((key) => storage.get(key)));
}
