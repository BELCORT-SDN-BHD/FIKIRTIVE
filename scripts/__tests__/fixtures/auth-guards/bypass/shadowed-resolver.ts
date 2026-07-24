// Bypass class: a local variable shadows the trusted resolver name.
import { prisma } from "@fikirtive/db";

const resolvePrincipal = () => ({ ownerId: "attacker-controlled" });

export function leak() {
  const principal = resolvePrincipal();
  return prisma.user.findMany({ where: { ownerId: principal.ownerId } });
}
