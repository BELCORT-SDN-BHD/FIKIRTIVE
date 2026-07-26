// Bypass class: sensitive DB access is reached through a local helper.
import { prisma } from "@fikirtive/db";

function helper() {
  return prisma.user.findMany();
}

export function leak() {
  return helper();
}
