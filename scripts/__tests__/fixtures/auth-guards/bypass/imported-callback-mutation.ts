// Bypass class: an imported callback that mutates the principal must invalidate its alias.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { mutatePrincipal } from "../support/imported-callbacks";

function consumePrincipal(
  callback: (principal: { ownerId: string }) => void,
  principal: { ownerId: string },
) {
  callback(principal);
}

export async function leakAfterImportedPrincipalMutation() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  consumePrincipal(mutatePrincipal, gate);
  return prisma.genJob.findMany({
    where: { ownerId: gate.ownerId },
  });
}
