// Bypass class: nested callback writes through captured derived objects reach caller state.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakNestedCallback(body: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const job = (await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  })) as any;
  if (!job) return { error: "not found" };
  body.ids.forEach((id) => {
    [id].map((targetId) => {
      job.targetId = targetId;
    });
  });
  return prisma.genJob.update({
    where: { id: job.targetId },
    data: { status: "DONE" },
  });
}
