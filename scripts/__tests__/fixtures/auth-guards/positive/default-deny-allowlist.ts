// Positive class: every explicitly modeled expression wrapper preserves the exact owner value.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readOwnedThroughAllowlist() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = gate.ownerId;
  const awaitedOwnerId = await ownerId;

  await prisma.user.findMany({ where: { ownerId: (ownerId) } });
  await prisma.user.findMany({ where: { ownerId: ownerId as string } });
  await prisma.user.findMany({ where: { ownerId: <string>ownerId } });
  await prisma.user.findMany({ where: { ownerId: ownerId! } });
  await prisma.user.findMany({ where: { ownerId: ownerId satisfies string } });
  await prisma.user.findMany({ where: { ownerId: awaitedOwnerId } });
  await prisma.user.findMany({ where: { ownerId: gate["ownerId"] } });
  await prisma.user.findMany({ where: { ownerId: ownerId || gate.ownerId } });
  await prisma.user.findMany({ where: { ownerId: ownerId ?? gate.ownerId } });
  return prisma.user.findMany({ where: { ownerId: ownerId && gate.ownerId } });
}
