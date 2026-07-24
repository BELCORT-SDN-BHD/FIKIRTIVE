// Bypass class: merely referencing a resolved principal cannot authorize unrelated tenant reads.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak() {
  const gate = await requireOwner();
  void gate;
  await prisma.user.findMany({ where: { ownerId: "attacker-controlled" } });
  await prisma.user.findMany({ where: { ownerId: gate.ownerId } });
  return prisma.user.findMany({ where: { ownerId: "attacker-controlled" } });
}
