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
