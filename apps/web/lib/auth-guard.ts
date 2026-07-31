import "server-only";
import { auth } from "@/lib/better-auth/compat";
import { allowed, isFounderAdmin } from "@/lib/allowlist";
import { prisma, grantCreditsTx } from "@fikirtive/db";
import { runAsSystem, type UserPrincipal } from "@fikirtive/db/principal";
import { newId, FOUNDER_OWNER_ID, SIGNUP_GRANT_CREDITS, roleAllows, isRole, isOrgRole, type Section, type Action, type Role } from "@fikirtive/core";

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

/** #464 ②-B — turn a SUCCESSFUL `requireOwner()` gate into the full ambient {@link UserPrincipal}.
 *
 *  This is HALF of the B1 seam, and the split is deliberate. `runAsUser` (the frame runner in
 *  `@fikirtive/db/principal`) is TRANSPARENT — it is exactly `store.run(frame, fn)`, reads
 *  nothing and decides nothing — which is what lets the CI auth-guard prover analyse
 *  `runAsUser(p, fn)` as `fn()` in the CALLER's own proof context. A helper that did the DB
 *  read AND the frame entry in one call would put a Prisma-reaching module between the caller's
 *  guard and its own body, and the prover would lose the guard→sensitive-op proof across it.
 *  So the read lives HERE, in a plain value-returning function the caller awaits in its own
 *  context, and the frame entry stays the registered runner:
 *
 *      const gate = await requireOwner(); if ("error" in gate) return gate;
 *      const principal = await resolveUserPrincipal(gate);
 *      return runAsUser(principal, async () => { …unchanged body… });
 *
 *  ZERO ENFORCEMENT, ZERO BEHAVIOUR CHANGE by construction: it never throws, never denies and
 *  never short-circuits. The guard call and its `if ("error" in gate) return gate` stay OUTSIDE
 *  and unchanged, so a denied caller never reaches this function at all.
 *
 *  MEMBERSHIP MISS — deliberately DEGRADES, never denies. `requireOwner()` resolves a
 *  founder-admin session to `ownerId: "founder"`, and that session has no Membership row in the
 *  founder org, so this lookup legitimately misses. The four CRM gateways answer a miss with
 *  `ACTION_DENIED`; doing that here would turn a working founder request into an error — a
 *  behaviour change, which B1 forbids. A miss therefore yields a principal that still names the
 *  subject and the org (`subjectEmail` + `ownerId`, the two fields tenant scoping actually
 *  needs) and leaves `subjectUserId` / `orgRole` / `membershipId` null. This is the first
 *  producer of those documented RESERVED NULLs: read null as "this frame did not resolve a
 *  membership", NEVER as "no membership exists".
 *
 *  `impersonating` — B1 adds NO new `isImpersonating()` round trip. The exports that block
 *  impersonation already call it and return an error BEFORE the frame opens, so `false` is the
 *  honest value on those paths; a site that already has the answer passes it explicitly. */
export async function resolveUserPrincipal(
  gate: { email: string; ownerId: string },
  opts: { impersonating?: boolean } = {},
): Promise<UserPrincipal> {
  // One query, the same shape and columns the four CRM gateways already resolve.
  const membership = await prisma.membership.findFirst({
    where: { orgId: gate.ownerId, status: "active", deletedAt: null, user: { email: gate.email } },
    select: { id: true, role: true, userId: true },
  });
  return {
    kind: "user",
    subjectUserId: membership?.userId ?? null,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: membership && isOrgRole(membership.role) ? membership.role : null,
    membershipId: membership?.id ?? null,
    impersonating: opts.impersonating ?? false,
    // #463/#464 never carry the impersonator's id — see @fikirtive/db/principal (deferred to ②-D).
    impersonatedByBaUserId: null,
  };
}

/** #538 — thrown to abort provisioning when the operator's revoke won the AllowedEmail row.
 *  A dedicated type so the catch below can tell a DELIBERATE fail-closed abort apart from the
 *  concurrent-creator P2002 it is allowed to recover from. */
class RevokedDuringProvisioning extends Error {
  constructor(email: string) {
    super(`provisioning refused: ${email} was revoked`);
    this.name = "RevokedDuringProvisioning";
  }
}

