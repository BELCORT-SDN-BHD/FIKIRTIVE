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

export function canvasImageCostCredits(model: string, count = CANVAS_IMAGE_DEFAULT_COUNT): number {
  return displayCredits(
    pricedGenCredits({
      kind: "IMAGE",
      model,
      count: clampImageVariantCount(count),
      videoOptions: null,
    }),
  );
}

export function canvasVideoCostCredits(model: string): number {
  return displayCredits(
    pricedGenCredits({
      kind: "VIDEO",
      model,
      count: 1,
      videoOptions: null,
    }),
  );
}

export function canvasGenCostQuote(
  models: { image: string; video: string; imageCredits?: number; videoCredits?: number },
  imageCount = CANVAS_IMAGE_DEFAULT_COUNT,
): CanvasGenCostQuote {
  return {
    imageCredits: typeof models.imageCredits === "number"
      ? models.imageCredits * clampImageVariantCount(imageCount)
      : canvasImageCostCredits(models.image, imageCount),
    videoCredits: typeof models.videoCredits === "number"
      ? models.videoCredits
      : canvasVideoCostCredits(models.video),
  };
}
