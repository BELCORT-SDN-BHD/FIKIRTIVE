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

export type AccountActivity = {
  id: string;
  label: string; // friendly description (the ledger reason, else a kind label)
  delta: number; // signed change in DISPLAYED credits (1 displayed = $0.10)
  at: string; // ISO timestamp
};
export type AccountInfo = {
  email: string;
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

/** Read the signed-in user's own account. Fail-closed: returns {error} for an
 *  unauthenticated/unresolvable session and never reads another org's data. */
export async function getMyAccount(): Promise<AccountInfo | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const { email, ownerId } = owner;

  const [account, ledger] = await Promise.all([
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
  // balanceDelta != 0 is filtered in the query above (SETTLE is hold-only).
  const recent: AccountActivity[] = ledger.map((l) => ({
    id: l.id,
    label: activityLabel(l, genJobLabels),
    delta: displayCredits(l.balanceDelta),
    at: l.createdAt.toISOString(),
  }));

  return {
    email,
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
