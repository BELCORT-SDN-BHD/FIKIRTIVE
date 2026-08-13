import { describe, it, expect } from "vitest";
import { formatCredits, creditsLabel, spendCapBlockedMessage } from "../credit-format";

describe("formatCredits", () => {
  it("keeps up to 1 decimal for sub-1000 balances (fractional credits are real signal)", () => {
    expect(formatCredits(42.3)).toBe("42.3");
    expect(formatCredits(0.4)).toBe("0.4");
    expect(formatCredits(999.95)).toBe("1,000"); // rounds to 1 decimal (1000.0) → integer branch
  });

  it("shows a clean whole number for integer sub-1000 balances", () => {
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(12)).toBe("12");
    expect(formatCredits(500)).toBe("500");
  });

  it("keeps the same 1-decimal precision at 1000+ — grouping never changes the amount (#521)", () => {
    expect(formatCredits(1234567.3)).toBe("1,234,567.3");
    expect(formatCredits(1234.6)).toBe("1,234.6"); // used to silently become "1,235"
    expect(formatCredits(1000.1)).toBe("1,000.1");
    expect(formatCredits(999.99)).toBe("1,000"); // rounds to 1 decimal (1000.0) → integer branch
  });

  it("handles negative deltas (spend) with the same magnitude rule", () => {
    expect(formatCredits(-11.6)).toBe("-11.6");
    expect(formatCredits(-1234.6)).toBe("-1,234.6"); // real amount preserved, not rounded to -1,235
  });

  it("uses a fixed locale so server and client never disagree", () => {
    // en-US thousands separator regardless of the runtime's default locale.
    expect(formatCredits(12345)).toBe("12,345");
  });
});

describe("creditsLabel", () => {
  it("singularizes exactly 1 credit", () => {
    expect(creditsLabel(1)).toBe("1 credit");
  });
  it("pluralizes everything else, including fractional and zero", () => {
    expect(creditsLabel(0)).toBe("0 credits");
    expect(creditsLabel(0.4)).toBe("0.4 credits");
    expect(creditsLabel(20)).toBe("20 credits");
    expect(creditsLabel(12345)).toBe("12,345 credits");
  });
});

// #524 — the sentence a merchant reads when their OWN cap stopped an action. The whole point
// of the ticket is that the product's words and the charging path agree, so the words are
// pinned: both real numbers, and the exit is the setting they can move, never a top-up.
describe("spendCapBlockedMessage", () => {
  it("names what the action needed, what the cap is, and where the cap lives", () => {
    expect(spendCapBlockedMessage(11, 5)).toBe(
      "Paused by your spend cap — this needs 11 credits and your cap is 5 credits per action. Raise the cap in Settings to run it.",
    );
  });

  it("never sends a capped merchant to Billing — they are not short of credits", () => {
    const message = spendCapBlockedMessage(11, 5);
    expect(message).not.toMatch(/top up|billing/i);
  });

  it("singularizes a 1-credit cap like every other credit amount", () => {
    expect(spendCapBlockedMessage(2, 1)).toContain("your cap is 1 credit per action");
  });

  it("says so plainly when the cap could not be read, and confirms nothing was charged", () => {
    expect(spendCapBlockedMessage(11, null)).toBe(
      "Paused — your spend cap couldn't be read, so nothing was charged. Try again in a moment.",
    );
  });
});
