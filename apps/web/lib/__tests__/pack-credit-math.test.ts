import { describe, it, expect } from "vitest";
import { packTotalCredits, canAffordPack } from "../../components/otto/pack-credit-math";

describe("packTotalCredits", () => {
  it("sums multiple cards correctly", () => {
    const cards = [
      { payload: { estimatedPriceUsd: 0.5 } },
      { payload: { estimatedPriceUsd: 0.3 } },
      { payload: { estimatedPriceUsd: 0.2 } },
    ];
    // 0.5/0.1 = 5, 0.3/0.1 = 3, 0.2/0.1 = 2 → 5+3+2 = 10
    expect(packTotalCredits(cards)).toBe(10);
  });

  it("converts USD to credits at 0.1 rate with ceiling", () => {
    const cards = [{ payload: { estimatedPriceUsd: 0.15 } }];
    // 0.15/0.1 = 1.5 → ceil = 2
    expect(packTotalCredits(cards)).toBe(2);
  });

  it("uses estimatedCredits when present (overrides USD conversion)", () => {
    const cards = [{ payload: { estimatedCredits: 5, estimatedPriceUsd: 0.5 } }];
    // Should use estimatedCredits (5), not convert 0.5
    expect(packTotalCredits(cards)).toBe(5);
  });

  it("returns 0 for empty pack", () => {
    expect(packTotalCredits([])).toBe(0);
  });

  it("treats missing estimatedPriceUsd as 0", () => {
    const cards = [{ payload: {} }];
    // Math.max(1, ceil(0/0.1)) = max(1, 0) = 1 (minimum 1 credit per card)
    expect(packTotalCredits(cards)).toBe(1);
  });

  it("enforces minimum 1 credit per card", () => {
    const cards = [{ payload: { estimatedPriceUsd: 0 } }];
    expect(packTotalCredits(cards)).toBe(1);
  });

  it("handles rounding for fractional USD values", () => {
    const cards = [
      { payload: { estimatedPriceUsd: 0.05 } }, // 0.05/0.1 = 0.5 → ceil = 1
      { payload: { estimatedPriceUsd: 0.11 } }, // 0.11/0.1 = 1.1 → ceil = 2
    ];
    expect(packTotalCredits(cards)).toBe(1 + 2); // 3
  });
});

describe("canAffordPack", () => {
  it("returns true when balance exactly matches pack cost", () => {
    expect(canAffordPack(10, 1.0)).toBe(true); // 10 credits = $1.0, exact match
  });

  it("returns true when balance exceeds pack cost", () => {
    expect(canAffordPack(10, 1.5)).toBe(true); // 10 credits vs $1.50 balance
  });

  it("returns false when balance less than pack cost", () => {
    expect(canAffordPack(10, 0.5)).toBe(false); // 10 credits > $0.50 balance
  });

  it("returns false when pack is just barely unaffordable", () => {
    expect(canAffordPack(11, 1.0)).toBe(false); // 11 credits > floor($1.0 / 0.1) = 10
  });

  it("uses floor division (not ceiling) for balance conversion", () => {
    const balanceUsd = 1.05; // floor(1.05/0.1) = floor(10.5) = 10 credits
    expect(canAffordPack(10, balanceUsd)).toBe(true);
    expect(canAffordPack(11, balanceUsd)).toBe(false);
  });

  it("returns true for zero-credit pack (free)", () => {
    expect(canAffordPack(0, 0.0)).toBe(true);
  });

  it("handles zero balance", () => {
    expect(canAffordPack(0, 0.0)).toBe(true);
    expect(canAffordPack(1, 0.0)).toBe(false);
  });

  it("handles large balances", () => {
    expect(canAffordPack(1000, 100.0)).toBe(true); // 1000 credits = $100
    expect(canAffordPack(1001, 100.0)).toBe(false);
  });
});
