// Bypass class: route handlers live outside apps/web/lib.
import { prisma } from "@fikirtive/db";

export async function GET() {
  return prisma.user.findMany();
}
