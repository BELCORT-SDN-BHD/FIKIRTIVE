// Bypass class: a traced nested helper cannot preserve a captured owner binding after overwriting it.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakAfterNestedOverwrite(body: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  function overwriteOwner() {
    ownerId = body.ownerId;
  }
  overwriteOwner();
  return prisma.contact.findMany({ where: { ownerId } });
}
