import "server-only";
import { headers } from "next/headers";
import type { Role } from "@fikirtive/core";
import { auth as baAuth } from "./server";
import { roleForEmail } from "./session-role";

type NextAuthShapedSession = { user: { email: string | null; name: string | null; image: string | null; role: Role } } | null;

/** Cutover drop-in for the NextAuth `auth()` consumed by auth-guard.ts. Returns the
 *  exact session.user shape (email/name/image/role, role defaulting to "viewer"). DORMANT. */
export async function auth(): Promise<NextAuthShapedSession> {
  const session = await baAuth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const email = session.user.email ?? null;
  return {
    user: {
      email,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
      role: await roleForEmail(email),
    },
  };
}

/** WHO is running the current impersonation, and AS WHOM. Null when this request is not an
 *  impersonation at all. Reads the RAW BA session (`auth()` above drops the session object).
 *
 *  #756 — the yes/no answer below could not be written into an audit row, so the one event that
 *  had to name the operator (`impersonate.stop`) recorded `payload: {}` — not the wrong person,
 *  NOBODY. Both ids come from the session Better Auth itself maintains: `impersonatedBy` is
 *  stamped server-side when impersonation starts and `userId` is the session's own subject, so
 *  neither is anything a client can supply. Both are BetterAuthUser ids (a different id space
 *  from `User.id` — the two tables join by email). */
export type ImpersonationPrincipals = { operatorBaUserId: string; subjectBaUserId: string | null };

export async function currentImpersonation(): Promise<ImpersonationPrincipals | null> {
  const session = await baAuth.api.getSession({ headers: await headers() });
  const raw = session?.session as { impersonatedBy?: string | null; userId?: string | null } | undefined;
  const operatorBaUserId = raw?.impersonatedBy;
  if (!operatorBaUserId) return null;
  return { operatorBaUserId, subjectBaUserId: raw?.userId ?? null };
}

/** True when the current request runs under an admin impersonation session.
 *  Used to block spend + show the banner. */
export async function isImpersonating(): Promise<boolean> {
  return (await currentImpersonation()) !== null;
}
