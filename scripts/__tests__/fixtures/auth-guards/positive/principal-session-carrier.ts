// Positive class: a carrier property whose value is the guard result keeps exact per-property provenance.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function load(ctx: { session: { ownerId: string } }) {
  return prisma.contact.findMany({ where: { ownerId: ctx.session.ownerId } });
}

export async function readSessionCarrier() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return load({ session: gate });
}
