// Bypass class: a spread-rebuilt surface carries members from an unknown source.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

declare const extra: Record<string, unknown>;

export async function leakViaSpreadSurface(id: string) {
  const dispatch = {
    ...extra,
    run: (db: typeof prisma, assetId: string) => find(db, assetId),
  };
  return dispatch.run(prisma, id);
}
