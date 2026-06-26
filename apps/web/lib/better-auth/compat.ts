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

/** True when the current request runs under an admin impersonation session. Reads the RAW BA
 *  session (`auth()` above drops the session object). Used to block spend + show the banner. */
export async function isImpersonating(): Promise<boolean> {
  const session = await baAuth.api.getSession({ headers: await headers() });
  return !!(session?.session as any)?.impersonatedBy;
}
