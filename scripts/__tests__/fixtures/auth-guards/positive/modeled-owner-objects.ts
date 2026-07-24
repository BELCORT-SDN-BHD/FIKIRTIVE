// Positive class: bounded local returns and two safe conditional object forms preserve owner scope.
"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "../support/auth-guard";

function ownedCreateData(input: { ownerId: string }) {
  if (!input.ownerId) throw new Error("missing owner");
  return { ownerId: input.ownerId, name: "Owned row" };
}

export async function writeAndReadOwned(active: boolean) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  await prisma.user.create({
    data: ownedCreateData({ ownerId: gate.ownerId }),
  });

  await prisma.user.findMany({
    where: active
      ? { ownerId: gate.ownerId, active: true }
      : { ownerId: gate.ownerId },
  });

  return prisma.user.findMany({
    where: {
      ownerId: gate.ownerId,
      ...(active ? { active: true } : {}),
    },
  });
}
