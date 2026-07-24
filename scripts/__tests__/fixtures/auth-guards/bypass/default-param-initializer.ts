// Bypass class: a sensitive default-parameter initializer cannot hide beside a clean export.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak(
  rows = prisma.user.findMany({ where: { ownerId: "attacker-controlled" } }),
) {
  return rows;
}

export async function clean() {
  const principal = await requireOwner();
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
}
