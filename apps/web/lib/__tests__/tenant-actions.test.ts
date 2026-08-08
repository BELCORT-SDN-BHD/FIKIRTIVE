import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { FOUNDER_OWNER_ID, INTERNAL_PER_DISPLAY } from "@fikirtive/core";

// Unit test (no DB): mock requireRole + prisma + next/cache so invariants —
// gate-first fail-closed, founder exclusion, status validation, email normalization,
// session-cut scoped to org member userIds only — are pinned deterministically.

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole: mockRequireRole }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({}) }));

vi.mock("@/lib/allowlist", () => ({ isFounderAdmin: vi.fn() }));
const mockCurrentImpersonation = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ currentImpersonation: mockCurrentImpersonation }));
vi.mock("@/lib/better-auth/server", () => ({
  auth: { api: { impersonateUser: vi.fn(), stopImpersonating: vi.fn() } },
}));

// Provide only the prisma methods called by tenant-actions; stray calls throw.
const membershipUpdateMany = vi.fn();
const membershipFindMany = vi.fn();
const userFindMany = vi.fn();
const baUserFindMany = vi.fn();
const baUserFindUnique = vi.fn();
const baUserUpdateMany = vi.fn();
const baSessionDeleteMany = vi.fn();
const allowedEmailUpsert = vi.fn();
const allowedEmailUpdateMany = vi.fn();
const allowedEmailFindUnique = vi.fn();
const allowedEmailCreate = vi.fn();
const membershipFindFirst = vi.fn();
const actionEventCreate = vi.fn();
const organizationFindFirst = vi.fn();

const mockGrantCredits = vi.fn();
class MockInsufficientCredits extends Error {
  constructor(message = "Not enough credits.") {
    super(message);
    this.name = "InsufficientCredits";
  }
}

vi.mock("@fikirtive/db", () => ({
  prisma: {
    membership: { updateMany: membershipUpdateMany, findMany: membershipFindMany, findFirst: membershipFindFirst },
    user: { findMany: userFindMany },
    betterAuthUser: { findMany: baUserFindMany, findUnique: baUserFindUnique, updateMany: baUserUpdateMany },
    betterAuthSession: { deleteMany: baSessionDeleteMany },
    allowedEmail: {
      upsert: allowedEmailUpsert,
      updateMany: allowedEmailUpdateMany,
      findUnique: allowedEmailFindUnique,
      create: allowedEmailCreate,
    },
    actionEvent: { create: actionEventCreate },
    organization: { findFirst: organizationFindFirst },
    // run the callback against a tx wired to the same mocks, so existing setMembershipStatus assertions hold
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        membership: { updateMany: membershipUpdateMany, findFirst: membershipFindFirst },
        user: { findMany: userFindMany },
        allowedEmail: { updateMany: allowedEmailUpdateMany },
        betterAuthUser: { updateMany: baUserUpdateMany },
        betterAuthSession: { deleteMany: baSessionDeleteMany },
      }),
  },
  grantCredits: mockGrantCredits,
  InsufficientCredits: MockInsufficientCredits,
}));

const { isFounderAdmin } = await import("@/lib/allowlist");
const { auth } = await import("@/lib/better-auth/server");
const authApi = auth.api as unknown as { impersonateUser: Mock; stopImpersonating: Mock };

const { setMembershipStatus, cutTenantSessions, inviteTenant, revokeTenantInvite, grantTenantCredits, impersonateTenant, stopImpersonatingTenant } =
  await import("@/lib/tenant-actions");

// A resolved gate value returned by requireRole on success.
const GATE = { email: "admin@fikirtive.com", role: "super_admin" };
const GATE_ERROR = { error: "You don't have access to this." };

