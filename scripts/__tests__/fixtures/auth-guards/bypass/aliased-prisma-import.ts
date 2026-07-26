// Bypass class: prisma is imported under an alias.
import { prisma as db } from "@fikirtive/db";

export function leak() {
  return db.user.findMany();
}
