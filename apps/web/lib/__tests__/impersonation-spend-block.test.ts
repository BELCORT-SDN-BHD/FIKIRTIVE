import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner, requireRole: vi.fn(), requireSession: vi.fn() }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating, auth: vi.fn() }));

const reserveCredits = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction: vi.fn(), genJob: { create: vi.fn() } },
  reserveCredits, refundReservation: vi.fn(), InsufficientCredits: class extends Error {},
}));
const withLlmBudget = vi.fn();
vi.mock("@fikirtive/otto", () => ({ withLlmBudget }));

beforeEach(() => { vi.clearAllMocks(); mockRequireOwner.mockResolvedValue({ email: "founder@t.test", ownerId: "founder" }); });

describe("spend is blocked while impersonating", () => {
  it("startGen refuses + never reserves", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const { startGen } = await import("@/lib/gen-actions");
    const res = await startGen({});
    expect(res).toHaveProperty("error");
    expect(reserveCredits).not.toHaveBeenCalled();
  });
  it("coworkDraftStoryboard refuses + never meters", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const mod = await import("@/lib/cowork-actions");
    // call with minimal args; the guard runs right after requireOwner, before any spend
    const res = await (mod.coworkDraftStoryboard as (...a: unknown[]) => Promise<unknown>)({});
    expect(res).toHaveProperty("error");
    expect(withLlmBudget).not.toHaveBeenCalled();
  });
});