beforeEach(() => {
  mockRequireRole.mockReset();
  membershipUpdateMany.mockReset();
  membershipFindMany.mockReset();
  userFindMany.mockReset();
  baUserFindMany.mockReset();
  baUserFindUnique.mockReset();
  baUserUpdateMany.mockReset();
  baSessionDeleteMany.mockReset();
  allowedEmailUpsert.mockReset();
  allowedEmailUpdateMany.mockReset();
  allowedEmailFindUnique.mockReset();
  allowedEmailCreate.mockReset();
  membershipFindFirst.mockReset();
  actionEventCreate.mockReset();
  organizationFindFirst.mockReset();
  mockGrantCredits.mockReset();
  // audit writes are best-effort; default to a resolved promise so .catch(() => {}) works
  actionEventCreate.mockResolvedValue({});
  // Default: the address is nobody's login yet and owns nothing — the plain "still pending"
  // world. Tests that exercise the activation race override these.
  allowedEmailFindUnique.mockResolvedValue(null);
  baUserFindUnique.mockResolvedValue(null);
  allowedEmailCreate.mockResolvedValue({});
  userFindMany.mockResolvedValue([]);
  membershipFindFirst.mockResolvedValue(null);
  organizationFindFirst.mockResolvedValue({ id: "orgX" });
  (isFounderAdmin as Mock).mockReset();
  mockCurrentImpersonation.mockReset();
  authApi.impersonateUser.mockReset();
  authApi.stopImpersonating.mockReset();
});

// ── setMembershipStatus ─────────────────────────────────────────────────────

describe("setMembershipStatus", () => {
  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual(GATE_ERROR);
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects the FOUNDER_OWNER_ID org", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await setMembershipStatus(FOUNDER_OWNER_ID, "suspended");
    expect(res).toEqual({ error: "Invalid org." });
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid status", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await setMembershipStatus("orgX", "deleted");
    expect(res).toEqual({ error: "Invalid status." });
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown or soft-deleted org before changing memberships", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue(null);

    const res = await setMembershipStatus("orgX", "suspended");

    expect(res).toEqual({ error: "Unknown or closed org." });
    expect(organizationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "orgX", deletedAt: null } })
    );
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("returns error when no memberships matched", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 0 });
    membershipFindMany.mockResolvedValue([]);
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ error: "No memberships for that org." });
  });

  it("updates memberships and returns ok for valid org + status", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 2 });
    membershipFindMany.mockResolvedValue([]);
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ ok: true });
    expect(membershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "orgX", deletedAt: null }, data: { status: "suspended" } })
    );
  });

  it("accepts 'active' as a valid status", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([]);
    const res = await setMembershipStatus("orgX", "active");
    expect(res).toEqual({ ok: true });
  });

  it("on suspend: bans the org's BA users and cuts their BA sessions", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([{ userId: "user_0" }]);
    userFindMany.mockResolvedValue([{ email: "u0@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_0" }]);
    baSessionDeleteMany.mockResolvedValue({ count: 2 });
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["ba_0"] } }, data: expect.objectContaining({ banned: true, banReason: `suspended by ${GATE.email}` }) })
    );
    expect(baSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: { in: ["ba_0"] } } });
  });

  it("on reactivate: lifts the ban and does NOT cut sessions", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([{ userId: "user_0" }]);
    userFindMany.mockResolvedValue([{ email: "u0@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_0" }]);
    const res = await setMembershipStatus("orgX", "active");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["ba_0"] } }, data: expect.objectContaining({ banned: false, banReason: null, banExpires: null }) })
    );
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("skips the auth-layer writes when the org has no BA users", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([]);
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).not.toHaveBeenCalled();
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });
});

// ── cutTenantSessions ───────────────────────────────────────────────────────

describe("cutTenantSessions", () => {
  // helper: wire the 3-hop member→email→ba-user resolution
  function wireMembers(baUserIds: string[]) {
    membershipFindMany.mockResolvedValue(baUserIds.map((_, i) => ({ userId: `user_${i}` })));
    userFindMany.mockResolvedValue(baUserIds.map((_, i) => ({ email: `u${i}@t.test` })));
    baUserFindMany.mockResolvedValue(baUserIds.map((id) => ({ id })));
  }

  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual(GATE_ERROR);
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("rejects the FOUNDER_OWNER_ID org", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await cutTenantSessions(FOUNDER_OWNER_ID);
    expect(res).toEqual({ error: "Invalid org." });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("returns { ok: true, cut: 0 } when the org has no members", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipFindMany.mockResolvedValue([]);
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual({ ok: true, cut: 0 });
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown or soft-deleted org before resolving members", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue(null);

    const res = await cutTenantSessions("orgX");

    expect(res).toEqual({ error: "Unknown or closed org." });
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("returns { ok: true, cut: 0 } when members exist but none have BA accounts", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipFindMany.mockResolvedValue([{ userId: "user_1" }]);
    userFindMany.mockResolvedValue([{ email: "u0@t.test" }]);
    baUserFindMany.mockResolvedValue([]);
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual({ ok: true, cut: 0 });
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes BetterAuthSession rows scoped to the org's BA user ids", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    wireMembers(["ba_1", "ba_2"]);
    baSessionDeleteMany.mockResolvedValue({ count: 3 });
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual({ ok: true, cut: 3 });
    expect(baSessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["ba_1", "ba_2"] } },
    });
  });

  it("does NOT touch the legacy Session table (cutover bug fix)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    wireMembers(["ba_1"]);
    baSessionDeleteMany.mockResolvedValue({ count: 1 });
    await cutTenantSessions("orgX");
    // legacy prisma.session is no longer in the mock; if cut still referenced it the call would throw.
    expect(baSessionDeleteMany).toHaveBeenCalledTimes(1);
  });
});

