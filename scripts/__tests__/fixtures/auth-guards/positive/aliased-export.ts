// Positive class: aliased export.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function internalOk() {
  const principal = await requireOwner();
  if ("error" in principal) return principal;
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
}

export { internalOk as ok };
