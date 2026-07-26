// Bypass class: a reassigned provider export cannot retain its safe callback initializer.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import { reassignedCallback } from "../support/reassigned-imported-callback";

function consumePrincipal(
  callback: (principal: { ownerId: string }) => void,
  principal: { ownerId: string },
) {
  callback(principal);
}

export async function leakAfterProviderCallbackReassignment() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  consumePrincipal(reassignedCallback, gate);
  return prisma.genJob.findMany({
    where: { ownerId: gate.ownerId },
  });
}
