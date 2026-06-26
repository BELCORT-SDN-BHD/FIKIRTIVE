import { describe, it, expect } from "vitest";
import { suggestCategory, isNearDup } from "../memory-suggest";

describe("suggestCategory", () => {
  it("returns null for empty string", () => {
    expect(suggestCategory("")).toBeNull();
    expect(suggestCategory("   ")).toBeNull();
  });

  it("returns null (Brand) for generic brand text", () => {
    expect(suggestCategory("We make handmade candles in Brooklyn")).toBeNull();
    expect(suggestCategory("Founded in 2020, our mission is sustainability")).toBeNull();
  });

  it("detects Voice", () => {
    expect(suggestCategory("We have a warm and friendly tone")).toBe("Voice");
    expect(suggestCategory("Our voice is casual and upbeat")).toBe("Voice");
    expect(suggestCategory("Writing style: approachable")).toBe("Voice");
  });

  it("detects Audience", () => {
    expect(suggestCategory("Our ideal customer is a busy mom")).toBe("Audience");
    expect(suggestCategory("Our audience is small business owners")).toBe("Audience");
    expect(suggestCategory("Target demographic: 25-40 women")).toBe("Audience");
  });

  it("does not flag ordinary copy with 'for'/'who' as Audience", () => {
    expect(suggestCategory("known for our quality")).not.toBe("Audience");
    expect(suggestCategory("we stand for sustainability")).not.toBe("Audience");
  });

  it("detects Rules", () => {
    expect(suggestCategory("Never use the word 'cheap'")).toBe("Rules");
    expect(suggestCategory("Always include a CTA")).toBe("Rules");
    expect(suggestCategory("Don't mention competitors by name")).toBe("Rules");
    expect(suggestCategory("Brand guideline: avoid slang")).toBe("Rules");
  });

  it("detects Products", () => {
    expect(suggestCategory("Our flagship product is the Candle Kit SKU-100")).toBe("Products");
    expect(suggestCategory("Price range: $20–$80")).toBe("Products");
    expect(suggestCategory("We sell hand-poured soy candles")).toBe("Products");
  });

  it("Rules wins over Audience when both match", () => {
    // "always" is a Rules keyword even if text also has "customer"
    expect(suggestCategory("always greet the customer warmly")).toBe("Rules");
  });
});

describe("isNearDup", () => {
  it("returns false for empty text", () => {
    expect(isNearDup("", ["some memory"])).toBe(false);
    expect(isNearDup("   ", ["some memory"])).toBe(false);
  });

  it("returns false when existing list is empty", () => {
    expect(isNearDup("we make candles", [])).toBe(false);
  });

  it("detects exact match (case-insensitive)", () => {
    expect(isNearDup("We Make Candles", ["we make candles"])).toBe(true);
  });

  it("detects exact match after whitespace collapse", () => {
    expect(isNearDup("we  make   candles", ["we make candles"])).toBe(true);
  });

  it("detects needle is substring of hay", () => {
    expect(isNearDup("make candles", ["we make candles in brooklyn"])).toBe(true);
  });

  it("detects hay is substring of needle", () => {
    expect(isNearDup("we make candles in brooklyn", ["make candles"])).toBe(true);
  });

  it("returns false for genuinely different text", () => {
    expect(isNearDup("our brand is modern and sleek", ["we make candles"])).toBe(false);
  });

  it("matches against any entry in the list", () => {
    const existing = ["warm friendly tone", "eco-friendly products"];
    expect(isNearDup("friendly tone", existing)).toBe(true);
    expect(isNearDup("eco-friendly", existing)).toBe(true);
    expect(isNearDup("something completely different", existing)).toBe(false);
  });

  it("does not match a short existing fragment against a longer draft", () => {
    expect(isNearDup("eco-friendly packaging", ["eco"])).toBe(false);
  });
});
