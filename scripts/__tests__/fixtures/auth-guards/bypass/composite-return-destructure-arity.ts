// Bypass class: the composite-return grant fires on destructuring arity, not on what was proved.
// The identical resolver, the identical leak and the identical single bound name are rejected
// when the pattern binds ONE element; adding a second element — here a rest element that is never
// read — flips the same code to accepted, and the client-supplied `teamId` becomes an accepted
// query scope. A proof that changes with the number of names on the left-hand side is not a proof.
//
// Regression guard for the #469 change-two mechanism (`returnedPrincipalProperties`) that #470
// reverted. Measured two-sided: rejected on the reverted fence, accepted on a047d7d3 where change
// two was live. Controls measured alongside it, both rejected on BOTH fences: the same file with
// `const { service } = await resolvePrincipal(...)` (one element, no rest), and a legitimately
// owner-scoped one-element destructure — the second control shows the inconsistency also denied
// correct code, so the trigger tracked arity rather than provenance in both directions.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

async function resolvePrincipal(clientTeamId: string) {
  const gate = await requireOwner();
  if ("error" in gate) throw new Error("denied");
  return {
    service: { ownerId: gate.ownerId, teamId: clientTeamId },
    ambient: { kind: "user" as const, ownerId: gate.ownerId },
  };
}

export async function leak(clientTeamId: string) {
  const { service, ...rest } = await resolvePrincipal(clientTeamId);
  void rest;
  return prisma.user.findMany({ where: { ownerId: service.teamId } });
}
