import { createGenerationProvider } from "@fikirtive/generation";

/** Worker's generation provider — mock by default ($0, offline); byteplus when
 *  GENERATION_PROVIDER=byteplus + BYTEPLUS_API_KEY are set (prod, real money — the
 *  only paid provider, ADR 0003). */
export const provider = createGenerationProvider();
