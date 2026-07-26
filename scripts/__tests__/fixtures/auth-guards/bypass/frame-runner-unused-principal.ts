// Bypass class: a principal IS resolved and a frame IS entered, but the sensitive operation
// is scoped by client input instead of the resolved owner. Entering a frame is not a guard.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runAsUser } from "../packages/db/src/principal";

type ServicePrincipal = { ownerId: string; membershipId: string };
type Resolved = { service: ServicePrincipal; ambient: { kind: "user"; ownerId: string } };

async function resolvePrincipal(): Promise<Resolved> {
  const gate = await requireOwner();
  if ("error" in gate) throw new Error("denied");
  return {
    service: { ownerId: gate.ownerId, membershipId: "m1" },
    ambient: { kind: "user", ownerId: gate.ownerId },
  };
}

async function runRead<T>(operation: (principal: ServicePrincipal) => Promise<T>) {
  const { service, ambient } = await resolvePrincipal();
  return runAsUser(ambient, () => operation(service));
}

export async function leak(clientOwnerId: string) {
  return runRead(() => prisma.user.findMany({ where: { ownerId: clientOwnerId } }));
}
