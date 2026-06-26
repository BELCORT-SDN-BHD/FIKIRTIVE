import { describe, it, expect, vi, beforeEach } from "vitest";

const GUARD_MSG = "Paused while impersonating a customer — exit impersonation to do this.";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner, requireRole: vi.fn(), requireSession: vi.fn() }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating, auth: vi.fn() }));

const reserveCredits = vi.fn();
const entityVariantFindFirst = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    genJob: { create: vi.fn() },
    entityVariant: { findFirst: entityVariantFindFirst },
  },
  reserveCredits, refundReservation: vi.fn(), InsufficientCredits: class extends Error {},
}));
const withLlmBudget = vi.fn();
vi.mock("@fikirtive/otto", () => ({ withLlmBudget }));

beforeEach(() => { vi.clearAllMocks(); mockRequireOwner.mockResolvedValue({ email: "founder@t.test", ownerId: "founder" }); });

describe("spend is blocked while impersonating", () => {
  it("startGen refuses with the guard message + never reserves", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    // startGen's guard runs right after requireOwner, BEFORE input validation —
    // so `{}` reaches the guard and returns the exact guard message (not a parse error).
    const { startGen } = await import("@/lib/gen-actions");
    const res = await startGen({});
    expect(res).toEqual({ error: GUARD_MSG });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
  it("coworkDraftStoryboard refuses with the guard message + never meters", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    // coworkDraftStoryboard validates BEFORE the guard, so pass valid input to reach it.
    const mod = await import("@/lib/cowork-actions");
    const res = await mod.coworkDraftStoryboard({ projectId: "p1", idea: "a robot in a forest" });
    expect(res).toEqual({ error: GUARD_MSG });
    expect(withLlmBudget).not.toHaveBeenCalled();
  });
  it("regenerateVariant refuses with the guard message + never reserves (variant spend path)", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    // The guard short-circuits before entityVariant.findFirst; the mock proves it would
    // otherwise proceed to the spend path (dispatchVariantJob → reserveCredits).
    entityVariantFindFirst.mockResolvedValue({ id: "v1", entityId: "e1", prompt: "p", entity: { baseAssetId: "a1" } });
    const { regenerateVariant } = await import("@/lib/refgen-actions");
    const res = await regenerateVariant("v1");
    expect(res).toEqual({ error: GUARD_MSG });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});