// ── inviteTenant ────────────────────────────────────────────────────────────

describe("inviteTenant", () => {
  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await inviteTenant("new@example.com");
    expect(res).toEqual(GATE_ERROR);
    expect(allowedEmailUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-string email", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await inviteTenant(42);
    expect(res).toEqual({ error: "Enter a valid email." });
    expect(allowedEmailCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed email string", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await inviteTenant("not-an-email");
    expect(res).toEqual({ error: "Enter a valid email." });
    expect(allowedEmailCreate).not.toHaveBeenCalled();
  });

  it("lowercases and trims the email before writing", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await inviteTenant("  USER@Example.COM  ");
    expect(res).toEqual({ ok: true, result: "invited" });
    expect(allowedEmailCreate).toHaveBeenCalledWith({
      data: { email: "user@example.com", status: "invited", invitedBy: GATE.email },
    });
  });

  it("creates a row for an unknown email and returns result 'invited'", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await inviteTenant("beta@test.com");
    expect(res).toEqual({ ok: true, result: "invited" });
    expect(allowedEmailCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "beta@test.com", status: "invited" }) })
    );
  });

  // #538 round 2 (P2) — the old blanket upsert rewrote ANY row to "invited". Self-signup
  // writes status "active", so re-inviting a merchant who is already inside demoted them
  // back to pending. Re-inviting must now be a no-op that says so.
  it("never downgrades an already-active address, and writes nothing", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailFindUnique.mockResolvedValue({ status: "active" });
    const res = await inviteTenant("live@merchant.com");
    expect(res).toEqual({ ok: true, result: "already_member" });
    expect(allowedEmailCreate).not.toHaveBeenCalled();
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
    expect(allowedEmailUpsert).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("reports an already-pending address without rewriting it", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailFindUnique.mockResolvedValue({ status: "invited" });
    const res = await inviteTenant("pending@merchant.com");
    expect(res).toEqual({ ok: true, result: "already_invited" });
    expect(allowedEmailCreate).not.toHaveBeenCalled();
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("re-invites a revoked address under a not-active precondition", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailFindUnique.mockResolvedValue({ status: "revoked" });
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    const res = await inviteTenant("back@merchant.com");
    expect(res).toEqual({ ok: true, result: "invited" });
    // The precondition rides in the WHERE, so a signup racing this write wins.
    expect(allowedEmailUpdateMany).toHaveBeenCalledWith({
      where: { email: "back@merchant.com", status: { not: "active" } },
      data: { status: "invited" },
    });
  });

  it("yields to a signup that activates the row mid-flight (update matches nothing)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailFindUnique.mockResolvedValue({ status: "revoked" });
    allowedEmailUpdateMany.mockResolvedValue({ count: 0 });
    const res = await inviteTenant("racing@merchant.com");
    expect(res).toEqual({ ok: true, result: "already_member" });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("does not overwrite a row created concurrently after the read said 'missing'", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "active" });
    allowedEmailCreate.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await inviteTenant("collide@merchant.com");
    expect(res).toEqual({ ok: true, result: "already_member" });
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
  });

  // #538 round 3 (P2) — the catch used to swallow EVERY error and report "already invited".
  // A dead connection would have been reported to the operator as a successful-ish no-op.
  it("re-throws a non-P2002 database error instead of faking 'already invited'", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const boom = Object.assign(new Error("connection terminated"), { code: "P1001" });
    allowedEmailCreate.mockRejectedValue(boom);
    await expect(inviteTenant("broken@merchant.com")).rejects.toThrow("connection terminated");
  });

  it("re-throws an error carrying no Prisma code at all", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailCreate.mockRejectedValue(new Error("something else entirely"));
    await expect(inviteTenant("weird@merchant.com")).rejects.toThrow("something else entirely");
  });
});

