import { prisma } from "@fikirtive/db";

export function importedHelper() {
  return prisma.user.findMany();
}
