// Positive class: a carrier ownerId written after a spread survives it, and a known spread only revokes the keys it supplies.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

type Scope = { ownerId: string; label?: string };

function load(scope: Scope) {
  return prisma.contact.findMany({ where: { ownerId: scope.ownerId } });
}

export async function readLeadingSpreadCarrier(input: Scope) {
  const gate = await requireOwner();
  return load({ ...input, ownerId: gate.ownerId });
}

export async function readTrailingNeutralKnownSpreadCarrier(input: Scope) {
  const gate = await requireOwner();
  return load({ ownerId: gate.ownerId, ...{ label: input.label } });
}
