"use server";
/**
 * User-facing self-service account (closed-beta P4 safe slice). Read-only view of
 * "who am I + how many credits do I have + what did I spend" plus sign-out. This
 * file NEVER writes credits — granting/spending lives in the credit service and the
 * idempotent spend path. Tenant scoping is via requireOwner() (the fail-closed
 * session→ownerId resolver), so a user only ever sees their own org's balance.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@fikirtive/db";
import { displayCredits, CREDITS_PER_USD, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { auth } from "@/lib/better-auth/server";
import { formatCredits } from "@/lib/credit-format";
import { partsInTz, formatDayLabel, formatTime } from "@/lib/schedule-view";
import { mergeSettings } from "@/lib/owner-settings";
import { spendLabelOf } from "@/lib/spend-history";

export type AccountActivity = {
  id: string;
  label: string; // what the merchant is told this was — from the shared ledger wording (spend-history.ts)
  delta: number; // NET signed change in DISPLAYED credits for this task (1 displayed = $0.10)
  at: string; // ISO timestamp of the task's most recent ledger event
  atLabel: string; // pre-formatted, locale-fixed display time (never format dates client-side — see schedule-view.ts)
  detail?: string; // merchant-facing breakdown when a hold was later adjusted, e.g. "11.6 credits used · 0.4 refunded"
};
export type AccountInfo = {
  email: string;
  organizationName: string;
  isFounder: boolean;
  balance: number; // spendable, DISPLAYED credits
  reserved: number; // in-flight hold, DISPLAYED credits
  balanceUsd: number; // ≈ USD of the spendable balance
  recent: AccountActivity[];
};

/* This file owns no wording of its own for a ledger row. It calls `spendLabelOf`
 * (lib/spend-history.ts), the single authority every merchant-facing entrance shares, so the
 * same row reads the same on /billing and here (#683). The table that used to live here put
 * the ledger's INTERNAL operator note ahead of any human label, which meant an admin
 * adjustment reached the merchant as the back-office ticket text an operator had typed. That
 * field is no longer selected below, so there is nothing left to fall back to it. */

/** Merge one task's hold + settle/refund ledger rows into a single entry (decision ④,
 *  spec issue #513 §C9): a generation job or an Otto turn writes RESERVE first, then
 *  either SETTLE (partial refund of an over-estimated hold) or REFUND (full release on
 *  failure) against the SAME refId — a merchant reads that as ONE thing that happened,
 *  not two ledger mechanics. Rows with no refId (GRANT/ADJUST — admin grants/adjustments)
 *  never merge; each keeps its own row. Pure, read-only, order-preserving (a refId's
 *  position is set by its first-seen row) — this only reshapes what getMyAccount already
 *  fetched; it writes nothing and changes no ledger/credit semantics. */
