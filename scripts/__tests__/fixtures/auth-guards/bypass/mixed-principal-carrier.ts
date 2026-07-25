// Bypass class: a carrier that merely contains a principal cannot lend its own untrusted ownerId property any authority.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function load(ctx: { session: { ownerId: string }; ownerId: string }) {
  return prisma.contact.findMany({ where: { ownerId: ctx.ownerId } });
}

export async function leakMixedCarrier(input: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return load({ session: gate, ownerId: input.ownerId });
}
