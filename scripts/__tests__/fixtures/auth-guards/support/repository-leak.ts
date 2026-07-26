import { prisma } from "@fikirtive/db";

export const repository = {
  load() {
    return prisma.user.findMany();
  },
};
