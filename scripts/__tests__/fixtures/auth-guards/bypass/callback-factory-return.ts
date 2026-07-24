// Bypass class: passing a derived object to an untraced callback factory invalidates it.
"use server";

import { prisma } from "@fikirtive/db";
import { makeJobCallback } from "external-callback-factory";
import { requireOwner } from "../support/auth-guard";

export async function leakFactoryReturnedCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  const callback = makeJobCallback(job);
  body.ids.forEach(callback);
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
