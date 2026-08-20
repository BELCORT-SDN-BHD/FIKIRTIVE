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
  const reserveCreditsUpTo = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  const assertWithinSpendCap = vi.fn();
  const fakeTx = {};
  const $transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx));

  class InsufficientCredits extends Error {
    constructor(msg = "Not enough credits.") { super(msg); this.name = "InsufficientCredits"; }
  }
  class SpendCapBlocked extends Error {
    readonly requiredInternal: number;
    readonly capInternal: number | null;
    constructor(detail: { requiredInternal: number; capInternal: number | null }) {
      super("Paused by your spend cap — raise it in Settings to run this.");
      this.name = "SpendCapBlocked";
      this.requiredInternal = detail.requiredInternal;
      this.capInternal = detail.capInternal;
    }
  }

  return { reserveCredits, reserveCreditsUpTo, settleCredits, refundReservation, assertWithinSpendCap, $transaction, InsufficientCredits, SpendCapBlocked, fakeTx };
});

vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction: mocks.$transaction },
  reserveCredits: mocks.reserveCredits,
  reserveCreditsUpTo: mocks.reserveCreditsUpTo,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
  assertWithinSpendCap: mocks.assertWithinSpendCap,
  InsufficientCredits: mocks.InsufficientCredits,
  SpendCapBlocked: mocks.SpendCapBlocked,
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mock is registered)
// ---------------------------------------------------------------------------
import { withLlmBudget, actualCostInternal, mapOttoUsage, llmHoldInternal, ReservationNotClaimed, ClaimFailed } from "./meter.js";
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
  // #898: default is "the whole cap was available" — tests that care set their own hold.
  mocks.reserveCreditsUpTo.mockResolvedValue(40);
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

  it("uses the manifest-supplied price table for BOTH reserve and settle", async () => {
    const registered = llmPricesFor(MODEL);
    const manifestPrices = {
      inputPerToken: registered.inputPerToken * 2,
      cachedInputPerToken: registered.cachedInputPerToken * 2,
      cacheWriteInputPerToken: registered.cacheWriteInputPerToken * 2,
      outputPerToken: registered.outputPerToken * 2,
    };
    const expected = turnBudgetInternal(manifestPrices, MARGIN, 1);

    await withLlmBudget(
      makeArgs({ prices: manifestPrices }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );

    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: expected }),
    );
    expect(mocks.settleCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actualInternal: expected }),
    );
  });

  it("rejects manifest pricing below the registered floor before reserve or model execution", async () => {
    const registered = llmPricesFor(MODEL);
    const fn = vi.fn();

    await expect(withLlmBudget(
      makeArgs({ prices: { ...registered, inputPerToken: 0 } }),
      fn,
    )).rejects.toThrow(/below the registered fail-closed floor/);

    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Test #10: prompt-cache metering (engine spec §2.3 — Phase 1)
// Field names verified against installed @ai-sdk/anthropic@3.0.85 +
// @openai/agents-extensions@0.11.8: the adapter emits inputTokensDetails
// { cached_tokens, cache_write_tokens }, and each entry's inputTokens is the
// Anthropic TOTAL (noCache + cacheRead + cacheWrite).
// ---------------------------------------------------------------------------
describe("Test #10a — mapOttoUsage cache read/write mapping", () => {
  it("sums cached_tokens AND cache_write_tokens across request entries", () => {
    const stateUsage: Parameters<typeof mapOttoUsage>[0] = {
      inputTokens: 26_000,
      outputTokens: 400,
      requestUsageEntries: [
        // step 1: cold cache — the prefix is WRITTEN
        { inputTokens: 13_000, outputTokens: 200, inputTokensDetails: { cache_write_tokens: 12_400 } },
        // step 2: warm cache — the prefix is READ
        { inputTokens: 13_000, outputTokens: 200, inputTokensDetails: { cached_tokens: 12_400 } },
      ],
    };
    expect(mapOttoUsage(stateUsage)).toEqual({
      inputTokens: 26_000,
      outputTokens: 400,
      cachedInputTokens: 12_400,
      cacheWriteInputTokens: 12_400,
    });
  });

  it("no cache fields → both undefined (pre-caching behavior unchanged)", () => {
    const stateUsage = {
      inputTokens: 500,
      outputTokens: 100,
      requestUsageEntries: [{ inputTokens: 500, outputTokens: 100, inputTokensDetails: {} }],
    };
    const out = mapOttoUsage(stateUsage);
    expect(out.cachedInputTokens).toBeUndefined();
    expect(out.cacheWriteInputTokens).toBeUndefined();
  });

  it("missing requestUsageEntries → totals pass through, no cache fields", () => {
    expect(mapOttoUsage({ inputTokens: 300, outputTokens: 150 })).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      cachedInputTokens: undefined,
      cacheWriteInputTokens: undefined,
    });
  });
});