// ── revokeTenantInvite ──────────────────────────────────────────────────────

describe("revokeTenantInvite", () => {
  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await revokeTenantInvite("someone@example.com");
    expect(res).toEqual(GATE_ERROR);
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await revokeTenantInvite("bad");
    expect(res).toEqual({ error: "Invalid email." });
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
  });

  it("returns error when no PENDING row matched", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 0 });
    const res = await revokeTenantInvite("missing@example.com");
    expect(res).toEqual({ error: "No pending invite for that address." });
  });

  it("sets status to revoked and returns ok", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    const res = await revokeTenantInvite("beta@test.com");
    expect(res).toEqual({ ok: true });
    // "still invited" rides in the WHERE — a row already flipped to active/revoked is
    // never rewritten by a stale admin click.
    expect(allowedEmailUpdateMany).toHaveBeenCalledWith({
      where: { email: "beta@test.com", status: "invited" },
      data: { status: "revoked" },
    });
  });

  it("lowercases the email before matching", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    await revokeTenantInvite("BETA@TEST.COM");
    expect(allowedEmailUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: "beta@test.com" }) })
    );
  });

  // #538 — the membership veto. Since round 3, provisioning flips the AllowedEmail row to
  // `active` as it creates the membership, so a merchant who signs up NO LONGER leaves a
  // stale `invited` row behind and the `status: "invited"` predicate alone would already
  // refuse. This veto remains as defence in depth for rows written BEFORE that protocol
  // landed, which are still stuck at `invited` while their owner is already inside.
  it("refuses to revoke an address that already owns a live membership", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindMany.mockResolvedValue([{ id: "user-1" }]);
    membershipFindFirst.mockResolvedValue({ id: "mem-1" });
    const res = await revokeTenantInvite("justsignedup@merchant.com");
    expect(res).toEqual({
      error: "That address already belongs to a merchant workspace. Manage their access from that tenant instead.",
    });
    expect(allowedEmailUpdateMany).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("matches the login address case-insensitively and ignores the founder org", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindMany.mockResolvedValue([{ id: "user-1" }]);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    await revokeTenantInvite("Mixed@Case.com");
    // User.email is stored as typed, so the lookup must not be case-sensitive.
    expect(userFindMany).toHaveBeenCalledWith({
      where: { email: { equals: "mixed@case.com", mode: "insensitive" } },
      select: { id: true },
    });
    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { userId: { in: ["user-1"] }, deletedAt: null, orgId: { not: FOUNDER_OWNER_ID } },
      select: { id: true },
    });
  });

  it("still revokes when the address has a user row but no live membership", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindMany.mockResolvedValue([{ id: "user-1" }]);
    membershipFindFirst.mockResolvedValue(null);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    const res = await revokeTenantInvite("nomembership@merchant.com");
    expect(res).toEqual({ ok: true });
  });
});

// ── grantTenantCredits ──────────────────────────────────────────────────────

