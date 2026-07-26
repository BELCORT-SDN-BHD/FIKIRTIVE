// Positive class: a gateway that resolves a principal, then runs the operation inside a
// transparent principal frame. The frame runner executes the callback on the caller's own
// stack, so the resolver still dominates every sensitive operation the callback performs.
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

export async function ok() {
  return runRead((principal) =>
    prisma.user.findMany({ where: { ownerId: principal.ownerId } }),
  );
}
