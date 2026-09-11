import "server-only";
import { prisma } from "@fikirtive/db";

function envList(s: string | undefined): string[] {
  return (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** env ∪ DB allowlist. Both env lists only ADD an address; NEITHER overrides a revocation —
 *  `AllowedEmail` has the last word on every address there is.
 *
 *  SIGNIN-A7 —— `AUTH_ALLOWED_EMAILS`, and then `FOUNDER_ADMIN_EMAILS`, used to return true here
 *  BEFORE the database was consulted, so revoking an address named in either variable took its
 *  `AllowedEmail` row away and left its access untouched: this is the per-request re-assertion
 *  every gated action runs (`requireSession` / `requireRole` / `requireOwner` in auth-guard.ts),
 *  so the revoked merchant kept working until the cookie itself expired. The founder list was the
 *  last one standing, and it fell for the same reason: a rule with an exception the size of an
 *  environment variable is not the rule 规格 §1.6 wrote down («撤销仍然绝对»).
 *
 *  The break-glass survives, on the WRITE side: `revokeEmailAccess` (lib/signup-gate.ts) refuses
 *  to revoke an address still named in `FOUNDER_ADMIN_EMAILS`, so no row can lock the deployer
 *  out of his own product in the first place, and the way back does not go through the database.
 *  Same correction, same reason, as the door's own decision (`lib/signup-gate.ts`). */
export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  const namedByEnv =
    envList(process.env.FOUNDER_ADMIN_EMAILS).includes(e) || envList(process.env.AUTH_ALLOWED_EMAILS).includes(e);
  try {
    const row = await prisma.allowedEmail.findUnique({ where: { email: e }, select: { status: true } });
    if (row?.status === "revoked") return false;
    return namedByEnv || !!row;
  } catch {
    return false; // DB outage → fail closed, founder included
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