describe("grantTenantCredits", () => {
  const VALID_PAYLOAD = {
    orgId: "org_merchant",
    displayedAmount: 100,
    reason: "Beta bonus",
    idempotencyKey: "key-abc-12345678",
  };

  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual(GATE_ERROR);
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects orgId === FOUNDER_OWNER_ID", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, orgId: FOUNDER_OWNER_ID });
    expect(res).toEqual({ error: "Pick a merchant org (founder top-up uses /admin/credits)." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(organizationFindFirst).not.toHaveBeenCalled();
  });

  it("rejects empty orgId", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, orgId: "" });
    expect(res).toEqual({ error: "Pick a merchant org (founder top-up uses /admin/credits)." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects when org not found (findFirst returns null)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue(null);
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual({ error: "Unknown or closed org." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects when org is soft-deleted (findFirst returns null for deletedAt filter)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    // Simulates org with deletedAt set — the WHERE { deletedAt: null } excludes it
    organizationFindFirst.mockResolvedValue(null);
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual({ error: "Unknown or closed org." });
    expect(organizationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VALID_PAYLOAD.orgId, deletedAt: null } })
    );
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects non-integer displayedAmount", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, displayedAmount: 1.5 });
    expect(res).toEqual({ error: "Enter a non-zero whole number of credits (max ±1,000,000)." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects displayedAmount === 0", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, displayedAmount: 0 });
    expect(res).toEqual({ error: "Enter a non-zero whole number of credits (max ±1,000,000)." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects displayedAmount over 1_000_000", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, displayedAmount: 1_000_001 });
    expect(res).toEqual({ error: "Enter a non-zero whole number of credits (max ±1,000,000)." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("rejects direct tenant credit actions over 1,000 displayed credits", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, displayedAmount: 1001 });
    expect(res).toEqual({ error: "Credit actions are capped at 1,000 displayed credits each." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("converts displayedAmount to internal credits (×INTERNAL_PER_DISPLAY)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    await grantTenantCredits(VALID_PAYLOAD);
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: VALID_PAYLOAD.orgId,
        amount: VALID_PAYLOAD.displayedAmount * INTERNAL_PER_DISPLAY,
      })
    );
  });

  it("passes source=ADMIN and createdBy=gate.email to grantCredits", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    await grantTenantCredits(VALID_PAYLOAD);
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ADMIN", createdBy: GATE.email })
    );
  });

  it("returns { ok: true, duplicate: false } on a fresh grant", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual({ ok: true, duplicate: false });
  });

  it("returns { ok: true, duplicate: true } on an idempotency replay", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ duplicate: true });
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual({ ok: true, duplicate: true });
  });

  it("writes BOTH audit events: ownerId=FOUNDER_OWNER_ID (tenant.credits.grant) + ownerId=orgId (credits.grant)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    await grantTenantCredits(VALID_PAYLOAD);
    expect(actionEventCreate).toHaveBeenCalledTimes(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = actionEventCreate.mock.calls.map((c: any[]) => (c[0] as { data: { ownerId: string; type: string } }).data);
    const founderEvent = calls.find((d) => d.ownerId === FOUNDER_OWNER_ID);
    const orgEvent = calls.find((d) => d.ownerId === VALID_PAYLOAD.orgId);
    expect(founderEvent).toBeDefined();
    expect(founderEvent!.type).toBe("tenant.credits.grant");
    expect(orgEvent).toBeDefined();
    expect(orgEvent!.type).toBe("credits.grant");
  });

  it("returns InsufficientCredits error as a friendly message without rethrowing", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockRejectedValue(new MockInsufficientCredits());
    const res = await grantTenantCredits(VALID_PAYLOAD);
    expect(res).toEqual({ error: "That adjustment would drive the balance negative (or the account doesn't exist)." });
  });

  it("rethrows unexpected errors from grantCredits", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockRejectedValue(new Error("DB connection lost"));
    await expect(grantTenantCredits(VALID_PAYLOAD)).rejects.toThrow("DB connection lost");
  });

  it("rejects idempotencyKey shorter than 8 chars", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, idempotencyKey: "short" });
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("accepts negative displayedAmount (adjustment)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    organizationFindFirst.mockResolvedValue({ id: "org_merchant" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    const res = await grantTenantCredits({ ...VALID_PAYLOAD, displayedAmount: -50 });
    expect(res).toEqual({ ok: true, duplicate: false });
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -50 * INTERNAL_PER_DISPLAY })
    );
  });
});

// ── impersonateTenant ───────────────────────────────────────────────────────

