// Bypass class: a computed member name is dynamic dispatch and can never be pinned to a body.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

export async function leakViaDynamicMember(id: string, pick: string) {
  const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
  return dispatch[pick](prisma, id);
}
