import "server-only";
import { prisma } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { isFounderAdmin } from "@/lib/allowlist";

/** Convergence on BA sign-in. Mirrors auth.ts events.signIn but keyed off email
 *  (the canonical join key). Idempotent, best-effort, NEVER throws — requireOwner()
 *  remains the authoritative fail-closed resolver. */
export async function convergeIdentity(input: { email: string; name?: string | null; image?: string | null; emailVerified?: boolean }): Promise<void> {
  if (!input.emailVerified) return; // never converge (esp. founder super-admin promote) on an unverified identity
  const email = input.email.toLowerCase();
  try {
    // 1. Ensure the canonical User row exists (BA identities reconnect to the tenant graph by email).
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: input.name ?? null, image: input.image ?? null },
        select: { id: true },
      });
    }
    // 2. Founder super-admin self-heal (promote-only, idempotent).
    if (isFounderAdmin(email)) {
      await Promise.resolve(prisma.user.updateMany({ where: { email, role: { not: "super-admin" } }, data: { role: "super-admin" } })).catch(() => {});
      // Mirror the canonical role onto ba_user.role so the admin plugin's hasPermission
      // recognizes the founder (it reads the raw ba_user.role, not roleForEmail).
      await Promise.resolve(prisma.betterAuthUser.updateMany({ where: { email }, data: { role: "super-admin" } })).catch(() => {});
      await Promise.resolve(prisma.membership.upsert({
        where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
        create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
        update: {},
      })).catch(() => {});
    } else {
      // 3. Non-founder personal-org convergence (best-effort; requireOwner re-bootstraps on demand).
      try {
        const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
        await bootstrapPersonalOrg(user.id, email);
      } catch (e) {
        console.warn("[better-auth] converge bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
    // 4. Audit.
    await Promise.resolve(prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "auth.signin", payload: { email } } })).catch(() => {});
  } catch (e) {
    console.warn("[better-auth] convergeIdentity failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}
