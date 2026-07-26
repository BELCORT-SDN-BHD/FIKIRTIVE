// Bypass class: a traced helper cannot poison an initially safe empty derived collection.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function leakPoisonedEmptyCollection(clientId: string) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ids: string[] = [];
  collectClientId(ids, clientId);
  for (const id of ids) {
    await prisma.contact.deleteMany({ where: { id } });
  }
}

function collectClientId(ids: string[], clientId: string) {
  ids.push(clientId);
}
