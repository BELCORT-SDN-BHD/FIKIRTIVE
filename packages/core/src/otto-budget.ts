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
 *
 * #898 (Founder 2026-08-13, formal correction to #543): this constant is now the CEILING of
 * the hold, not the hold itself. A conversation turn holds min(this, current balance) — see
 * OTTO_CHAT_MIN_START_INTERNAL. A merchant with a balance at or above 4 credits is held
 * exactly as before; only a merchant who cannot afford the full hold sees a smaller one.
 */
export const OTTO_CONVERSATION_TURN_RESERVE_INTERNAL = 40;

/**
 * The minimum balance a merchant needs to START a conversation turn, in INTERNAL credits.
 * 10 internal = 1 displayed credit.
 *
 * #898 Founder decision (2026-08-13) — the interim correction to #543. The hold was also the
 * door: a merchant holding 3.9 credits could not send a message at all, so they could not even
 * ask what their remaining credits were still good for. Measured single-message cost is
 * 0.4–3.3 credits (#536), so at 3.9 credits nearly every message was in fact affordable.
 *
 * The new semantics, in three lines:
 *   entry gate  = balance >= OTTO_CHAT_MIN_START_INTERNAL     (was: >= the full hold)
 *   hold        = min(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, balance)
 *   charge      = min(actual cost, hold)                      (settleCredits, unchanged)
 *
 * Why a floor at all: reserveCredits no-ops on cost <= 0, so without a minimum a balance of
 * 0.0x credits would become an unlimited free chat. 1 credit is above the measured typical
 * message (0.4–1.3) and is the smallest number the product can state honestly.
 *
 * The bounded exposure this opens: when the actual cost of a message exceeds the (smaller)
 * hold, settleCredits charges the hold and the platform absorbs the difference — at most
 * ~2.3 credits on the cold-cache opening message of a merchant sitting under 1 credit of
 * headroom. Every such clamp writes a queryable ledger reason (HOLD_SHORTFALL_REASON_PREFIX
 * in @fikirtive/db) so the absorption is visible instead of silent. It disappears on its own
 * once the assembler (#879 step 2) lands. Merchants are never over-charged and the balance
 * can never go negative — reserve/settle/refund and their exactly-once indexes are untouched.
 */
export const OTTO_CHAT_MIN_START_INTERNAL = 10;
