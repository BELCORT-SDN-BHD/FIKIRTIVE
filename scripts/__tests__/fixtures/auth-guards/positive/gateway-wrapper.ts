// Positive class: gateway wrapper consumes resolvePrincipal before its service call.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function resolvePrincipal() {
  const principal = await requireOwner();
  if ("error" in principal) throw new Error("denied");
  return principal;
}

async function runRead(operation: (principal: { ownerId: string }) => unknown) {
  return operation(await resolvePrincipal());
}

export async function ok() {
  return runRead((principal) =>
    prisma.user.findMany({ where: { ownerId: principal.ownerId } }),
  );
}
