// Bypass class: an opaque mutator cannot hide a capability that crosses with a local carrier.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughOpaqueMutator(
  id: string,
  install: (ctx: any, db: any) => void,
) {
  const ctx: any = {};
  install(ctx, prisma);
  return runLocalDbCarrier(ctx, id);
}