describe("impersonateTenant", () => {
  it("denies a non-founder even if the role gate passes", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(false);
    const res = await impersonateTenant("orgX");
    expect(res).toHaveProperty("error");
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
  });

  it("rejects the founder's own org without calling the BA api", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    const res = await impersonateTenant(FOUNDER_OWNER_ID);
    expect(res).toHaveProperty("error");
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
  });

  it("rejects an empty reason before resolving the BA owner", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    const res = await impersonateTenant("orgX", "   ");
    expect(res).toEqual({ error: "Enter an impersonation reason with at least 8 characters." });
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("rejects a too-short reason before resolving the BA owner", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    const res = await impersonateTenant("orgX", "short");
    expect(res).toEqual({ error: "Enter an impersonation reason with at least 8 characters." });
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown or soft-deleted org before resolving the BA owner", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    organizationFindFirst.mockResolvedValue(null);

    const res = await impersonateTenant("orgX", "Debug checkout issue");

    expect(res).toEqual({ error: "Unknown or closed org." });
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
  });

  it("returns an error when the org has no resolvable BA owner", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    membershipFindMany.mockResolvedValue([]); // no owner
    const res = await impersonateTenant("orgX", "Debug checkout issue");
    expect(res).toHaveProperty("error");
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
  });

  it("founder impersonates the org owner's BA user", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    membershipFindMany.mockResolvedValue([{ userId: "user_1" }]);
    userFindMany.mockResolvedValue([{ email: "owner@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_owner" }]);
    authApi.impersonateUser.mockResolvedValue({ ok: true });
    const reason = "Debug checkout issue";
    const res = await impersonateTenant("orgX", reason);
    expect(res).toEqual({ ok: true });
    expect(authApi.impersonateUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: "ba_owner" } })
    );
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "impersonate.start",
          payload: expect.objectContaining({ reason }),
        }),
      })
    );
  });
});

// ── stopImpersonatingTenant ─────────────────────────────────────────────────

describe("stopImpersonatingTenant", () => {
  it("calls stopImpersonating when the session IS impersonating (F15 — not gated on the viewer's role)", async () => {
    mockCurrentImpersonation.mockResolvedValue({ operatorBaUserId: "ba_founder", subjectBaUserId: "ba_owner" });
    authApi.stopImpersonating.mockResolvedValue({ ok: true });
    const res = await stopImpersonatingTenant();
    expect(res).toEqual({ ok: true });
    expect(authApi.stopImpersonating).toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "impersonate.stop" }) })
    );
  });

  // #756 — the row used to carry `payload: {}`. Not "recorded the wrong person": recorded
  // NOBODY, so the one question the audit exists to answer had no answer here.
  it("records WHO ended the impersonation, and whom it was of", async () => {
    mockCurrentImpersonation.mockResolvedValue({ operatorBaUserId: "ba_founder", subjectBaUserId: "ba_owner" });
    baUserFindUnique.mockResolvedValue({ email: "founder@fikirtive.com" });
    authApi.stopImpersonating.mockResolvedValue({ ok: true });

    await stopImpersonatingTenant();

    // `via` is the same actor key impersonate.start and every gated admin write use, so the
    // audit page names the operator here exactly as it does there.
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "impersonate.stop",
          payload: { via: "founder@fikirtive.com", operatorBaUserId: "ba_founder", baUserId: "ba_owner" },
        }),
      })
    );
    // The address is resolved server-side FROM THE SESSION's operator id. Nothing here is
    // taken from the caller — this action accepts no arguments at all.
    expect(baUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ba_founder" } })
    );
  });

  it("reads the operator BEFORE the revert wipes it from the session", async () => {
    const order: string[] = [];
    mockCurrentImpersonation.mockImplementation(async () => {
      order.push("read");
      return { operatorBaUserId: "ba_founder", subjectBaUserId: "ba_owner" };
    });
    authApi.stopImpersonating.mockImplementation(async () => {
      order.push("revert");
      return { ok: true };
    });
    baUserFindUnique.mockResolvedValue({ email: "founder@fikirtive.com" });

    await stopImpersonatingTenant();

    expect(order).toEqual(["read", "revert"]);
  });

  it("names nobody rather than guessing when the operator's address cannot be resolved", async () => {
    mockCurrentImpersonation.mockResolvedValue({ operatorBaUserId: "ba_gone", subjectBaUserId: "ba_owner" });
    baUserFindUnique.mockResolvedValue(null);
    authApi.stopImpersonating.mockResolvedValue({ ok: true });

    await stopImpersonatingTenant();

    // Unattributed in the identity column (#755), but the id that DID it is still on the row —
    // no plausible-looking name is invented to fill the gap.
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { via: null, operatorBaUserId: "ba_gone", baUserId: "ba_owner" },
        }),
      })
    );
  });

  it("returns an error and does not call stopImpersonating when NOT impersonating (F15)", async () => {
    mockCurrentImpersonation.mockResolvedValue(null);
    const res = await stopImpersonatingTenant();
    expect(res).toHaveProperty("error");
    expect(authApi.stopImpersonating).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });
});
