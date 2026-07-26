import { prisma } from "@fikirtive/db";

export function loadMixedCarrier(ctx: {
  session: { ownerId: string };
  ownerId: string;
}) {
  return prisma.contact.findMany({ where: { ownerId: ctx.ownerId } });
}
