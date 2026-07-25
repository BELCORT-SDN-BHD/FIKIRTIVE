// Positive class: a carrier ownerId property assigned from the guard result stays a proven principal binding.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function load(ctx: { ownerId: string }) {
  return prisma.contact.findMany({ where: { ownerId: ctx.ownerId } });
}

export async function readOwnerIdCarrier() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return load({ ownerId: gate.ownerId });
}