describe("Test #10b — actualCostInternal cache-write pricing (1.25× input)", () => {
  const prices = llmPricesFor(MODEL); // sonnet: 3e-6 in / 15e-6 out / 0.3e-6 cached / 3.75e-6 cache-write

  it("price table sanity: cacheWriteInputPerToken = 1.25 × inputPerToken", () => {
    expect(prices.cacheWriteInputPerToken).toBeCloseTo(prices.inputPerToken * 1.25, 12);
  });

  it("{no cache}: unchanged pricing — all input at the regular rate", () => {
    const usage = { inputTokens: 10_000, outputTokens: 500 };
    const expectedUsd = 10_000 * 3e-6 + 500 * 15e-6;
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD));
  });

  it("{read-heavy}: cached reads bill at the cached rate", () => {
    const usage = { inputTokens: 13_000, outputTokens: 500, cachedInputTokens: 12_400 };
    const expectedUsd = (13_000 - 12_400) * 3e-6 + 12_400 * 0.3e-6 + 500 * 15e-6;
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD));
  });

  it("{write+read}: cache writes bill the 1.25× premium, reads the cached rate — exact internal-credit total", () => {
    // A realistic 10-step turn: step 1 writes the 12.4k prefix, steps 2-10 read it.
    const usage = {
      inputTokens: 130_000, // 10 × (12.4k prefix + 0.6k history), totals incl. cache tokens
      outputTokens: 2_000,
      cachedInputTokens: 111_600, // 9 reads × 12.4k
      cacheWriteInputTokens: 12_400, // 1 write × 12.4k
    };
    const nonCached = 130_000 - 111_600 - 12_400; // 6_000
    const expectedUsd = nonCached * 3e-6 + 111_600 * 0.3e-6 + 12_400 * 3.75e-6 + 2_000 * 15e-6;
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD));
  });

  it("cached path is CHEAPER than uncached for the SAME token counts (the whole point of Phase 1)", () => {
    const base = { inputTokens: 130_000, outputTokens: 2_000 };
    const uncached = actualCostInternal(base, prices, MARGIN);
    const cached = actualCostInternal(
      { ...base, cachedInputTokens: 111_600, cacheWriteInputTokens: 12_400 },
      prices,
      MARGIN,
    );
    expect(cached).toBeLessThan(uncached);
  });

  it("clamp guard: cacheWrite is capped at input − cached (cached + cacheWrite never exceeds input)", () => {
    // Malformed usage: 800 cached + 900 write > 1000 input → write clamps to 200.
    const usage = { inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 800, cacheWriteInputTokens: 900 };
    const expectedUsd = 0 * 3e-6 + 800 * 0.3e-6 + 200 * 3.75e-6;
    expect(actualCostInternal(usage, prices, MARGIN)).toBe(Math.ceil(expectedUsd * MARGIN * CREDITS_PER_USD));
  });

  it("NaN/negative cacheWrite → treated as 0", () => {
    const clean = actualCostInternal({ inputTokens: 1_000, outputTokens: 100 }, prices, MARGIN);
    expect(actualCostInternal({ inputTokens: 1_000, outputTokens: 100, cacheWriteInputTokens: NaN }, prices, MARGIN)).toBe(clean);
    expect(actualCostInternal({ inputTokens: 1_000, outputTokens: 100, cacheWriteInputTokens: -50 }, prices, MARGIN)).toBe(clean);
  });
});

describe("Test #10c — withLlmBudget settles write+read usage correctly (≤ reserve)", () => {
  it("settleCredits receives the exact write+read internal total; settle ≤ reserve", async () => {
    // One metered step whose input fits the 12k reserve assumption (warm-cache step).
    const usage = { inputTokens: 11_000, outputTokens: 200, cachedInputTokens: 10_000, cacheWriteInputTokens: 500 };
    const fn = vi.fn().mockResolvedValue({ result: "ok", usage });

    await withLlmBudget(makeArgs(), fn);

    const prices = llmPricesFor(MODEL);
    const expectedActual = actualCostInternal(usage, prices, MARGIN);
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(expectedActual);

    const reserve = turnBudgetInternal(prices, MARGIN, 1);
    expect(expectedActual).toBeLessThanOrEqual(reserve);
  });
});

// ---------------------------------------------------------------------------
// Test #8: source audit — cowork-actions must stay free of raw LLM entry points.
// History: enhancePrompt/coworkDraftStoryboard/coworkTurn once called transport.chat here
// (wrapped in withLlmBudget); batch-3 surgery (7-10, 2026-07-07) deleted those dead paid
// endpoints. This fence now asserts they STAY deleted: any reintroduced transport/LLM call
// in this action file must come back through packages/otto metering, not a raw client.
// ---------------------------------------------------------------------------
describe("Test #8 — bypass audit: no unmetered LLM entry points in cowork-actions", () => {
  it("cowork-actions.ts source contains no transport.chat / getTransport call sites", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");

    // Path from packages/otto/src/meter.test.ts → apps/web/lib/cowork-actions.ts
    const thisFile = fileURLToPath(import.meta.url);
    const actionsPath = resolve(dirname(thisFile), "../../../apps/web/lib/cowork-actions.ts");
    const src = readFileSync(actionsPath, "utf8");

    expect(src).not.toContain("transport.chat");
    expect(src).not.toContain("getTransport");
  });
});

