import { describe, it, expect } from "vitest";
import { packTotalCredits, canAffordPack } from "../../components/otto/pack-credit-math";

describe("packTotalCredits", () => {
  it("sums the guaranteed per-card credits", () => {
    const cards = [
      { payload: { estimatedCredits: 5 } },
      { payload: { estimatedCredits: 3 } },
      { payload: { estimatedCredits: 2 } },
    ];
    expect(packTotalCredits(cards)).toBe(10);
  });

  it("returns 0 for an empty pack", () => {
    expect(packTotalCredits([])).toBe(0);
  });

  // #580 复审 r2 P1-3 —— 以下每一条,修复前都会得到一个猜出来的数字。
  it("只有记账用的 USD → 没有可担保的总价(不再除以 0.1 猜)", () => {
    expect(packTotalCredits([{ payload: { estimatedPriceUsd: 0.5 } }])).toBeNull();
    expect(packTotalCredits([{ payload: { estimatedPriceUsd: 0.15 } }])).toBeNull();
  });

  it("空 payload 不再被当成 1 credit", () => {
    expect(packTotalCredits([{ payload: {} }])).toBeNull();
  });

  it("一张卡担保不住,整包就没有总价 —— 漏算等于低报花费", () => {
    expect(
      packTotalCredits([{ payload: { estimatedCredits: 5 } }, { payload: { estimatedPriceUsd: 0.3 } }]),
    ).toBeNull();
  });

  it("0 / 负数 / 小数 credits 都不是可担保价格", () => {
    expect(packTotalCredits([{ payload: { estimatedCredits: 0 } }])).toBeNull();
    expect(packTotalCredits([{ payload: { estimatedCredits: -2 } }])).toBeNull();
    expect(packTotalCredits([{ payload: { estimatedCredits: 2.5 } }])).toBeNull();
  });

  it("字段读不全的卡也拖住整包 —— 单卡不许批准,整包更不许", () => {
    expect(
      packTotalCredits([{ payload: { estimatedCredits: 5, params: "16:9" } }]),
    ).toBeNull();
  });

  it("根本不是 payload 的东西没有价格", () => {
    expect(packTotalCredits([{ payload: null }])).toBeNull();
    expect(packTotalCredits([{ payload: "card" }])).toBeNull();
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

  it("does not under-count on float-imprecise balances (F10)", () => {
    // 0.3 / 0.1 === 2.9999999999999996 in IEEE-754 → naive Math.floor = 2, undercounts.
    // $0.30 is exactly 3 credits and must afford a 3-credit pack.
    expect(canAffordPack(3, 0.3)).toBe(true);
    // $0.70 is exactly 7 credits (0.7/0.1 === 6.999999999999999 naively).
    expect(canAffordPack(7, 0.7)).toBe(true);
    // Still correctly rejects the next credit up.
    expect(canAffordPack(4, 0.3)).toBe(false);
    expect(canAffordPack(8, 0.7)).toBe(false);
  });
});
