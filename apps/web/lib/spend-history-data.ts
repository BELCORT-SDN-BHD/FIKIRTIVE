import "server-only";
/**
 * spend-history-data — the server read behind /billing's spend history (#555).
 *
 * A page-only READ module (the lib/data.ts pattern): `server-only`, never a client-callable
 * server action, so it adds no Otto action surface. Otto still cannot read a merchant's
 * balance or charges — that skill is tracked separately; here Otto's job is only to point at
 * this page (see packages/otto/src/instructions.ts "Credits and spending").
 *
 * MONEY SAFETY: read-only. It never reserves, settles, refunds, grants, or adjusts anything.
 * Fail-closed tenancy: requireOwner() resolves the session to one ownerId and every query is
 * filtered by it, so a merchant only ever sees their own workspace's ledger.
 */
import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { mergeSettings } from "./owner-settings";
import { buildSpendHistory, type SpendEntry, type SpendLedgerRow } from "./spend-history";

/** How many TASKS the history shows (a task = one refId group, or a lone no-refId row). */
export const SPEND_HISTORY_TASK_LIMIT = 50;

/** Fetch EVERY ledger row of the `limit` most recent tasks — including zero-delta rows.
 *
 *  Same two-pass task window as account-actions' recentTaskLedgerRows (find the recent task
 *  keys, then re-fetch by task identity so a task's older half is never cut off), with one
 *  deliberate difference: NO `balanceDelta != 0` filter. A generation settles at exactly the
 *  amount it reserved, so its SETTLE row carries balanceDelta 0; dropping that row would
 *  leave only the RESERVE and make a finished job read as an unsettled hold. A task has at
 *  most two rows, so a 4x raw window always contains `limit` distinct tasks. */
async function recentSpendLedgerRows(ownerId: string, limit: number): Promise<SpendLedgerRow[]> {
  const recentRaw = await prisma.creditLedger.findMany({
    where: { orgId: ownerId },
    orderBy: { createdAt: "desc" },
    take: limit * 4,
    select: { id: true, refId: true },
  });

  const taskKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const row of recentRaw) {
    const key = row.refId ?? `row:${row.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    taskKeys.push(key);
    if (taskKeys.length === limit) break;
  }
  if (taskKeys.length === 0) return [];

  const taskRefIds = taskKeys.filter((k) => !k.startsWith("row:"));
  const taskRowIds = taskKeys.filter((k) => k.startsWith("row:")).map((k) => k.slice(4));

  return prisma.creditLedger.findMany({
    where: {
      orgId: ownerId,
      OR: [
        ...(taskRefIds.length ? [{ refId: { in: taskRefIds } }] : []),
        ...(taskRowIds.length ? [{ id: { in: taskRowIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, kind: true, source: true, reason: true, refId: true,
      balanceDelta: true, reservedDelta: true, createdAt: true,
    },
  });
}

/** The signed-in merchant's own spend history — "where did my credits go".
 *  Returns {error} for an unauthenticated/unresolvable session; never reads another org. */
export async function getSpendHistory(): Promise<SpendEntry[] | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const { ownerId } = owner;

  const [organization, rows] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { settings: true },
    }),
    recentSpendLedgerRows(ownerId, SPEND_HISTORY_TASK_LIMIT),
  ]);
  if (!organization) return { error: "Could not load your organization." };
  // Charge times display in the merchant's own workspace timezone (the existing Schedule
  // setting), same rule as the account activity feed.
  const tz = mergeSettings(organization.settings).timezone;

  // A refId with no prefix is a generation job id; label it by what that job made. Anything
  // not found here stays uncategorised rather than guessed at (see spendCategoryOf).
  const jobRefIds = rows
    .map((r) => r.refId)
    .filter((refId): refId is string => !!refId && !refId.includes(":"));
  const [genJobs, refGenJobs] = jobRefIds.length
    ? await Promise.all([
        prisma.genJob.findMany({ where: { ownerId, id: { in: jobRefIds } }, select: { id: true, kind: true } }),
        prisma.refGenJob.findMany({ where: { ownerId, id: { in: jobRefIds } }, select: { id: true } }),
      ])
    : [[], []];
  const jobKindByRefId = new Map<string, "IMAGE" | "VIDEO">([
    ...genJobs.map((j) => [j.id, j.kind === "VIDEO" ? "VIDEO" : "IMAGE"] as const),
    // Reference-image jobs only ever produce images.
    ...refGenJobs.map((j) => [j.id, "IMAGE"] as const),
  ]);

  return buildSpendHistory(rows, jobKindByRefId, tz);
}
