// Bypass class: resolving the guard first does not scope a capability forwarded through a local surface.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { find } from "../support/capability-repository";

export async function leakAfterGuard(id: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const dispatch = { run: (db: typeof prisma, assetId: string) => find(db, assetId) };
  return dispatch.run(prisma, id);
}
