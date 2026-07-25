// Positive class: a callee's distinct parameter or local cannot invalidate a caller binding with the same name.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function rewriteParameter(ownerId: string, candidate: string) {
  ownerId = candidate;
  return ownerId.length;
}

function rewriteLocal(candidate: string) {
  let ownerId = "callee-local";
  ownerId = candidate;
  return ownerId.length;
}

export async function readOwnedAfterDistinctReassignments(body: {
  ownerId: string;
}) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ownerId = gate.ownerId;
  rewriteParameter("callee-parameter", body.ownerId);
  rewriteLocal(body.ownerId);
  return prisma.contact.findMany({ where: { ownerId } });
}
