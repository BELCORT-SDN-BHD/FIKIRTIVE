import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mock only auth() (the session). allowed()/isFounderAdmin() read env, set below.
// We inline allowed()/isFounderAdmin() in the factory because importOriginal can't
// load next-auth (it imports `next/server` without .js — fails in ESM/node outside
// Next.js bundler). The implementations are identical to auth.ts.
const mockAuth = vi.fn();
vi.mock("@/auth", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { auth: mockAuth, allowed, isFounderAdmin };
});

const FOUNDER_EMAIL = "founder@artlio.test";
const NEW_EMAIL = "merchant-a@artlio.test";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${FOUNDER_EMAIL},${NEW_EMAIL},offlist-but-allowed@artlio.test`;
  process.env.FOUNDER_ADMIN_EMAILS = FOUNDER_EMAIL;
});

afterEach(() => { mockAuth.mockReset(); });

// import AFTER the mock + env are in place
const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");

async function ensureUser(email: string): Promise<string> {
  const id = `usr_${randomUUID()}`;
  const u = await prisma.user.upsert({ where: { email }, update: {}, create: { id, email } });
  return u.id;
}

describe("requireOwner — fail-closed", () => {
  it("rejects an unauthenticated session", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await requireOwner();
    expect("error" in r).toBe(true);
  });

  it("rejects an off-allowlist email even if a session exists", async () => {
    mockAuth.mockResolvedValue({ user: { email: "stranger@evil.test" } });
    const r = await requireOwner();
    expect("error" in r).toBe(true);
  });

  it("resolves a founder-admin email to the founder org and ONLY the founder", async () => {
    await ensureUser(FOUNDER_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: FOUNDER_EMAIL } });
    const r = await requireOwner();
    expect(r).toEqual({ email: FOUNDER_EMAIL, ownerId: FOUNDER_OWNER_ID });
  });

  it("bootstraps a NEW personal org (never 'founder') for a non-founder allowlisted user", async () => {
    const userId = await ensureUser(NEW_EMAIL);
    await prisma.membership.deleteMany({ where: { userId } });
    mockAuth.mockResolvedValue({ user: { email: NEW_EMAIL } });

    const r = await requireOwner();
    expect("error" in r).toBe(false);
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).not.toBe(FOUNDER_OWNER_ID);
    expect(r.email).toBe(NEW_EMAIL);

    const org = await prisma.organization.findUnique({ where: { id: r.ownerId } });
    expect(org).not.toBeNull();
    const mem = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId: r.ownerId } } });
    expect(mem?.role).toBe("owner");
    const acct = await prisma.creditAccount.findUnique({ where: { orgId: r.ownerId } });
    expect(acct?.balance).toBe(1000 * 10); // BETA_INITIAL_GRANT_CREDITS
  });

  it("is idempotent — a second call returns the same org and does not re-grant", async () => {
    const userId = await ensureUser(NEW_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: NEW_EMAIL } });
    const first = await requireOwner();
    if ("error" in first) throw new Error(first.error);
    const second = await requireOwner();
    if ("error" in second) throw new Error(second.error);
    expect(second.ownerId).toBe(first.ownerId);
    const acct = await prisma.creditAccount.findUnique({ where: { orgId: first.ownerId } });
    expect(acct?.balance).toBe(1000 * 10);
    const grants = await prisma.creditLedger.count({ where: { orgId: first.ownerId, idempotencyKey: `signup:${first.ownerId}` } });
    expect(grants).toBe(1);
  });
});

describe("suspension / revocation gates (Fix A + Fix B)", () => {
  it("(Fix B) requireOwner returns { error } for a suspended member and does NOT create a second org", async () => {
    const suspEmail = `suspended-${randomUUID()}@artlio.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${suspEmail}`;
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");

    // Set up: create user + bootstrap org normally, then suspend the membership.
    const userId = (await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email: suspEmail } })).id;
    const orgId = await bootstrapPersonalOrg(userId, suspEmail);
    expect(orgId).not.toBeNull();
    await prisma.membership.update({
      where: { userId_orgId: { userId, orgId: orgId! } },
      data: { status: "suspended" },
    });

    // Act: requireOwner should deny.
    mockAuth.mockResolvedValue({ user: { email: suspEmail } });
    const r = await requireOwner();
    expect("error" in r).toBe(true);

    // Verify: only ONE org exists for this user (no second bootstrapped org was created).
    const orgCount = await prisma.membership.count({ where: { userId, deletedAt: null } });
    expect(orgCount).toBe(1);
  });

  it("(Fix B) active member returns { ownerId } equal to their org", async () => {
    const activeEmail = `active-${randomUUID()}@artlio.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${activeEmail}`;
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");

    const userId = (await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email: activeEmail } })).id;
    const orgId = await bootstrapPersonalOrg(userId, activeEmail);
    expect(orgId).not.toBeNull();

    mockAuth.mockResolvedValue({ user: { email: activeEmail } });
    const r = await requireOwner();
    expect("error" in r).toBe(false);
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).toBe(orgId);
  });

  it("(Fix A) bootstrapPersonalOrg does NOT flip status back to active on a suspended membership", async () => {
    const fixAEmail = `fix-a-${randomUUID()}@artlio.test`;
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");

    const userId = (await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email: fixAEmail } })).id;
    // First bootstrap: creates active membership.
    const orgId = await bootstrapPersonalOrg(userId, fixAEmail);
    expect(orgId).not.toBeNull();

    // Suspend the membership.
    await prisma.membership.update({
      where: { userId_orgId: { userId, orgId: orgId! } },
      data: { status: "suspended" },
    });

    // Second bootstrap call (simulates events.signIn running again on next login).
    await bootstrapPersonalOrg(userId, fixAEmail);

    // Assert: status is STILL suspended (Fix A: update no longer sets status: "active").
    const mem = await prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: orgId! } },
    });
    expect(mem?.status).toBe("suspended");
  });
});

describe("soft-deleted + suspended defense-in-depth (Fix 1)", () => {
  it("requireOwner returns {error} for a membership that is BOTH soft-deleted AND suspended", async () => {
    const email = `soft-susp-${randomUUID()}@artlio.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${email}`;
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");

    // Set up: bootstrap normally, then soft-delete AND suspend the membership.
    const userId = (await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email } })).id;
    const orgId = await bootstrapPersonalOrg(userId, email);
    expect(orgId).not.toBeNull();
    await prisma.membership.update({
      where: { userId_orgId: { userId, orgId: orgId! } },
      data: { status: "suspended", deletedAt: new Date() },
    });

    // Act: requireOwner must deny (not bootstrap a new org).
    mockAuth.mockResolvedValue({ user: { email } });
    const r = await requireOwner();
    expect("error" in r).toBe(true);

    // Verify: no second org was created; the original remains.
    const memberCount = await prisma.membership.count({ where: { userId } });
    expect(memberCount).toBe(1);
  });

  it("requireOwner revives a soft-deleted active membership (account reopening) and returns its ownerId", async () => {
    const email = `soft-active-${randomUUID()}@artlio.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${email}`;
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");

    const userId = (await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email } })).id;
    const orgId = await bootstrapPersonalOrg(userId, email);
    expect(orgId).not.toBeNull();
    // Soft-delete but keep status active (account closed, not suspended).
    await prisma.membership.update({
      where: { userId_orgId: { userId, orgId: orgId! } },
      data: { deletedAt: new Date() },
    });

    // Act: requireOwner should revive and return the same orgId.
    mockAuth.mockResolvedValue({ user: { email } });
    const r = await requireOwner();
    expect("error" in r).toBe(false);
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).toBe(orgId);

    // Verify: membership is no longer soft-deleted.
    const mem = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId: orgId! } } });
    expect(mem?.deletedAt).toBeNull();
  });
});

describe("events.signIn convergence", () => {
  it("bootstrapPersonalOrg called directly converges the same org requireOwner would build", async () => {
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
    const email = `merchant-b-${randomUUID()}@artlio.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${email}`;
    const u = await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email } });
    const orgId = await bootstrapPersonalOrg(u.id, email);
    expect(orgId).not.toBeNull();
    expect(orgId).not.toBe(FOUNDER_OWNER_ID);
    mockAuth.mockResolvedValue({ user: { email } });
    const r = await requireOwner();
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).toBe(orgId); // requireOwner reuses the converged org
  });
});
