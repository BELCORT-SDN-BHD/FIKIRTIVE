// Bypass class: destructuring assignment overwrites previously derived identity bindings.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakObjectReassignment(body: { id: string }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  let { id } = job;
  ({ id } = body);
  return prisma.genJob.updateMany({
    where: { id },
    data: { state: "DONE" },
  });
}

export async function leakArrayReassignment(body: { ids: string[] }) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  let id = job.id;
  [id] = body.ids;
  return prisma.genJob.updateMany({
    where: { id },
    data: { state: "DONE" },
  });
}
