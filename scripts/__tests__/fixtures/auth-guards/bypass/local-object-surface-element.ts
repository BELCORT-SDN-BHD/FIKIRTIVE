// Bypass class: string-literal element access onto a local object surface stays in scope.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

export async function leakViaElementAccess(id: string) {
  const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
  return dispatch["run"](prisma, id);
}
