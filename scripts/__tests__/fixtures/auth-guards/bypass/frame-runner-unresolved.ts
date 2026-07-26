// Bypass class: the transparent-frame-runner wrapper is present but nothing ever resolves a
// principal — the frame is built from a request-supplied org id. Wrapping the work in a
// principal frame must not manufacture a proof the source never had.
import { prisma } from "@fikirtive/db";
import { runAsUser } from "../packages/db/src/principal";

type ServicePrincipal = { ownerId: string; membershipId: string };

const REQUEST_ORG = "org-from-the-request-body";

async function runRead<T>(operation: (principal: ServicePrincipal) => Promise<T>) {
  const service = { ownerId: REQUEST_ORG, membershipId: "m1" };
  return runAsUser({ kind: "user", ownerId: REQUEST_ORG }, () => operation(service));
}

export async function leak() {
  return runRead((principal) =>
    prisma.user.findMany({ where: { ownerId: principal.ownerId } }),
  );
}
