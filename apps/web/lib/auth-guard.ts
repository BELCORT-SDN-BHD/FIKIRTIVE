import "server-only";
import { auth } from "@/lib/better-auth/compat";
import { allowed, isFounderAdmin } from "@/lib/allowlist";
import { prisma, grantCreditsTx } from "@fikirtive/db";
import { runAsSystem, type UserPrincipal } from "@fikirtive/db/principal";
import {
  newId,
  FOUNDER_OWNER_ID,
  SIGNUP_GRANT_CREDITS,
  rolesAllow,
  primaryPlatformRole,
  effectiveOrgRoles,
  primaryOrgRole,
  isRole,
  type Section,
  type Action,
  type Role,
} from "@fikirtive/core";

/** In-handler auth (R7): re-assert auth()+allowlist INSIDE every action, not just
 *  at the opt-in proxy wall. Returns the email or an {error} the caller returns
 *  verbatim. Spend actions (operator-RBAC does NOT gate spend) stay on THIS. */
export async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await allowed(email))) return { error: "Not authorized." };
  return { email };
}

/** Platform capability gate. Every assigned role contributes permissions. */
export async function requireRole(
  section: Section,
  action: Action,
): Promise<{ email: string; roles: Role[]; role: Role } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await allowed(email))) return { error: "Not authorized." };

  // #734 — `User.role` is NOT selected here, and never was used. Reading it made the compat
  // column look authoritative to the next reader, which is how the admin roster came to display
  // it while this gate decided on `UserRole`. `UserRole` is the authority; nothing else is.
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { roles: { select: { role: true } } },
  });
  const roles = [...new Set((user?.roles ?? []).map((assignment) => assignment.role).filter(isRole))];
  if (!rolesAllow(roles, section, action)) {
    // denied-attempt audit (best-effort — never let the audit write change the deny)
    await prisma.actionEvent.create({
      data: {
        id: newId(),
        ownerId: FOUNDER_OWNER_ID,
        type: "rbac.deny",
        payload: { email, roles, section, action },
      },
    }).catch(() => {});
    return { error: "You don't have access to this." };
  }
  return { email, roles, role: primaryPlatformRole(roles) };
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
  let ownerId: string | null;
  try {
    ownerId = await bootstrapPersonalOrg(user.id, email);
  } catch (e) {
    // #538 — a revoke landed mid-provisioning. Deny, and say so distinctly instead of
    // inviting the merchant to retry something that will never succeed.
    if (e instanceof RevokedDuringProvisioning) return { error: "Your access has been revoked." };
    throw e;
  }
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
    select: { id: true, userId: true, roles: { select: { role: true } } },
  });
  const orgRoles = effectiveOrgRoles(
    (membership?.roles ?? []).map((assignment) => assignment.role),
  );
  return {
    kind: "user",
    subjectUserId: membership?.userId ?? null,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: primaryOrgRole(orgRoles),
    membershipId: membership?.id ?? null,
    impersonating: opts.impersonating ?? false,
    // #463/#464 never carry the impersonator's id — see @fikirtive/db/principal (deferred to ②-D).
    impersonatedByBaUserId: null,
  };
}

/** #538 — thrown to abort provisioning when the operator's revoke won the AllowedEmail row.
 *  A dedicated type so the catch below can tell a DELIBERATE fail-closed abort apart from the
 *  concurrent-creator P2002 it is allowed to recover from.
 *
 *  It ESCAPES bootstrapPersonalOrg rather than collapsing into its `null` return: `null` also
 *  means "transient failure, retry later", and callers must not confuse a security refusal
 *  with a blip. Both production callers handle it explicitly (requireOwner below, and
 *  convergeIdentity). Carries no email — the type is the whole message. */
export class RevokedDuringProvisioning extends Error {
  constructor() {
    // No email in the message: generic handlers log `e.message`, and #575 log discipline
    // keeps user content out of logs. The type carries the whole meaning.
    super("provisioning refused: address revoked during signup");
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
 *  already renamed themselves. #680 — no shop name (sign-in-code/invite/OAuth identities) now
 *  leaves the name EMPTY rather than falling back to the email address.
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
      //
      // BOTH SIDES MUST NAME THE SAME SINGLE ROW, or there is nothing to serialize on.
      // AllowedEmail.email is a plain TEXT primary key: nothing in the database forbids
      // `a@b.com` and `A@b.com` coexisting. A case-INSENSITIVE predicate here against a
      // lowercase-exact predicate in revokeTenantInvite would let the two sides update
      // DIFFERENT physical rows — revoke flips the canonical row while provisioning flips
      // a case-variant one, and the split state comes back. So this side uses the exact
      // same lowercase-exact predicate revoke uses: every writer normalizes before
      // writing, the lowercase row is the only one the allowlist ever reads
      // (allowlist.ts findUnique is exact), and a stray case-variant row is inert here.
      // The durable fix — a lower(email) unique constraint — needs a migration and is
      // tracked in #578; this keeps the protocol sound in the meantime.
      const admissionEmail = email.trim().toLowerCase();
      await tx.allowedEmail.updateMany({
        where: { email: admissionEmail, status: "invited" },
        data: { status: "active" },
      });
      const admission = await tx.allowedEmail.findUnique({
        where: { email: admissionEmail },
        select: { status: true },
      });
      // Revoke won the row. Fail CLOSED: abort the whole provisioning tx rather than
      // leave the split state the reviewer flagged — a live membership owned by an
      // address the operator just locked out. Rolling back here also unwinds the
      // welcome grant below, so a revoked address is never granted credits.
      if (admission?.status === "revoked") throw new RevokedDuringProvisioning();
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
      // #680 — NO shop name collected (sign-in code / invite / OAuth) means the workspace has no
      // name yet, and that is what gets stored: an empty name. It used to fall back to the
      // merchant's email address, which /profile then showed back to them under "Your shop name
      // — shown across Fikirtive." An address is not a shop name, and writing one here made the
      // product state a fact about the merchant that the merchant never said. Empty is the
      // truthful value, and it is what makes /profile's "Set your shop name" placeholder show.
      // (Organization.name is `String @default("")` — no schema change is involved.)
      const workspaceName = (owner?.name ?? "").trim();
      await tx.organization.upsert({ where: { id: orgId }, create: { id: orgId, name: workspaceName }, update: {} });
      const membership = await tx.membership.upsert({
        where: { userId_orgId: { userId, orgId } },
        create: { id: newId(), userId, orgId, role: "owner" },
        update: {},
        select: { id: true },
      });
      await tx.membershipRole.upsert({
        where: { membershipId_role: { membershipId: membership.id, role: "owner" } },
        create: { membershipId: membership.id, role: "owner" },
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
      // Fixed-category log, no user content (#575 discipline). Rethrown rather than folded
      // into `null` so callers can tell a refusal from a retryable failure.
      console.error("auth-guard: provisioning refused — address revoked during signup");
      throw e;
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
