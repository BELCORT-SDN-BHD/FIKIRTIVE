// Bypass class: resolver appears only in unreachable dead code.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leak() {
  if (false) {
    const principal = await requireOwner();
    void principal;
  }
  return prisma.user.findMany();
}
