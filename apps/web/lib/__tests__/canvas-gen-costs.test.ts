import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_DEFAULT_COUNT,
  CANVAS_IMAGE_MAX_VARIANT_COUNT,
  canvasGenCostQuote,
  clampImageVariantCount,
  genCostHint,
} from "../canvas-gen-costs";

describe("canvasGenCostQuote", () => {
  it("uses the exact server-supplied quote for one image and one video", () => {
    const quote = canvasGenCostQuote({ imageCredits: 1, videoCredits: 8 });

    expect(CANVAS_IMAGE_DEFAULT_COUNT).toBe(1);
    expect(CANVAS_IMAGE_MAX_VARIANT_COUNT).toBe(4);
    expect(quote.imageCredits).toBe(1);
    expect(quote.videoCredits).toBe(8);
  });

  it("quotes the selected image variant count after applying the 1-4 clamp", () => {
    const serverQuote = { imageCredits: 2, videoCredits: 9 };
    expect(canvasGenCostQuote(serverQuote, 3)).toEqual({ imageCredits: 6, videoCredits: 9 });
    expect(canvasGenCostQuote(serverQuote, 99)).toEqual({ imageCredits: 8, videoCredits: 9 });
  });

  it("prices every batch size the composer offers at exactly what the paid call approves", () => {
    // #547 A2: the composer can now ask for up to four images. The label beside Generate and
    // the credits the paid call approves are both `unit x clamp(count)`, so a merchant can
    // never be shown one price and charged another.
    const serverQuote = { imageCredits: 1, videoCredits: 8 };
    for (let count = 1; count <= CANVAS_IMAGE_MAX_VARIANT_COUNT; count += 1) {
      expect(canvasGenCostQuote(serverQuote, count).imageCredits)
        .toBe(serverQuote.imageCredits * clampImageVariantCount(count));
    }
  });
});

describe("genCostHint", () => {
  it("prices a pre-flight canvas action from the server quote alone (#550 ②)", () => {
    expect(genCostHint(8)).toBe("Cost: 8 credits");
    expect(genCostHint(1)).toBe("Cost: 1 credit");
    expect(genCostHint(11.6)).toBe("Cost: 11.6 credits");
    expect(genCostHint(1200)).toBe("Cost: 1,200 credits");
  });

  it("says it is still checking rather than inventing a price before the quote lands", () => {
    expect(genCostHint(undefined)).toBe("Checking cost…");
    expect(genCostHint(null)).toBe("Checking cost…");
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
