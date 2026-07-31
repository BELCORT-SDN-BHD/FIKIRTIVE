import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const db = {
  user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  membership: { upsert: vi.fn() },
  betterAuthUser: { updateMany: vi.fn() },
  actionEvent: { create: vi.fn() },
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
    betterAuthUser: { updateMany: Mock };
    membership: { upsert: Mock };
  }) => Promise<unknown>) =>
    fn({
      user: { updateMany: db.user.updateMany },
      betterAuthUser: { updateMany: db.betterAuthUser.updateMany },
      membership: { upsert: db.membership.upsert },
    })
  );
  mockBootstrap.mockReset();
  process.env.FOUNDER_ADMIN_EMAILS = "founder@x.test";
});

describe("convergeIdentity", () => {
  it("creates the canonical user if absent and bootstraps a non-founder org + audit", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "usr_1", email: "merchant@x.test", emailVerified: new Date() });
    await convergeIdentity({ email: "merchant@x.test", name: "M", emailVerified: true });
    // #544 — the canonical create stamps emailVerified (DateTime, next-auth convention).
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailVerified: expect.any(Date) }) }),
    );
    expect(mockBootstrap).toHaveBeenCalledWith("usr_1", "merchant@x.test");
    expect(db.actionEvent.create).toHaveBeenCalled();
  });

  it("#544 — stamps emailVerified on an existing canonical row that is still null (set-once via emailVerified:null filter)", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_2", email: "merchant2@x.test", emailVerified: null });
    await convergeIdentity({ email: "merchant2@x.test", emailVerified: true });
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "merchant2@x.test", emailVerified: null }, data: { emailVerified: expect.any(Date) } }),
    );
  });

  it("#544 — does NOT re-stamp an already-verified canonical row", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_3", email: "merchant3@x.test", emailVerified: new Date("2026-01-01T00:00:00Z") });
    await convergeIdentity({ email: "merchant3@x.test", emailVerified: true });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("self-heals founder super-admin + seeds founder membership, no personal bootstrap", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test", emailVerified: new Date() });
    await convergeIdentity({ email: "founder@x.test", emailVerified: true });
    expect(db.user.updateMany).toHaveBeenCalled();   // promote-only self-heal
    expect(db.membership.upsert).toHaveBeenCalled();  // founder membership seed
    expect(mockBootstrap).not.toHaveBeenCalled();
    expect(db.betterAuthUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "founder@x.test" }, data: { role: "super-admin" } })
    );
  });
  it("does not write ba_user.role when the canonical User.role write fails", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    // Founder is already verified, so the #544 emailVerified stamp is skipped and the ONLY
    // user.updateMany reaching the rejecting mock is the in-tx role write this test targets.
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test", emailVerified: new Date() });
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
    expect(db.actionEvent.create).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
  it("performs NO writes when emailVerified is omitted (undefined ⇒ falsy)", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    await convergeIdentity({ email: "missing-flag@x.test" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.actionEvent.create).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
});
