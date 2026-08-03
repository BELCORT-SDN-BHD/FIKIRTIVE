import "server-only";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { isFounderAdmin } from "@/lib/allowlist";

/** #538 — is this the deliberate "revoked mid-provisioning" refusal thrown by
 *  bootstrapPersonalOrg? Matched by NAME, not `instanceof`: auth-guard is loaded through a
 *  dynamic import below (it imports better-auth/compat, which reaches back here — a static
 *  import would close that cycle), so the constructor identity is not reliably in scope. */
function isProvisioningRefusal(e: unknown): boolean {
  return e instanceof Error && e.name === "RevokedDuringProvisioning";
}

/** Convergence on BA sign-in. Mirrors auth.ts events.signIn but keyed off email
 *  (the canonical join key). Idempotent, best-effort, and throws for exactly ONE reason —
 *  requireOwner() remains the authoritative fail-closed resolver.
 *
 *  #538 CARVE-OUT to "never throws": if provisioning was deliberately rolled back because the
 *  operator revoked this address mid-signup, that refusal propagates instead of being logged
 *  as a non-fatal hiccup. Reporting success there degraded a security decision into a generic
 *  allowlist denial with no server-side trace. Every OTHER failure stays non-fatal exactly as
 *  before. Security did not depend on this — the session gate already refuses a revoked
 *  address — but the error semantics did.
 *
 *  #463 — the canonical system context. Better Auth runs this from its user/session create
 *  hooks, which fire BEFORE setSessionCookie: there is no cookie, so getSession() returns
 *  null and no user principal can exist here by construction. Rather than re-order writes
 *  that cannot be re-ordered, the whole body runs under the named identity
 *  "auth:converge-identity". The emailVerified gate stays FIRST (outside the wrapper, so an
 *  unverified identity still performs zero work), and the idempotency / founder-atomicity /
 *  allowlist-ordering constraints are all unchanged. (#538 narrowed never-throw to the single
 *  carve-out documented above; every other failure is still swallowed as non-fatal.) */
export async function convergeIdentity(input: { email: string; name?: string | null; image?: string | null; emailVerified?: boolean }): Promise<void> {
  if (!input.emailVerified) return; // never converge (esp. founder super-admin promote) on an unverified identity
  const email = input.email.toLowerCase();
  await runAsSystem("auth:converge-identity", async () => {
    try {
      // 1. Ensure the canonical User row exists (BA identities reconnect to the tenant graph by email).
      //    #544 — mirror emailVerified onto the canonical row. We only reach here when
      //    input.emailVerified is true (the early return above), so a create stamps the
      //    verification and an existing row is stamped ONCE if it is still null. The canonical
      //    column is a DateTime? (next-auth convention): a timestamp means verified. Set-once —
      //    a later convergence never overwrites an earlier stamp (the `emailVerified: null`
      //    filter no-ops once set), so the moment-of-verification is preserved.
      let user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true, role: true },
      });
      if (!user) {
        user = await prisma.user.create({
          data: { email, name: input.name ?? null, image: input.image ?? null, emailVerified: new Date() },
          select: { id: true, emailVerified: true, role: true },
        });
      } else if (!user.emailVerified) {
        await prisma.user.updateMany({ where: { email, emailVerified: null }, data: { emailVerified: new Date() } });
      }
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role: user.role } },
        create: { userId: user.id, role: user.role },
        update: {},
      });
      // 2. Founder super-admin self-heal (promote-only, idempotent).
      if (isFounderAdmin(email)) {
        await prisma.$transaction(async (tx) => {
          await tx.user.updateMany({ where: { email, role: { not: "super-admin" } }, data: { role: "super-admin" } });
          await tx.userRole.upsert({
            where: { userId_role: { userId: user.id, role: "super-admin" } },
            create: { userId: user.id, role: "super-admin" },
            update: {},
          });
          // Mirror the canonical role onto ba_user.role in the same tx so the admin plugin's
          // HTTP gate cannot drift from requireRole's canonical User.role view.
          await tx.betterAuthUser.updateMany({ where: { email }, data: { role: "super-admin" } });
          const membership = await tx.membership.upsert({
            where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
            create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
            update: {},
            select: { id: true },
          });
          await tx.membershipRole.upsert({
            where: { membershipId_role: { membershipId: membership.id, role: "owner" } },
            create: { membershipId: membership.id, role: "owner" },
            update: {},
          });
        });
      } else {
        // 3. Non-founder personal-org convergence (best-effort; requireOwner re-bootstraps on demand).
        try {
          const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
          await bootstrapPersonalOrg(user.id, email);
        } catch (e) {
          // #538 — every bootstrap failure is a retryable hiccup EXCEPT one: the operator's
          // revoke won the AllowedEmail row mid-provisioning and the tx was rolled back on
          // purpose. Swallowing that left the refusal traceless in the logs and let
          // convergence report success, degrading a security decision into a generic denial.
          // #575 log discipline: fixed category and constants only — an email address is user
          // content and never reaches a log line here.
          if (isProvisioningRefusal(e)) {
            console.error("[better-auth] converge: provisioning refused — address revoked during signup");
            throw e; // deliberate: see the never-throws carve-out above
          }
          console.warn("[better-auth] converge bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }
      // 4. Audit.
      await Promise.resolve(prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "auth.signin", payload: { email } } })).catch(() => {});
    } catch (e) {
      // The one deliberate exception to never-throws (#538): a provisioning refusal is a
      // security decision, not a convergence hiccup, and must not be downgraded here either.
      if (isProvisioningRefusal(e)) throw e;
      console.warn("[better-auth] convergeIdentity failed (non-fatal):", e instanceof Error ? e.message : e);
    }
  });
}
