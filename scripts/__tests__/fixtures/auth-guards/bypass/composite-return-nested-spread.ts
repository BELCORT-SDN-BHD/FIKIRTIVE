// Bypass class: the composite return's spread default-deny does not hold one layer down. The
// top-level object literal carries no spread, so the per-property enumeration succeeds; the
// spread of client-controlled data sits inside the `service` property value instead, where a
// separate, laxer authority rule reads only `ownerId` and ignores every other key the spread
// supplies. The query is then scoped by one of those client-controlled keys.
//
// Regression guard for the #469 change-two mechanism (`returnedPrincipalProperties`) that #470
// reverted. That mechanism's own contract was "any shape the prover cannot enumerate exactly (a
// spread, a computed key, an unnamed member) proves NOTHING for the whole value — default deny";
// the contract is enforced only at the top level, so pushing the spread one layer down restores
// the grant. Measured two-sided: rejected on the reverted fence, accepted on a047d7d3 where
// change two was live. Control measured alongside it: the same laundering with the spread at the
// TOP level is rejected on both fences, which is what makes the nesting the bypass.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runAsUser } from "../packages/db/src/principal";

async function resolvePrincipal(clientScope: { teamId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) throw new Error("denied");
  return {
    service: { ...clientScope, ownerId: gate.ownerId },
    ambient: { kind: "user" as const, ownerId: gate.ownerId },
  };
}

export async function leak(clientScope: { teamId: string }) {
  const { service, ambient } = await resolvePrincipal(clientScope);
  return runAsUser(ambient, () =>
    prisma.user.findMany({ where: { ownerId: service.teamId } }),
  );
}
