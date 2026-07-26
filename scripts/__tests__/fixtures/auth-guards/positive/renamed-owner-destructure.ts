// Positive class: a renamed ownerId destructure remains a principal-derived scalar.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

export async function ok() {
  const principal = await requireOwner();
  const { ownerId: oid } = principal;
  return prisma.user.findMany({ where: { ownerId: oid } });
}
