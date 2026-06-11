import { createGenerationProvider } from "@artlio/generation";

/** Worker's generation provider — mock by default ($0, offline), fal when
 *  GENERATION_PROVIDER=fal + FAL_KEY are set (prod, real money). */
export const provider = createGenerationProvider();
