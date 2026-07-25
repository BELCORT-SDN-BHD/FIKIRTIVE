// Bypass class: a locally declared object literal cannot launder a DB capability past the fence.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

export async function leakViaLocalObject(id: string) {
  const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
  return dispatch.run(prisma, id);
}
