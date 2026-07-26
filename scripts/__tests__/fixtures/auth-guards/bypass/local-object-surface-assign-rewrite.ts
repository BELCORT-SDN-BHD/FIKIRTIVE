// Bypass class: an opaque mutator can rewrite a local surface, so its declared shape is unprovable.
"use server";

import { prisma } from "@fikirtive/db";
import { find, findA } from "../support/capability-repository";

export async function leakViaAssignRewrite(id: string) {
  const dispatch = { run: (db: typeof prisma, assetId: string) => findA(db, assetId) };
  Object.assign(dispatch, {
    run: (db: typeof prisma, assetId: string) => find(db, assetId),
  });
  return dispatch.run(prisma, id);
}
