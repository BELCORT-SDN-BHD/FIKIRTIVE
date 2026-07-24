// Bypass class: a destructured dynamic DB import must remain visible to sensitive-call tracking.
"use server";

export async function leak() {
  const { prisma } = await import("@fikirtive/db");
  return prisma.user.findMany({ where: { ownerId: "attacker-controlled" } });
}
