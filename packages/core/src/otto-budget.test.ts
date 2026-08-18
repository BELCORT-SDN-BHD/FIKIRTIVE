import { describe, expect, it } from "vitest";
import {
  oneStepFloorInternal,
  turnBudgetInternal,
  OTTO_MAX_STEPS,
  OTTO_CONVERSATION_TURN_MARGIN,
  OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
  OTTO_CHAT_MIN_START_INTERNAL,
} from "./otto-budget.js";
import { displayCredits, SIGNUP_GRANT_CREDITS } from "./spend.js";
import { llmPricesFor, OTTO_LLM_MARGIN_DEFAULT } from "./llm-prices.js";

describe("oneStepFloorInternal", () => {
  it("floor math, no 10× display/internal error (Sonnet-ish prices, margin=3)", () => {
    // 12000*15e-6 + 1500*75e-6 = 0.2925 USD; *3 = 0.8775; *100 = 87.75; ceil = 88
    expect(oneStepFloorInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3)).toBe(88);
  });

  it("Opus-ish prices, margin=3 — proves not hardcoded", () => {
    // 12000*5e-6 + 1500*25e-6 = 0.06 + 0.0375 = 0.0975; *3 = 0.2925; *100 = 29.25; ceil = 30
    expect(oneStepFloorInternal({ inputPerToken: 5e-6, outputPerToken: 25e-6 }, 3)).toBe(30);
  });

  it("margin=1 sanity (no markup)", () => {
    // 12000*5e-6 + 1500*25e-6 = 0.0975; *1 = 0.0975; *100 = 9.75; ceil = 10
    expect(oneStepFloorInternal({ inputPerToken: 5e-6, outputPerToken: 25e-6 }, 1)).toBe(10);
  });
});

describe("turnBudgetInternal", () => {
  it("turn budget = maxSteps * floor (Sonnet-ish prices, margin=3, maxSteps=10)", () => {
    expect(turnBudgetInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3, 10)).toBe(880);
  });
});

// Founder ruling 2026-08-18 — chat replies stop consuming credits; credits are spent on
// generation only. The whole of that ruling is this one multiplier.
describe("OTTO_CONVERSATION_TURN_MARGIN (chat is free)", () => {
  it("is 0 — a conversation turn is priced at nothing", () => {
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBe(0);
  });

  it("zeroes the HOLD at live prices: the worst case a turn could hold comes out 0", () => {
    // The same call the meter makes (llmHoldInternal → turnBudgetInternal) with the chat price.
    expect(
      turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS),
    ).toBe(0);
    // …and 0 is what makes it free downstream: reserveCredits no-ops on cost <= 0, so no
    // RESERVE row is written and settle/refund then find no reservation to act on.
    expect(turnBudgetInternal(llmPricesFor("claude-opus-4-8"), OTTO_CONVERSATION_TURN_MARGIN, 1)).toBe(0);
  });

  it("zeroes the CHARGE for any usage — a long turn is as free as a short one", () => {
    // oneStepFloorInternal shares the arithmetic actualCostInternal uses (cost × margin × 100).
    expect(oneStepFloorInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN)).toBe(0);
  });

  it("leaves GENERATION pricing alone — the generation markup is untouched", () => {
    // The ruling moved chat only. A shared margin would have quietly re-priced every image
    // and video with it.
    expect(OTTO_LLM_MARGIN_DEFAULT).toBe(2.0);
    expect(OTTO_CONVERSATION_TURN_MARGIN).not.toBe(OTTO_LLM_MARGIN_DEFAULT);
  });
});

describe("OTTO_CONVERSATION_TURN_RESERVE_INTERNAL (#543 conversation-turn hold cap)", () => {
  it("is 40 internal credits = 4 displayed credits", () => {
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBe(40);
    expect(displayCredits(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL)).toBe(4);
  });

  it("caps the 120-internal worst case a live conversation turn used to hold", () => {
    // Live values: sonnet prices, the default 2.0x margin, OTTO_MAX_STEPS steps.
    const worstCase = turnBudgetInternal(
      llmPricesFor("claude-sonnet-4-6"),
      OTTO_LLM_MARGIN_DEFAULT,
      OTTO_MAX_STEPS,
    );
    expect(worstCase).toBe(120);
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeLessThan(worstCase);
  });

  it("stays above the measured single-turn peak (33 internal / 3.3 displayed)", () => {
    expect(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL).toBeGreaterThan(33);
  });

  it("leaves the signup grant able to fund more than one conversation turn", () => {
    // #791-3: cite the grant instead of a copy of it — 250 internal / 40 internal hold = 6
    // concurrent-hold turns (at the pre-#543 hold of 120 it was 1). Reading the constant is
    // the point: the hold and the grant can only be judged against each other.
    expect(
      Math.floor(SIGNUP_GRANT_CREDITS / OTTO_CONVERSATION_TURN_RESERVE_INTERNAL),
    ).toBeGreaterThanOrEqual(5);
  });
});

// #898 (Founder 2026-08-13, formal correction to #543) — the hold stopped being the door.
describe("OTTO_CHAT_MIN_START_INTERNAL (#898 chat entry gate)", () => {
  it("is 10 internal credits = 1 displayed credit", () => {
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBe(10);
    expect(displayCredits(OTTO_CHAT_MIN_START_INTERNAL)).toBe(1);
  });

  it("lets a merchant on 3.9 credits start a message — the case #898 was opened for", () => {
    // The old gate was the hold itself, so 39 internal < 40 internal meant "no". The gate is
    // now the minimum, and the hold shrinks to whatever the balance can cover.
    const balance = 39;
    expect(balance).toBeGreaterThanOrEqual(OTTO_CHAT_MIN_START_INTERNAL);
    expect(balance).toBeLessThan(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
    expect(Math.min(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, balance)).toBe(39);
  });

  it("is a real floor, not zero — a PRICED turn must not fall through to free chat", () => {
    // reserveCredits no-ops on cost <= 0: a hold that rounded to nothing would meter nothing.
    // (Chat is free today by DECISION — OTTO_CONVERSATION_TURN_MARGIN — and the composition
    // root drops this minimum entirely while it is. This pins the other case: if chat is ever
    // priced again, the floor it comes back with must be a real one, not an accidental 0.)
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBeGreaterThan(0);
    expect(Math.min(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, OTTO_CHAT_MIN_START_INTERNAL)).toBeGreaterThan(0);
  });

  it("never exceeds the hold ceiling — the gate can only be at or below what is held", () => {
    expect(OTTO_CHAT_MIN_START_INTERNAL).toBeLessThanOrEqual(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
  });

  it("bounds the platform's per-message exposure to the measured peak minus the gate", () => {
    // Worst realistic case: a merchant at exactly the gate sends the cold-cache opening
    // message, measured at 33 internal (#536). The clamp absorbs 33 - 10 = 23 internal
    // (2.3 displayed) — bounded, and recorded on the SETTLE row.
    const MEASURED_PEAK_INTERNAL = 33;
    expect(MEASURED_PEAK_INTERNAL - OTTO_CHAT_MIN_START_INTERNAL).toBeLessThanOrEqual(23);
  });
});
