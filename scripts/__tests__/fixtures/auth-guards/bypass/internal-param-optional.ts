// Bypass class: an optional ownerId cannot prove a fail-closed INTERNAL boundary.
import { prisma } from "@fikirtive/db";

export async function leak(ownerId?: string) {
  return prisma.user.findMany({ where: { ownerId } });
}
