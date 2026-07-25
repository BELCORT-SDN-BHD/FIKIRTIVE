// Bypass class: a cross-module callback cannot overwrite a captured owner binding silently.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runEach } from "../support/run-each";

export async function leakAfterImportedCallback(input: { ids: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  runEach(input.ids, (id) => {
    ownerId = id;
  });
  return prisma.contact.findMany({ where: { ownerId } });
}
