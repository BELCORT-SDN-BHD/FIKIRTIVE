// Positive class: a known read-only method on a scalar property does not mutate its parent object.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readAfterPropertyTrim() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const normalizedOwnerId = gate.ownerId.trim();
  return prisma.user.findMany({
    where: { ownerId: gate.ownerId, normalizedOwnerId },
  });
}
