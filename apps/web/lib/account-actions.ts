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

export type AccountActivity = {
  id: string;
  label: string; // friendly description (the ledger reason, else a kind label)
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

// Only kinds that move the spendable balance surface here (SETTLE is hold-only).
const KIND_LABEL: Record<string, string> = {
  GRANT: "Credits added",
  RESERVE: "Generation",
  REFUND: "Refund",
  ADJUST: "Adjustment",
  SETTLE: "Settled",
};

function videoResolution(videoOptions: unknown): string | null {
  if (!videoOptions || typeof videoOptions !== "object" || Array.isArray(videoOptions)) return null;
  const resolution = (videoOptions as { resolution?: unknown }).resolution;
  return typeof resolution === "string" && resolution.trim() ? resolution.trim() : null;
}

function genJobActivityLabel(job: { kind: string; count: number; videoOptions: unknown }): string {
  if (job.kind === "VIDEO") {
    const resolution = videoResolution(job.videoOptions);
    return resolution ? `Video generation - ${resolution}` : "Video generation";
  }
  const count = Math.max(1, job.count);
  return `Image generation - ${count} ${count === 1 ? "image" : "images"}`;
}

/** Otto LLM-turn ledger rows carry an "otto-..." refId (otto-turn/stream/approve/verdict);
 *  media rows carry the GenJob id. Label the conversation cost distinctly so a chat turn
 *  doesn't read as "Generation" in the activity feed. */
function activityLabel(
  row: { refId: string | null; reason: string | null; kind: string },
  genJobLabels: Map<string, string>,
): string {
  if (row.refId?.startsWith("otto-")) return "Otto thinking";
  if (row.refId && genJobLabels.has(row.refId)) return genJobLabels.get(row.refId)!;
  return row.reason?.trim() || KIND_LABEL[row.kind] || row.kind;
}

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

    const parts = partsInTz(latest.createdAt, "UTC");
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

/** Read the signed-in user's own account. Fail-closed: returns {error} for an
 *  unauthenticated/unresolvable session and never reads another org's data. */
export async function getMyAccount(): Promise<AccountInfo | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const { email, ownerId } = owner;

  const [organization, account, ledger] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { name: true },
    }),
    prisma.creditAccount.findUnique({ where: { orgId: ownerId }, select: { balance: true, reserved: true } }),
    prisma.creditLedger.findMany({
      // balanceDelta != 0 filters in the DB so "25 recent" means 25 balance-moving rows
      // (SETTLE is hold-only, balanceDelta 0; the charge already shows as its RESERVE row).
      where: { orgId: ownerId, balanceDelta: { not: 0 } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, reason: true, refId: true, balanceDelta: true, createdAt: true },
    }),
  ]);
  if (!organization) return { error: "Could not load your organization." };

  const genJobRefIds = ledger
    .map((l) => l.refId)
    .filter((refId): refId is string => !!refId && !refId.startsWith("otto-"));
  const genJobs = genJobRefIds.length
    ? await prisma.genJob.findMany({
        where: { ownerId, id: { in: genJobRefIds } },
        select: { id: true, kind: true, count: true, videoOptions: true },
      })
    : [];
  const genJobLabels = new Map(genJobs.map((j) => [j.id, genJobActivityLabel(j)]));

  const balanceInternal = account?.balance ?? 0;
  // balanceDelta != 0 is filtered in the query above (SETTLE is hold-only for the GEN
  // path). Label each row first (label only depends on refId/reason/kind, so it's stable
  // across a group's rows), then merge same-refId rows into one task per decision ④.
  const recent: AccountActivity[] = mergeByTask(
    ledger.map((l) => ({ ...l, label: activityLabel(l, genJobLabels) })),
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
