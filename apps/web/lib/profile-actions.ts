"use server";
/**
 * #542 — the merchant's own two names, and the only place either can be changed.
 *
 * The defect (F-07, from #529/#530): `User.name` was never writable, so the Otto greeting
 * fell back to the email's local part ("Hi tools"), and `Organization.name` was the merchant's
 * full email address for every account created before #543 added the shop-name signup field.
 * /profile had no input at all, and none of Settings' six sections carried a name field — so a
 * merchant simply could not fix either one.
 *
 * IDENTITY COMES FROM THE SESSION, NEVER FROM AN ARGUMENT. Both writers take a single string.
 * There is no userId and no orgId on the wire to forge: `requireOwner()` (the fail-closed
 * session→ownerId resolver) supplies BOTH the tenant identity (`gate.ownerId`, which IS the
 * Organization's primary key) and the subject identity (`gate.email`, the authenticated
 * address). A caller can therefore only ever rename their own workspace and their own user
 * row, whatever they put on the wire.
 *
 * WHY THE USER ROW IS REACHED THROUGH MEMBERSHIP. `User` is an auth-identity table: it has no
 * `ownerId` column and is not in TENANT_MODELS, so `where: { email }` would be correct but
 * unprovable to the auth-guard fence, which models owner identity as `ownerId` only. Resolving
 * the row through `Membership` — scoped by the authenticated `ownerId` and narrowed to the
 * authenticated email — keeps the write inside the tenant the session actually resolved to,
 * and lets the machine prove it instead of adding a reviewed exemption.
 */
import { prisma } from "@fikirtive/db";
import { revalidatePath } from "next/cache";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";

/** Same cap the signup form's shop-name input already enforces (maxLength=80) and the same
 *  one renameProject uses for a campaign name. Longer input is trimmed to fit rather than
 *  refused, and the saved value is echoed back so the field never disagrees with the row.
 *  Not exported: a "use server" module may only export async functions, and this is the
 *  AUTHORITATIVE cap — the input's own maxLength is a convenience that this re-imposes. */
const MAX_NAME_LENGTH = 80;

export type ProfileNames = {
  /** The merchant's own display name. "" when never set — the caller decides the fallback. */
  displayName: string;
  /** The workspace/shop name. Pre-#543 accounts have the merchant's email address here. */
  workspaceName: string;
  email: string;
};

function clean(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

/** Read the signed-in merchant's own two names. Fail-closed: an unauthenticated or
 *  unresolvable session gets {error} and never another org's row. */
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

/** Rename YOURSELF. The row is resolved through the caller's own membership in the org that
 *  `requireOwner()` resolved, so this cannot reach another user's row by construction. */
export async function updateDisplayName(name: string): Promise<{ ok: true; name: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  // Same policy as setOwnerSetting: impersonation is for SEEING what a customer sees, not for
  // editing their identity on their behalf.
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to change their name." };
  const value = clean(name);
  if (!value) return { error: "Name required." };
  const { ownerId } = gate;
  const membership = await prisma.membership.findFirst({
    where: { orgId: ownerId, user: { email: gate.email } },
    select: { userId: true },
  });
  // Every merchant has this row: requireOwner() bootstraps Organization + Membership together
  // in one transaction, and convergeIdentity seeds the founder-admin's founder-org membership
  // on each verified sign-in. Missing it means the identity is not resolvable — fail closed.
  if (!membership) return { error: "Could not save your name. Try again." };
  try {
    await prisma.user.update({ where: { id: membership.userId }, data: { name: value } });
  } catch {
    return { error: "Could not save your name. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, name: value };
}

/** Rename YOUR WORKSPACE. `gate.ownerId` is the authenticated tenant id AND the Organization
 *  primary key, so the update targets exactly one row: the caller's own org. */
export async function updateWorkspaceName(name: string): Promise<{ ok: true; name: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to rename their workspace." };
  const value = clean(name);
  if (!value) return { error: "Workspace name required." };
  const { ownerId } = gate;
  // Owner-scoped lookup first (the renameProject shape): a soft-deleted org is not renameable,
  // and the update then runs against an id this session provably owns.
  const organization = await prisma.organization.findFirst({ where: { id: ownerId, deletedAt: null }, select: { id: true } });
  if (!organization) return { error: "Workspace not found." };
  try {
    await prisma.organization.update({ where: { id: organization.id }, data: { name: value } });
  } catch {
    return { error: "Could not save the workspace name. Try again." };
  }
  // Traceable, like every other owner-scoped change (best-effort — an audit write must never
  // turn a landed rename into a reported failure).
  await prisma.actionEvent
    .create({ data: { id: newId(), ownerId, projectId: null, type: "workspace.rename", payload: { name: value } } })
    .catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true, name: value };
}
