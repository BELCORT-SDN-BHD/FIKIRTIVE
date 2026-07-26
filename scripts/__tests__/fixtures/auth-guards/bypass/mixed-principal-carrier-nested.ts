// Bypass class: burying the principal deeper inside the carrier does not launder the sibling untrusted ownerId.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function load(ctx: {
  meta: { audit: { session: { ownerId: string } } };
  ownerId: string;
}) {
  return prisma.contact.findMany({ where: { ownerId: ctx.ownerId } });
}

export async function leakMixedCarrierNested(input: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return load({ meta: { audit: { session: gate } }, ownerId: input.ownerId });
}
