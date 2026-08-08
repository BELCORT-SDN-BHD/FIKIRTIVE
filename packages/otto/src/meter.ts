/**
 * withLlmBudget — reserve→settle wrapper for paid LLM calls (Task 1.7 Part D).
 *
 * MONEY-SAFETY invariants (non-negotiable):
 *  1. Reserve BEFORE the model call. InsufficientCredits propagates; fn is NEVER called.
 *  2. Settle ACTUAL token cost (≤ reserved); remainder is refunded inside settleCredits.
 *  3. A FAILED model call (fn throws) refunds the WHOLE reservation; user never charged.
 *  4. Mock/free calls (paid:false) bypass all metering — ZERO credits touched.
 *  5. Unknown model → sonnet pricing (never free = never a metering hole).
 */
import {
  CREDITS_PER_USD,
  llmPricesFor,
  ottoLlmMargin,
  turnBudgetInternal,
  type LlmPrices,
} from "@fikirtive/core";
import {
  prisma,
  reserveCredits,
  settleCredits,
  refundReservation,
} from "@fikirtive/db";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** Anthropic prompt-cache WRITE tokens (cache_creation_input_tokens), billed at 1.25× input. */
  cacheWriteInputTokens?: number;
};

/**
 * mapOttoUsage — map an OpenAI Agents SDK RunResult usage object to withLlmBudget's TokenUsage.
 * Pure helper shared by every metered Otto entry (web ottoTurn / stream / ottoApprove,
 * worker research).
 *
 * Field provenance (verified against installed @ai-sdk/anthropic@3.0.85 +
 * @openai/agents-extensions@0.11.8): the Anthropic provider returns V3 usage
 * `inputTokens: { total, noCache, cacheRead, cacheWrite }` where `total` INCLUDES cache
 * read + write tokens; the aisdk adapter maps cacheRead → inputTokensDetails.cached_tokens
 * and cacheWrite → inputTokensDetails.cache_write_tokens, and takes `.total` as the entry's
 * inputTokens. So cached + cacheWrite ⊆ inputTokens here by construction.
 */
export function mapOttoUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  requestUsageEntries?: Array<{
    inputTokens: number;
    outputTokens: number;
    inputTokensDetails: Record<string, number>;
  }>;
}): TokenUsage {
  let cachedInputTokens = 0;
  let cacheWriteInputTokens = 0;
  if (usage.requestUsageEntries) {
    for (const entry of usage.requestUsageEntries) {
      cachedInputTokens += entry.inputTokensDetails?.cached_tokens ?? 0;
      cacheWriteInputTokens += entry.inputTokensDetails?.cache_write_tokens ?? 0;
    }
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
    cacheWriteInputTokens: cacheWriteInputTokens > 0 ? cacheWriteInputTokens : undefined,
  };
}

/**
 * Pure helper: compute actual internal-credit cost from real token usage.
 *
 * Cached (read) and cache-write tokens are SUBSETS of inputTokens (see mapOttoUsage:
 * the adapter's per-entry inputTokens is the Anthropic `total` incl. cache read + write).
 * Cache reads are priced at the cheaper cached rate; cache writes at the 1.25× write
 * premium (engine spec §2.3). Both are clamped so cached + cacheWrite never exceeds input
 * (consistency guard — malformed usage can shift tokens between rate tiers but never
 * fabricate token counts beyond inputTokens; the settle-side ≤-reserve clamp in
 * settleCredits remains the hard charge ceiling).
 * Non-cached input = (inputTokens - cached - cacheWrite) × inputPerToken.
 * Result is always a non-negative integer (Math.ceil).
 */
