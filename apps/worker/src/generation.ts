import { createGenerationProvider } from "@fikirtive/generation";

/** Worker's generation provider — mock by default ($0, offline); byteplus when
 *  GENERATION_PROVIDER=byteplus + BYTEPLUS_API_KEY are set (prod, real money);
 *  fal when GENERATION_PROVIDER=fal + FAL_KEY are set (legacy fallback, real money). */
export const provider = createGenerationProvider();
