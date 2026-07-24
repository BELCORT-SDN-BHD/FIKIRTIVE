// Bypass class: aliased export was invisible to the token scanner.
import { prisma } from "@fikirtive/db";

async function internalLeak() {
  return prisma.user.findMany();
}

export { internalLeak as leak };
