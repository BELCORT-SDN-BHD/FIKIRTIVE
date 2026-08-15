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
  /** The workspace/shop name, or "" when the merchant has never set one. See
   *  {@link workspaceNameOrUnset} for why an address stored here reads as unset. */
  workspaceName: string;
  email: string;
};

/** #680 — a workspace whose stored name IS the account's own email address has no shop name;
 *  it has the placeholder bootstrapPersonalOrg used to write for merchants who came in through
 *  a magic link or an invite (no signup form, so no shop name was ever asked for). Reading it
 *  as "" is what lets /profile show its "Set your shop name" placeholder instead of presenting
 *  an address as the answer to "Your shop name — shown across Fikirtive."
 *
 *  The comparison is EXACT (case-insensitively) against this account's own address, not a
 *  general "looks like an email" test: a merchant who deliberately names their shop after some
 *  other address keeps that name. bootstrapPersonalOrg no longer writes this value, so the
 *  check exists for rows created before that fix — it reads them honestly without rewriting
 *  anybody's data. */
export function workspaceNameOrUnset(storedName: string | null | undefined, email: string): string {
  const stored = storedName ?? "";
  return stored.trim().toLowerCase() === email.trim().toLowerCase() ? "" : stored;
}

/** Read just the merchant's own display name, given an ALREADY-RESOLVED gate (no auth
 *  check here — the caller did that). The user row is reached through `Membership` rather
 *  than by email: `User` is an auth-identity table with no `ownerId` column, and scoping by
 *  the authenticated `ownerId` keeps the read inside the tenant the session actually
 *  resolved to (see profile-actions.ts for the same reasoning on the write side).
 *
 *  #592 — factored out of {@link getMyProfileNames} so the sidebar identity read
 *  (account-actions.ts) can pull the display name from this exact query too, instead of
 *  growing a second copy that could drift from what #574 already established as the
 *  merchant's display name. */
export async function readDisplayName(ownerId: string, email: string): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { orgId: ownerId, user: { email } },
    select: { user: { select: { name: true } } },
  });
  return membership?.user.name?.trim() ?? "";
}

/** Read the signed-in merchant's own two names. Fail-closed: an unauthenticated or
 *  unresolvable session gets {error} and never another org's row. */
export async function getMyProfileNames(): Promise<ProfileNames | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const [displayName, organization] = await Promise.all([
    readDisplayName(ownerId, gate.email),
    prisma.organization.findFirst({ where: { id: ownerId, deletedAt: null }, select: { name: true } }),
  ]);
  return {
    displayName,
    workspaceName: workspaceNameOrUnset(organization?.name, gate.email),
    email: gate.email,
  };
}
