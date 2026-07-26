// Positive class: the exact pg-boss Prisma adapter keeps a tracked queue send in its transaction.
import { prisma } from "@fikirtive/db";
import { fromPrisma } from "pg-boss";
import { requireOwner } from "../support/auth-guard";
import { getBoss } from "../support/queue";

export async function ok() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  let boss: Awaited<ReturnType<typeof getBoss>> | null = null;
  try {
    boss = await getBoss();
  } catch {
    // The fresh-send path below rejects the known null preparation state.
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.genJob.create({
      data: { ownerId: gate.ownerId },
    });
    if (!boss) throw new Error("QUEUE_UNAVAILABLE");
    return boss.send("job", { genJobId: row.id }, { db: fromPrisma(tx) });
  });
}
