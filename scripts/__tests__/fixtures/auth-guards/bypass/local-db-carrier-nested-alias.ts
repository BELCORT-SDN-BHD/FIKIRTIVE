// Bypass class: nested local aliases cannot strip a DB capability before an imported helper.
"use server";

import { prisma } from "@fikirtive/db";
import { runNestedLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughNestedLocalCarrier(id: string) {
  const dbCarrier = { dbAlias: prisma };
  const carrierAlias = dbCarrier;
  const ctx = { nested: carrierAlias };
  return runNestedLocalDbCarrier(ctx, id);
}
