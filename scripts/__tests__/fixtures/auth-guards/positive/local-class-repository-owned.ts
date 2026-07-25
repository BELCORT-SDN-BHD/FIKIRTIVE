// Positive class: a local class repository method that scopes by ownerId resolves to its real body.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

class Repository {
  load(db: typeof prisma, ownerId: string) {
    return db.user.findMany({ where: { ownerId } });
  }
}

export async function readOwnedViaLocalClass() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return new Repository().load(prisma, gate.ownerId);
}
