import { prisma } from "@fikirtive/db";

export function loadOwnedRows(ownerId: string) {
  return prisma.genJob.findMany({
    where: { ownerId },
  });
}

export function loadOwnedRow(ownerId: string, id: string | undefined) {
  return prisma.genJob.findFirst({
    where: { id, ownerId },
  });
}
