import { prisma } from "@fikirtive/db";

export async function leak() {
  return prisma.user.findMany();
}
