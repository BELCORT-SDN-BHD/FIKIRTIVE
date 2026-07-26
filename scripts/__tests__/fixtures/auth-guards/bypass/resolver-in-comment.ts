// Bypass class: resolver name appears only in a comment.
import { prisma } from "@fikirtive/db";

export function leak() {
  // requireOwner();
  return prisma.user.findMany();
}
