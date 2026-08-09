import { describe, expect, it } from "vitest";
import {
  oneStepFloorInternal,
  turnBudgetInternal,
  OTTO_MAX_STEPS,
  OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
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
