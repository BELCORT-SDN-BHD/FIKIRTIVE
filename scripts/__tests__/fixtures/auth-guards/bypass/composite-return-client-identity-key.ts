// Bypass class: a composite resolver return launders a CLIENT-SUPPLIED identity key into
// proved-principal provenance. The resolver really does authenticate, and the composite's
// `ownerId` really is owner-authoritative — but the same object also carries a request-supplied
// `membershipId`, and the sensitive query is scoped by THAT key, never by the proved owner.
//
// Regression guard for the #469 change-two mechanism (`returnedPrincipalProperties`, per-property
// provenance of a composite return) that #470 reverted. With that mechanism in place the
// destructured `service` binding inherits derived-principal status from the composite, after
// which every `*Id` member read off it is accepted as owner-scoped — so this leak scanned green.
// Measured two-sided: rejected on the reverted fence, accepted on a047d7d3 where change two was
// live. If change two is ever re-introduced this fixture stops failing and the registry turns red.
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { runAsUser } from "../packages/db/src/principal";

type ServicePrincipal = { ownerId: string; membershipId: string };
type Resolved = { service: ServicePrincipal; ambient: { kind: "user"; ownerId: string } };

async function resolvePrincipal(clientMembershipId: string): Promise<Resolved> {
  const gate = await requireOwner();
  if ("error" in gate) throw new Error("denied");
  return {
    service: { ownerId: gate.ownerId, membershipId: clientMembershipId },
    ambient: { kind: "user", ownerId: gate.ownerId },
  };
}

async function runRead<T>(
  clientMembershipId: string,
  operation: (principal: ServicePrincipal) => Promise<T>,
) {
  const { service, ambient } = await resolvePrincipal(clientMembershipId);
  return runAsUser(ambient, () => operation(service));
}

export async function leak(clientMembershipId: string) {
  return runRead(clientMembershipId, (principal) =>
    prisma.user.findMany({ where: { ownerId: principal.membershipId } }),
  );
}
