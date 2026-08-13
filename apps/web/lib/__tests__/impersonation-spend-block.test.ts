import { describe, it, expect, vi, beforeEach } from "vitest";

const GUARD_MSG = "Paused while impersonating a customer — exit impersonation to do this.";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, requireRole: vi.fn(), requireSession: vi.fn(), resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating, auth: vi.fn() }));

const reserveCredits = vi.fn();
const entityVariantFindFirst = vi.fn();
/**
 * #524 r6 — the two READ-ONLY ledger questions ottoApprove asks (judge r5 P1-A'①/②).
 *
 *  - finalizedReservations: which per-attempt refIds the ledger has already finished with, so a
 *    retry reserves under one it will still accept. Default: none — a fresh card.
 *  - otherHoldsSince: whether anything besides this turn's own hold was taken for this org since
 *    it was taken. Default "none" — these fixtures hold nothing else, so a failed approval really
 *    did charge nothing, and the card may say so.
 */
const { mockFinalizedReservations, mockOtherHoldsSince } = vi.hoisted(() => ({
  mockFinalizedReservations: vi.fn(async (_orgId: string, _refIds: readonly string[]) => new Set<string>()),
  mockOtherHoldsSince: vi.fn(async (_orgId: string, _refId: string): Promise<"none" | "some" | "unknown"> => "none"),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    genJob: { create: vi.fn() },
    entityVariant: { findFirst: entityVariantFindFirst },
  },
  reserveCredits, refundReservation: vi.fn(), InsufficientCredits: class extends Error {},
  SpendCapBlocked: class extends Error {},
  // #524 r6: ottoApprove asks the LEDGER which attempt is still free, and whether a failed
  // approval may claim "nothing was charged". Read-only; defaults say "fresh" and "unknown".
  finalizedReservations: mockFinalizedReservations,
  otherHoldsSince: mockOtherHoldsSince,
}));
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
