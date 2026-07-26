// Bypass class: every statically function-like callback carrier must preserve callback mutation tracking.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function invoke(input: { mutate: () => void }) {
  input.mutate();
}

export async function leakMethodShorthand(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  await invoke({
    mutate() {
      job.id = body.id;
    },
  });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}

export async function leakFunctionExpression(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  await invoke({
    mutate: function mutate() {
      job.id = body.id;
    },
  });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}

export async function leakShorthandProperty(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  const mutate = () => {
    job.id = body.id;
  };
  await invoke({ mutate });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}

export async function leakUnresolvedProperty(
  body: { id: string; external: boolean },
  externalMutator: () => void,
) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  await invoke({
    mutate: body.external
      ? externalMutator
      : () => {
          job.id = body.id;
        },
  });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
