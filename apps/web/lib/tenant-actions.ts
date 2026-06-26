"use server";
import { prisma, grantCredits, InsufficientCredits } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID, INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/better-auth/server";
import { isFounderAdmin } from "@/lib/allowlist";

const ORG_STATUS = new Set(["active", "suspended"]);

/** Resolve an org's active members to their Better Auth user ids.
 *  Membership.userId → User.email → BetterAuthUser.id (the two user tables join by email;
 *  BetterAuthSession/ban operate on BetterAuthUser.id, a different id space from User.id). */
async function orgMemberBaUserIds(orgId: string): Promise<string[]> {
  const members = await prisma.membership.findMany({ where: { orgId, deletedAt: null }, select: { userId: true } });
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
  // both sides must be lowercase: BetterAuthUser.email is normalized at signup, so we lowercase User.email to match the `in` filter (case-sensitive in Postgres).
  const emails = users.map((u) => u.email.toLowerCase());
  if (emails.length === 0) return [];
  const baUsers = await prisma.betterAuthUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
  return baUsers.map((u) => u.id);
}

export async function setMembershipStatus(orgId: string, status: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  if (!ORG_STATUS.has(status)) return { error: "Invalid status." };
  // Mirror to the Better Auth layer so suspension is immediate + global: ban the members'
  // BA users (the installed admin plugin's session.create.before hook then blocks re-login)
  // and cut their live BA sessions. Reactivation lifts the ban. Membership.status stays the
  // authoritative per-tenant gate (requireOwner consumes it); this is defense-in-depth.
  const baUserIds = await orgMemberBaUserIds(orgId);
  // Atomic: flip Membership.status and mirror to the BA auth layer in one transaction, so a
  // BA-write failure rolls back the status flip (no diverged "suspended but not banned" state).
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.membership.updateMany({ where: { orgId }, data: { status } });
    if (count === 0) return 0;
    if (baUserIds.length > 0) {
      if (status === "suspended") {
        await tx.betterAuthUser.updateMany({ where: { id: { in: baUserIds } }, data: { banned: true, banReason: `suspended by ${gate.email}` } });
        await tx.betterAuthSession.deleteMany({ where: { userId: { in: baUserIds } } });
      } else {
        await tx.betterAuthUser.updateMany({ where: { id: { in: baUserIds } }, data: { banned: false, banReason: null, banExpires: null } });
      }
    }
    return count;
  });
  if (updated === 0) return { error: "No memberships for that org." };
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.status", payload: { orgId, status, via: gate.email } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.status", payload: { status, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`); revalidatePath("/admin/tenants");
  return { ok: true };
}

export async function cutTenantSessions(orgId: string): Promise<{ ok: true; cut: number } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const baUserIds = await orgMemberBaUserIds(orgId);
  if (baUserIds.length === 0) return { ok: true, cut: 0 };
  const { count } = await prisma.betterAuthSession.deleteMany({ where: { userId: { in: baUserIds } } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.cut", payload: { orgId, cut: count, via: gate.email } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.cut", payload: { cut: count, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, cut: count };
}

function normEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
}

export async function inviteTenant(emailRaw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Enter a valid email." };
  await prisma.allowedEmail.upsert({ where: { email }, create: { email, status: "invited", invitedBy: gate.email }, update: { status: "invited" } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.invite", payload: { email, via: gate.email } } }).catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true };
}

export async function revokeTenantInvite(emailRaw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Invalid email." };
  const { count } = await prisma.allowedEmail.updateMany({ where: { email }, data: { status: "revoked" } });
  if (count === 0) return { error: "No such invite." };
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.revoke", payload: { email, via: gate.email } } }).catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true };
}

/** Resolve an org's first owner to their Better Auth user id (email join, same id-space rule as
 *  orgMemberBaUserIds). Returns null if there is no resolvable BA owner. */
async function ownerBaUserId(orgId: string): Promise<string | null> {
  const owners = await prisma.membership.findMany({ where: { orgId, role: "owner", deletedAt: null }, select: { userId: true }, take: 1 });
  if (owners.length === 0) return null;
  const users = await prisma.user.findMany({ where: { id: { in: owners.map((m) => m.userId) } }, select: { email: true } });
  if (users.length === 0 || !users[0]?.email) return null;
  const baUsers = await prisma.betterAuthUser.findMany({ where: { email: { in: [users[0].email.toLowerCase()] } }, select: { id: true } });
  return baUsers[0]?.id ?? null;
}

/** Founder-only: become the org owner to debug what they see. Spend is blocked while
 *  impersonating (the 8 web entry-point guards). Audited. */
export async function impersonateTenant(orgId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (!isFounderAdmin(gate.email)) return { error: "Only a founder may impersonate." };
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const baUserId = await ownerBaUserId(orgId);
  if (!baUserId) return { error: "That tenant has no signed-in owner to impersonate yet." };
  try {
    await auth.api.impersonateUser({ body: { userId: baUserId }, headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.start", payload: { orgId, baUserId, via: gate.email } } }).catch(() => {});
  return { ok: true };
}

/** End impersonation and restore the founder's own session. */
export async function stopImpersonatingTenant(): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (!isFounderAdmin(gate.email)) return { error: "Only a founder may do this." };
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not stop impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.stop", payload: { via: gate.email } } }).catch(() => {});
  return { ok: true };
}

export async function grantTenantCredits(raw: unknown): Promise<{ ok: true; duplicate?: boolean } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate; // super-admin only (cross-tenant minting)
  const v = raw as { orgId?: unknown; displayedAmount?: unknown; reason?: unknown; idempotencyKey?: unknown };
  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org (founder top-up uses /admin/credits)." };
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true } });
  if (!org) return { error: "Unknown or closed org." }; // NEVER fall back to founder
  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  if (!Number.isInteger(displayedAmount) || displayedAmount === 0 || Math.abs(displayedAmount) > 1_000_000) return { error: "Enter a non-zero whole number of credits (max ±1,000,000)." };
  const reason = typeof v?.reason === "string" ? v.reason.slice(0, 500) : "";
  const idempotencyKey = typeof v?.idempotencyKey === "string" ? v.idempotencyKey : "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) return { error: "Invalid request." };
  const amount = displayedAmount * INTERNAL_PER_DISPLAY;
  let res: Awaited<ReturnType<typeof grantCredits>>;
  try {
    res = await grantCredits({ orgId, amount, reason, source: "ADMIN", createdBy: gate.email, idempotencyKey });
  } catch (e) {
    if (e instanceof InsufficientCredits) return { error: "That adjustment would drive the balance negative (or the account doesn't exist)." };
    throw e;
  }
  const dup = "duplicate" in res;
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.grant", payload: { orgId, displayedAmount, amount, reason, via: gate.email, duplicate: dup } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "credits.grant", payload: { displayedAmount, amount, reason, via: gate.email, duplicate: dup } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, duplicate: dup };
}
