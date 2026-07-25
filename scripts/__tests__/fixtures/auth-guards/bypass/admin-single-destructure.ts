// Bypass class: a generic requireRole field cannot masquerade as an owner identity.
"use server";

import { prisma } from "@fikirtive/db";
import { requireRole } from "../support/auth-guard";

export async function leak() {
  const { role } = await requireRole("model", "mutate");
  return prisma.user.findMany({ where: { ownerId: role } });
}
