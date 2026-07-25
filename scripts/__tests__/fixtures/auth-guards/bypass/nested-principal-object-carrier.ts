// Bypass class: a nested carrier cannot launder a principal object through a traced helper.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { poison } from "../support/poison-principal-carrier";

export async function leakNestedPrincipal(body: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  poison({ gate }, body.ownerId);
  return prisma.contact.findMany({ where: { ownerId: gate.ownerId } });
}
