import { createGenerationProvider } from "@fikirtive/generation";

/**
 * Worker's generation provider — the ONE production call site of the factory, resolved once at
 * import time from `process.env`.
 *
 * Three outcomes, and "default" is no longer one of them (C1b ①):
 *   - `GENERATION_PROVIDER=byteplus` + `BYTEPLUS_API_KEY` → the paid engine (prod, real money —
 *     the only paid provider, ADR 0003).
 *   - `GENERATION_PROVIDER=mock` → the offline stand-in ($0, no network). Dev, CI and the tracer
 *     scripts ask for this BY NAME.
 *   - anything else IN PRODUCTION → `UnconfiguredProvider`, which REFUSES every generation and
 *     lets the worker's terminal branch refund the merchant's hold. Outside production the same
 *     absence still resolves to the mock, so dev and CI need no setting at all.
 *
 * The comment here used to read "mock by default ($0, offline)", and that default was the defect:
 * a production deploy that lost this variable did not fail, it silently delivered solid-colour
 * stand-ins as merchants' generations and settled the charge. See `createGenerationProvider` in
 * packages/generation/src/index.ts for the full account.
 */
export const provider = createGenerationProvider();
