import { describe, expect, it } from "vitest";
import { oneStepFloorInternal, turnBudgetInternal } from "./otto-budget.js";

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
