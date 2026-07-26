// Positive class: a gateway that resolves ONE principal, then runs the operation inside a
// transparent principal frame carrying that same principal. The frame runner executes the
// callback on the caller's own stack, so the resolver still dominates every sensitive
// operation the callback performs.
//
// Mirrors the production CRM gateways (#470): the resolver returns a single value and the
// operation is scoped by that value — not by a look-alike rebuilt from its properties, which
// would carry no provenance.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runAsUser } from "../packages/db/src/principal";

type ServicePrincipal = { kind: "user"; ownerId: string; membershipId: string };

async function resolvePrincipal(): Promise<ServicePrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new Error("denied");
  return { kind: "user", ownerId: gate.ownerId, membershipId: "m1" };
}

async function runRead<T>(operation: (principal: ServicePrincipal) => Promise<T>) {
  const principal = await resolvePrincipal();
  return runAsUser(principal, () => operation(principal));
}

export async function ok() {
  return runRead((principal) =>
    prisma.user.findMany({ where: { ownerId: principal.ownerId } }),
  );
}
