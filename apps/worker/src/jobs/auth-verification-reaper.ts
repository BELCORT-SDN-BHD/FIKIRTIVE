import { prisma } from "@fikirtive/db";

/** How long an already-expired verification row is kept before it is swept.
 *
 *  The row is dead the moment `expiresAt` passes — Better Auth's own consume step refuses an
 *  expired token, so nothing here is a security window. The day of grace exists only so an
 *  operator debugging "my link said invalid" the same afternoon still has the row to look at. */
const EXPIRED_GRACE_MS = 1000 * 60 * 60 * 24;

/**
 * #678 r3 — sweep expired Better Auth verification rows (magic-link tokens, email-verification
 * tokens, password-reset tokens).
 *
 * WHY IT EXISTS. Nothing in the repository ever deleted these. Better Auth consumes a token on
 * a successful redemption, so the rows that pile up are exactly the ones nobody redeemed: the
 * merchant who asked for a second link, the signup that was abandoned, and — the reason a review
 * asked for this — every request that minted a row and was never followed. Minting now happens
 * only after the access check (lib/better-auth/sender.ts), so the volume is bounded by the
 * allowlist rather than by whoever is pressing the button; this keeps the table from carrying
 * that history forever regardless.
 *
 * `BetterAuthVerification` carries no ownerId — it is a platform-level table, not a tenant one —
 * so this is a single cross-tenant delete with no per-row tenant phase, unlike the credit and
 * job reapers beside it. It runs inside the tick's own "worker-reaper-tick" system frame.
 *
 * Returns how many rows were swept.
 */
export async function reapExpiredAuthVerifications(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPIRED_GRACE_MS);
  const { count } = await prisma.betterAuthVerification.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}
