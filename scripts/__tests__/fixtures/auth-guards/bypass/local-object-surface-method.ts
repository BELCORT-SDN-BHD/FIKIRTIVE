// Bypass class: object-literal method shorthand is still an unguarded capability crossing.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

export async function leakViaMethodShorthand(id: string) {
  const dispatch = {
    async run(db: typeof prisma, assetId: string) {
      return find(db, assetId);
    },
  };
  return dispatch.run(prisma, id);
}
