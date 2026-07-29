import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test (no DB): the spend cap validation is the authoritative write-path guard for
// decision ① (issue #513 §C1) — the UI's Save button already blocks invalid input, but
// this is what actually protects the setting if that gate is ever bypassed.
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: { organization: { findUnique, update } },
}));

const { setOwnerSetting } = await import("@/lib/owner-settings-actions");

beforeEach(() => {
  mockRequireOwner.mockReset();
  mockIsImpersonating.mockReset();
  mockRevalidatePath.mockReset();
  findUnique.mockReset();
  update.mockReset();
  mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
  mockIsImpersonating.mockResolvedValue(false);
  findUnique.mockResolvedValue({ settings: null });
  update.mockResolvedValue({});
});

describe("setOwnerSetting — spendCapCredits validation (decision ①)", () => {
  it("rejects a negative spend cap without writing", async () => {
    const res = await setOwnerSetting("spendCapCredits", -5);
    expect(res).toEqual({ error: "Spend cap must be a whole number of credits, 0 or more." });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a fractional spend cap without writing", async () => {
    const res = await setOwnerSetting("spendCapCredits", 12.5);
    expect(res).toEqual({ error: "Spend cap must be a whole number of credits, 0 or more." });
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts 0 (removes the cap) and saves it", async () => {
    const res = await setOwnerSetting("spendCapCredits", 0);
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "orgA" },
      data: { settings: expect.objectContaining({ spendCapCredits: 0 }) },
    });
  });

  it("accepts a positive whole number and saves it", async () => {
    const res = await setOwnerSetting("spendCapCredits", 500);
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "orgA" },
      data: { settings: expect.objectContaining({ spendCapCredits: 500 }) },
    });
  });

  it("still fails closed while impersonating, before the numeric guard even runs", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const res = await setOwnerSetting("spendCapCredits", 100);
    expect(res).toEqual({ error: "Paused while impersonating a customer — exit impersonation to change their settings." });
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves other settings keys unaffected by the new numeric guard", async () => {
    const res = await setOwnerSetting("notifyEmail", false);
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalled();
  });
});
