// Bypass class: a visible non-empty branch cannot discard an opaque callback-push branch.
"use server";

import { storageKey } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { storage } from "../support/storage";

function appendClientKey(keys: string[], clientKey: string) {
  keys.push(clientKey);
}

export async function leak(input: {
  useCallback: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const keys: string[] = [];
  if (input.useCallback) {
    rows.forEach(() => {
      keys.push(input.clientKey);
    });
  } else {
    for (const row of rows) {
      keys.push(storageKey(gate.ownerId, row.contentHash, row.ext));
    }
  }
  if (keys.length === 0) return [];
  const out = [];
  for (const key of keys) {
    out.push(await storage.get(key));
  }
  return out;
}

export async function leakThroughTracedCallee(input: {
  useHelper: boolean;
  clientKey: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await prisma.asset.findMany({
    where: { ownerId: gate.ownerId },
  });
  const keys: string[] = [];
  if (input.useHelper) {
    appendClientKey(keys, input.clientKey);
  } else {
    for (const row of rows) {
      keys.push(storageKey(gate.ownerId, row.contentHash, row.ext));
    }
  }
  if (keys.length === 0) return [];
  const out = [];
  for (const key of keys) {
    out.push(await storage.get(key));
  }
  return out;
}
