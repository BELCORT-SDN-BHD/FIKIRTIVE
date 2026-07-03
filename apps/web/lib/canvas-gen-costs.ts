import { displayCredits, pricedGenCredits } from "@fikirtive/core";

export const CANVAS_IMAGE_VARIANT_COUNT = 4;

export type CanvasGenCostQuote = {
  imageCredits: number;
  videoCredits: number;
};

export function canvasGenCostQuote(models: { image: string; video: string }): CanvasGenCostQuote {
  return {
    imageCredits: displayCredits(
      pricedGenCredits({
        kind: "IMAGE",
        model: models.image,
        count: CANVAS_IMAGE_VARIANT_COUNT,
        videoOptions: null,
      }),
    ),
    videoCredits: displayCredits(
      pricedGenCredits({
        kind: "VIDEO",
        model: models.video,
        count: 1,
        videoOptions: null,
      }),
    ),
  };
}
