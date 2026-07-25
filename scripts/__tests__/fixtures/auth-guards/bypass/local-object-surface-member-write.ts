// Bypass class: a member write after declaration detaches the surface from its literal.
"use server";

import { prisma } from "@fikirtive/db";
import { find, findA } from "../support/capability-repository";

export async function leakViaMemberWrite(id: string) {
  const dispatch = { run: (db: typeof prisma, assetId: string) => findA(db, assetId) };
  dispatch.run = (db: typeof prisma, assetId: string) => find(db, assetId);
  return dispatch.run(prisma, id);
}
