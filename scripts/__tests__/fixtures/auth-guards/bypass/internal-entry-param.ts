// Bypass class: a "use server" ENTRY module cannot substitute a caller-supplied ownerId.
"use server";

import { prisma } from "@fikirtive/db";

export async function leak(ownerId: string) {
  return prisma.user.findMany({ where: { ownerId } });
}
