// Bypass class: a module-scope object literal surface is covered exactly like a block-scoped one.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };

export async function leakViaModuleSurface(id: string) {
  return dispatch.run(prisma, id);
}
