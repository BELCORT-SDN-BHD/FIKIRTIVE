// Bypass class: resolvePrincipal is called but its return value is discarded.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function resolvePrincipal() {
  const principal = await requireOwner();
  if ("error" in principal) throw new Error("denied");
  return principal;
}

export async function leak() {
  await resolvePrincipal();
  return prisma.user.findMany();
}
