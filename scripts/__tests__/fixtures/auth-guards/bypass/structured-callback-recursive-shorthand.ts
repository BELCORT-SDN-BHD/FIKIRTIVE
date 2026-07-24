// Bypass class: a called recursive carrier shorthand cannot hide a later-assigned short callback.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function invoke(input: { mutate: () => void }) {
  input.mutate();
}

export async function leakRecursiveShorthand(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  invoke({
    mutate() {
      function recurse(depth: number, input: { f: () => void }) {
        input.f();
        if (depth > 0) {
          let f: () => void;
          f = () => {
            job.id = body.id;
          };
          recurse(depth - 1, { f });
        }
      }
      recurse(1, { f() {} });
    },
  });
  return prisma.genJob.updateMany({
    where: { id: job.id },
    data: { state: "DONE" },
  });
}
