/**
 * SIGNIN-A7 —— 操作员那一侧的撤销入口（`app/admin/access-actions.ts`）。
 *
 * 行为本身（名单那一行翻面 ＋ 会话在同一笔事务里消失 ＋ 两扇门随后都拒）在真库上由
 * `lib/__tests__/signin-pause-and-revoke.test.ts` 证明。这个文件只钉 server action 该负责的
 * 三件事，而且刻意不重复那边：**没有权限的人撤不了**、入参收成一个小写地址、审计写不下去也
 * 不许把一次真的撤销报成失败。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));

const revokeEmailAccess = vi.fn();
vi.mock("@/lib/signup-gate", () => ({ revokeEmailAccess }));

const actionEventCreate = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { actionEvent: { create: actionEventCreate } } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { revokeMerchantAccess } = await import("../access-actions");

const OPERATOR = { email: "operator@fikirtive.test", roles: ["admin"], role: "admin" };

beforeEach(() => {
  requireRole.mockReset();
  revokeEmailAccess.mockReset();
  actionEventCreate.mockReset();
  requireRole.mockResolvedValue(OPERATOR);
  revokeEmailAccess.mockResolvedValue("revoked");
  actionEventCreate.mockResolvedValue({});
});

describe("revokeMerchantAccess", () => {
  it("SIGNIN-A7 —— 有权限的操作员撤一个自助进来的地址：动作照做，并留下一行审计", async () => {
    expect(await revokeMerchantAccess("Merchant@Example.com")).toEqual({ ok: true, result: "revoked" });
    // 归一化在动作这一层就做完 —— 下游那个函数只收小写地址。
    expect(revokeEmailAccess).toHaveBeenCalledWith("merchant@example.com");
    expect(actionEventCreate).toHaveBeenCalledTimes(1);
    const row = actionEventCreate.mock.calls[0]?.[0] as { data: { type: string; payload: Record<string, unknown> } };
    expect(row.data.type).toBe("tenant.revoke");
    expect(row.data.payload).toMatchObject({ email: "merchant@example.com", via: OPERATOR.email });
  });

  it("refuses a caller without the tenants capability, and touches nothing", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });
    expect(await revokeMerchantAccess("merchant@example.com")).toEqual({ error: "You don't have access to this." });
    expect(revokeEmailAccess).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("refuses anything that is not an address, before reaching the database", async () => {
    for (const bad of ["", "   ", "not-an-email", 42, null, undefined]) {
      expect(await revokeMerchantAccess(bad)).toEqual({ error: "Invalid email." });
    }
    expect(revokeEmailAccess).not.toHaveBeenCalled();
  });

  /** 「没有可撤的东西」和「撤掉了」必须是两个答案 —— 不然操作员打错一个字母也会看到成功。 */
  it("says so when the address has no access to take away", async () => {
    revokeEmailAccess.mockResolvedValue("unknown");
    expect(await revokeMerchantAccess("ghost@example.com")).toEqual({ error: "That address has no access to revoke." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("still reports success when only the audit write fails", async () => {
    actionEventCreate.mockRejectedValue(new Error("audit table down"));
    expect(await revokeMerchantAccess("merchant@example.com")).toEqual({ ok: true, result: "revoked" });
  });
});
