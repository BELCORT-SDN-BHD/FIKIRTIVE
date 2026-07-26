// Bypass class: a traced helper return cannot hide a DB capability from an imported helper.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

function makeCtx() {
  return { db: prisma };
}

export async function leakThroughTracedReturn(id: string) {
  const ctx = makeCtx();
  return runLocalDbCarrier(ctx, id);
}
