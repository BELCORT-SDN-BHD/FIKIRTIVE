// Bypass class: owner authority under NOT is inverted and cannot scope the query.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakNegatedOwner() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.user.findMany({
    where: {
      NOT: { ownerId: gate.ownerId },
    },
  });
}
