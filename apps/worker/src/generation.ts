import { createGenerationProvider } from "@fikirtive/generation";

/**
 * Worker's generation provider — the ONE production call site of the factory, resolved once at
 * import time from `process.env`.
 *
 * Three outcomes, and "default" is no longer one of them (C1b ①):
 *   - `GENERATION_PROVIDER=byteplus` + `BYTEPLUS_API_KEY` → the paid engine (prod, real money —
 *     the only paid provider, ADR 0003).
 *   - `GENERATION_PROVIDER=mock` OUTSIDE PRODUCTION → the offline stand-in ($0, no network).
 *     Dev, CI and the tracer scripts ask for this BY NAME.
 *   - anything else, and IN PRODUCTION everything that is not `byteplus` — unset, `mock`, a typo
 *     — → `UnconfiguredProvider`, which REFUSES every generation and lets the worker's terminal
 *     branch refund the merchant's hold. Outside production the same settings still resolve to
 *     the mock, so dev and CI need no setting at all.
 *
 * RELY-A3 (Founder 2026-09-12, #1359 場②) is why `mock` lost its production exemption: the
 * merchant cannot tell a deploy that chose the stand-in from one that inherited the old sample
 * value, and both hand over swatches and settle the charge. See docs/specs/fail-closed-reliability.md.
 *
 * The comment here used to read "mock by default ($0, offline)", and that default was the defect:
 * a production deploy that lost this variable did not fail, it silently delivered solid-colour
 * stand-ins as merchants' generations and settled the charge. See `createGenerationProvider` in
 * packages/generation/src/index.ts for the full account.
 */
export const provider = createGenerationProvider();