// ---------------------------------------------------------------------------
// Test #9 (#543) — reserveCapInternal caps the HOLD only. RESERVE→SETTLE/REFUND
// semantics are untouched: reserve still happens before fn, settle still clamps the
// charge to the held amount, a throw still refunds the whole hold.
// ---------------------------------------------------------------------------
describe("Test #9 — reserveCapInternal (#543 conversation-turn hold cap)", () => {
  it("holds the cap instead of the worst case when the cap is lower", async () => {
    const prices = llmPricesFor(MODEL);
    const worstCase = turnBudgetInternal(prices, MARGIN, 10);
    expect(worstCase).toBeGreaterThan(40);

    await withLlmBudget(
      makeArgs({ maxSteps: 10, reserveCapInternal: 40 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }),
    );

    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: 40 }),
    );
  });

  it("never RAISES the hold — a cap above the worst case leaves the derived budget intact", async () => {
    const prices = llmPricesFor(MODEL);
    const worstCase = turnBudgetInternal(prices, MARGIN, 1);

    await withLlmBudget(
      makeArgs({ maxSteps: 1, reserveCapInternal: 9_999 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );

    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: worstCase }),
    );
  });

  it("fails closed on a malformed cap — 0, negative, fractional and NaN fall back to the worst case", async () => {
    const prices = llmPricesFor(MODEL);
    const worstCase = turnBudgetInternal(prices, MARGIN, 10);

    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.clearAllMocks();
      await withLlmBudget(
        makeArgs({ maxSteps: 10, reserveCapInternal: bad }),
        vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
      );
      expect(mocks.reserveCredits).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cost: worstCase }),
      );
    }
  });

  it("no-usage settle charges the CAPPED hold, never the uncapped worst case", async () => {
    await withLlmBudget(
      makeArgs({ maxSteps: 10, reserveCapInternal: 40 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(40);
  });

  it("a throwing call still refunds the whole capped hold (invariant #3 unchanged)", async () => {
    const boom = new Error("model exploded");
    await expect(
      withLlmBudget(makeArgs({ maxSteps: 10, reserveCapInternal: 40 }), vi.fn().mockRejectedValue(boom)),
    ).rejects.toBe(boom);
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #10 (#898) — reserveMinInternal turns the hold from a fixed amount into
// min(cap, balance), and moves the door down to the minimum. Founder 2026-08-13,
// formal correction to #543.
//
// The cap alone was still a door: with a flat 4-credit hold, a merchant sitting on
// 3.9 credits could not send a message at all — they could not even ask what their
// remaining credits were still good for — while one message measures 0.4–3.3 (#536).
// ---------------------------------------------------------------------------
describe("Test #10 — reserveMinInternal (#898 chat hold fits the balance)", () => {
  it("routes to reserveCreditsUpTo with the cap and the minimum, not to the fixed reserve", async () => {
    mocks.reserveCreditsUpTo.mockResolvedValue(39);

    await withLlmBudget(
      makeArgs({ maxSteps: 10, reserveCapInternal: 40, reserveMinInternal: 10 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }),
    );

    expect(mocks.reserveCreditsUpTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, refId: REF, capInternal: 40, minimumInternal: 10 }),
    );
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
  });

  it("the no-usage settle charges the hold that was ACTUALLY taken, not the one it asked for", async () => {
    // The merchant only had 1.2 credits, so 12 internal is what the reserve took. Charging the
    // 40 it hoped for would be charging money that was never held — settleCredits would clamp
    // it, but the intent must be right at this layer too.
    mocks.reserveCreditsUpTo.mockResolvedValue(12);

    await withLlmBudget(
      makeArgs({ maxSteps: 10, reserveCapInternal: 40, reserveMinInternal: 10 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );

    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(12);
  });

  it("a refused entry never calls the model — invariant #1 holds through the new path", async () => {
    mocks.reserveCreditsUpTo.mockRejectedValue(new mocks.InsufficientCredits());
    const fn = vi.fn();

    await expect(
      withLlmBudget(makeArgs({ maxSteps: 10, reserveCapInternal: 40, reserveMinInternal: 10 }), fn),
    ).rejects.toBeInstanceOf(mocks.InsufficientCredits);

    expect(fn).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });

  it("a throwing call still refunds the whole fitted hold (invariant #3 unchanged)", async () => {
    mocks.reserveCreditsUpTo.mockResolvedValue(12);
    const boom = new Error("model exploded");

    await expect(
      withLlmBudget(
        makeArgs({ maxSteps: 10, reserveCapInternal: 40, reserveMinInternal: 10 }),
        vi.fn().mockRejectedValue(boom),
      ),
    ).rejects.toBe(boom);

    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed minimum — 0, negative, fractional, NaN and Infinity keep the fixed hold", async () => {
    // Fail-closed direction: ignoring a bad minimum holds MORE and admits FEWER callers.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.clearAllMocks();
      mocks.reserveCreditsUpTo.mockResolvedValue(12);
      await withLlmBudget(
        makeArgs({ maxSteps: 10, reserveCapInternal: 40, reserveMinInternal: bad }),
        vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
      );
      expect(mocks.reserveCreditsUpTo).not.toHaveBeenCalled();
      expect(mocks.reserveCredits).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cost: 40 }),
      );
    }
  });

  it("omitting the minimum leaves every existing caller on the fixed hold, byte for byte", async () => {
    await withLlmBudget(
      makeArgs({ maxSteps: 10, reserveCapInternal: 40 }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );

    expect(mocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: 40 }),
    );
  });
});

