import "server-only";
import { auth, allowed } from "@/auth";
import { prisma } from "@artlio/db";
import { newId, FOUNDER_OWNER_ID, roleAllows, isRole, type Section, type Action, type Role } from "@artlio/core";

/** In-handler auth (R7): re-assert auth()+allowlist INSIDE every action, not just
 *  at the opt-in proxy wall. Returns the email or an {error} the caller returns
 *  verbatim. Spend actions (operator-RBAC does NOT gate spend) stay on THIS. */
export async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !allowed(email)) return { error: "Not authorized." };
  return { email };
}

/** OPT-6 P1b operator-RBAC gate. Two walls: (1) the env allowlist (outer — never
 *  reads role; a default-viewer who is off the allowlist is out of the app), then
 *  (2) the section→role matrix (roleAllows). Denies by default; a denied attempt is
 *  audited (best-effort). Returns {email, role} on success. NOT used on spend
 *  actions — those keep requireSession (RBAC is operator-only). */
export async function requireRole(
  section: Section,
  action: Action,
): Promise<{ email: string; role: Role } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !allowed(email)) return { error: "Not authorized." };
  const role: Role = isRole(session.user?.role) ? session.user.role : "viewer";
  if (!roleAllows(role, section, action)) {
    // denied-attempt audit (best-effort — never let the audit write change the deny)
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "rbac.deny", payload: { email, role, section, action } },
    }).catch(() => {});
    return { error: "You don't have access to this." };
  }
  return { email, role };
}
