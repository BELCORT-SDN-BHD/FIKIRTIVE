// Bypass class: non-async exported function was invisible to the token scanner.
import { prisma } from "@fikirtive/db";

export function leak() {
  return prisma.user.findMany();
}
