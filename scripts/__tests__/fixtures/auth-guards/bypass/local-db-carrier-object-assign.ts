// Bypass class: Object.assign cannot hide a DB capability in a local carrier.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughObjectAssign(id: string) {
  const ctx: any = {};
  Object.assign(ctx, { db: prisma });
  return runLocalDbCarrier(ctx, id);
}
