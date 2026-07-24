// Bypass class: aliased and nested default assignment targets must invalidate old derived identity.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakObjectAliasDefault(body: {
  source?: string;
  nested: Array<string | undefined>;
  extra: string;
}) {
  const gate = await requireOwner();
  const job = await prisma.genJob.findFirst({
    where: { ownerId: gate.ownerId },
  });
  let id = job.id;
  const fallback = job.id;
  let nestedId = job.id;
  const nestedFallback = job.id;
  let restIds: Array<string | undefined> = [];
  let rest = {};
  ({
    source: id = fallback,
    nested: [nestedId = nestedFallback, ...restIds],
    ...rest
  } = body);
  return prisma.genJob.updateMany({
    where: { id },
    data: { state: "DONE" },
  });
}
