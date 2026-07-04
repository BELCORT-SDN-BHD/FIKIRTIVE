import { describe, expect, it } from "vitest";
import { CANVAS_IMAGE_VARIANT_COUNT, canvasGenCostQuote } from "../canvas-gen-costs";

describe("canvasGenCostQuote", () => {
  it("quotes the same displayed credits as the core generation pricing", () => {
    const quote = canvasGenCostQuote({ image: "seedream", video: "seedance-2-fast" });

    expect(CANVAS_IMAGE_VARIANT_COUNT).toBe(4);
    expect(quote.imageCredits).toBe(4);
    expect(quote.videoCredits).toBe(7);
  });
});
