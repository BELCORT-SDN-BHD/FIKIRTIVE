"use server";
import { prisma, grantCredits, InsufficientCredits } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID, INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/better-auth/server";
import { isFounderAdmin } from "@/lib/allowlist";
import { isImpersonating } from "@/lib/better-auth/compat";

const ORG_STATUS = new Set(["active", "suspended"]);
const FINANCE_DIRECT_CREDIT_LIMIT = 1_000;

async function activeMerchantOrg(orgId: string): Promise<{ id: string } | null> {
  if (!orgId || orgId === FOUNDER_OWNER_ID) return null;
  return prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true } });
}

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
  if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };
  // Mirror to the Better Auth layer so suspension is immediate + global: ban the members'
  // BA users (the installed admin plugin's session.create.before hook then blocks re-login)
  // and cut their live BA sessions. Reactivation lifts the ban. Membership.status stays the
  // authoritative per-tenant gate (requireOwner consumes it); this is defense-in-depth.
  const baUserIds = await orgMemberBaUserIds(orgId);
  // Atomic: flip Membership.status and mirror to the BA auth layer in one transaction, so a
  // BA-write failure rolls back the status flip (no diverged "suspended but not banned" state).
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.membership.updateMany({ where: { orgId, deletedAt: null }, data: { status } });
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
  if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };
  const baUserIds = await orgMemberBaUserIds(orgId);
  if (baUserIds.length === 0) return { ok: true, cut: 0 };
  const { count } = await prisma.betterAuthSession.deleteMany({ where: { userId: { in: baUserIds } } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.cut", payload: { orgId, cut: count, via: gate.email } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.cut", payload: { cut: count, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, cut: count };
}

/** Prisma's unique-constraint code. Narrow on the code, never on the message. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function normEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Admit an address to the closed door. Three outcomes, because "invite" is not always a
 *  write (#538 round 2):
 *    invited         — a missing or previously revoked row is now `invited`
 *    already_invited — the row was already `invited`; nothing written
 *    already_member  — the address already signed up (`active`); nothing written
 *  The last one is the point: self-signup writes status "active" (signup-gate.ts), and the
 *  old blanket upsert rewrote that to "invited", demoting a live merchant to pending. An
 *  address that is already in must never be downgraded by an operator re-typing it.
 *
 *  `already_member` names the AllowedEmail row being "active" — i.e. this address completed
 *  signup. It is NOT a Membership lookup; only revokeTenantInvite queries memberships. */
export async function inviteTenant(
  emailRaw: unknown,
): Promise<{ ok: true; result: "invited" | "already_invited" | "already_member" } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Enter a valid email." };
  const existing = await prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } });
  if (existing?.status === "active") return { ok: true, result: "already_member" };
  if (existing?.status === "invited") return { ok: true, result: "already_invited" };
  if (existing) {
    // Only a `revoked` row is left to re-invite. `status: { not: "active" }` keeps the
    // never-downgrade rule atomic: a signup landing between the read above and this write
    // flips the row to `active` and must win, so the update then matches nothing.
    const { count } = await prisma.allowedEmail.updateMany({ where: { email, status: { not: "active" } }, data: { status: "invited" } });
    if (count === 0) return { ok: true, result: "already_member" };
  } else {
    try {
      await prisma.allowedEmail.create({ data: { email, status: "invited", invitedBy: gate.email } });
    } catch (e) {
      // ONLY a unique-constraint collision means "someone created this row first". Any other
      // database failure is a real failure and must surface as one — swallowing it here would
      // report a comforting "already invited" for an invite that never happened.
      if (!isUniqueViolation(e)) throw e;
      const row = await prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } });
      return { ok: true, result: row?.status === "active" ? "already_member" : "already_invited" };
    }
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.invite", payload: { email, via: gate.email } } }).catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true, result: "invited" };
}

/** Revoke a PENDING invite. Two preconditions, checked together in one transaction (#538
 *  round 2): the row must still be `invited`, AND the address must not already belong to a
 *  live member of a merchant org.
 *
 *  The second one is not redundant. Self-signup does not touch an operator's existing row
 *  (signup-gate.ts uses skipDuplicates), so a merchant who signs up keeps a stale `invited`
 *  AllowedEmail row while becoming a real tenant owner. The admin list is rendered once and
 *  can go stale; without this check, clicking Revoke on that stale row would lock out a
 *  merchant who is already inside. */
export async function revokeTenantInvite(emailRaw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Invalid email." };
  const outcome = await prisma.$transaction(async (tx) => {
    // User.email is stored as typed (not normalized like AllowedEmail.email), so compare
    // case-insensitively — the same both-sides-lowercase rule orgMemberBaUserIds documents.
    const users = await tx.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
    if (users.length > 0) {
      const live = await tx.membership.findFirst({
        where: { userId: { in: users.map((u) => u.id) }, deletedAt: null, orgId: { not: FOUNDER_OWNER_ID } },
        select: { id: true },
      });
      if (live) return "member" as const;
    }
    const { count } = await tx.allowedEmail.updateMany({ where: { email, status: "invited" }, data: { status: "revoked" } });
    return count === 0 ? ("none" as const) : ("revoked" as const);
  });
  if (outcome === "member") return { error: "That address already belongs to an active merchant. Suspend their tenant instead." };
  if (outcome === "none") return { error: "No pending invite for that address." };
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
export async function impersonateTenant(orgId: string, reasonRaw?: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (!isFounderAdmin(gate.email)) return { error: "Only a founder may impersonate." };
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";
  if (reason.length < 8) return { error: "Enter an impersonation reason with at least 8 characters." };
  if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };
  const baUserId = await ownerBaUserId(orgId);
  if (!baUserId) return { error: "That tenant has no signed-in owner to impersonate yet." };
  try {
    await auth.api.impersonateUser({ body: { userId: baUserId }, headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.start", payload: { orgId, baUserId, reason, via: gate.email } } }).catch(() => {});
  return { ok: true };
}

/** End impersonation and restore the founder's own session. */
export async function stopImpersonatingTenant(): Promise<{ ok: true } | { error: string }> {
  // F15: while impersonating, the ACTIVE session IS the impersonated (viewer-role) user, so
  // gating on requireRole("tenants","mutate") of that session could lock staff OUT of stopping
  // impersonation. Gate on "is this session actually impersonating" instead — Better Auth's
  // stopImpersonating only reverts a session carrying impersonatedBy, which IS the authorization.
  if (!(await isImpersonating())) return { error: "Not impersonating anyone." };
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not stop impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.stop", payload: {} } }).catch(() => {});
  return { ok: true };
}

export async function grantTenantCredits(raw: unknown): Promise<{ ok: true; duplicate?: boolean } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate; // super-admin only (cross-tenant minting)
  const v = raw as { orgId?: unknown; displayedAmount?: unknown; reason?: unknown; idempotencyKey?: unknown };
  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org (founder top-up uses /admin/credits)." };
  const org = await activeMerchantOrg(orgId);
  if (!org) return { error: "Unknown or closed org." }; // NEVER fall back to founder
  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  if (!Number.isInteger(displayedAmount) || displayedAmount === 0 || Math.abs(displayedAmount) > 1_000_000) return { error: "Enter a non-zero whole number of credits (max ±1,000,000)." };
  if (Math.abs(displayedAmount) > FINANCE_DIRECT_CREDIT_LIMIT) return { error: "Credit actions over 1,000 displayed credits require founder approval." };
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
