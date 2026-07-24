import { prisma } from "@fikirtive/db";

export const customerService = {
  list() {
    return prisma.user.findMany();
  },
};
