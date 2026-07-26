// Bypass class: resolver token appears after the sensitive operation.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak() {
  const rows = await prisma.user.findMany();
  const principal = await requireOwner();
  return { rows, principal };
}
