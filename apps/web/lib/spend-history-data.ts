import "server-only";
/**
 * spend-history-data — the server read behind /billing's spend history AND Otto's
 * `readSpending` skill (#555).
 *
 * ONE read surface, two callers: the Billing page renders it, and the Otto port
 * (apps/web/lib/otto-actions.ts → ctx.spending) hands the same owner-scoped result to the
 * skill, so Otto answers "what have I spent?" from the same rows a human sees instead of
 * pointing at a page and hoping. Registered in PARITY_READ_SURFACES (第九缝) — round-1
 * review P1③: a new read surface gets declared, never kept off the list to hold a number down.
 *
 * MONEY SAFETY: read-only. It never reserves, settles, refunds, grants, or adjusts anything.
 * Fail-closed tenancy: requireOwner() resolves the session to one ownerId and every query is
 * filtered by it, so a merchant only ever sees their own workspace's ledger.
 */
import { prisma } from "@fikirtive/db";
import { displayCredits } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { mergeSettings } from "./owner-settings";
import { buildSpendHistory, type SpendEntry, type SpendLedgerRow } from "./spend-history";

/** How many TASKS the history shows (a task = one refId group, or a lone no-refId row). */
export const SPEND_HISTORY_TASK_LIMIT = 50;

/** How far back the returned rows reach. Reported, never implied: the page and Otto both say
 *  "the last N" when older activity exists, so neither can claim to list every charge
 *  (round-1 review P1① — a PR that fixes 「说的与做的不一致」 must not carry its own). */
export type SpendWindow = {
  taskLimit: number;
  /** How many tasks are actually in `entries`. */
  returned: number;
  /** True when the workspace has activity older than this window. */
  hasMore: boolean;
};

export type SpendOverview = {
  /** Spendable balance in DISPLAYED credits. */
  balance: number;
  /** Credits held for work in flight, in DISPLAYED credits. */
  reserved: number;
  entries: SpendEntry[];
  window: SpendWindow;
};

/** Fetch EVERY ledger row of the `limit` most recent tasks — including the zero-delta ones —
 *  plus whether older tasks exist.
 *
 *  Same two-pass task window as account-actions' recentTaskLedgerRows (find the recent task
 *  keys, then re-fetch by task identity so a task's older half is never cut off), with one
 *  deliberate difference: NO `balanceDelta != 0` filter. A generation settles at exactly the
 *  amount it reserved, so its SETTLE row carries balanceDelta 0; dropping that row would leave
 *  only the RESERVE and make a finished job read as an unsettled hold. That rule is asserted at
 *  the QUERY layer in spend-history-data.test.ts, not only in the pure fold (round-1 P2).
 *
 *  A task has at most two rows, so a 4x raw window always contains the distinct tasks we need;
 *  we scan for one task MORE than we return purely to learn whether history continues. */
async function recentSpendLedgerRows(
  ownerId: string,
  limit: number,
): Promise<{ rows: SpendLedgerRow[]; hasMore: boolean }> {
  const recentRaw = await prisma.creditLedger.findMany({
    where: { orgId: ownerId },
    orderBy: { createdAt: "desc" },
    take: (limit + 1) * 4,
    select: { id: true, refId: true },
  });

  const taskKeys: string[] = [];
  const seenKeys = new Set<string>();
  let hasMore = false;
  for (const row of recentRaw) {
    const key = row.refId ?? `row:${row.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (taskKeys.length === limit) {
      // A (limit + 1)-th distinct task exists → there IS history older than we return.
      hasMore = true;
      break;
    }
    taskKeys.push(key);
  }
  if (taskKeys.length === 0) return { rows: [], hasMore: false };

  const taskRefIds = taskKeys.filter((k) => !k.startsWith("row:"));
  const taskRowIds = taskKeys.filter((k) => k.startsWith("row:")).map((k) => k.slice(4));

  const rows = await prisma.creditLedger.findMany({
    where: {
      orgId: ownerId,
      OR: [
        ...(taskRefIds.length ? [{ refId: { in: taskRefIds } }] : []),
        ...(taskRowIds.length ? [{ id: { in: taskRowIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    // The ledger's internal operator note is NOT selected: no merchant-facing word is derived
    // from it, so it never enters this read at all (#683).
    select: {
      id: true, kind: true, source: true, refId: true,
      balanceDelta: true, reservedDelta: true, createdAt: true,
    },
  });
  return { rows, hasMore };
}

/** The signed-in merchant's balance plus where their credits went.
 *  Returns {error} for an unauthenticated/unresolvable session; never reads another org. */
export async function getSpendOverview(): Promise<SpendOverview | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const { ownerId } = owner;

  const [organization, account, ledger] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { settings: true },
    }),
    prisma.creditAccount.findUnique({ where: { orgId: ownerId }, select: { balance: true, reserved: true } }),
    recentSpendLedgerRows(ownerId, SPEND_HISTORY_TASK_LIMIT),
  ]);
  if (!organization) return { error: "Could not load your organization." };
  // Charge times display in the merchant's own workspace timezone (the existing Schedule
  // setting), same rule as the account activity feed.
  const tz = mergeSettings(organization.settings).timezone;

  // A refId with no prefix is a generation job id; label it by what that job made. Anything
  // not found here stays uncategorised rather than guessed at (see spendCategoryOf).
  const jobRefIds = ledger.rows
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

  const entries = buildSpendHistory(ledger.rows, jobKindByRefId, tz);
  return {
    balance: displayCredits(account?.balance ?? 0),
    reserved: displayCredits(account?.reserved ?? 0),
    entries,
    window: { taskLimit: SPEND_HISTORY_TASK_LIMIT, returned: entries.length, hasMore: ledger.hasMore },
  };
}
