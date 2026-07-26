// Bypass class: a function-local object carrier cannot hide a DB capability from an imported helper.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughLocalCarrier(id: string) {
  const ctx = { db: prisma };
  return runLocalDbCarrier(ctx, id);
}
