import "server-only";
import { prisma } from "@fikirtive/db";

/** Shown on the signup page and returned by the API when new signups are paused.
 *  Honest: it says the door is shut, and does not promise a date. */
export const SIGNUPS_PAUSED_MESSAGE = "New signups are paused right now.";

/**
 * #543 — the emergency "pause new signups" switch (`SIGNUPS_PAUSED`).
 *
 * Read LIVE on every call, never captured at module init, so flipping the variable takes
 * effect on the next request without a code change. FAIL-CLOSED: an unset or explicitly
 * "off" value is the only way signups stay open — any other value (a typo, "yes", "paused",
 * a stray "1") pauses them. Shutting the door by accident is recoverable; leaving it open
 * by accident is not.
 */
export function signupsPaused(): boolean {
  const raw = (process.env.SIGNUPS_PAUSED ?? "").trim().toLowerCase();
  if (raw === "") return false;
  return !["0", "false", "off", "no"].includes(raw);
}

/**
 * #543 — registration IS the invite.
 *
 * Self-service signup writes the registering address into the SAME AllowedEmail table the
 * invite flow uses, so every existing deny-by-default gate (`isAllowedEmail`,
 * `assertAllowedEmail`, `requireSession`, `requireOwner`, the admin re-assertions) keeps
 * working byte-for-byte — the door opened, the walls did not move. AllowedEmail keeps its
 * other two jobs: operator invites, and revocation.
 *
 * Called only AFTER the account row exists, never speculatively from a request body: a
 * refused or abandoned signup must not leave behind an address that could still walk in
 * later (e.g. after signups are paused).
 *
 * NEVER resurrects an existing row — `skipDuplicates` is an INSERT … ON CONFLICT DO NOTHING,
 * so an operator's `revoked` or `invited` row keeps its own status and audit trail.
 */
export async function admitSelfSignup(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await prisma.allowedEmail.createMany({
    data: [{ email: normalized, status: "active", invitedBy: "self-signup" }],
    skipDuplicates: true,
  });
}
