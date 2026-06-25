import "server-only";
import { auth } from "@/lib/better-auth/compat";
import { allowed, isFounderAdmin } from "@/auth";
import { prisma, grantCreditsTx } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID, BETA_INITIAL_GRANT_CREDITS, roleAllows, isRole, type Section, type Action, type Role } from "@fikirtive/core";

/** In-handler auth (R7): re-assert auth()+allowlist INSIDE every action, not just
 *  at the opt-in proxy wall. Returns the email or an {error} the caller returns
 *  verbatim. Spend actions (operator-RBAC does NOT gate spend) stay on THIS. */
export async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await allowed(email))) return { error: "Not authorized." };
  return { email };
}

/** OPT-6 P1b operator-RBAC gate. Two walls: (1) the env allowlist (outer — never
 *  reads role; a default-viewer who is off the allowlist is out of the app), then
 *  (2) the section→role matrix (roleAllows). Denies by default; a denied attempt is
 *  audited (best-effort). Returns {email, role} on success. NOT used on spend
 *  actions — those keep requireSession (RBAC is operator-only). */
export async function requireRole(
  section: Section,
  action: Action,
): Promise<{ email: string; role: Role } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await allowed(email))) return { error: "Not authorized." };
  const role: Role = isRole(session.user?.role) ? session.user.role : "viewer";
  if (!roleAllows(role, section, action)) {
    // denied-attempt audit (best-effort — never let the audit write change the deny)
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "rbac.deny", payload: { email, role, section, action } },
    }).catch(() => {});
    return { error: "You don't have access to this." };
  }
  return { email, role };
}

/** P3 — the authoritative, FAIL-CLOSED session→ownerId resolver. EVERY tenant-data and
 *  spend site uses this instead of the FOUNDER_OWNER_ID constant. Contract (spec §6.3):
 *   - no session / off-allowlist  → { error } (the allowlist stays the outer invite gate)
 *   - founder-admin email         → "founder" (the ONLY path that may EVER return "founder")
 *   - any other allowlisted user  → their active org; if none, SYNCHRONOUSLY bootstrap a
 *     personal Organization + Membership(owner) + CreditAccount(beta grant), idempotently,
 *     and return the new org id
 *   - if bootstrap can't complete → { error } (NEVER fall back to "founder" or any default —
 *     that would silently hand a new user the founder's data + credits)
 *  Idempotent. Identical under next-auth and Better Auth (P4 doesn't touch it). */
export async function requireOwner(): Promise<{ email: string; ownerId: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await allowed(email))) return { error: "Not authorized." };

  // Only a founder-admin session may ever resolve to the founder org.
  if (isFounderAdmin(email)) return { email, ownerId: FOUNDER_OWNER_ID };

  // The user row exists (DB-session strategy created it at sign-in). Find their active org.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { error: "Not authorized." }; // no user row → cannot scope; fail closed

  // Find the user's non-founder membership regardless of status OR deletedAt, so a
  // suspended/revoked member is denied even if their row was soft-deleted (defense-in-depth).
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, orgId: { not: FOUNDER_OWNER_ID } },
    orderBy: { createdAt: "asc" },
    select: { orgId: true, status: true, deletedAt: true },
  });
  if (existing && (existing.status === "suspended" || existing.status === "revoked")) return { error: "Your access is suspended." };
  if (existing && !existing.deletedAt) return { email, ownerId: existing.orgId };
  // none, or a soft-deleted non-suspended membership (account reopening) → bootstrap
  const ownerId = await bootstrapPersonalOrg(user.id, email);
  if (!ownerId) return { error: "Could not set up your workspace — please retry." };
  return { email, ownerId };
}

/** Create (idempotently) a personal Organization + Membership(owner) + CreditAccount with the
 *  one-time beta grant. Returns the org id, or null if it can't complete (NEVER "founder").
 *
 *  CONCURRENCY-IDEMPOTENT: the org id is DETERMINISTIC (`org_<userId>`), so two simultaneous
 *  callers (two tabs, or events.signIn racing the first request) converge on the SAME org
 *  instead of creating two orgs + double-granting. The org/membership writes are upserts (the
 *  loser of the race no-ops), and the beta grant is attempted EVERY call but dedupes on the
 *  stable key "signup:<orgId>" (grantCredits is ledger-first idempotent) — so a grant that
 *  failed after a prior commit is retried on the next call. `org_<userId>` is charset-safe for
 *  storageKey (/[^0-9A-Za-z_-]/) because the next-auth user id is. Shared by requireOwner
 *  (authoritative) and events.signIn (convergence). */
export async function bootstrapPersonalOrg(userId: string, email: string): Promise<string | null> {
  const orgId = `org_${userId}`; // deterministic → concurrent callers converge on ONE org
  try {
    await prisma.$transaction(async (tx) => {
      await tx.organization.upsert({ where: { id: orgId }, create: { id: orgId, name: email }, update: {} });
      await tx.membership.upsert({
        where: { userId_orgId: { userId, orgId } },
        create: { id: newId(), userId, orgId, role: "owner" },
        update: {},
      });
      // revive a soft-deleted membership ONLY if it isn't suspended/revoked
      await tx.membership.updateMany({
        where: { userId, orgId, status: { notIn: ["suspended", "revoked"] } },
        data: { deletedAt: null },
      });
      // carry the active org so a future multi-org switcher needs no auth-table migration
      await tx.user.update({ where: { id: userId }, data: { activeOrgId: orgId } });
      // Beta grant ATOMIC with the org/membership writes (grantCreditsTx runs in THIS tx): if it
      // fails the whole tx rolls back — no "org exists but 0 credits" limbo — and the next request
      // re-runs bootstrap cleanly. Idempotent on "signup:<orgId>" (createMany skipDuplicates), so a
      // replay or concurrent winner no-ops. Credit writes stay inside the credit service.
      await grantCreditsTx(tx, {
        orgId,
        amount: BETA_INITIAL_GRANT_CREDITS,
        source: "BETA",
        reason: "beta signup grant",
        idempotencyKey: `signup:${orgId}`,
      });
    });
    return orgId;
  } catch (e) {
    // A concurrent creator may have won the org pk / membership upsert mid-tx (P2002), aborting
    // this tx. Re-read the deterministic org; if it now exists, use it. Otherwise fail closed.
    const m = await prisma.membership
      .findFirst({ where: { userId, orgId, deletedAt: null, status: "active" }, select: { orgId: true } })
      .catch(() => null);
    if (m) return m.orgId;
    console.error("bootstrapPersonalOrg failed:", e instanceof Error ? e.message : e);
    return null; // NEVER return "founder" or a default
  }
}
