import { CREDITS_PER_USD } from "./spend.js";

/** Max context tokens Otto can consume in one LLM step. */
export const OTTO_CONTEXT_CAP_TOKENS = 12_000;
/** Max output tokens Otto can emit in one LLM step. */
export const OTTO_OUTPUT_CAP_TOKENS = 1_500;
/** Max LLM steps per user turn. */
export const OTTO_MAX_STEPS = 10;

/**
 * Worst-case internal-credit cost for a single Otto LLM step, rounded up.
 * "Floor" in the sense of a minimum reserve — never under-reserves.
 *
 * DELIBERATELY prompt-cache-UNAWARE (engine spec §2.4): the reserve is a worst-case floor
 * and must never assume a cache hit — a cold cache (first step, expired 5-min TTL, or
 * OTTO_PROMPT_CACHE off) pays full input price, so pricing the reserve at cached rates
 * would under-reserve exactly when the cache misses. Fail-safe direction: reserve ≥ actual,
 * settleCredits clamps and refunds the difference. Do NOT add cache terms here.
 *
 * Formula:
 *   oneStepMaxUsd = OTTO_CONTEXT_CAP_TOKENS * prices.inputPerToken
 *                 + OTTO_OUTPUT_CAP_TOKENS  * prices.outputPerToken
 *   result = ceil( oneStepMaxUsd * margin * CREDITS_PER_USD )
 */
export function oneStepFloorInternal(
  prices: { inputPerToken: number; outputPerToken: number },
  margin: number,
): number {
  const oneStepMaxUsd =
    OTTO_CONTEXT_CAP_TOKENS * prices.inputPerToken +
    OTTO_OUTPUT_CAP_TOKENS * prices.outputPerToken;
  return Math.ceil(oneStepMaxUsd * margin * CREDITS_PER_USD);
}

/**
 * Worst-case internal-credit budget for a full user turn (all steps).
 * = oneStepFloorInternal(prices, margin) * maxSteps
 */
export function turnBudgetInternal(
  prices: { inputPerToken: number; outputPerToken: number },
  margin: number,
  maxSteps: number,
): number {
  return oneStepFloorInternal(prices, margin) * maxSteps;
}
