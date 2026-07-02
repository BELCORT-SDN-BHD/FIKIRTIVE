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
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("@/lib/better-auth/server", () => ({
  auth: { api: { impersonateUser: vi.fn(), stopImpersonating: vi.fn() } },
}));

// Provide only the prisma methods called by tenant-actions; stray calls throw.
const membershipUpdateMany = vi.fn();
const membershipFindMany = vi.fn();
const userFindMany = vi.fn();
const baUserFindMany = vi.fn();
const baUserUpdateMany = vi.fn();
const baSessionDeleteMany = vi.fn();
const allowedEmailUpsert = vi.fn();
const allowedEmailUpdateMany = vi.fn();
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
    membership: { updateMany: membershipUpdateMany, findMany: membershipFindMany },
    user: { findMany: userFindMany },
    betterAuthUser: { findMany: baUserFindMany, updateMany: baUserUpdateMany },
    betterAuthSession: { deleteMany: baSessionDeleteMany },
    allowedEmail: { upsert: allowedEmailUpsert, updateMany: allowedEmailUpdateMany },
    actionEvent: { create: actionEventCreate },
    organization: { findFirst: organizationFindFirst },
    // run the callback against a tx wired to the same mocks, so existing setMembershipStatus assertions hold
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        membership: { updateMany: membershipUpdateMany },
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
const GATE = { email: "admin@artlio.com", role: "super_admin" };
const GATE_ERROR = { error: "You don't have access to this." };

beforeEach(() => {
  mockRequireRole.mockReset();
  membershipUpdateMany.mockReset();
  membershipFindMany.mockReset();
  userFindMany.mockReset();
  baUserFindMany.mockReset();
  baUserUpdateMany.mockReset();
  baSessionDeleteMany.mockReset();
  allowedEmailUpsert.mockReset();
  allowedEmailUpdateMany.mockReset();
  actionEventCreate.mockReset();
  organizationFindFirst.mockReset();
  mockGrantCredits.mockReset();
  // audit writes are best-effort; default to a resolved promise so .catch(() => {}) works
  actionEventCreate.mockResolvedValue({});
  (isFounderAdmin as Mock).mockReset();
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
      expect.objectContaining({ where: { orgId: "orgX" }, data: { status: "suspended" } })
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
    expect(allowedEmailUpsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed email string", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await inviteTenant("not-an-email");
    expect(res).toEqual({ error: "Enter a valid email." });
    expect(allowedEmailUpsert).not.toHaveBeenCalled();
  });

  it("lowercases and trims the email before upserting", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpsert.mockResolvedValue({});
    const res = await inviteTenant("  USER@Example.COM  ");
    expect(res).toEqual({ ok: true });
    expect(allowedEmailUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "user@example.com" },
        create: expect.objectContaining({ email: "user@example.com", status: "invited", invitedBy: GATE.email }),
        update: { status: "invited" },
      })
    );
  });

  it("upserts a valid email and returns ok", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpsert.mockResolvedValue({});
    const res = await inviteTenant("beta@test.com");
    expect(res).toEqual({ ok: true });
    expect(allowedEmailUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "beta@test.com" } })
    );
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

  it("returns error when count is 0 (no such invite)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 0 });
    const res = await revokeTenantInvite("missing@example.com");
    expect(res).toEqual({ error: "No such invite." });
  });

  it("sets status to revoked and returns ok", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    const res = await revokeTenantInvite("beta@test.com");
    expect(res).toEqual({ ok: true });
    expect(allowedEmailUpdateMany).toHaveBeenCalledWith({
      where: { email: "beta@test.com" },
      data: { status: "revoked" },
    });
  });

  it("lowercases the email before matching", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    allowedEmailUpdateMany.mockResolvedValue({ count: 1 });
    await revokeTenantInvite("BETA@TEST.COM");
    expect(allowedEmailUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "beta@test.com" } })
    );
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

  it("returns an error when the org has no resolvable BA owner", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    membershipFindMany.mockResolvedValue([]); // no owner
    const res = await impersonateTenant("orgX");
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
    const res = await impersonateTenant("orgX");
    expect(res).toEqual({ ok: true });
    expect(authApi.impersonateUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: "ba_owner" } })
    );
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "impersonate.start" }) })
    );
  });
});

// ── stopImpersonatingTenant ─────────────────────────────────────────────────

describe("stopImpersonatingTenant", () => {
  it("calls stopImpersonating when the session IS impersonating (F15 — not gated on the viewer's role)", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    authApi.stopImpersonating.mockResolvedValue({ ok: true });
    const res = await stopImpersonatingTenant();
    expect(res).toEqual({ ok: true });
    expect(authApi.stopImpersonating).toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "impersonate.stop" }) })
    );
  });

  it("returns an error and does not call stopImpersonating when NOT impersonating (F15)", async () => {
    mockIsImpersonating.mockResolvedValue(false);
    const res = await stopImpersonatingTenant();
    expect(res).toHaveProperty("error");
    expect(authApi.stopImpersonating).not.toHaveBeenCalled();
  });
});
