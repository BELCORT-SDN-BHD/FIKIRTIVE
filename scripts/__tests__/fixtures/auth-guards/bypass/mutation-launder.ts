// Bypass class: mutating a principal-derived object invalidates it as an authority carrier.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakMutatedResult(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  job.targetId = body.targetId;
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}

export async function leakMutatedGate(body: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  (gate as any)["ownerId"] = body.ownerId;
  return prisma.user.findMany({ where: { ownerId: gate.ownerId } });
}
