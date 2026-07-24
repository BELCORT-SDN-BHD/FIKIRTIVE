// Bypass class: a recursive structured callback carrier cannot skip a nested captured mutation.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function invoke(input: { mutate: () => void }) {
  input.mutate();
}

export async function leakRecursiveStructuredCarrier(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  invoke({
    mutate() {
      function recurse(depth: number, input: { mutate: () => void }) {
        input.mutate();
        if (depth > 0) {
          recurse(depth - 1, {
            mutate() {
              job.id = body.id;
            },
          });
        }
      }
      recurse(1, { mutate() {} });
    },
  });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
