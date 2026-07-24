import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

export async function ok() {
  const principal = await requireOwner();
  if ("error" in principal) return principal;
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
}
