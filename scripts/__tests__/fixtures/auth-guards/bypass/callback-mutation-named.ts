// Bypass class: a named callback mutating a captured derived object must invalidate the caller.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakNamedCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  const callback = (targetId: string) => {
    job.targetId = targetId;
  };
  body.ids.forEach(callback);
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}

export async function leakBlockScopedNamedCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  if (body.ids.length) {
    const callback = (targetId: string) => {
      job.targetId = targetId;
    };
    body.ids.forEach(callback);
  }
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}

export async function leakReassignedCallback(
  body: { ids: string[] },
  replacement: (targetId: string) => void,
) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  let callback = (targetId: string) => {
    job.targetId = targetId;
  };
  callback = replacement;
  body.ids.forEach(callback);
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
