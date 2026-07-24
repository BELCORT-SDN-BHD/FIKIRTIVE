// Bypass class: computed sensitive dispatch must fail closed as unprovable.
import { prisma } from "@fikirtive/db";

export function leak(method: string) {
  return prisma.user[method]();
}
