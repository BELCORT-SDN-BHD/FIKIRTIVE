// Bypass class: an imported mutator hidden behind a local callback factory is unprovable.
"use server";

import { prisma } from "@fikirtive/db";
import { mutateJobTarget } from "external-callback-mutator";
import { requireOwner } from "../support/auth-guard";

function bindJobCallback(
  callback: (job: any, targetId: string) => void,
  job: any,
) {
  return (targetId: string) => callback(job, targetId);
}

export async function leakImportedMutatorThroughWrapper(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  const callback = bindJobCallback(mutateJobTarget, job);
  body.ids.forEach(callback);
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
