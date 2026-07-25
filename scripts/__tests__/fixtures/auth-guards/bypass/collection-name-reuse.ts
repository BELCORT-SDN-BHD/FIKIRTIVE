// Bypass class: derived-collection metadata cannot leak into a same-named callee local.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ids: string[] = [];
  void ids;
  return readByClientIds(clientId);
}

async function readByClientIds(clientId: string) {
  const ids = [clientId];
  for (const id of ids) {
    await prisma.user.findMany({ where: { id } });
  }
}
