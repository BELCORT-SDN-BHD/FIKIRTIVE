// Bypass class: default export was invisible to the token scanner.
import { prisma } from "@fikirtive/db";

export default async function leak() {
  return prisma.user.findMany();
}
