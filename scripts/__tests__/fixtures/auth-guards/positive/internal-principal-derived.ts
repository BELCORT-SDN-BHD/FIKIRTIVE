// Positive class: INTERNAL principal object is narrowed into a derived owner scope.
import { prisma } from "@fikirtive/db";

type CustomerInboxPrincipal = { ownerId: string; membershipId: string };

export async function readOwned(principal: CustomerInboxPrincipal) {
  const owned = { ownerId: principal.ownerId };
  return prisma.user.findMany({ where: owned });
}
