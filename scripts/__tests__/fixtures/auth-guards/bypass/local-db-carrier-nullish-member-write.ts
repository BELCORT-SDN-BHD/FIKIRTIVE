// Bypass class: a nullish member write cannot hide a DB capability from an imported helper.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughNullishMemberWrite(id: string) {
  const ctx: any = {};
  ctx.db ??= prisma;
  return runLocalDbCarrier(ctx, id);
}