// ---------------------------------------------------------------------------
// #524 r3 — the afterReserve CLAIM window (judge r2 P1-A).
//
// 判官定性:任何「先消费一次性同意、再让权威闸决定」的顺序都关不死窗口 —— 两个决定在两笔
// 事务里,READ COMMITTED 下中间永远能插进一次上限变更。所以顺序改成:**先扣、再吃、后跑**。
// 这一组钉的就是那个窗口本身:hold 拿到之后、模型跑之前,claim 才发生;claim 输了就把
// hold 整笔退掉且**绝不调用 fn**。reserve/settle/refund 三个实现一字未改。
// ---------------------------------------------------------------------------
describe("#524 r3 — afterReserve claims the work between the hold and the model", () => {
  it("runs AFTER the reserve and BEFORE fn — the whole point of the window", async () => {
    const order: string[] = [];
    mocks.reserveCredits.mockImplementation(async () => { order.push("reserve"); });
    const fn = vi.fn(async () => { order.push("fn"); return { result: "ok" }; });

    await withLlmBudget(
      makeArgs({ afterReserve: async () => { order.push("claim"); return true; } }),
      fn,
    );

    expect(order).toEqual(["reserve", "claim", "fn"]);
  });

  it("a reserve refusal means the claim NEVER runs — the consent is untouched", async () => {
    // This is the invariant the approval card depends on: cap/balance refusal ⇒ nothing consumed.
    mocks.reserveCredits.mockRejectedValue(new mocks.InsufficientCredits());
    const claim = vi.fn(async () => true);
    const fn = vi.fn();

    await expect(withLlmBudget(makeArgs({ afterReserve: claim }), fn)).rejects.toThrow(
      mocks.InsufficientCredits,
    );

    expect(claim).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled(); // nothing was held
  });

  it("a LOST claim refunds the whole hold, never calls fn, and throws ReservationNotClaimed", async () => {
    const fn = vi.fn();

    await expect(
      withLlmBudget(makeArgs({ afterReserve: async () => false }), fn),
    ).rejects.toThrow(ReservationNotClaimed);

    expect(fn).not.toHaveBeenCalled();
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF });
    // Net zero: exactly one reserve, exactly one refund, no settle.
    expect(mocks.reserveCredits).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("a THROWING claim refunds the hold too, then reports it as ClaimFailed carrying the cause", async () => {
    // A claim that errored is not "someone else won" — it must not leave a hold standing, and it
    // must not be laundered into a benign answer either (judge r2 P2 is the caller-side half).
    // #524 r5: it is WRAPPED, because the caller has to tell "this attempt burned its refId" from
    // "the work refused before anything was held" — those need different answers (judge r4 P1-A'①).
    const boom = new Error("card write failed");
    const fn = vi.fn();

    const thrown = await withLlmBudget(makeArgs({ afterReserve: async () => { throw boom; } }), fn).catch(
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(ClaimFailed);
    expect((thrown as ClaimFailed).cause).toBe(boom); // the original failure is never lost
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("a WON claim settles normally — the ordinary path is untouched", async () => {
    const fn = vi.fn(async () => ({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }));

    const out = await withLlmBudget(makeArgs({ afterReserve: async () => true }), fn);

    expect(out).toBe("ok");
    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });

  it("without afterReserve nothing changes — every existing caller keeps its exact behaviour", async () => {
    const fn = vi.fn(async () => ({ result: "ok" }));
    await withLlmBudget(makeArgs(), fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });

  it("paid:false skips the claim entirely — a free call holds nothing to claim", async () => {
    const claim = vi.fn(async () => true);
    const fn = vi.fn(async () => ({ result: "free" }));

    await withLlmBudget(makeArgs({ paid: false, afterReserve: claim }), fn);

    expect(claim).not.toHaveBeenCalled();
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(llmHoldInternal(makeArgs({ paid: false }))).toBe(0);
  });

  it("the hold it refunds is exactly the hold llmHoldInternal derives", async () => {
    // One definition of the number, so a preflight and the real reserve can never disagree.
    const args = makeArgs({ afterReserve: async () => false });
    await expect(withLlmBudget(args, vi.fn())).rejects.toThrow(ReservationNotClaimed);
    expect(mocks.reserveCredits).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      refId: REF,
      cost: llmHoldInternal(args),
    });
  });
});

// ---------------------------------------------------------------------------
// #524 r5 — judge r4 P1-B: the spend cap is judged against the WHOLE approved
// action, inside the reserve's own transaction.
// ---------------------------------------------------------------------------
describe("#524 r5 — capCostInternal judges both legs of one action at the authority", () => {
  // The judge's counterexample, in the units the reserve actually deals in: a cap of 7, a 4-credit
  // LLM hold, a 6-credit reference generation. Each leg alone is under the ceiling; the action the
  // merchant clicked costs 10 and is over it. HOLD is pinned through reserveCapInternal so the
  // hold is exactly 4 no matter what the price table says.
  const HOLD = 4;
  const TOOL = 6;
  const ACTION_TOTAL = HOLD + TOOL; // 10 — the one approval, both legs
  const CAP = 7;
  const approvalArgs = (extra?: Record<string, unknown>) =>
    makeArgs({ reserveCapInternal: HOLD, capCostInternal: ACTION_TOTAL, ...extra });

  it("refuses the judge's cap-7 / hold-4 / refgen-6 counterexample: each leg under, the sum over", async () => {
    // The exact shape that got through before r5: two authorities each waving through their own
    // leg while the action the merchant approved sails past the ceiling they set.
    mocks.assertWithinSpendCap.mockImplementation(async (_tx: unknown, _orgId: string, cost: number) => {
      if (cost > CAP) throw new mocks.SpendCapBlocked({ requiredInternal: cost, capInternal: CAP });
    });
    const claim = vi.fn(async () => true);
    const fn = vi.fn();

    const thrown = await withLlmBudget(approvalArgs({ afterReserve: claim }), fn).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(mocks.SpendCapBlocked);
    // The number the merchant is told is the WHOLE action, not one leg of it.
    expect((thrown as InstanceType<typeof mocks.SpendCapBlocked>).requiredInternal).toBe(ACTION_TOTAL);
    // Sanity on the premise: each leg on its own WOULD have passed this cap.
    expect(HOLD).toBeLessThanOrEqual(CAP);
    expect(TOOL).toBeLessThanOrEqual(CAP);
    // Nothing held, nothing consumed, nothing ran: the refusal lands before all of it.
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("judges the action total in the SAME transaction as the reserve, before it", async () => {
    // Same transaction is the whole point: a preflight in another one cannot see a cap the
    // merchant moved after it read. Assert both the ordering and the shared tx handle.
    const order: string[] = [];
    mocks.assertWithinSpendCap.mockImplementation(async () => { order.push("cap"); });
    mocks.reserveCredits.mockImplementation(async () => { order.push("reserve"); });

    await withLlmBudget(approvalArgs(), async () => ({ result: "ok" }));

    expect(order).toEqual(["cap", "reserve"]);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2); // reserve tx + settle tx
    const capTx = mocks.assertWithinSpendCap.mock.calls[0]![0];
    const reserveTx = mocks.reserveCredits.mock.calls[0]![0];
    expect(capTx).toBe(reserveTx);
    expect(mocks.assertWithinSpendCap).toHaveBeenCalledWith(reserveTx, ORG, ACTION_TOTAL);
  });

  // #524 r6(判官 r5 P2):上一版这里写着「一次事务,不是两次读一个会动的 cap」—— 与生产
  // 相反。生产里 cap 确实被读**两次**:这一次判整动作,`reserveCredits` 内部再判这一笔。
  // 而且这份替身把 `reserveCredits` mock 掉了,第二次读根本不会发生,所以那句断言证不了
  // 任何关于原子性的事,是一格假绿。
  //
  // 这里如实钉住这份替身**能**证的东西:同一个事务句柄一路传下去。真正的原子性
  // (`SELECT … FOR UPDATE`,以及「事务中途调低 cap 不改变本次判定」)由 packages/db 的
  // 真库演练证明 —— credits.test.ts case 19。两条断言各就各位,谁也不冒充谁。
  it("hands the SAME transaction on to reserveCredits, whose own cap read is the second one", async () => {
    const reserveTxs: unknown[] = [];
    mocks.reserveCredits.mockImplementation(async (tx: unknown) => { reserveTxs.push(tx); });

    await withLlmBudget(approvalArgs(), async () => ({ result: "ok" }));

    // This double stops at reserveCredits' door, so exactly ONE cap read is visible from here.
    // Production reads it again inside reserveCredits — under a row lock taken by this first
    // read, which is what makes the pair one verdict (packages/db credits.test.ts case 19).
    expect(mocks.assertWithinSpendCap).toHaveBeenCalledTimes(1);
    expect(reserveTxs[0]).toBe(mocks.assertWithinSpendCap.mock.calls[0]![0]);
  });

  it("changes NO amount — the hold is still exactly llmHoldInternal", async () => {
    // It widens the cap verdict and nothing else: never reserve more, never settle more.
    const args = approvalArgs();
    await withLlmBudget(args, async () => ({ result: "ok" }));
    expect(llmHoldInternal(args)).toBe(HOLD);
    expect(mocks.reserveCredits).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF, cost: HOLD });
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { actualInternal: number }];
    expect(settleCall[1].actualInternal).toBeLessThanOrEqual(HOLD);
  });

  it("ignores a total at or below the hold, and malformed values — it can only ever be stricter", async () => {
    // A looser ceiling must never come from this field: the reserve's own per-charge verdict
    // stands alone whenever the action total says nothing new (or says nothing sane).
    for (const capCostInternal of [undefined, 0, -5, HOLD, Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.clearAllMocks();
      await withLlmBudget(makeArgs({ reserveCapInternal: HOLD, capCostInternal }), async () => ({ result: "ok" }));
      expect(mocks.assertWithinSpendCap, `capCostInternal=${String(capCostInternal)}`).not.toHaveBeenCalled();
      expect(mocks.reserveCredits).toHaveBeenCalledTimes(1);
    }
  });

  it("paid:false holds nothing, so there is no action total to judge", async () => {
    await withLlmBudget(makeArgs({ paid: false, capCostInternal: ACTION_TOTAL }), async () => ({ result: "free" }));
    expect(mocks.assertWithinSpendCap).not.toHaveBeenCalled();
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #524 r5 — judge r4 P1-A'②: "nothing was charged" is reported, never guessed.
// ---------------------------------------------------------------------------
describe("#524 r5 — onRefundedFailure tells the caller this turn charged nothing", () => {
  it("fires after a full refund, so a spent one-shot consent can stop claiming success", async () => {
    const onRefundedFailure = vi.fn();
    const boom = new Error("resume died");

    await expect(
      withLlmBudget(makeArgs({ onRefundedFailure }), async () => { throw boom; }),
    ).rejects.toBe(boom);

    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(onRefundedFailure).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("does NOT fire when usageOnError settled a real charge — the merchant WAS charged", async () => {
    // The distinction the card's sentence depends on: "nothing was charged" must be true when
    // said. A failed call that still burned tokens is settled, not refunded.
    const onRefundedFailure = vi.fn();
    const boom = new Error("died mid-stream");

    await expect(
      withLlmBudget(
        makeArgs({ onRefundedFailure, usageOnError: () => ({ inputTokens: 1000, outputTokens: 500 }) }),
        async () => { throw boom; },
      ),
    ).rejects.toBe(boom);

    expect(mocks.settleCredits).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
    expect(onRefundedFailure).not.toHaveBeenCalled();
  });

  it("a throwing hook never masks the real failure", async () => {
    const boom = new Error("resume died");
    await expect(
      withLlmBudget(
        makeArgs({ onRefundedFailure: () => { throw new Error("hook exploded"); } }),
        async () => { throw boom; },
      ),
    ).rejects.toBe(boom);
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// #524 × #898 合流:两票的两个「上限」在这一层碰头。
//
// #898 把聊天冻结改成 min(4 credits, 余额),#524 给 reserveCredits 装了商家自设上限的闸。
// Founder 2026-08-13 裁决(市调报告存档 issue #909):上限只管新的花钱动作,进行中的对话
// 完全豁免 —— 所以这一层的分流本身就是那条裁决:带 minimum 的回合走 reserveCreditsUpTo
// (账本侧不读上限),不带的走 reserveCredits(照旧判上限)。
//
// 已批准动作的全成本判定(capCostInternal)一行未动:它判的是商家主动要的产出,正是上限
// 该管的那一类。这里钉的是**两条路各走各的**,以及退款/结算在新路径上原样成立。
// ---------------------------------------------------------------------------
describe("#524 × #898 — the conversation hold and the capped charge take different doors", () => {
  const HOLD = 4;   // reserveCapInternal, pinned below the derived worst case
  const MIN = 1;    // reserveMinInternal — the entry minimum
  const TOOL = 6;   // an approved tool's own deterministic charge

  it("a turn WITH a minimum goes through the cap-free reserve; the capped one is never called", async () => {
    mocks.reserveCreditsUpTo.mockResolvedValue(2);

    await withLlmBudget(
      makeArgs({ reserveCapInternal: HOLD, reserveMinInternal: MIN }),
      async () => ({ result: "ok" }),
    );

    expect(mocks.reserveCreditsUpTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ capInternal: HOLD, minimumInternal: MIN }),
    );
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    // No action total ⇒ nothing widened. The conversation leg is judged by neither cap read.
    expect(mocks.assertWithinSpendCap).not.toHaveBeenCalled();
  });

  it("a turn WITHOUT a minimum keeps the capped reserve, exactly as #524 shipped it", async () => {
    await withLlmBudget(makeArgs({ reserveCapInternal: HOLD }), async () => ({ result: "ok" }));

    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: HOLD }),
    );
    expect(mocks.reserveCreditsUpTo).not.toHaveBeenCalled();
  });

  it("the approved-action verdict still runs on the balance-aware path — it judges the CHARGE legs", async () => {
    // The exemption is for the conversation hold, not for the generation the merchant approved.
    // capCostInternal is the whole approval, so the widened verdict is unchanged by #898.
    mocks.reserveCreditsUpTo.mockResolvedValue(2);

    await withLlmBudget(
      makeArgs({ reserveCapInternal: HOLD, reserveMinInternal: MIN, capCostInternal: HOLD + TOOL }),
      async () => ({ result: "ok" }),
    );

    expect(mocks.assertWithinSpendCap).toHaveBeenCalledTimes(1);
    expect(mocks.assertWithinSpendCap.mock.calls[0]![2]).toBe(HOLD + TOOL);
    // …and it shares the reserve's transaction, so a refusal takes the hold down with it.
    expect(mocks.assertWithinSpendCap.mock.calls[0]![0]).toBe(mocks.reserveCreditsUpTo.mock.calls[0]![0]);
  });

  it("settle and refund read the hold that was REALLY taken, not the one it asked for", async () => {
    mocks.reserveCreditsUpTo.mockResolvedValue(2);
    await withLlmBudget(
      makeArgs({ reserveCapInternal: HOLD, reserveMinInternal: MIN }),
      vi.fn().mockResolvedValue({ result: "ok", usage: undefined }),
    );
    const settleCall = mocks.settleCredits.mock.calls[0] as [unknown, { actualInternal: number }];
    expect(settleCall[1].actualInternal).toBe(2);

    vi.clearAllMocks();
    mocks.reserveCreditsUpTo.mockResolvedValue(2);
    const boom = new Error("model exploded");
    await expect(
      withLlmBudget(makeArgs({ reserveCapInternal: HOLD, reserveMinInternal: MIN }), vi.fn().mockRejectedValue(boom)),
    ).rejects.toBe(boom);
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("a refusal from the cap-free reserve is a BALANCE refusal, and the model never runs", async () => {
    mocks.reserveCreditsUpTo.mockRejectedValue(new mocks.InsufficientCredits());
    const fn = vi.fn();

    await expect(
      withLlmBudget(makeArgs({ reserveCapInternal: HOLD, reserveMinInternal: MIN }), fn),
    ).rejects.toBeInstanceOf(mocks.InsufficientCredits);

    expect(fn).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 钱路 M1-c — extraHoldInternal / extraSettleInternal(非 LLM 的那一笔)
//
// 现役唯一用户 = 深研的搜索费(Founder 2026-07-03 裁的 3×,裁决 9b 落地)。搜索此前被标成
// FREE,而「free」的真正含义是**没人计价**。这一族用例钉住的是:加这条腿**不能**动到
// reserve→settle→refund 的任何一条不变量。
// ---------------------------------------------------------------------------
describe("钱路 M1-c — extraHoldInternal / extraSettleInternal(搜索费那条腿)", () => {
  const EXTRA_HOLD = 36; // 12 次搜索 × 3 internal(standard 档的 worst case)
  const usage = { inputTokens: 1000, outputTokens: 100 };
  const llmOnly = turnBudgetInternal(llmPricesFor(MODEL), MARGIN, 1);
  const tokenOnly = () => actualCostInternal(usage, llmPricesFor(MODEL), MARGIN);

  it("hold 变大:持有额 = LLM worst case + 非 LLM worst case", () => {
    expect(llmHoldInternal(makeArgs({ extraHoldInternal: EXTRA_HOLD }))).toBe(llmOnly + EXTRA_HOLD);
    // 不传就是原来的行为,一格不动。
    expect(llmHoldInternal(makeArgs())).toBe(llmOnly);
  });

  it("settle 变大:token 那一笔 + 实际发生的搜索费", async () => {
    await withLlmBudget(
      makeArgs({ extraHoldInternal: EXTRA_HOLD, extraSettleInternal: () => 15 }), // 实际搜了 5 次
      async () => ({ result: "ok", usage }),
    );
    expect(mocks.settleCredits).toHaveBeenCalledWith(mocks.fakeTx, {
      orgId: ORG,
      refId: REF,
      actualInternal: tokenOnly() + 15,
    });
  });

  it("持有额必须盖得住最坏情况的 settle —— 否则搜索费会被 clamp 掉、成本落在我们头上", async () => {
    // 一次搜满 12 次的深研:settle 的搜索部分正好等于 hold 的搜索部分。
    await withLlmBudget(
      makeArgs({ extraHoldInternal: EXTRA_HOLD, extraSettleInternal: () => EXTRA_HOLD }),
      async () => ({ result: "ok", usage }),
    );
    const heldTotal = llmOnly + EXTRA_HOLD;
    const settled = mocks.settleCredits.mock.calls[0]![1].actualInternal;
    expect(settled).toBeLessThanOrEqual(heldTotal);
    // 而且搜索那部分**真的进了 settle**,不是被吞掉。
    expect(settled).toBe(tokenOnly() + EXTRA_HOLD);
  });

  it("不变量 #3 不动:fn 抛错 → 全额退款(搜索费一起退,一轮没成的深研不收钱)", async () => {
    const boom = new Error("provider down");
    const extraSettle = vi.fn(() => 15);
    await expect(
      withLlmBudget(
        makeArgs({ extraHoldInternal: EXTRA_HOLD, extraSettleInternal: extraSettle }),
        vi.fn().mockRejectedValue(boom),
      ),
    ).rejects.toBe(boom);
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(extraSettle).not.toHaveBeenCalled();
  });

  it("优雅截断(usageOnError)= 真的跑了 → token 与搜索一起结", async () => {
    const err = Object.assign(new Error("max turns"), { state: { usage } });
    await expect(
      withLlmBudget(
        makeArgs({
          extraHoldInternal: EXTRA_HOLD,
          extraSettleInternal: () => 9,
          usageOnError: () => usage,
        }),
        vi.fn().mockRejectedValue(err),
      ),
    ).rejects.toBe(err);
    expect(mocks.settleCredits).toHaveBeenCalledWith(mocks.fakeTx, {
      orgId: ORG,
      refId: REF,
      actualInternal: tokenOnly() + 9,
    });
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });

  it("paid:false 照旧零计量 —— 搜索费也不例外", async () => {
    const r = await withLlmBudget(
      makeArgs({ paid: false, extraHoldInternal: EXTRA_HOLD, extraSettleInternal: () => 99 }),
      async () => ({ result: "free", usage }),
    );
    expect(r).toBe("free");
    expect(llmHoldInternal(makeArgs({ paid: false, extraHoldInternal: EXTRA_HOLD }))).toBe(0);
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
  });

  it("坏掉的 extraHold 一律忽略(方向 = 不额外持有,退回改动前的行为)", () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(llmHoldInternal(makeArgs({ extraHoldInternal: bad })), `extraHold=${String(bad)}`).toBe(llmOnly);
    }
  });

  it("坏掉的 extraSettle 收 0 —— 计数器坏掉不许变成一笔编出来的收费", async () => {
    const bads = [
      () => Number.NaN,
      () => -5,
      () => Number.POSITIVE_INFINITY,
      () => {
        throw new Error("counter blew up");
      },
    ];
    for (const bad of bads) {
      vi.clearAllMocks();
      mocks.settleCredits.mockResolvedValue(undefined);
      mocks.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(mocks.fakeTx));
      await withLlmBudget(
        makeArgs({ extraHoldInternal: EXTRA_HOLD, extraSettleInternal: bad }),
        async () => ({ result: "ok", usage }),
      );
      expect(mocks.settleCredits.mock.calls[0]![1].actualInternal).toBe(tokenOnly());
    }
  });

  it("非整数的实际搜索费向上进位 —— 余量归我们,不是归商家", async () => {
    await withLlmBudget(
      makeArgs({ extraHoldInternal: EXTRA_HOLD, extraSettleInternal: () => 2.1 }),
      async () => ({ result: "ok", usage }),
    );
    expect(mocks.settleCredits.mock.calls[0]![1].actualInternal).toBe(tokenOnly() + 3);
  });

  it("没有这条腿时,行为与本次改动之前逐字相同(回归钉板)", async () => {
    await withLlmBudget(makeArgs(), async () => ({ result: "ok", usage }));
    expect(mocks.reserveCredits).toHaveBeenCalledWith(mocks.fakeTx, { orgId: ORG, refId: REF, cost: llmOnly });
    expect(mocks.settleCredits).toHaveBeenCalledWith(mocks.fakeTx, {
      orgId: ORG,
      refId: REF,
      actualInternal: tokenOnly(),
    });
  });
});

// ---------------------------------------------------------------------------
// 钱路 M1-b —— commitInSettleTx:交付与结算同一笔提交(invariant #10)
// ---------------------------------------------------------------------------
describe("commitInSettleTx — 交付与结算同一笔提交", () => {
  it("在 settle 的**同一个 tx** 上回调,而且排在 settle 之后", async () => {
    const order: string[] = [];
    let handedTx: unknown = null;
    mocks.settleCredits.mockImplementation(async () => {
      order.push("settle");
    });

    await withLlmBudget(
      makeArgs({
        commitInSettleTx: async (tx) => {
          order.push("commit");
          handedTx = tx;
        },
      }),
      vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }),
    );

    expect(order).toEqual(["settle", "commit"]);
    // 交付拿到的 tx 与 settle 拿到的是**同一个对象** —— 这就是「同一笔提交」这句话的机器证明。
    const settleTx = (mocks.settleCredits.mock.calls[0] as [unknown, unknown])[0];
    expect(handedTx).toBe(settleTx);
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });

  it("钩子抛错:整笔回滚之后全额退款,原错误照样抛给调用方", async () => {
    const boom = new Error("the report write blew up");

    await expect(
      withLlmBudget(
        makeArgs({
          commitInSettleTx: async () => {
            throw boom;
          },
        }),
        vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }),
      ),
    ).rejects.toBe(boom);

    // settle 那一笔事务整个回滚了(这里 $transaction 是替身,所以断言的是「随后补了退款」)。
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(mocks.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF });
  });

  it("不传钩子的调用方:结算失败仍然原样抛出,绝不新增一笔退款(零行为变更)", async () => {
    const boom = new Error("settle transaction failed");
    mocks.settleCredits.mockRejectedValue(boom);

    await expect(
      withLlmBudget(makeArgs(), vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } })),
    ).rejects.toBe(boom);

    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

describe("commitInSettleTx × paid:false — 免费路上也必须交付", () => {
  it("paid:false:不计量,但交付照跑(而且在一笔事务里)", async () => {
    let handedTx: unknown = null;

    const out = await withLlmBudget(
      makeArgs({
        paid: false,
        commitInSettleTx: async (tx) => {
          handedTx = tx;
        },
      }),
      vi.fn().mockResolvedValue({ result: "ok", usage: { inputTokens: 10, outputTokens: 5 } }),
    );

    expect(out).toBe("ok");
    expect(handedTx, "免费路上交付被安静地跳过了 —— 换了个入口的同一种静默失败").not.toBeNull();
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    // 免费 = 一分钱都不碰(invariant #4 不许被这条缝松动)
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});
