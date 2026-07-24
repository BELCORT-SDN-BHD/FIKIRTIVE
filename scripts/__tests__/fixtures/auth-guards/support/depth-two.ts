import { prisma } from "@fikirtive/db";

export function depthTwo() {
  return prisma.user.findMany();
}
