// Bypass class: a reassigned receiver root no longer proves which literal is dispatched to.
"use server";

import { prisma } from "@fikirtive/db";
import { find, findA } from "../support/capability-repository";

export async function leakViaReassignedSurface(id: string, flag: boolean) {
  let dispatch = { run: (db: typeof prisma, assetId: string) => findA(db, assetId) };
  if (flag) {
    dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
  }
  return dispatch.run(prisma, id);
}
