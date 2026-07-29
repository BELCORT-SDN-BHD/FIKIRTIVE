import { describe, it, expect } from "vitest";
import { formatCredits, creditsLabel } from "../credit-format";

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

  it("denoises 1000+ balances to a whole credit — no decimal clutter (§C5/#15)", () => {
    expect(formatCredits(1234567.3)).toBe("1,234,567");
    expect(formatCredits(1000.1)).toBe("1,000");
    expect(formatCredits(999.99)).toBe("1,000"); // sub-1000 branch rounds up to 1000 first (still whole)
  });

  it("handles negative deltas (spend) with the same magnitude rule", () => {
    expect(formatCredits(-11.6)).toBe("-11.6");
    expect(formatCredits(-1234.6)).toBe("-1,235");
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
