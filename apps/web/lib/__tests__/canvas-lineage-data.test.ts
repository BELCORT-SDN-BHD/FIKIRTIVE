import { describe, expect, it } from "vitest";
import { netChargedInternalCredits } from "../canvas-lineage-data";

describe("netChargedInternalCredits", () => {
  it("reads a settled generation as the amount it really cost", () => {
    // A finished job: RESERVE holds the credits, SETTLE closes the hold at the same amount.
    expect(netChargedInternalCredits([
      { balanceDelta: -10 },
      { balanceDelta: 0 },
    ])).toBe(10);
  });

  it("reads a refunded failure as no charge, not as a charge", () => {
    expect(netChargedInternalCredits([
      { balanceDelta: -80 },
      { balanceDelta: 80 },
    ])).toBe(0);
  });

  it("reads a job that has only reserved so far at the held amount", () => {
    expect(netChargedInternalCredits([{ balanceDelta: -40 }])).toBe(40);
  });

  it("has no rows to fold for a job that never touched the ledger", () => {
    expect(netChargedInternalCredits([])).toBe(0);
  });
});
