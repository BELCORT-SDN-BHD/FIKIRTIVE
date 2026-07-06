import { displayCredits, pricedGenCredits } from "@fikirtive/core/spend";

/** Founder decision (2026-07-06): one image per canvas generation by default; the
 *  owner requests more variants explicitly, up to the max. */
export const CANVAS_IMAGE_DEFAULT_COUNT = 1;
/** Hard cap on image variants per generation (MAX_GEN_COUNT). The spend gate rejects
 *  more and the charge scales by count. */
export const CANVAS_IMAGE_MAX_VARIANT_COUNT = 4;

/** Clamp a requested image-variant count to a whole number in [1, MAX]. Defensive:
 *  the server `genRequest` gate caps too, but the client must never send junk/over-cap. */
export function clampImageVariantCount(count: number): number {
  if (!Number.isFinite(count)) return CANVAS_IMAGE_DEFAULT_COUNT;
  return Math.max(1, Math.min(CANVAS_IMAGE_MAX_VARIANT_COUNT, Math.floor(count)));
}

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
        count: CANVAS_IMAGE_DEFAULT_COUNT,
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
