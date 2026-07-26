// Bypass class: a cross-module callback cannot overwrite a captured principal member silently.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runEach } from "../support/run-each";

export async function leakAfterImportedMemberCallback(input: {
  ids: string[];
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = gate;
  runEach(input.ids, (id) => {
    principal.ownerId = id;
  });
  return prisma.contact.findMany({
    where: { ownerId: principal.ownerId },
  });
}
