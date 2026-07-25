// Bypass class: the mixed carrier cannot authorize a write sink either.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function write(ctx: { session: { ownerId: string }; ownerId: string }) {
  return prisma.contact.create({ data: { ownerId: ctx.ownerId } });
}

export async function leakMixedCarrierWrite(input: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return write({ session: gate, ownerId: input.ownerId });
}
