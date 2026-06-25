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
      select: { id: true, kind: true, reason: true, balanceDelta: true, createdAt: true },
    }),
  ]);

  const balanceInternal = account?.balance ?? 0;
  // balanceDelta != 0 is filtered in the query above (SETTLE is hold-only).
  const recent: AccountActivity[] = ledger.map((l) => ({
    id: l.id,
    label: l.reason?.trim() || KIND_LABEL[l.kind] || l.kind,
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
