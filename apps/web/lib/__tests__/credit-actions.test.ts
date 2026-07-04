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

vi.mock("@fikirtive/db", () => ({
  prisma: {
    actionEvent: { create: actionEventCreate },
  },
  grantCredits: mockGrantCredits,
  InsufficientCredits: MockInsufficientCredits,
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

    expect(result).toEqual({ error: "Credit actions over 1,000 displayed credits require founder approval." });
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("rejects finance direct adjustments over 1,000 displayed credits", async () => {
    mockRequireRole.mockResolvedValue(FINANCE_GATE);

    const result = await grantCreditsAction({ ...payload, displayedAmount: -1001 });

    expect(result).toEqual({ error: "Credit actions over 1,000 displayed credits require founder approval." });
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

    expect(result).toEqual({ error: "Credit actions over 1,000 displayed credits require founder approval." });
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
