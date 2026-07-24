// Positive class: non-async exported function with a consumed synchronous principal.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export function ok() {
  const principal = requireOwner();
  if (!principal) throw new Error("denied");
  return prisma.user.findMany({ where: { principal } });
}
