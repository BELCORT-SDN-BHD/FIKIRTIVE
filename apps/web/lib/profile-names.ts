import "server-only";
/**
 * #542 — reading the signed-in merchant's own two names.
 *
 * Deliberately NOT a server action. Only server components need it (/profile renders the
 * initial field values, /otto reads the greeting name), so putting it in a server-action
 * module would publish a callable endpoint nothing calls — the same reason `data.ts` is a
 * plain `server-only` read module. The two WRITE paths, which the browser really does call,
 * live in `profile-actions.ts`.
 *
 * (Keep the server-action directive string out of this file's text entirely: the parity
 * scanner classifies a module by searching its source for that literal, comments included.)
 */
import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

export type ProfileNames = {
  /** The merchant's own display name. "" when never set — the caller decides the fallback. */
  displayName: string;
  /** The workspace/shop name. Pre-#543 accounts have the merchant's email address here. */
  workspaceName: string;
  email: string;
};

/** Read the signed-in merchant's own two names. Fail-closed: an unauthenticated or
 *  unresolvable session gets {error} and never another org's row.
 *
 *  The user row is reached through `Membership` rather than by email: `User` is an
 *  auth-identity table with no `ownerId` column, and scoping by the authenticated `ownerId`
 *  keeps the read inside the tenant the session actually resolved to (see profile-actions.ts
 *  for the same reasoning on the write side). */
export async function getMyProfileNames(): Promise<ProfileNames | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const [membership, organization] = await Promise.all([
    prisma.membership.findFirst({
      where: { orgId: ownerId, user: { email: gate.email } },
      select: { user: { select: { name: true } } },
    }),
    prisma.organization.findFirst({ where: { id: ownerId, deletedAt: null }, select: { name: true } }),
  ]);
  return {
    displayName: membership?.user.name?.trim() ?? "",
    workspaceName: organization?.name ?? "",
    email: gate.email,
  };
}
