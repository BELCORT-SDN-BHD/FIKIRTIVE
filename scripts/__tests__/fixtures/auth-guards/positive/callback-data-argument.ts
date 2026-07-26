// Positive class: a callback consumer's ordinary data argument is not itself a callback.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stableValue).join(",");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([, entry]) => stableValue(entry))
      .join(",");
  }
  return JSON.stringify(value);
}

async function updateWithCallbackCarrier(input: {
  ownerId: string;
  mutate: (value: string) => string;
}) {
  input.mutate("safe");
  return prisma.genJob.updateMany({
    where: { ownerId: input.ownerId },
    data: { state: "DONE" },
  });
}

export async function updateAfterReduce(body: { ids: string[] }) {
  const gate = await requireOwner();
  const ownerId = gate.ownerId;
  const job = await prisma.genJob.findFirst({
    where: { ownerId },
  });
  body.ids.reduce((value) => value, ownerId);
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}

export async function updateThroughCallbackCarrier() {
  const gate = await requireOwner();
  return updateWithCallbackCarrier({
    ownerId: gate.ownerId,
    mutate: (value) => stableValue(value),
  });
}
