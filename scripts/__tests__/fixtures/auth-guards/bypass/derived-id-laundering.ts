// Bypass class: a non-owner-scoped read result cannot launder a client id into an owned key.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = await prisma.genJob.findFirst({
    where: { id: clientId },
    select: { id: true },
  });
  return prisma.genJob.update({
    where: { id: job.id },
    data: { status: "DONE" },
  });
}

export async function leakUncheckedClientId(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = await prisma.genJob.findFirst({
    where: { id: clientId, ownerId: gate.ownerId },
    select: { id: true },
  });
  return prisma.genJob.update({
    where: { id: clientId },
    // A derived value in a sibling subtree cannot launder the attacker-controlled key.
    data: { status: "DONE", auditId: job.id },
  });
}
