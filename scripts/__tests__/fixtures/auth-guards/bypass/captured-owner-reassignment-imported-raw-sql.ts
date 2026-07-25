// Bypass class: a cross-module callback overwrite must invalidate a captured owner before tagged raw SQL.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runEach } from "../support/run-each";

export async function leakAfterImportedCallbackRawSql(input: {
  ids: string[];
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  runEach(input.ids, (id) => {
    ownerId = id;
  });
  return prisma.$queryRaw`
    SELECT * FROM "Contact" WHERE "owner_id" = ${ownerId}
  `;
}
