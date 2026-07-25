// Bypass class: nullable-derived metadata cannot leak into a same-named callee local.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const selected = null;
  void selected;
  return readByClientId(clientId);
}

function readByClientId(clientId: string) {
  const selected = clientId;
  if (selected) {
    return prisma.user.findMany({ where: { id: selected } });
  }
  return [];
}
