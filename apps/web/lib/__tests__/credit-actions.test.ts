import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOUNDER_OWNER_ID, INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole: mockRequireRole }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const actionEventCreate = vi.fn();
const mockGrantCredits = vi.fn();

class MockInsufficientCredits extends Error {
  constructor(message = "Not enough credits.") {
    super(message);
    this.name = "InsufficientCredits";
  }
}

/** MONEY-A14:30 天累计闸的拒绝(判定在账本层,这里只验动作层怎么翻译它)。 */
class MockFinanceAdjustBlocked extends Error {
  reason = "rolling-window" as const;
  orgId = "org_merchant_1";
  usedInternal = 26_000;
  limitInternal = 20_000;
}

const activeMerchantOrg = vi.fn();
vi.mock("@/lib/tenant-admin", () => ({ activeMerchantOrg }));

const founderAlert = vi.fn();
vi.mock("@/lib/founder-alert", () => ({ founderAlert }));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    actionEvent: { create: actionEventCreate },
  },
  grantCredits: mockGrantCredits,
  InsufficientCredits: MockInsufficientCredits,
  FinanceAdjustBlocked: MockFinanceAdjustBlocked,
}));

const { grantCreditsAction } = await import("@/lib/credit-actions");

const FINANCE_GATE = { email: "finance@fikirtive.com", role: "finance" };
const SUPER_GATE = { email: "founder@fikirtive.com", role: "super-admin" };
const GATE_ERROR = { error: "You don't have access to this." };

beforeEach(() => {
  mockRequireRole.mockReset();
  revalidatePath.mockReset();
  actionEventCreate.mockReset();
  actionEventCreate.mockResolvedValue({});
  mockGrantCredits.mockReset();
  activeMerchantOrg.mockReset();
  activeMerchantOrg.mockResolvedValue({ id: "org_merchant_1" });
  founderAlert.mockReset();
  founderAlert.mockResolvedValue([]);
});

describe("grantCreditsAction", () => {
  const payload = {
    orgId: FOUNDER_OWNER_ID,
    displayedAmount: 100,
    reason: "Beta top-up",
    idempotencyKey: "admin-grant-key-123",
  };

  it("returns the gate error before touching credits", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);

    const result = await grantCreditsAction(payload);

    expect(result).toEqual(GATE_ERROR);
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("rejects finance direct grants over 1,000 displayed credits", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);

    const result = await grantCreditsAction({ ...payload, displayedAmount: 1001 });

    expect(result).toEqual({ error: "Credit actions are capped at 1,000 displayed credits each." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("rejects finance direct adjustments over 1,000 displayed credits", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);

    const result = await grantCreditsAction({ ...payload, displayedAmount: -1001 });

    expect(result).toEqual({ error: "Credit actions are capped at 1,000 displayed credits each." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("lets finance apply an in-limit grant through the single ledger writer", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);
    mockGrantCredits.mockResolvedValue({ ok: true });

    const result = await grantCreditsAction({ ...payload, displayedAmount: 1000 });

    expect(result).toEqual({ ok: true, duplicate: false });
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: FOUNDER_OWNER_ID,
        amount: 1000 * INTERNAL_PER_DISPLAY,
        reason: payload.reason,
        source: "ADMIN",
        createdBy: FINANCE_GATE.email,
        idempotencyKey: payload.idempotencyKey,
      }),
    );
    expect(actionEventCreate).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/credits");
  });

  it("rejects super-admin direct grants over 1,000 displayed credits", async () => {
    mockRequireRole.mockResolvedValue(SUPER_GATE);

    const result = await grantCreditsAction({ ...payload, displayedAmount: 5000 });

    expect(result).toEqual({ error: "Credit actions are capped at 1,000 displayed credits each." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("keeps insufficient-credit adjustments friendly and retry-safe", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);
    mockGrantCredits.mockRejectedValue(new MockInsufficientCredits());

    const result = await grantCreditsAction({ ...payload, displayedAmount: -500 });

    expect(result).toEqual({ error: "That adjustment would drive the balance negative (or the account doesn't exist)." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });
});

// ── 跨租户铸币:orgId 来自请求体,所以它要跨租户的权限 ──────────────────────────
describe("grantCreditsAction — 请求体里的 orgId 不是自带授权(MONEY-A14 判官 P1)", () => {
  const payload = {
    orgId: FOUNDER_OWNER_ID,
    displayedAmount: 100,
    reason: "Beta top-up",
    idempotencyKey: "admin-grant-key-123",
  };
  const crossPayload = { ...payload, orgId: "org_merchant_1" };

  it("finance 持有 credits.mutate,但没有 tenants.mutate ⇒ 拒绝铸别人 org 的币", async () => {
    mockRequireRole.mockImplementation(async (section: string) =>
      section === "credits" ? FINANCE_GATE : { error: "You don't have access to this." },
    );

    const result = await grantCreditsAction(crossPayload);

    expect(result).toEqual({ error: "You don't have access to this." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("持有 tenants.mutate ⇒ 放行,但那个 org 必须还活着(与 grantTenantCredits 同口径)", async () => {
    mockRequireRole.mockResolvedValue(SUPER_GATE);
    activeMerchantOrg.mockResolvedValue(null);

    expect(await grantCreditsAction(crossPayload)).toEqual({ error: "Unknown or closed org." });
    expect(mockGrantCredits).not.toHaveBeenCalled();

    activeMerchantOrg.mockResolvedValue({ id: "org_merchant_1" });
    mockGrantCredits.mockResolvedValue({ ok: true });
    expect(await grantCreditsAction(crossPayload)).toEqual({ ok: true, duplicate: false });
    expect(mockGrantCredits).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_merchant_1" }));
  });

  it("founder 自己那本账不走跨租户闸(缺省行为一字不动)", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);
    mockGrantCredits.mockResolvedValue({ ok: true });

    expect(await grantCreditsAction(payload)).toEqual({ ok: true, duplicate: false });
    expect(activeMerchantOrg).not.toHaveBeenCalled();
    expect(mockRequireRole).toHaveBeenCalledTimes(1);
  });

  it("撞上 30 天累计闸 ⇒ 说人话 + 报警,不把异常抛给页面", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);
    mockGrantCredits.mockRejectedValue(new MockFinanceAdjustBlocked("over"));

    const result = await grantCreditsAction(payload);

    expect(result).toMatchObject({ error: expect.stringContaining("2,000") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.adjust_window_blocked" }));
  });
});
