import { describe, it, expect, vi, beforeEach } from "vitest";
const db = {
  user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  membership: { upsert: vi.fn() },
  actionEvent: { create: vi.fn() },
};
vi.mock("@fikirtive/db", () => ({ prisma: db }));
const mockBootstrap = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ bootstrapPersonalOrg: mockBootstrap }));

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f: any) => f.mockReset()));
  mockBootstrap.mockReset();
  process.env.FOUNDER_ADMIN_EMAILS = "founder@x.test";
});

describe("convergeIdentity", () => {
  it("creates the canonical user if absent and bootstraps a non-founder org + audit", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "usr_1", email: "merchant@x.test" });
    await convergeIdentity({ email: "merchant@x.test", name: "M" });
    expect(db.user.create).toHaveBeenCalled();
    expect(mockBootstrap).toHaveBeenCalledWith("usr_1", "merchant@x.test");
    expect(db.actionEvent.create).toHaveBeenCalled();
  });
  it("self-heals founder super-admin + seeds founder membership, no personal bootstrap", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test" });
    await convergeIdentity({ email: "founder@x.test" });
    expect(db.user.updateMany).toHaveBeenCalled();   // promote-only self-heal
    expect(db.membership.upsert).toHaveBeenCalled();  // founder membership seed
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
  it("never throws when a write fails", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockRejectedValue(new Error("db"));
    await expect(convergeIdentity({ email: "x@x.test" })).resolves.toBeUndefined();
  });
});
