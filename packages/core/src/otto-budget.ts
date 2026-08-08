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

/**
 * The HOLD a single Otto CONVERSATION turn places on the balance, in INTERNAL credits.
 * 40 internal = 4 displayed credits.
 *
 * #543 Founder decision (2026-07-31). The derived worst case above assumes every one of
 * OTTO_MAX_STEPS steps burns the full context and output cap, which at live sonnet prices
 * and the 2.0× margin is 120 internal — 12 displayed credits held on every turn. With a
 * 20-credit welcome grant of the day (25 since #791) that hold is the thing that strands the
 * last credits: a merchant with 11 credits left cannot start a turn at all. 40 internal is still comfortably above
 * the measured single-turn peak (33 internal / 3.3 displayed), so it is a cap on the HOLD,
 * not a change to what a turn costs.
 *
 * Scope: the conversation turn only (runtime.ts ottoBudgetArgsFor). Research jobs and
 * single-call helpers keep the derived worst-case budget.
 *
 * RESERVE/SETTLE semantics are untouched. settleCredits still clamps the charge to
 * A = min(actual, held) and refunds the remainder, balance still cannot go negative, and
 * the finalizer indexes still make settle/refund exactly-once. The only behaviour that
 * moves is the direction of the residual on a pathological turn: instead of over-holding,
 * a turn whose ACTUAL cost exceeds the cap is charged the cap — a bounded, per-turn
 * under-charge (never an over-charge, never a merchant-visible loss).
 */
export const OTTO_CONVERSATION_TURN_RESERVE_INTERNAL = 40;
