// Bypass class: a sensitive server action outside apps/web/lib is content-covered.
"use server";

import { prisma } from "@fikirtive/db";

export async function leak() {
  return prisma.user.findMany();
}
