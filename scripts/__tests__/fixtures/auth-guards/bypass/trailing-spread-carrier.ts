// Bypass class: a trailing spread of unknown shape overwrites a proven carrier ownerId.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

type Scope = { ownerId: string };

function load(scope: Scope) {
  return prisma.contact.findMany({ where: { ownerId: scope.ownerId } });
}

export async function leakTrailingSpreadCarrier(input: Scope) {
  const gate = await requireOwner();
  return load({ ownerId: gate.ownerId, ...input });
}
