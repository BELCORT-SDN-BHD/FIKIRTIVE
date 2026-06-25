import "server-only";
import { prisma } from "@fikirtive/db";
import { isRole, type Role } from "@fikirtive/core";

/** Canonical role for an email (the BA session enrichment seam). Mirrors auth.ts's
 *  session callback: missing/garbage/no-email/DB-error → "viewer", never throws. */
export async function roleForEmail(email: string | null | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    const row = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { role: true } });
    return isRole(row?.role) ? row.role : "viewer";
  } catch {
    return "viewer";
  }
}
