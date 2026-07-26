// Bypass class: method chaining cannot launder a resolver call into a consumed principal.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak() {
  await requireOwner().catch(() => null);
  return prisma.user.findMany({ where: { ownerId: "attacker-controlled" } });
}
