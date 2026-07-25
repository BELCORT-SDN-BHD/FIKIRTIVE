// Positive class: a local object-literal repository that scopes by ownerId is provable, not unprovable.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readOwnedViaLocalRepository() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const repository = {
    load: (db: typeof prisma, ownerId: string) => db.user.findMany({ where: { ownerId } }),
  };
  return repository.load(prisma, gate.ownerId);
}
