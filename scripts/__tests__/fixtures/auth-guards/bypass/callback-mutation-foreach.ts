// Bypass class: callback writes through captured derived objects invalidate the caller's taint.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function runCallback(callback: () => void) {
  callback();
}

export async function leakForEachCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  body.ids.forEach((id) => {
    job.targetId = id;
  });
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}

export async function leakTracedLocalCallback(body: { targetId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  runCallback(() => {
    job.targetId = body.targetId;
  });
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
