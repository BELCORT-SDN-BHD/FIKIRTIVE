import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test (no DB): mock requireRole + prisma + next/cache so the saveUserRole
// invariants are pinned — gate-first, self-escalation guard, and ba_user.role mirror.

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole: mockRequireRole }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const betterAuthUserUpdateMany = vi.fn();
const actionEventCreate = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: userUpdate },
        betterAuthUser: { updateMany: betterAuthUserUpdateMany },
        actionEvent: { create: actionEventCreate },
      }),
  },
}));

const { saveUserRole } = await import("@/lib/admin-actions");

const GATE = { email: "founder@fikirtive.com", role: "super-admin" };
const GATE_ERROR = { error: "You don't have access to this." };

beforeEach(() => {
  mockRequireRole.mockReset();
  userFindUnique.mockReset();
  userUpdate.mockReset();
  betterAuthUserUpdateMany.mockReset();
  actionEventCreate.mockReset();
});

describe("saveUserRole", () => {
  it("rejects when the gate fails", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const result = await saveUserRole({ userId: "usr_1", role: "ops" });
    expect(result).toEqual(GATE_ERROR);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects when userId is missing", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const result = await saveUserRole({ role: "ops" });
    expect(result).toEqual({ error: "Missing user." });
  });

  it("rejects when role is unknown", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const result = await saveUserRole({ userId: "usr_1", role: "god" });
    expect(result).toEqual({ error: "Unknown role." });
  });

  it("rejects self-escalation (actor changing their own role)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindUnique.mockResolvedValue({ id: "usr_f", email: "founder@fikirtive.com", role: "super-admin" });
    const result = await saveUserRole({ userId: "usr_f", role: "ops" });
    expect(result).toEqual({ error: "You can't change your own role." });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the target user is not found", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindUnique.mockResolvedValue(null);
    const result = await saveUserRole({ userId: "usr_missing", role: "ops" });
    expect(result).toEqual({ error: "User not found." });
  });

  it("updates User.role and mirrors onto ba_user.role (by email, lowercased)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindUnique.mockResolvedValue({ id: "usr_2", email: "Operator@x.test", role: "member" });
    const result = await saveUserRole({ userId: "usr_2", role: "ops" });
    expect(result).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "usr_2" }, data: { role: "ops" } });
    expect(betterAuthUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "operator@x.test" }, data: { role: "ops" } })
    );
    expect(actionEventCreate).toHaveBeenCalled();
  });

  it("does NOT call betterAuthUser.updateMany when target has no email", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    userFindUnique.mockResolvedValue({ id: "usr_3", email: null, role: "member" });
    const result = await saveUserRole({ userId: "usr_3", role: "ops" });
    expect(result).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalled();
    expect(betterAuthUserUpdateMany).not.toHaveBeenCalled();
  });
});
