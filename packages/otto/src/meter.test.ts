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
  const fakeTx = {};
  const $transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx));

  class InsufficientCredits extends Error {
    constructor(msg = "Not enough credits.") { super(msg); this.name = "InsufficientCredits"; }
  }

  return { reserveCredits, reserveCreditsUpTo, settleCredits, refundReservation, $transaction, InsufficientCredits };
});

vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction: mocks.$transaction },
  reserveCredits: mocks.reserveCredits,
  reserveCreditsUpTo: mocks.reserveCreditsUpTo,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
  InsufficientCredits: mocks.InsufficientCredits,
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mock is registered)
// ---------------------------------------------------------------------------
import { withLlmBudget, actualCostInternal, mapOttoUsage } from "./meter.js";
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
