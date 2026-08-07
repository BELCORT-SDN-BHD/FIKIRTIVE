/**
 * credit-direction.test — the word "charge" is decided here, so it is pinned here (#684).
 *
 * Judge r1 P2③: before this, no test referenced the judgment directly — the copy tests read
 * rendered markup, and the "negative amount but the hold is still open" branch had no test at
 * all, so flipping it to "charge" stayed green while the merchant got told they had spent
 * money they had not. Every branch is named below, and both consumers (apps/web's
 * spendDirectionOf/countCharges, packages/otto's summariseSpending) are thin adapters over it.
 */
import { describe, it, expect } from "vitest";
import { creditDirection } from "./credit-direction.js";

describe("creditDirection", () => {
  it("calls a settled deduction a charge", () => {
    expect(creditDirection(-3, false)).toBe("charge");
    expect(creditDirection(-0.1, false)).toBe("charge");
  });

  it("calls an OPEN hold a hold — a reservation ceiling is not money spent", () => {
    expect(creditDirection(-12, true)).toBe("hold");
  });

  it("calls a top-up or a grant an addition, never a charge", () => {
    expect(creditDirection(500, false)).toBe("addition");
    expect(creditDirection(20, false)).toBe("addition");
  });

  it("calls a hold that came back in full unchanged — no money moved", () => {
    expect(creditDirection(0, false)).toBe("unchanged");
    expect(creditDirection(0, true)).toBe("unchanged");
  });

  it("never calls anything that ADDED credits a charge, pending or not", () => {
    for (const pending of [true, false]) {
      expect(creditDirection(1, pending)).not.toBe("charge");
      expect(creditDirection(0.1, pending)).not.toBe("charge");
    }
  });
});
