// Positive class: default export of a local identifier.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

const ok = async () => {
  const principal = await requireOwner();
  if ("error" in principal) return principal;
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
};

export default ok;
