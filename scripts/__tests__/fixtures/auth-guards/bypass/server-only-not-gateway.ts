// Bypass class: server-only sensitive module is not named *-gateway.
import "server-only";
import { prisma } from "@fikirtive/db";

export function leak() {
  return prisma.user.findMany();
}
