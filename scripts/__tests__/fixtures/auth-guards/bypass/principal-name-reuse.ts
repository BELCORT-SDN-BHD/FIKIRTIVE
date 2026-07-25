// Bypass class: a fresh local declaration cannot inherit principal metadata by name.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak(clientOwnerId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = gate.ownerId;
  if (!ownerId) return [];
  return readByClientOwner(clientOwnerId);
}

function readByClientOwner(clientOwnerId: string) {
  const ownerId = clientOwnerId;
  if (!ownerId) return [];
  return prisma.user.findMany({ where: { ownerId } });
}
