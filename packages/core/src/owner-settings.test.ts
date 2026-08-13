/**
 * readSpendCap — the ONE reading of the merchant's spend cap (#524).
 *
 * Until #524 this setting was written and never read: the Settings screen promised Otto would
 * pause a task that went over it, and the charging path did not open the blob. These cases pin
 * the reading itself, so a future edit cannot quietly turn a corrupted ceiling back into
 * "unlimited" — which is the failure mode the ticket exists to close.
 *
 * r1 judge P1-1: the first version read the blob through `mergeSettings`, which DROPS a
 * wrong-typed value and falls back to the default 0 = no cap. A stored `"5"` therefore let
 * every amount through, while a stored `12.5` refused — one threat family, two answers, and
 * the fail-OPEN one was the more likely shape. The suite below is organised as that family:
 * every present-but-invalid shape refuses, and only "never set" reads as no ceiling.
 */
import { describe, it, expect } from "vitest";
import { readSpendCap } from "./owner-settings.js";
import { INTERNAL_PER_DISPLAY } from "./spend.js";

describe("readSpendCap — a cap the merchant really set", () => {
  it("reads a set cap in INTERNAL credits — the unit the ledger charges in", () => {
    expect(readSpendCap({ spendCapCredits: 5 })).toEqual({
      kind: "cap",
      internal: 5 * INTERNAL_PER_DISPLAY,
    });
  });

  it("scales with the pricing unit instead of a hand-written 10", () => {
    expect(readSpendCap({ spendCapCredits: 137 })).toEqual({
      kind: "cap",
      internal: 137 * INTERNAL_PER_DISPLAY,
    });
  });

  it("treats 0 as no cap — exactly what the Settings screen shows as No cap set", () => {
    expect(readSpendCap({ spendCapCredits: 0 })).toEqual({ kind: "none" });
  });
});

describe("readSpendCap — never set is NOT corruption", () => {
  // The one thing fail-closed must never do is stop a merchant who simply has no ceiling.
  it("a workspace that never opened Settings has no cap", () => {
    expect(readSpendCap(null)).toEqual({ kind: "none" });
    expect(readSpendCap(undefined)).toEqual({ kind: "none" });
  });

  it("a settings blob without the key has no cap (every workspace older than the setting)", () => {
    expect(readSpendCap({})).toEqual({ kind: "none" });
    expect(readSpendCap({ autoPublish: true, timezone: "Asia/Kuala_Lumpur" })).toEqual({ kind: "none" });
  });
});

describe("readSpendCap — FAILS CLOSED on every present-but-invalid shape (r1 judge P1-1)", () => {
  // One threat, one answer. These values cannot come from this product's write path
  // (owner-settings-actions.ts rejects them), so reaching any of them means the blob was
  // written by something else — and a ceiling we cannot read must stop spending, not open it.
  const corrupted: [string, unknown][] = [
    ["a numeric string (the fail-OPEN shape r1 shipped)", "5"],
    ["a non-numeric string", "lots"],
    ["an empty string", ""],
    ["a fraction", 12.5],
    ["a negative number", -5],
    ["a negative fraction", -0.5],
    ["an explicitly stored null", null],
    ["a boolean", true],
    ["an object", { amount: 5 }],
    ["an array", [5]],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  for (const [name, value] of corrupted) {
    it(`refuses on ${name}`, () => {
      expect(readSpendCap({ spendCapCredits: value })).toEqual({ kind: "unreadable" });
    });
  }

  it("refuses when the settings blob itself is not an object — the key cannot even be looked up", () => {
    expect(readSpendCap("garbage")).toEqual({ kind: "unreadable" });
    expect(readSpendCap(7)).toEqual({ kind: "unreadable" });
    expect(readSpendCap([{ spendCapCredits: 5 }])).toEqual({ kind: "unreadable" });
  });

  it("never reports a corrupted value as a usable ceiling", () => {
    // The property that matters: no corrupted shape may return kind "cap" or "none".
    for (const [, value] of corrupted) {
      expect(readSpendCap({ spendCapCredits: value }).kind).toBe("unreadable");
    }
  });
});
