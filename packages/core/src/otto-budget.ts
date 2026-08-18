import { CREDITS_PER_USD } from "./spend.js";

/** Max context tokens Otto can consume in one LLM step. */
export const OTTO_CONTEXT_CAP_TOKENS = 12_000;
/** Max output tokens Otto can emit in one LLM step. */
export const OTTO_OUTPUT_CAP_TOKENS = 1_500;
/** Max LLM steps per user turn. */
export const OTTO_MAX_STEPS = 10;

/**
 * The price multiplier applied to ONE Otto CONVERSATION turn — the single place a chat turn
 * is priced.
 *
 *   hold   = worst-case model cost × THIS × CREDITS_PER_USD   (turnBudgetInternal below)
 *   charge = actual     model cost × THIS × CREDITS_PER_USD   (actualCostInternal, meter.ts)
 *
 * **1.05 = the provider's API cost plus 5%.** Founder SECOND ruling 2026-08-18, superseding the
 * same-day ruling that made chat free: 其实应该看用量，不然之后思考很久或其他的，我们的成本会
 * cover 不到，可能就 api 成本 +5% 我们赚的钱这样。
 *
 * WHAT CHANGED HIS MIND, and why the shape of the rule is "usage" rather than a flat price: a
 * conversation turn has no bounded cost. A turn that thinks for a long time, or reads a lot of
 * context, costs the platform whatever it costs — and a free (or flat) chat surface is exactly
 * the design where our own bill can run past what the merchant ever pays us. Charging ACTUAL
 * USAGE makes that impossible by construction: the merchant is billed for what their turn really
 * consumed, so a long thinking turn is expensive for them and covered for us, and a one-line
 * question stays nearly free without us pricing it as if it might not be.
 *
 * WHY 1.05 AND NOT THE 2.0 GENERATION MARKUP. Conversation is not where this product earns —
 * generation is (OTTO_LLM_MARGIN_DEFAULT in llm-prices.ts, unchanged at 2.0). The 5% is cost
 * RECOVERY with a thin margin on top, so talking to Otto stays cheap enough that nobody rations
 * it, while no conversation can be sold below what it costs us to serve.
 *
 * WHAT IT MEANS IN CREDITS. The measured beta reply that used to cost 2.5 displayed credits at
 * 2.0 had a real provider cost of $0.125; at 1.05 the same reply charges 14 internal = 1.4
 * displayed credits. The full worst-case turn (every one of OTTO_MAX_STEPS steps burning the
 * whole context and output cap, at live sonnet prices) is 70 internal — which the #543 hold
 * ceiling below still caps at 40.
 *
 * WHY A MULTIPLIER AND NOT A SPECIAL CASE IN THE SPEND MACHINERY. reserve → settle → refund is
 * untouched by pricing: the hold and the charge are both this arithmetic, never a branch on "is
 * this chat", so re-pricing conversation cannot reach the code that moves money. That is what
 * made the free ruling a one-number change, and what makes this reversal one too.
 *
 * Re-pricing chat is this ONE number. The hold shape below (#543's ceiling, #898's entry
 * minimum) applies whenever it is above 0, and stands down if conversation is ever free again.
 */
export const OTTO_CONVERSATION_TURN_MARGIN = 1.05;

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
 * The HOLD a single PRICED Otto CONVERSATION turn places on the balance, in INTERNAL credits.
 * 40 internal = 4 displayed credits.
 *
 * LIVE (Founder's second ruling 2026-08-18 put conversation back on usage pricing, so this
 * ceiling is in force again — runtime.ts ottoBudgetArgsFor passes it whenever
 * OTTO_CONVERSATION_TURN_MARGIN is above 0). It caps a hold, never a charge; at the 1.05
 * multiplier the derived worst case is 70 internal, so the cap still bites and still buys the
 * thing #543 opened it for — a merchant near the bottom of their balance can start a turn.
 *
 * #543 Founder decision (2026-07-31). The derived worst case above assumes every one of
 * OTTO_MAX_STEPS steps burns the full context and output cap, which at live sonnet prices
 * and the 2.0× margin is 120 internal — 12 displayed credits held on every turn. With a
 * 20-credit welcome grant of the day (25 since #791) that hold is the thing that strands the
 * last credits: a merchant with 11 credits left cannot start a turn at all. 40 internal is still comfortably above
 * the measured single-turn peak (33 internal / 3.3 displayed), so it is a cap on the HOLD,
 * not a change to what a turn costs.
 *   ├─ HISTORICAL AT margin 2.0 (2026-07-31): "120 internal / 12 displayed" is the worst case at THAT margin; at today's 1.05 it is 70 internal / 7 displayed (per-step ceil, not a flat 52.5% of 120).
 *   └─ HISTORICAL AT margin 2.0 (2026-07-31): the "33 internal / 3.3 displayed" measured peak is that same turn priced at 2.0; at 1.05 it lands around 17–18 internal (~1.7–1.8 displayed). The 40 ceiling clears both, so #543's reasoning survives the re-pricing unchanged.
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
 * The minimum balance a merchant needs to START a PRICED conversation turn, in INTERNAL
 * credits. 10 internal = 1 displayed credit.
 *
 * LIVE again with the second ruling (2026-08-18): a turn that charges for usage has to be able
 * to refuse a merchant who cannot pay for any usage at all, or the first thing they would meet
 * is a hold that fails halfway. This is #898's documented trade coming back with the price — a
 * merchant at 0 credits is told to top up instead of starting a turn nobody can settle. It is
 * only passed while OTTO_CONVERSATION_TURN_MARGIN is above 0; a free conversation has no door.
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
 *   └─ HISTORICAL AT margin 2.0 (2026-08-13): every credit figure in this block was measured at THAT margin — #536's 0.4–3.3 band, the 0.4–1.3 typical message, the ~2.3-credit absorption bound; at today's 1.05 they are ~0.21–1.73, ~0.21–0.68 and ~1.2. All three shrink, so #898's conclusions (1 credit clears the typical message; the exposure is bounded and small) hold a fortiori.
 */
export const OTTO_CHAT_MIN_START_INTERNAL = 10;
