// Positive class: INTERNAL export carries a required ownerId and scopes the sensitive call.
import { prisma } from "@fikirtive/db";

export async function readOwned(ownerId: string) {
  return prisma.user.findMany({ where: { ownerId } });
}
