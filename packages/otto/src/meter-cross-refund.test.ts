/**
 * meter-cross-refund.test.ts — probe for the M1-b × M1-c cross path: `commitInSettleTx`
 * (钱路 M1-b, delivery-in-settle-tx) throwing while `extraSettleInternal` (钱路 M1-c, the
 * research search fee) is NON-ZERO.
 *
 * Provenance: this file transcribes, byte-for-byte in its assertions, the differential-judge
 * probe written and verified for PR #1012's merge 5fb59eab (issue #1040). Only the file's
 * location/name and this header comment changed on transcription; every `describe`/`it` and
 * every expectation below is unmodified from the judge's original.
 *
 * Why this combination needs its own pin. `commitInSettleTx` (M1-b) and `extraSettleInternal`
 * (M1-c) landed on different sides of the same merge, so neither parent could ever exercise
 * BOTH being non-trivial on one call — only the merge composes them. And it is not a
 * hypothetical composition: apps/worker/src/jobs/research.ts:311-318 passes all three hooks
 * (`extraHoldInternal`, `extraSettleInternal`, `commitInSettleTx`) on the SAME `withLlmBudget`
 * call, so this is the live production path, not a corner nobody reaches.
 *
 * What is asserted today (correct by construction, per packages/db/src/credits.ts:333-335):
 * `refundReservation` takes no amount argument — it reads the held amount FROM THE RESERVE ROW
 * (`reservedDelta`) and refunds exactly that, so a delivery failure refunds the token hold AND
 * the search fee together, with nothing left for a future amount-parameter change to carve out
 * from under it. This file exists so that if `refundReservation` ever grows an amount parameter,
 * a test goes red before the gap does.
 *
 * Unlike meter.test.ts (whose $transaction mock never rolls back and whose settle/refund are
 * bare spies), this file stands up a MINIATURE LEDGER that mirrors packages/db/src/credits.ts
 * line for line — clamp A=min(trunc(actual),B), finalizer-once mutual exclusion, refund amount
 * READ FROM THE RESERVE ROW — and a `$transaction` that really rolls back on throw. So the
 * assertions are about MONEY (balance / reserved), not about which spy was called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SEED_BALANCE = 100_000;

const mocks = vi.hoisted(() => {
  type Acct = { balance: number; reserved: number };
  const state = {
    acct: { balance: 0, reserved: 0 } as Acct,
    reserveRow: null as number | null, // RESERVE.reservedDelta — the ONE authority on the hold
    finalizer: null as null | "SETTLE" | "REFUND",
  };

  const reserveCredits = vi.fn(async (_tx: unknown, a: { cost: number }) => {
    if (state.acct.balance < a.cost) throw new Error("InsufficientCredits");
    state.acct.balance -= a.cost;
    state.acct.reserved += a.cost;
    state.reserveRow = a.cost;
  });

  // credits.ts:268 — A = min(trunc(actual), B); balance += B-A; reserved -= B.
  const settleCredits = vi.fn(async (_tx: unknown, a: { actualInternal?: number }) => {
    if (state.reserveRow === null) return;
    if (state.finalizer) return; // finalizer_once unique index
    const B = state.reserveRow;
    const A = Math.min(a.actualInternal === undefined ? B : Math.max(0, Math.trunc(a.actualInternal)), B);
    state.finalizer = "SETTLE";
    state.acct.balance += B - A;
    state.acct.reserved -= B;
  });

  // credits.ts:328 — "The amount is read FROM THE RESERVE ROW (never recomputed)."
  const refundReservation = vi.fn(async (_tx: unknown, _a: unknown) => {
    if (state.reserveRow === null) return "no-reservation";
    if (state.finalizer) return state.finalizer === "REFUND" ? "already-refunded" : "already-settled";
    state.finalizer = "REFUND";
    state.acct.balance += state.reserveRow;
    state.acct.reserved -= state.reserveRow;
    return "refunded";
  });

  const reserveCreditsUpTo = vi.fn();
  const assertWithinSpendCap = vi.fn();

  // A transaction that ACTUALLY rolls back — the whole point of this probe.
  const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const snap = { acct: { ...state.acct }, reserveRow: state.reserveRow, finalizer: state.finalizer };
    try {
      return await cb({});
    } catch (e) {
      state.acct = snap.acct;
      state.reserveRow = snap.reserveRow;
      state.finalizer = snap.finalizer;
      throw e;
    }
  });

  class InsufficientCredits extends Error {}
  class SpendCapBlocked extends Error {}

  return { state, reserveCredits, reserveCreditsUpTo, settleCredits, refundReservation, assertWithinSpendCap, $transaction, InsufficientCredits, SpendCapBlocked };
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

import { withLlmBudget, llmHoldInternal, actualCostInternal } from "./meter.js";
import { llmPricesFor } from "@fikirtive/core";

const ORG = "org-judge";
const REF = "research:card-judge";
const MODEL = "claude-sonnet-4-6";
const MARGIN = 3;
const USAGE = { inputTokens: 1_000, outputTokens: 500 };
const EXTRA_HOLD = 900;   // tier.maxSearches × rate (worst case)
const EXTRA_ACTUAL = 300; // ctx.searchesUsed × rate (what really happened)

function args(overrides?: Record<string, unknown>) {
  return {
    orgId: ORG, refId: REF, model: MODEL, paid: true, margin: MARGIN, maxSteps: 4,
    extraHoldInternal: EXTRA_HOLD,
    extraSettleInternal: () => EXTRA_ACTUAL,
    ...overrides,
  } as Parameters<typeof withLlmBudget>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.acct = { balance: SEED_BALANCE, reserved: 0 };
  mocks.state.reserveRow = null;
  mocks.state.finalizer = null;
});

describe("JUDGE #1012 — M1-b × M1-c cross path: delivery throws while the search leg is non-zero", () => {
  it("the hold that gets taken already contains the search leg", async () => {
    const hold = llmHoldInternal(args());
    await withLlmBudget(args(), vi.fn().mockResolvedValue({ result: "r", usage: USAGE }));
    expect(mocks.state.reserveRow).toBe(hold);
    expect(hold).toBeGreaterThan(llmHoldInternal(args({ extraHoldInternal: 0 })));
    expect(hold - llmHoldInternal(args({ extraHoldInternal: 0 }))).toBe(EXTRA_HOLD);
  });

  it("control — delivery SUCCEEDS: the merchant pays tokens + the search leg, exactly once", async () => {
    await withLlmBudget(
      args({ commitInSettleTx: async () => {} }),
      vi.fn().mockResolvedValue({ result: "r", usage: USAGE }),
    );
    const expectedCharge = actualCostInternal(USAGE, llmPricesFor(MODEL), MARGIN) + EXTRA_ACTUAL;
    expect(SEED_BALANCE - mocks.state.acct.balance).toBe(expectedCharge);
    expect(mocks.state.acct.reserved).toBe(0);
    expect(mocks.state.finalizer).toBe("SETTLE");
  });

  it("THE GAP — delivery THROWS with a non-zero search leg: the WHOLE hold comes back, search fee included", async () => {
    const boom = new Error("the report write blew up");

    await expect(
      withLlmBudget(
        args({ commitInSettleTx: async () => { throw boom; } }),
        vi.fn().mockResolvedValue({ result: "r", usage: USAGE }),
      ),
    ).rejects.toBe(boom);

    // The money statement, not a spy statement: the merchant is EXACTLY where they started.
    expect(mocks.state.acct.balance, "商家为一份没交付的报告付了钱").toBe(SEED_BALANCE);
    expect(mocks.state.acct.reserved, "预扣没释放 —— 钱被卡住了").toBe(0);
    expect(mocks.state.finalizer).toBe("REFUND");

    // And the settle that rolled back HAD carried the search leg (so the roll-back is what saved it).
    const attempted = mocks.settleCredits.mock.calls.at(0)?.[1] as { actualInternal: number };
    expect(attempted.actualInternal).toBe(actualCostInternal(USAGE, llmPricesFor(MODEL), MARGIN) + EXTRA_ACTUAL);

    // Structural proof the refund can never be shrunk by the extra leg: it is passed NO amount.
    expect(mocks.refundReservation).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.refundReservation.mock.calls[0]![1] as object).sort()).toEqual(["orgId", "refId"]);
  });

  it("THE GAP, worst case — delivery throws when the search leg used the ENTIRE hold budget", async () => {
    const boom = new Error("delivery lost");
    await expect(
      withLlmBudget(
        args({ extraSettleInternal: () => EXTRA_HOLD, commitInSettleTx: async () => { throw boom; } }),
        vi.fn().mockResolvedValue({ result: "r", usage: USAGE }),
      ),
    ).rejects.toBe(boom);
    expect(mocks.state.acct.balance).toBe(SEED_BALANCE);
    expect(mocks.state.acct.reserved).toBe(0);
  });

  it("no double-refund: if a SETTLE had already won the finalizer slot, the catch arm cannot over-refund", async () => {
    const boom = new Error("delivery threw after someone else settled");
    // Simulate a racing finalizer that committed OUTSIDE our rolled-back transaction.
    mocks.refundReservation.mockImplementationOnce(async () => "already-settled");
    await expect(
      withLlmBudget(
        args({ commitInSettleTx: async () => { throw boom; } }),
        vi.fn().mockResolvedValue({ result: "r", usage: USAGE }),
      ),
    ).rejects.toBe(boom);
    // The mocked "already-settled" arm touches nothing — no extra credit is invented.
    expect(mocks.state.acct.balance).toBe(SEED_BALANCE - mocks.state.reserveRow!);
    expect(mocks.state.acct.reserved).toBe(mocks.state.reserveRow!);
  });
});
