// Bypass class: exported function reaches a sensitive op through multiple local calls.
import { prisma } from "@fikirtive/db";

function deepest() {
  return prisma.user.findMany();
}

function middle() {
  return deepest();
}

export function leak() {
  return middle();
}
