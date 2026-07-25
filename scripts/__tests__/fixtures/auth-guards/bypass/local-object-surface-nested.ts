// Bypass class: nesting the callable one level deeper does not hide the capability crossing.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

export async function leakViaNestedSurface(id: string) {
  const api = { db: { read: (db: typeof prisma, assetId: string) => find(db, assetId) } };
  return api.db.read(prisma, id);
}
