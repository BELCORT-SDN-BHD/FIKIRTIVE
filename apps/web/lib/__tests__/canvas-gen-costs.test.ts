import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_DEFAULT_COUNT,
  CANVAS_IMAGE_MAX_VARIANT_COUNT,
  canvasGenCostQuote,
  clampImageVariantCount,
} from "../canvas-gen-costs";

describe("canvasGenCostQuote", () => {
  it("quotes the default single image and one video at core pricing", () => {
    const quote = canvasGenCostQuote({ image: "seedream", video: "seedance-2-fast" });

    expect(CANVAS_IMAGE_DEFAULT_COUNT).toBe(1);
    expect(CANVAS_IMAGE_MAX_VARIANT_COUNT).toBe(4);
    expect(quote.imageCredits).toBe(1);
    expect(quote.videoCredits).toBe(8);
  });
});

describe("clampImageVariantCount", () => {
  it("defaults to 1, floors to a whole number, and never leaves [1, MAX]", () => {
    expect(clampImageVariantCount(1)).toBe(1);
    expect(clampImageVariantCount(3)).toBe(3);
    expect(clampImageVariantCount(4)).toBe(4);
    expect(clampImageVariantCount(9)).toBe(4); // capped at MAX
    expect(clampImageVariantCount(0)).toBe(1); // floored up to 1
    expect(clampImageVariantCount(-2)).toBe(1);
    expect(clampImageVariantCount(2.7)).toBe(2); // whole number
    expect(clampImageVariantCount(Number.NaN)).toBe(1);
  });
});
