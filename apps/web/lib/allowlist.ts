import "server-only";
import { prisma } from "@fikirtive/db";

function envList(s: string | undefined): string[] {
  return (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** env ∪ DB allowlist. Founder + env win FIRST (the DB can never lock the founder out).
 *  Then the DB invite allowlist (AllowedEmail), where a `revoked` row is denied. */
export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  if (envList(process.env.FOUNDER_ADMIN_EMAILS).includes(e)) return true;
  if (envList(process.env.AUTH_ALLOWED_EMAILS).includes(e)) return true;
  try {
    const row = await prisma.allowedEmail.findUnique({ where: { email: e }, select: { status: true } });
    return !!row && row.status !== "revoked";
  } catch {
    return false; // DB outage → fail closed (founder/env checks already passed above)
  }
}

/** Deny-by-default allowlist check (env ∪ DB) — thin alias of isAllowedEmail. Kept so the
 *  in-handler re-assertion sites (admin/layout, library, files, auth-guard) keep their
 *  `allowed(email)` call shape after NextAuth retirement moved this off auth.ts. Async:
 *  awaiting is REQUIRED — a bare `!allowed(email)` would always be falsy (a Promise). */
export async function allowed(email: string | null | undefined): Promise<boolean> {
  return isAllowedEmail(email);
}

/** Dedicated founder list (OPT-6 P1b) — distinct from AUTH_ALLOWED_EMAILS. Founders
 *  are seeded to super-admin on sign-in. next-auth-free so both auth stacks share it. */
export function isFounderAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
