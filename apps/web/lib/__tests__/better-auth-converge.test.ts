import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const db = {
  user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  userRole: { upsert: vi.fn() },
  membership: { upsert: vi.fn() },
  membershipRole: { upsert: vi.fn() },
  betterAuthUser: { updateMany: vi.fn() },
  actionEvent: { createMany: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@fikirtive/db", () => ({ prisma: db }));
const mockBootstrap = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ bootstrapPersonalOrg: mockBootstrap }));

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f) => (f as Mock).mockReset?.()));
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: {
    user: { updateMany: Mock };
    userRole: { upsert: Mock };
    betterAuthUser: { updateMany: Mock };
    membership: { upsert: Mock };
    membershipRole: { upsert: Mock };
  }) => Promise<unknown>) =>
    fn({
      user: { updateMany: db.user.updateMany },
      userRole: { upsert: db.userRole.upsert },
      betterAuthUser: { updateMany: db.betterAuthUser.updateMany },
      membership: { upsert: db.membership.upsert },
      membershipRole: { upsert: db.membershipRole.upsert },
    })
  );
  db.membership.upsert.mockResolvedValue({ id: "membership-founder" });
  mockBootstrap.mockReset();
  process.env.FOUNDER_ADMIN_EMAILS = "founder@x.test";
});

describe("convergeIdentity", () => {
  it("creates the canonical user if absent and bootstraps a non-founder org + audit", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "usr_1", email: "merchant@x.test", emailVerified: new Date(), role: "viewer" });
    await convergeIdentity({ email: "merchant@x.test", name: "M", emailVerified: true, sessionId: "ba_sess_1" });
    // #544 — the canonical create stamps emailVerified (DateTime, next-auth convention).
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailVerified: expect.any(Date) }) }),
    );
    expect(mockBootstrap).toHaveBeenCalledWith("usr_1", "merchant@x.test");
    // #737 — the audit write is idempotent like every other step. The key is the SESSION, i.e.
    // the sign-in event itself, plus skipDuplicates: a replay of the same login collides instead
    // of appending, and a second real login (a different session) is never folded into the first.
    expect(db.actionEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [expect.objectContaining({ id: "signin:ba_sess_1", type: "auth.signin" })],
      }),
    );
    expect(db.userRole.upsert).not.toHaveBeenCalled();
  });

  // Registration is not a sign-in: the user-create hook and afterEmailVerification converge with
  // no session, and the only shape that reaches them with none to follow is self-service signup
  // still held at requireEmailVerification.
  it("writes NO sign-in audit when convergence carries no session", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "usr_nosess", email: "registered@x.test", emailVerified: new Date(), role: "viewer" });

    await convergeIdentity({ email: "registered@x.test", name: "R", emailVerified: true });

    expect(db.actionEvent.createMany).not.toHaveBeenCalled();
    // The identity still converged — this drops the audit row, not the account.
    expect(mockBootstrap).toHaveBeenCalledWith("usr_nosess", "registered@x.test");
  });

  it("does not recreate an assignment from the legacy compatibility role", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({
      id: "usr_legacy",
      email: "legacy@x.test",
      emailVerified: new Date(),
      role: "ops",
    });

    await convergeIdentity({ email: "legacy@x.test", emailVerified: true });

    expect(db.userRole.upsert).not.toHaveBeenCalled();
  });

  it("#544 — stamps emailVerified on an existing canonical row that is still null (set-once via emailVerified:null filter)", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_2", email: "merchant2@x.test", emailVerified: null, role: "viewer" });
    await convergeIdentity({ email: "merchant2@x.test", emailVerified: true });
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "merchant2@x.test", emailVerified: null }, data: { emailVerified: expect.any(Date) } }),
    );
  });

  it("#544 — does NOT re-stamp an already-verified canonical row", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_3", email: "merchant3@x.test", emailVerified: new Date("2026-01-01T00:00:00Z"), role: "viewer" });
    await convergeIdentity({ email: "merchant3@x.test", emailVerified: true });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("self-heals founder super-admin + seeds founder membership, no personal bootstrap", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test", emailVerified: new Date(), role: "super-admin" });
    await convergeIdentity({ email: "founder@x.test", emailVerified: true });
    expect(db.user.updateMany).toHaveBeenCalled();   // promote-only self-heal
    expect(db.membership.upsert).toHaveBeenCalled();  // founder membership seed
    expect(db.userRole.upsert).toHaveBeenCalledWith({
      where: { userId_role: { userId: "usr_f", role: "super-admin" } },
      create: { userId: "usr_f", role: "super-admin" },
      update: {},
    });
    expect(mockBootstrap).not.toHaveBeenCalled();
    expect(db.betterAuthUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "founder@x.test" }, data: { role: "super-admin" } })
    );
  });
  it("does not write ba_user.role when the canonical User.role write fails", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    // Founder is already verified, so the #544 emailVerified stamp is skipped and the ONLY
    // user.updateMany reaching the rejecting mock is the in-tx role write this test targets.
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test", emailVerified: new Date(), role: "super-admin" });
    db.user.updateMany.mockRejectedValue(new Error("canonical role write failed"));

    await expect(convergeIdentity({ email: "founder@x.test", emailVerified: true })).resolves.toBeUndefined();

    expect(db.$transaction).toHaveBeenCalled();
    expect(db.betterAuthUser.updateMany).not.toHaveBeenCalled();
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });
  it("never throws when a write fails", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockRejectedValue(new Error("db"));
    await expect(convergeIdentity({ email: "x@x.test", emailVerified: true })).resolves.toBeUndefined();
  });
  it("performs NO writes when the identity is unverified (early-return gate)", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    await convergeIdentity({ email: "unverified@x.test", emailVerified: false });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.membership.upsert).not.toHaveBeenCalled();
    expect(db.actionEvent.createMany).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
  // #538 round 4 (P2) — a provisioning refusal used to be swallowed here as a "non-fatal"
  // bootstrap hiccup: convergence reported success and the refusal left no server-side trace.
  // It must now propagate, and be logged as a fixed category with NO user content (#575).
  it("propagates a provisioning refusal instead of degrading it to a non-fatal warning", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    const refusal = new Error("provisioning refused: address revoked during signup");
    refusal.name = "RevokedDuringProvisioning";
    mockBootstrap.mockRejectedValue(refusal);
    db.user.findUnique.mockResolvedValue({ id: "usr_rev", email: "revoked@x.test", emailVerified: new Date(), role: "viewer" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(convergeIdentity({ email: "revoked@x.test", emailVerified: true })).rejects.toThrow(/revoked/i);

      expect(errorSpy).toHaveBeenCalledWith(
        "[better-auth] converge: provisioning refused — address revoked during signup",
      );
      // Not downgraded to the generic non-fatal warning.
      expect(warnSpy).not.toHaveBeenCalled();
      // #575 log discipline: the address must never appear in any log argument.
      const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String).join(" ");
      expect(logged).not.toContain("revoked@x.test");
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("still treats an ordinary bootstrap failure as non-fatal", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    mockBootstrap.mockRejectedValue(new Error("connection reset"));
    db.user.findUnique.mockResolvedValue({ id: "usr_ok", email: "blip@x.test", emailVerified: new Date(), role: "viewer" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(convergeIdentity({ email: "blip@x.test", emailVerified: true })).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("performs NO writes when emailVerified is omitted (undefined ⇒ falsy)", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    await convergeIdentity({ email: "missing-flag@x.test" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.actionEvent.createMany).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
});
