// Bypass class: a cross-module callback overwrite must invalidate a captured principal member before tagged raw SQL.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runEach } from "../support/run-each";

export async function leakAfterImportedMemberCallbackRawSql(input: {
  ids: string[];
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = gate;
  runEach(input.ids, (id) => {
    principal.ownerId = id;
  });
  return prisma.$queryRaw`
    SELECT * FROM "Contact" WHERE "owner_id" = ${principal.ownerId}
  `;
}