/** Create (idempotently) a personal Organization + Membership(owner) + CreditAccount with the
 *  one-time welcome grant. Returns the org id, or null if it can't complete (NEVER "founder").
 *
 *  #543 — the workspace is named after the merchant's own shop. The signup form's third field
 *  is the shop name; it travels as the account name and lands here, so the first screen shows
 *  the merchant their own shop instead of their email address. The org name is set at CREATE
 *  only (`update: {}`) — a later bootstrap never renames a workspace the merchant may have
 *  already renamed themselves. No shop name (magic-link/OAuth identities) → the email, exactly
 *  as before.
 *
 *  CONCURRENCY-IDEMPOTENT: the org id is DETERMINISTIC (`org_<userId>`), so two simultaneous
 *  callers (two tabs, or events.signIn racing the first request) converge on the SAME org
 *  instead of creating two orgs + double-granting. The org/membership writes are upserts (the
 *  loser of the race no-ops), and the beta grant is attempted EVERY call but dedupes on the
 *  stable key "signup:<orgId>" (grantCredits is ledger-first idempotent) — so a grant that
 *  failed after a prior commit is retried on the next call. `org_<userId>` is charset-safe for
 *  storageKey (/[^0-9A-Za-z_-]/) because the next-auth user id is. Shared by requireOwner
 *  (authoritative) and events.signIn (convergence).
 *
 *  #463 — this is one of the two canonical system contexts. On the sign-in hook path the
 *  session cookie does not exist yet (Better Auth calls convergeIdentity BEFORE
 *  setSessionCookie), so there is no user principal to resolve, by construction. The tx
 *  therefore runs under the named system identity "auth:bootstrap-personal-org" rather than
 *  a nameless third state. Ordering, atomicity and every constraint below are unchanged —
 *  the wrapper adds a name, nothing else. */
export async function bootstrapPersonalOrg(userId: string, email: string): Promise<string | null> {
  const orgId = `org_${userId}`; // deterministic → concurrent callers converge on ONE org
  try {
    await runAsSystem("auth:bootstrap-personal-org", () => prisma.$transaction(async (tx) => {
      // ── #538 — registration half of the invite sync protocol ──────────────────────
      // Provisioning and admin revocation are two transactions that must never both
      // "win". They are serialized on ONE row (this address's AllowedEmail) by two
      // CONDITIONAL updates, so correctness does not depend on the isolation level:
      //
      //   here   UPDATE … SET status='active'  WHERE email=… AND status='invited'
      //   revoke UPDATE … SET status='revoked' WHERE email=… AND status='invited'
      //
      // Postgres takes a row lock per UPDATE and re-evaluates the WHERE against the
      // newly committed version, so whichever commits first flips the row out of
      // 'invited' and the loser matches 0 rows — then sees the winner's state below.
      // This also fixes a real display bug: self-signup never touched an operator's
      // existing 'invited' row (signup-gate.ts uses skipDuplicates), so an invited
      // merchant stayed "pending" in /admin/tenants forever, masked only by a
      // read-time filter. Now activation is recorded where it happens.
      await tx.allowedEmail.updateMany({
        where: { email: { equals: email, mode: "insensitive" }, status: "invited" },
        data: { status: "active" },
      });
      const admission = await tx.allowedEmail.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { status: true },
      });
      // Revoke won the row. Fail CLOSED: abort the whole provisioning tx rather than
      // leave the split state the reviewer flagged — a live membership owned by an
      // address the operator just locked out. Rolling back here also unwinds the
      // welcome grant below, so a revoked address is never granted credits.
      if (admission?.status === "revoked") throw new RevokedDuringProvisioning(email);
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
      const workspaceName = (owner?.name ?? "").trim() || email;
      await tx.organization.upsert({ where: { id: orgId }, create: { id: orgId, name: workspaceName }, update: {} });
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
      // Welcome grant ATOMIC with the org/membership writes (grantCreditsTx runs in THIS tx): if
      // it fails the whole tx rolls back — no "org exists but 0 credits" limbo — and the next
      // request re-runs bootstrap cleanly. Idempotent on "signup:<orgId>" (createMany
      // skipDuplicates), so a replay or concurrent winner no-ops. Credit writes stay inside the
      // credit service.
      //
      // #543 — the AMOUNT changed (100 → 20 displayed credits, the Founder's signup grant) and
      // NOTHING else. The idempotency key stays "signup:<orgId>" deliberately: a new key would
      // not dedupe against the rows already written, so every existing org would be granted a
      // SECOND time on its next sign-in. `orgId` is `org_<userId>` and a User row is unique per
      // email forever, so this key is already once-per-merchant-for-life.
      await grantCreditsTx(tx, {
        orgId,
        amount: SIGNUP_GRANT_CREDITS,
        source: "BETA",
        // Merchant-visible ledger label (account-actions surfaces `reason`). Honest now that
        // the closed beta isn't the reason anyone gets these credits.
        reason: "signup welcome grant",
        // #463: name the writer. The ledger's createdBy defaulted to "" here — the one place
        // the beta grant was unattributable. Same value as the system reason above; amount,
        // source, idempotencyKey and the dedup semantics are untouched.
        createdBy: "auth:bootstrap-personal-org",
        idempotencyKey: `signup:${orgId}`,
      });
    }));
    return orgId;
  } catch (e) {
    // #538 — a deliberate fail-closed abort must NOT be laundered into success by the
    // concurrent-creator recovery below: that recovery returns any pre-existing membership,
    // which for a revoked address is exactly the split state this abort exists to prevent.
    if (e instanceof RevokedDuringProvisioning) {
      console.error("bootstrapPersonalOrg refused: address is revoked");
      return null;
    }
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