export function actualCostInternal(
  usage: TokenUsage,
  prices: LlmPrices,
  margin: number,
): number {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  const cached = Math.min(Math.max(0, Number(usage.cachedInputTokens) || 0), input); // cached ⊆ input
  const cacheWrite = Math.min(Math.max(0, Number(usage.cacheWriteInputTokens) || 0), input - cached); // cached + cacheWrite ⊆ input
  const nonCachedInput = input - cached - cacheWrite;
  const usd =
    nonCachedInput * prices.inputPerToken +
    cached * prices.cachedInputPerToken +
    cacheWrite * prices.cacheWriteInputPerToken +
    output * prices.outputPerToken;
  const result = Math.ceil(usd * margin * CREDITS_PER_USD);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

/**
 * Wrap a paid LLM call with the reserve→settle credit accounting.
 *
 * @param args.paid  - false = mock/free path: fn runs without ANY reserve/settle.
 * @param args.model - used for price lookup (unknown → sonnet, never free).
 * @param args.prices - optional manifest-sourced price table (see field doc above).
 * @param args.maxSteps - 1 for single calls (enhance/draft); OTTO_MAX_STEPS for Otto turns.
 * @param fn         - async function that calls the LLM and returns { result, usage? }.
 */
export async function withLlmBudget<T>(
  args: {
    orgId: string;
    refId: string;
    model: string;
    paid: boolean;
    margin?: number;
    maxSteps?: number;
    /** Price table for this call. When supplied it MUST come from the Otto model-runtime
     *  manifest (runtime.ts ottoBudgetArgsFor — the single billing source, PH1-A1).
     *  Omitted → llmPricesFor(model), the fail-closed lookup (unknown → sonnet, never free). */
    prices?: LlmPrices;
    /** #543 — an upper bound on the HOLD, in INTERNAL credits. Server-owned composition
     *  data only (runtime.ts ottoBudgetArgsFor); never request/client supplied. It can only
     *  LOWER the hold, never raise it, and a malformed value (0, negative, fractional,
     *  NaN, Infinity) is ignored so the derived worst-case budget stays in force —
     *  fail-closed in the direction that holds MORE. Reserve/settle/refund semantics are
     *  unchanged: settleCredits still clamps the charge to the held amount. */
    reserveCapInternal?: number;
    usageOnError?: (e: unknown) => TokenUsage | null;
  },
  fn: () => Promise<{ result: T; usage?: TokenUsage }>,
): Promise<T> {
  // Invariant #4: mock/free path — no metering at all.
  if (!args.paid) {
    return (await fn()).result;
  }

  const registeredPrices = llmPricesFor(args.model);
  const prices = args.prices ?? registeredPrices;
  // A manifest may price more conservatively than the registered table, never below it.
  // This keeps the new composition seam fail-closed: a malformed/fixture manifest cannot
  // turn a production model into a free or under-reserved call by supplying cheaper prices.
  if (
    !Number.isFinite(prices.inputPerToken) || prices.inputPerToken < registeredPrices.inputPerToken ||
    !Number.isFinite(prices.cachedInputPerToken) || prices.cachedInputPerToken < registeredPrices.cachedInputPerToken ||
    !Number.isFinite(prices.cacheWriteInputPerToken) || prices.cacheWriteInputPerToken < registeredPrices.cacheWriteInputPerToken ||
    !Number.isFinite(prices.outputPerToken) || prices.outputPerToken < registeredPrices.outputPerToken
  ) {
    throw new Error(`Manifest pricing for ${args.model} is below the registered fail-closed floor.`);
  }
  const margin = args.margin ?? ottoLlmMargin();
  const maxSteps = args.maxSteps ?? 1;

  // Reserve the worst-case budget BEFORE calling the model.
  // turnBudgetInternal(prices, margin, 1) === oneStepFloorInternal(prices, margin).
  const worstCase = turnBudgetInternal(prices, margin, maxSteps);
  // #543: a composition-supplied cap may only LOWER the hold. Anything that is not a
  // positive integer is ignored, so a malformed cap can never open a metering hole.
  const cap = args.reserveCapInternal;
  const reserve =
    typeof cap === "number" && Number.isInteger(cap) && cap >= 1 ? Math.min(worstCase, cap) : worstCase;

  // Invariant #1: reserve first. InsufficientCredits propagates; fn never called.
  await prisma.$transaction((tx) =>
    reserveCredits(tx, { orgId: args.orgId, refId: args.refId, cost: reserve }),
  );

  // Invariant #3: refund the whole reservation if fn throws (unless usageOnError yields actual usage).
  let out: { result: T; usage?: TokenUsage };
  try {
    out = await fn();
  } catch (e) {
    const errUsage = args.usageOnError?.(e) ?? null;
    if (errUsage) {
      const actualInternal = actualCostInternal(errUsage, prices, margin);
      await prisma.$transaction((tx) =>
        settleCredits(tx, { orgId: args.orgId, refId: args.refId, actualInternal }),
      );
    } else {
      await prisma.$transaction((tx) =>
        refundReservation(tx, { orgId: args.orgId, refId: args.refId }),
      );
    }
    throw e;
  }

  // Invariant #2: settle actual cost (≤ reserved); settleCredits refunds the remainder.
  let actualInternal: number;
  if (out.usage) {
    actualInternal = actualCostInternal(out.usage, prices, margin);
  } else {
    // No usage info → charge the full reserve (no refund).
    actualInternal = reserve;
  }

  await prisma.$transaction((tx) =>
    settleCredits(tx, { orgId: args.orgId, refId: args.refId, actualInternal }),
  );

  return out.result;
}
