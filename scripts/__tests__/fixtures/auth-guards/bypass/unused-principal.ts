// Bypass class: principal is assigned but never used before the sensitive operation.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak() {
  const principal = await requireOwner();
  return prisma.user.findMany();
}
