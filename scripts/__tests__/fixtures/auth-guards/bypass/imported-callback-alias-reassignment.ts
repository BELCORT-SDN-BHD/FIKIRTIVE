// Bypass class: every provider-side local alias binding must remain stable.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";
import {
  aliasedCallback,
  identifierInitializerCallback,
} from "../support/aliased-imported-callbacks";

function consumePrincipal(
  callback: (principal: { ownerId: string }) => void,
  principal: { ownerId: string },
) {
  callback(principal);
}

export async function leakAfterIdentifierInitializerReassignment() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  consumePrincipal(identifierInitializerCallback, gate);
  return prisma.genJob.findMany({
    where: { ownerId: gate.ownerId },
  });
}

export async function leakAfterExportListAliasReassignment() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  consumePrincipal(aliasedCallback, gate);
  return prisma.genJob.findMany({
    where: { ownerId: gate.ownerId },
  });
}
