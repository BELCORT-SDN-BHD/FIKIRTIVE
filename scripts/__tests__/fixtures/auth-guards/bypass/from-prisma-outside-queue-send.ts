// Bypass class: pg-boss fromPrisma may only adapt a transaction at the exact tracked queue-send option.
"use server";

import { prisma } from "@fikirtive/db";
import { fromPrisma } from "pg-boss";
import { requireOwner } from "../support/auth-guard";

export async function leakPgBossAdapter() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return prisma.$transaction(async (tx) => fromPrisma(tx));
}
