// Positive class: named async function export.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function ok() {
  const principal = await requireOwner();
  if ("error" in principal) return principal;
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
}
