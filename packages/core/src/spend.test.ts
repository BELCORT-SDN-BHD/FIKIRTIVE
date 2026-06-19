import { describe, it, expect } from "vitest";
import { genSpentUsd, refgenSpentUsd, pricedGenCredits, pricedRefgenCredits, displayCredits, CREDITS_PER_USD, INTERNAL_PER_DISPLAY } from "./spend.js";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";

describe("genSpentUsd", () => {
  it("image = flat per-image price × count", () => {
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 1);
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 4);
  });
  it("video = videoPriceUsd with the job's resolved options", () => {
    const vo = { seconds: 5, resolution: "1080p", audio: true };
    expect(genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }))
      .toBe(videoPriceUsd("veo3.1-fast", { seconds: 5, resolution: "1080p", audio: true, count: 1 }));
  });
  it("video with null/partial videoOptions falls back to the model's defaults (never NaN)", () => {
    const v = genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});

describe("refgenSpentUsd", () => {
  it("= flat refgen per-image price × count (its OWN constant, not GEN_PRICE)", () => {
    expect(refgenSpentUsd({ model: "seedream", count: 1 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 1);
    expect(refgenSpentUsd({ model: "seedream", count: 3 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 3);
  });
});

describe("credit pricing (deterministic CHARGE in internal credits; 1 internal = $0.01, 1 displayed = 10 internal)", () => {
  it("image = 1 displayed credit (10 internal) PER image — flat, with margin over the ~$0.04 true cost", () => {
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })).toBe(10);
    expect(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null })).toBe(40);
  });
  it("video = cost rounded UP to the $0.10 displayed unit × 10 (>= true cost, deterministic)", () => {
    const c = pricedGenCredits({ kind: "VIDEO", model: "kling", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } });
    expect(c % INTERNAL_PER_DISPLAY).toBe(0); // whole displayed credits
    expect(c).toBeGreaterThanOrEqual(10);     // at least 1 displayed credit
    // charge must never under-cover the true fal cost
    const usd = genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: { seconds: 5, resolution: "720p", audio: false } });
    expect(displayCredits(c) * 0.1).toBeGreaterThanOrEqual(usd);
  });
  it("refgen = 1 displayed credit per image", () => {
    expect(pricedRefgenCredits({ model: "seedream", count: 1 })).toBe(10);
    expect(pricedRefgenCredits({ model: "seedream", count: 3 })).toBe(30);
  });
  it("displayCredits converts internal→displayed; CREDITS_PER_USD=100", () => {
    expect(displayCredits(2500)).toBe(250);
    expect(CREDITS_PER_USD).toBe(100);
  });
});
