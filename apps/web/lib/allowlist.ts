import "server-only";
import { prisma } from "@fikirtive/db";

function envList(s: string | undefined): string[] {
  return (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** env ∪ DB allowlist. Only the FOUNDER list wins ahead of the database (the break-glass key:
 *  one row must not be able to lock the deployer out of his own product). Everyone else is
 *  answered by `AllowedEmail`, where a `revoked` row is denied.
 *
 *  SIGNIN-A7 —— `AUTH_ALLOWED_EMAILS` used to return true here BEFORE the database was consulted,
 *  so revoking an address named in that variable took its `AllowedEmail` row away and left its
 *  access untouched: this is the per-request re-assertion every gated action runs
 *  (`requireSession` / `requireRole` / `requireOwner` in auth-guard.ts), so the revoked merchant
 *  kept working until the cookie itself expired. The env list now only ADDS an address to the
 *  allowlist; it never overrides a revocation. Same correction, same reason, as the door's own
 *  three-step decision (`lib/signup-gate.ts`). */
export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  if (envList(process.env.FOUNDER_ADMIN_EMAILS).includes(e)) return true;
  const namedByEnv = envList(process.env.AUTH_ALLOWED_EMAILS).includes(e);
  try {
    const row = await prisma.allowedEmail.findUnique({ where: { email: e }, select: { status: true } });
    if (row?.status === "revoked") return false;
    return namedByEnv || !!row;
  } catch {
    return false; // DB outage → fail closed (founder check already passed above)
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
