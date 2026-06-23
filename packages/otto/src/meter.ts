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
} from "@artlio/core";
import {
  prisma,
  reserveCredits,
  settleCredits,
  refundReservation,
} from "@artlio/db";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

/**
 * mapOttoUsage — map an OpenAI Agents SDK RunResult usage object to withLlmBudget's TokenUsage.
 * Pure helper shared by apps/web (ottoTurn) and apps/worker (resumeOttoAfterGen).
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
  if (usage.requestUsageEntries) {
    for (const entry of usage.requestUsageEntries) {
      cachedInputTokens += entry.inputTokensDetails?.cached_tokens ?? 0;
    }
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

/**
 * Pure helper: compute actual internal-credit cost from real token usage.
 *
 * Cached tokens are a SUBSET of inputTokens, priced at the cheaper cached rate.
 * Non-cached input = (inputTokens - cachedInputTokens) × inputPerToken.
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
  const nonCachedInput = input - cached;
  const usd = nonCachedInput * prices.inputPerToken + cached * prices.cachedInputPerToken + output * prices.outputPerToken;
  const result = Math.ceil(usd * margin * CREDITS_PER_USD);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

/**
 * Wrap a paid LLM call with the reserve→settle credit accounting.
 *
 * @param args.paid  - false = mock/free path: fn runs without ANY reserve/settle.
 * @param args.model - used for price lookup (unknown → sonnet, never free).
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
    usageOnError?: (e: unknown) => TokenUsage | null;
  },
  fn: () => Promise<{ result: T; usage?: TokenUsage }>,
): Promise<T> {
  // Invariant #4: mock/free path — no metering at all.
  if (!args.paid) {
    return (await fn()).result;
  }

  const prices = llmPricesFor(args.model);
  const margin = args.margin ?? ottoLlmMargin();
  const maxSteps = args.maxSteps ?? 1;

  // Reserve the worst-case budget BEFORE calling the model.
  // turnBudgetInternal(prices, margin, 1) === oneStepFloorInternal(prices, margin).
  const reserve = turnBudgetInternal(prices, margin, maxSteps);

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