function mergeByTask(
  rows: { id: string; kind: string; refId: string | null; balanceDelta: number; createdAt: Date; label: string }[],
  tz: string,
): AccountActivity[] {
  const order: string[] = [];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.refId ?? `row:${row.id}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(row);
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const netInternal = group.reduce((sum, r) => sum + r.balanceDelta, 0);
    const latest = group.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));

    let detail: string | undefined;
    if (group.length > 1) {
      const reserve = group.find((r) => r.kind === "RESERVE");
      const back = group.find((r) => r.kind === "SETTLE" || r.kind === "REFUND");
      if (reserve && back) {
        const heldInternal = -reserve.balanceDelta; // RESERVE.balanceDelta is always negative
        const usedInternal = heldInternal - back.balanceDelta; // back is the returned portion
        detail = usedInternal > 0
          ? `${formatCredits(displayCredits(usedInternal))} credits used · ${formatCredits(displayCredits(back.balanceDelta))} refunded`
          : "Held, then refunded in full";
      }
    }

    const parts = partsInTz(latest.createdAt, tz);
    return {
      id: latest.id,
      label: latest.label,
      delta: displayCredits(netInternal),
      at: latest.createdAt.toISOString(),
      atLabel: `${formatDayLabel(parts)}, ${formatTime(parts)}`,
      detail,
    };
  });
}

type LedgerRow = { id: string; kind: string; source: string; refId: string | null; balanceDelta: number; createdAt: Date };

/** Fetch every nonzero-delta ledger row for the `limit` most recent TASKS (a task is a
 *  refId group, or a lone row when refId is null) — not the `limit` most recent RAW rows.
 *  Fixes #521: a plain `take: limit` on raw rows could return a REFUND whose matching
 *  RESERVE sits just outside the window, so mergeByTask saw a lone REFUND row and
 *  displayed it as a standalone positive "income" line instead of the task's real net.
 *
 *  Two passes: (1) scan a generous raw batch (a task never has more than 2 nonzero-delta
 *  rows — one RESERVE plus one SETTLE/REFUND — so 4x the task limit is always enough to
 *  find `limit` distinct tasks) to find which `limit` tasks are the most recent; (2)
 *  re-fetch by task identity (refId/id), with no row-count cap, so a task's older half is
 *  always included however far back it sits. Every returned row is real: nothing is
 *  synthesized, this only changes which existing rows get fetched. */
async function recentTaskLedgerRows(ownerId: string, limit: number): Promise<LedgerRow[]> {
  const recentRaw = await prisma.creditLedger.findMany({
    where: { orgId: ownerId, balanceDelta: { not: 0 } },
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

  const rows = await prisma.creditLedger.findMany({
    where: {
      orgId: ownerId,
      balanceDelta: { not: 0 },
      OR: [
        ...(taskRefIds.length ? [{ refId: { in: taskRefIds } }] : []),
        ...(taskRowIds.length ? [{ id: { in: taskRowIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    // The ledger's internal operator note is NOT selected (#683): the merchant-facing label
    // comes from what the row IS (refId / kind / source), never from back-office text.
    select: { id: true, kind: true, source: true, refId: true, balanceDelta: true, createdAt: true },
  });
  return rows;
}

/** Read the signed-in user's own account. Fail-closed: returns {error} for an
 *  unauthenticated/unresolvable session and never reads another org's data. */
export async function getMyAccount(): Promise<AccountInfo | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const { email, ownerId } = owner;

  const [organization, account] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { name: true, settings: true },
    }),
    prisma.creditAccount.findUnique({ where: { orgId: ownerId }, select: { balance: true, reserved: true } }),
  ]);
  if (!organization) return { error: "Could not load your organization." };
  // Ledger times display in the merchant's own workspace timezone (existing Schedule
  // setting), not a hardcoded UTC — a merchant in Kuala Lumpur reading "10:05 AM" should
  // see the time they'd have seen the charge happen, not a UTC clock they never set.
  const tz = mergeSettings(organization.settings).timezone;

  const ledger = await recentTaskLedgerRows(ownerId, 25);

  // A refId with no prefix is a generation-job id; anything prefixed (otto-…, research:…) is
  // named by its prefix instead. Same lookup and same filter as /billing's read
  // (spend-history-data.ts), including reference-image jobs — otherwise a refgen row would
  // read "Image" there and "Credit change" here, which is the split this fix exists to close.
  const jobRefIds = ledger
    .map((l) => l.refId)
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

  const balanceInternal = account?.balance ?? 0;
  // balanceDelta != 0 is filtered in the query above (SETTLE is hold-only for the GEN
  // path). Label each row first (the label depends only on refId/kind/source, so it is
  // stable across a group's rows), then merge same-refId rows into one task per decision ④.
  const recent: AccountActivity[] = mergeByTask(
    ledger.map((l) => ({ ...l, label: spendLabelOf(l, jobKindByRefId) })),
    tz,
  );

  return {
    email,
    organizationName: organization.name,
    isFounder: ownerId === FOUNDER_OWNER_ID,
    balance: displayCredits(balanceInternal),
    reserved: displayCredits(account?.reserved ?? 0),
    balanceUsd: balanceInternal / CREDITS_PER_USD,
    recent,
  };
}

/** Sign the user out and return them to the login screen. Better Auth's server
 *  signOut clears the session cookie (nextCookies plugin writes it on this action's
 *  response); the redirect then lands on /login. Server-action analog of
 *  authClient.signOut() (the client method can't run inside a "use server" action). */
export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
