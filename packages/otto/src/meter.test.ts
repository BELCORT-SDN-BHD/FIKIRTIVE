/**
 * meter.test.ts — TDD tests for withLlmBudget + actualCostInternal (Task 1.7).
 *
 * Money-safety invariants tested:
 *  #1 paid:false → no metering (mock/free path never charges)
 *  #2 reserve fails → fn NEVER called, InsufficientCredits propagates
 *  #3 happy path (usage present) → settle actual, no refund
 *  #4 fn throws → refund whole reservation, never charge
 *  #5 no usage → settle full reserve (no refund)
 *  #6 reserve happens BEFORE fn BEFORE settle (call order asserted)
 *  #7 actualCostInternal pure math (cached rate, ceiling, 0-token edge)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db — vi.hoisted creates spies before vi.mock hoisting runs.
// prisma.$transaction invokes its callback synchronously with a fake tx.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const reserveCredits = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  const fakeTx = {};
  const $transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx));

  class InsufficientCredits extends Error {
    constructor(msg = "Not enough credits.") { super(msg); this.name = "InsufficientCredits"; }
  }

  return { reserveCredits, settleCredits, refundReservation, $transaction, InsufficientCredits };
});

vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction: mocks.$transaction },
  reserveCredits: mocks.reserveCredits,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
  InsufficientCredits: mocks.InsufficientCredits,
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mock is registered)
// ---------------------------------------------------------------------------
import { withLlmBudget, actualCostInternal } from "./meter.js";
import { llmPricesFor, CREDITS_PER_USD, turnBudgetInternal } from "@fikirtive/core";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const ORG = "org-test";
const REF = "ref-test";
const MODEL = "claude-sonnet-4-6";
const MARGIN = 3;

function makeArgs(overrides?: Partial<Parameters<typeof withLlmBudget>[0]>) {
  return { orgId: ORG, refId: REF, model: MODEL, paid: true, margin: MARGIN, maxSteps: 1, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: reserve/settle/refund succeed (resolve undefined)
  mocks.reserveCredits.mockResolvedValue(undefined);
  mocks.settleCredits.mockResolvedValue(undefined);
  mocks.refundReservation.mockResolvedValue(undefined);
  // Reset $transaction to always run its callback
  const fakeTx = {};
  mocks.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx));
});

// ---------------------------------------------------------------------------
// Test #1: paid:false → no metering
// ---------------------------------------------------------------------------
describe("Test #1 — paid:false (mock/free path)", () => {
  it("runs fn and returns result; reserveCredits and settleCredits are NEVER called", async () => {
    const fn = vi.fn().mockResolvedValue({ result: "hello", usage: undefined });
    const result = await withLlmBudget(makeArgs({ paid: false }), fn);

    expect(result).toBe("hello");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #2: reserve fails → fn NEVER called
// ---------------------------------------------------------------------------
describe("Test #2 — reserve fails → fn never called", () => {
  it("propagates InsufficientCredits and fn is not invoked", async () => {
    mocks.reserveCredits.mockRejectedValue(new mocks.InsufficientCredits());
    const fn = vi.fn();

    await expect(withLlmBudget(makeArgs(), fn)).rejects.toBeInstanceOf(mocks.InsufficientCredits);
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #3: happy path with usage → settle actual ≤ reserved
// ---------------------------------------------------------------------------
describe("Test #3 — happy path with usage → settle actual", () => {
  it("settleCredits called with actualInternal = actualCostInternal(usage, prices, margin); refundReservation NOT called", async () => {
    const usage = { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 300 };
    const fn = vi.fn().mockResolvedValue({ result: 42, usage });

    const result = await withLlmBudget(makeArgs(), fn);

    expect(result).toBe(42);
    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();

    const prices = llmPricesFor(MODEL);
    const expectedActual = actualCostInternal(usage, prices, MARGIN);
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { orgId: string; refId: string; actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(expectedActual);

    // Invariant: actual ≤ reserved
    const reserve = turnBudgetInternal(prices, MARGIN, 1);
    expect(expectedActual).toBeLessThanOrEqual(reserve);
  });
});

// ---------------------------------------------------------------------------
// Test #4: fn throws → refund + rethrow
// ---------------------------------------------------------------------------
describe("Test #4 — fn throws → refund + rethrow", () => {
  it("refundReservation called; settleCredits NOT called; error propagates", async () => {
    const boom = new Error("model exploded");
    const fn = vi.fn().mockRejectedValue(boom);

    await expect(withLlmBudget(makeArgs(), fn)).rejects.toBe(boom);

    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #5: no usage → settle the full reserve (no refund)
// ---------------------------------------------------------------------------
describe("Test #5 — no usage → settle full reserve", () => {
  it("settleCredits called with actualInternal === reserve; refundReservation NOT called", async () => {
    const fn = vi.fn().mockResolvedValue({ result: "ok", usage: undefined });

    await withLlmBudget(makeArgs(), fn);

    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();

    const prices = llmPricesFor(MODEL);
    const reserve = turnBudgetInternal(prices, MARGIN, 1);
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { orgId: string; refId: string; actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(reserve);
  });
});

// ---------------------------------------------------------------------------
// Test #6: reserve happens BEFORE fn BEFORE settle
// ---------------------------------------------------------------------------
describe("Test #6 — call order: reserve → fn → settle", () => {
  it("reserveCredits is called before fn, and fn is called before settleCredits", async () => {
    const callOrder: string[] = [];
    mocks.reserveCredits.mockImplementation(async () => { callOrder.push("reserve"); });
    mocks.settleCredits.mockImplementation(async () => { callOrder.push("settle"); });
    const fn = vi.fn().mockImplementation(async () => { callOrder.push("fn"); return { result: "done" }; });

    await withLlmBudget(makeArgs(), fn);

    expect(callOrder).toEqual(["reserve", "fn", "settle"]);
  });
});

// ---------------------------------------------------------------------------
// Test #7: actualCostInternal — pure math
// ---------------------------------------------------------------------------
describe("Test #7 — actualCostInternal pure math", () => {
  const prices = llmPricesFor(MODEL); // sonnet prices: 3e-6 in / 15e-6 out / 0.3e-6 cached

  it("computes cost with cached tokens at cached rate (cheaper than regular input)", () => {
    const usage = { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400 };
    const result = actualCostInternal(usage, prices, MARGIN);

    // non-cached = 600 tokens × 3e-6
    // cached     = 400 tokens × 0.3e-6
    // output     = 200 tokens × 15e-6
    const expectedUsd = 600 * 3e-6 + 400 * 0.3e-6 + 200 * 15e-6;
    const expectedInternal = Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD);
    expect(result).toBe(expectedInternal);
  });

  it("0 tokens → 0 internal credits", () => {
    const usage = { inputTokens: 0, outputTokens: 0 };
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(0);
  });

  it("no cached tokens → all input at regular rate", () => {
    const usage = { inputTokens: 500, outputTokens: 100 };
    const expectedUsd = 500 * prices.inputPerToken + 100 * prices.outputPerToken;
    const expectedInternal = Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD);
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(expectedInternal);
  });

  it("result is always an integer (Math.ceil)", () => {
    const usage = { inputTokens: 1, outputTokens: 1 };
    const result = actualCostInternal(usage, prices, 1);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("cached subset: actual ≤ reserve (never over-charges the cached path)", () => {
    // Full-cache scenario: all input is cached (cheapest)
    const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 1000 };
    const reserve = turnBudgetInternal(prices, MARGIN, 1);
    const actual = actualCostInternal(usage, prices, MARGIN);
    expect(actual).toBeLessThanOrEqual(reserve);
  });
});

// ---------------------------------------------------------------------------
// Test #7b: actualCostInternal — NaN/clamp guards (Fix 2 / P2-a)
// ---------------------------------------------------------------------------
describe("Test #7b — actualCostInternal NaN/clamp guards", () => {
  const prices = llmPricesFor(MODEL);

  it("cached > input clamps to input (never negative nonCachedInput)", () => {
    // cached=1500 > input=1000 → should clamp cached to 1000, nonCached=0
    const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 1500 };
    const result = actualCostInternal(usage, prices, MARGIN);
    // nonCached=0, cached=1000, output=100 — result is non-negative integer
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
    // Must equal the clamped calculation
    const expectedUsd = 0 * prices.inputPerToken + 1000 * prices.cachedInputPerToken + 100 * prices.outputPerToken;
    expect(result).toBe(Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD));
  });

  it("NaN usage fields → 0 (not NaN into ledger)", () => {
    const usage = { inputTokens: NaN, outputTokens: NaN, cachedInputTokens: NaN };
    const result = actualCostInternal(usage, prices, MARGIN);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("undefined/null-like usage fields → 0", () => {
    // undefined cachedInputTokens (omitted) — already tested; ensure inputTokens=0 edge too
    const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: undefined };
    const result = actualCostInternal(usage, prices, MARGIN);
    expect(result).toBe(0);
  });

  it("negative inputTokens → clamped to 0, result non-negative", () => {
    const usage = { inputTokens: -500, outputTokens: 100 };
    const result = actualCostInternal(usage, prices, MARGIN);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Test #9: withLlmBudget — usageOnError (Fix 3 / P1-c)
// ---------------------------------------------------------------------------
describe("Test #9 — withLlmBudget usageOnError", () => {
  it("usageOnError returns usage on throw → settleCredits called, refundReservation NOT called", async () => {
    const errUsage = { inputTokens: 500, outputTokens: 50 };
    const boom = new Error("maxTurns hit");
    const fn = vi.fn().mockRejectedValue(boom);
    const usageOnError = vi.fn().mockReturnValue(errUsage);

    await expect(withLlmBudget(makeArgs({ usageOnError }), fn)).rejects.toBe(boom);

    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();

    const prices = llmPricesFor(MODEL);
    const expectedActual = actualCostInternal(errUsage, prices, MARGIN);
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { orgId: string; refId: string; actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(expectedActual);
    expect(usageOnError).toHaveBeenCalledWith(boom);
  });

  it("usageOnError returns null on throw → refundReservation called (existing behavior)", async () => {
    const boom = new Error("something else");
    const fn = vi.fn().mockRejectedValue(boom);
    const usageOnError = vi.fn().mockReturnValue(null);

    await expect(withLlmBudget(makeArgs({ usageOnError }), fn)).rejects.toBe(boom);

    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("no usageOnError (undefined) on throw → refundReservation called (backward-compat)", async () => {
    const boom = new Error("plain throw");
    const fn = vi.fn().mockRejectedValue(boom);

    await expect(withLlmBudget(makeArgs(), fn)).rejects.toBe(boom);

    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });
});

