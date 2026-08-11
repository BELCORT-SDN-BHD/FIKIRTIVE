/**
 * readSpendCap — the ONE reading of the merchant's spend cap (#524).
 *
 * Until #524 this setting was written and never read: the Settings screen promised Otto would
 * pause a task that went over it, and the charging path did not open the blob. These cases pin
 * the reading itself, so a future edit cannot quietly turn a corrupted ceiling back into
 * "unlimited" — which is the failure mode the ticket exists to close.
 */
import { describe, it, expect } from "vitest";
import { readSpendCap } from "./owner-settings.js";
import { INTERNAL_PER_DISPLAY } from "./spend.js";

describe("readSpendCap", () => {
  it("reads a set cap in INTERNAL credits — the unit the ledger charges in", () => {
    expect(readSpendCap({ spendCapCredits: 5 })).toEqual({
      kind: "cap",
      internal: 5 * INTERNAL_PER_DISPLAY,
    });
  });

  it("treats 0 as no cap — exactly what the Settings screen shows as No cap set", () => {
    expect(readSpendCap({ spendCapCredits: 0 })).toEqual({ kind: "none" });
  });

  it("treats a workspace that never opened Settings as no cap", () => {
    expect(readSpendCap(null)).toEqual({ kind: "none" });
    expect(readSpendCap(undefined)).toEqual({ kind: "none" });
    expect(readSpendCap({})).toEqual({ kind: "none" });
  });

  it("FAILS CLOSED on a value that is not a whole number of credits — never reads as unlimited", () => {
    // The write path rejects all of these, so reaching them means the blob was written by
    // something that is not this product. A corrupted ceiling must stop spending, not open it.
    expect(readSpendCap({ spendCapCredits: 12.5 })).toEqual({ kind: "unreadable" });
    expect(readSpendCap({ spendCapCredits: -5 })).toEqual({ kind: "unreadable" });
  });

  it("falls back to no cap when the stored value is the WRONG TYPE, matching mergeSettings", () => {
    // A wrong-typed key is dropped by mergeSettings before this function ever sees it, so the
    // workspace reads as one that never set a cap. Pinned so the two layers cannot disagree.
    expect(readSpendCap({ spendCapCredits: "lots" })).toEqual({ kind: "none" });
  });

  it("scales with the pricing unit instead of a hand-written 10", () => {
    const cap = readSpendCap({ spendCapCredits: 137 });
    expect(cap).toEqual({ kind: "cap", internal: 137 * INTERNAL_PER_DISPLAY });
  });
});
