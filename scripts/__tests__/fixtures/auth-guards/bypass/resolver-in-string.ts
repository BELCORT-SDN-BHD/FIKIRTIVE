// Bypass class: resolver name appears only in a string.
import { prisma } from "@fikirtive/db";

export function leak() {
  const theater = "requireOwner()";
  return prisma.user.findMany({ where: { theater } });
}
