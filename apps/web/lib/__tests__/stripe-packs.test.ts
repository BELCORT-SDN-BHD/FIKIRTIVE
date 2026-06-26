import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, packFor, type PackKey } from "@/lib/stripe-packs";

describe("CREDIT_PACKS math", () => {
  const packs = Object.values(CREDIT_PACKS) as (typeof CREDIT_PACKS)[PackKey][];

  it.each(packs)("$key: internalCredits == usd * 100", ({ usd, internalCredits }) => {
    expect(internalCredits).toBe(usd * 100);
  });

  it.each(packs)("$key: displayCredits == usd * 10", ({ usd, displayCredits }) => {
    expect(displayCredits).toBe(usd * 10);
  });
});

describe("packFor", () => {
  it("returns null for an unknown key", () => {
    expect(packFor("99")).toBeNull();
    expect(packFor("")).toBeNull();
    expect(packFor("abc")).toBeNull();
  });

  it("returns the $10 pack for key '10'", () => {
    const pack = packFor("10");
    expect(pack).not.toBeNull();
    expect(pack!.usd).toBe(10);
    expect(pack!.displayCredits).toBe(100);
    expect(pack!.internalCredits).toBe(1000);
    expect(pack!.key).toBe("10");
  });

  it("returns the $25 pack for key '25'", () => {
    const pack = packFor("25");
    expect(pack).not.toBeNull();
    expect(pack!.usd).toBe(25);
  });

  it("returns the $50 pack for key '50'", () => {
    const pack = packFor("50");
    expect(pack).not.toBeNull();
    expect(pack!.usd).toBe(50);
  });
});
