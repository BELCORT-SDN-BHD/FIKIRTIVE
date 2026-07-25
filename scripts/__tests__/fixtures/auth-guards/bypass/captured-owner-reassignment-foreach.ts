// Bypass class: a modeled callback cannot preserve a captured owner binding after overwriting it.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakAfterForEachOverwrite(body: { ownerIds: string[] }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let ownerId = gate.ownerId;
  body.ownerIds.forEach((candidate) => {
    ownerId = candidate;
  });
  return prisma.contact.findMany({ where: { ownerId } });
}
