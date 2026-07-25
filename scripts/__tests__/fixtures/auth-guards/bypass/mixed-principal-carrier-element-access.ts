// Bypass class: string element access on a mixed carrier is the same untrusted read as property access.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function load(ctx: { session: { ownerId: string }; ownerId: string }) {
  return prisma.contact.findMany({ where: { ownerId: ctx["ownerId"] } });
}

export async function leakMixedCarrierElementAccess(input: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return load({ session: gate, ownerId: input.ownerId });
}
