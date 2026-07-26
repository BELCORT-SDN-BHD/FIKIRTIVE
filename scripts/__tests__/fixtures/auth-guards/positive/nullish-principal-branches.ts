// Positive class: a nullish expression remains principal-derived when both value branches are.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readOwnedWithFallback() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const fallbackDerivedFromGate = gate.ownerId;
  const ownerId = gate.ownerId ?? fallbackDerivedFromGate;
  return prisma.user.findMany({ where: { ownerId } });
}
