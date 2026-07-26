// Positive class: an ordinary local helper object that carries no capability keeps its clean bill.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function readOwnedWithLocalHelper(label: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const helpers = { fmt: (value: string) => value.trim() };
  return prisma.user.findMany({
    where: { ownerId: gate.ownerId, label: helpers.fmt(label) },
  });
}
