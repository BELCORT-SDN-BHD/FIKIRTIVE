// Bypass class: required ownerId exists but the sensitive operation does not use it.
import { prisma } from "@fikirtive/db";

export async function leak(ownerId: string) {
  void ownerId;
  return prisma.user.findMany();
}
