// Bypass class: a trailing spread of known shape overwrites the carrier ownerId it supplies.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

type Scope = { ownerId: string };

function load(scope: Scope) {
  return prisma.contact.findMany({ where: { ownerId: scope.ownerId } });
}

export async function leakTrailingKnownSpreadCarrier(input: Scope) {
  const gate = await requireOwner();
  return load({ ownerId: gate.ownerId, ...{ ownerId: input.ownerId } });
}

export async function leakTrailingLocalSpreadCarrier(input: Scope) {
  const gate = await requireOwner();
  const patch = { ownerId: input.ownerId };
  return load({ ownerId: gate.ownerId, ...patch });
}
