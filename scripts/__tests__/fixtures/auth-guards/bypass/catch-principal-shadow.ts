// Bypass class: a catch parameter cannot inherit authority from an outer same-named principal.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakCatchShadow(body: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = gate.ownerId;
  try {
    throw body.ownerId;
  } catch (ownerId) {
    return prisma.contact.findMany({ where: { ownerId } });
  }
}
