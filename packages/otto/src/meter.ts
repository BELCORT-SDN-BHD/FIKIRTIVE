/**
 * withLlmBudget — reserve→settle wrapper for paid LLM calls (Task 1.7 Part D).
 *
 * MONEY-SAFETY invariants (non-negotiable):
 *  1. Reserve BEFORE the model call. InsufficientCredits propagates; fn is NEVER called.
 *  2. Settle ACTUAL token cost (≤ reserved); remainder is refunded inside settleCredits.
 *  3. A FAILED model call (fn throws) refunds the WHOLE reservation; user never charged.
 *  4. Mock/free calls (paid:false) bypass all metering — ZERO credits touched.
 *  5. Unknown model → sonnet pricing (never free = never a metering hole).
 *  6. (#524 r3) An optional `afterReserve` claim runs between the hold and the model call. It can
 *     only STOP the call: a lost/failed claim refunds the whole hold and fn never runs. It cannot
 *     raise, lower or redirect a charge — reserve/settle/refund are byte-identical to before.
 *  7. (#524 r5) `onRefundedFailure` reports "this turn charged nothing" to the caller. Read-only
 *     signal, fired after the refund; it cannot change any amount and its throw is swallowed.
 *  8. (#524 r5) `capCostInternal` widens the SPEND-CAP verdict to the whole action this turn is a
 *     leg of, inside the reserve's own transaction. It can only refuse; the held amount, the
 *     settle and the refund are all unchanged by it. (#524 r6) That transaction reads the cap with
 *     the Organization row locked FOR UPDATE (assertWithinSpendCap), so the widened verdict and
 *     `reserveCredits`' own per-charge verdict see the SAME ceiling and no cap change can land
 *     between them.
 *  9. (#898 × #524) `reserveMinInternal` makes the hold fit the merchant instead of the other way
 *     round: hold = min(worst case, #543 cap, balance, merchant's spend cap), refused only below
 *     the minimum. Every bound can only make the hold SMALLER, so invariants 1–3 are untouched —
 *     settle still charges min(actual, hold) and a failure still refunds the whole hold.
 * 10. (钱路 M1-b) `commitInSettleTx` puts the DELIVERY in the settle's own transaction: either the
 *     merchant's goods and the charge both land, or neither does and the whole hold is refunded.
 *     Callers that do not pass it are byte-identical to before.
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
  Prisma,
  reserveCredits,
  reserveCreditsUpTo,
  settleCredits,
  refundReservation,
  assertWithinSpendCap,
} from "@fikirtive/db";

/** The transaction handle settle/refund already take — re-exported shape for `commitInSettleTx`. */
type Tx = Prisma.TransactionClient;

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

export type LlmBudgetArgs = {
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
  /** #898 — the minimum balance, in INTERNAL credits, that may START this call. When set (and
   *  valid), the hold becomes min(worst case, reserveCapInternal, current balance) instead of a
   *  fixed amount, and the call is refused only when the balance is below THIS number. Server-
   *  owned composition data only (runtime.ts ottoBudgetArgsFor); never request/client supplied.
   *  A malformed value (0, negative, fractional, NaN, Infinity) is ignored and the fixed hold
   *  stays in force — fail-closed in the direction that holds MORE and admits FEWER callers.
   *
   *  #524 × #898: on this path the merchant's own spend cap is a THIRD bound on the hold rather
   *  than a refusal — see reserveCreditsUpTo in @fikirtive/db for why a hold is clamped where a
   *  charge is refused. The cap remains a hard ceiling; the hold can only come out smaller. */
  reserveMinInternal?: number;
  usageOnError?: (e: unknown) => TokenUsage | null;
  /**
   * 钱路 M1-b —— **交付与结算同一笔提交**。在 settle 的那一笔事务里运行,拿到的就是 settle
   * 用的那个 `tx`。
   *
   * 为什么需要这个缝。此前「收钱」和「交货」是两笔独立事务:settle 先提交,交付的写在它后面
   * 单独跑。中间任何一次失败 —— 进程被 SIGKILL、写库报错、约束冲突 —— 结果都是**钱收了、货
   * 没了**,而且没有任何东西会回头把它补上(research 的报告写此前甚至是 try/catch 吞掉的
   * best-effort)。审计把这一条坐实为 P1。
   *
   * 语义:钩子抛错 ⇒ 整笔事务回滚 ⇒ **SETTLE 那一行根本不存在**,预扣仍然挂着;
   * `withLlmBudget` 随即把整笔预扣退掉,再把原错误抛给调用方。于是终局只有两种,没有第三种:
   *   ① 交付落库 且 结算落库(同一笔提交,要么都在要么都不在);
   *   ② 什么都没交付 且 商家一分钱没花(全额退款)—— 引擎已经烧掉的 token 由 founder 承担,
   *      与 gen/refgen 终态失败时「商家没拿到结果就不收钱」的口径逐字一致。
   *
   * 不传这个钩子的调用方,行为一个字节都没变(结算失败照旧原样抛出,不新增退款)。
   *
   * 钩子里只允许写「这一单的货」,不许再碰余额:钱的权威仍然只有 reserve/settle/refund。
   */
  commitInSettleTx?: (tx: Tx) => Promise<void>;
  /**
   * A claim on the work, run AFTER the hold is taken and BEFORE the model is called (#524 r3).
   *
   * It exists so a caller holding a ONE-SHOT consent (ottoApprove's approval card) can consume it
   * at the only moment that is safe: after the authoritative reserve has already said yes. Any
   * reserve refusal — spend cap or balance — therefore happens while the consent is still intact,
   * and `fn` never runs, so "the model did not run ⇒ the consent is still pending" holds by
   * CONSTRUCTION rather than by a preflight racing the ledger.
   *
   * Return false = the claim was lost (someone else already consumed it): the hold is refunded in
   * full through the ordinary `refundReservation` path and `ReservationNotClaimed` is thrown; `fn`
   * is never called, so nothing ran and the net ledger effect is zero. A throw is treated the same
   * way, then re-thrown — a claim that errored must not leave a hold standing.
   */
  afterReserve?: () => Promise<boolean>;
  /**
   * Called after `fn` threw and the WHOLE hold was refunded — i.e. this turn cost the merchant
   * exactly nothing (#524 r5, judge r4 P1-A'②).
   *
   * Purely informational and deliberately not async-critical: it cannot change what was charged,
   * it only lets a caller holding a spent one-shot consent say the true thing out loud ("approved,
   * but it couldn't run — nothing was charged") instead of leaving a card reading "approved" over
   * a thing that never happened. It does NOT fire when `usageOnError` yielded real usage, because
   * then the merchant WAS charged for what the call used and "nothing was charged" would be a lie.
   */
  onRefundedFailure?: () => void;
  /**
   * The FULL internal-credit cost of the merchant-visible action this turn is one leg of — the
   * amount the spend cap must be judged against (#524 r5, judge r4 P1-B).
   *
   * Why it exists. An Otto approval resume is ONE action to the merchant but TWO reserves to the
   * ledger: this turn's LLM hold, and the deterministic charge of the tool they approved, which
   * reserves later through its own authority. Each reserve judged alone passes a ceiling their
   * SUM would break — a cap of 7 credits waving through a 4-credit hold and then a 6-credit
   * reference generation, for a 10-credit action the merchant capped at 7. Summing it in a
   * preflight cannot fix that: the preflight and the reserve run in different transactions, so a
   * cap lowered in between is simply not seen. Here it is, in the reserve's own transaction.
   *
   * Semantics. It changes NO amount: the hold is still `llmHoldInternal(args)` and settle/refund
   * are untouched. It only widens what the cap verdict is taken against, so it can refuse, never
   * spend more. Values at or below the hold are ignored (the reserve's own verdict already covers
   * them), as are malformed ones — the direction that would loosen the ceiling is never taken from
   * this field. Server-derived only; never request- or model-supplied.
   */
  capCostInternal?: number;
};

/** Thrown when `afterReserve` itself FAILED (#524 r5, judge r4 P1-A'①). The hold was taken and
 *  then fully refunded, and `fn` was never called — but unlike ReservationNotClaimed nobody else
 *  won either, so the caller's one-shot consent is still unspent and the caller must be told the
 *  attempt burned its reservation. The original failure rides on `cause`. */
export class ClaimFailed extends Error {
  constructor(readonly cause: unknown) {
    super("The reserved work could not be claimed; the hold was refunded.");
    this.name = "ClaimFailed";
  }
}

/** Thrown when `afterReserve` did not claim the work: the hold was taken and then fully refunded,
 *  and `fn` was never called. Nothing ran, nothing was charged. Callers map it to their own benign
 *  "someone else already did this" answer. */
export class ReservationNotClaimed extends Error {
  constructor() {
    super("The reserved work was already claimed elsewhere; the hold was refunded.");
    this.name = "ReservationNotClaimed";
  }
}

/**
 * The EXACT number of internal credits `withLlmBudget` will hold for this call — extracted so
 * there is one definition of it, and `withLlmBudget` below is its only in-tree consumer that
 * spends (#524 r2).
 *
 * A caller may consult it READ-ONLY to answer "will the merchant's spend cap refuse this turn?"
 * BEFORE doing something it cannot take back (ottoApprove consumes the approval card before the
 * resume). That is a preflight, never an authority: the reserve inside `reserveCredits` remains
 * the only thing that decides whether money moves, and a preflight that says yes changes nothing
 * about its verdict. Deriving the number here rather than re-deriving it at the call site is the
 * point — a second copy of "what a turn holds" would drift from what is actually reserved, and a
 * preflight that guesses HIGH would refuse turns the ledger would have allowed.
 *
 * `paid: false` (fixture/mock runtimes) holds nothing at all — invariant #4.
 */
export function llmHoldInternal(args: LlmBudgetArgs): number {
  if (!args.paid) return 0;
  const prices = args.prices ?? llmPricesFor(args.model);
  const margin = args.margin ?? ottoLlmMargin();
  const worstCase = turnBudgetInternal(prices, margin, args.maxSteps ?? 1);
  const cap = args.reserveCapInternal;
  return typeof cap === "number" && Number.isInteger(cap) && cap >= 1 ? Math.min(worstCase, cap) : worstCase;
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
  args: LlmBudgetArgs,
  fn: () => Promise<{ result: T; usage?: TokenUsage }>,
): Promise<T> {
  // Invariant #4: mock/free path — no metering at all.
  if (!args.paid) {
    const out = await fn();
    // 钱路 M1-b:免费路上没有 settle 可言,但**交付仍然必须发生**。少了这三行,一个把交付
    // 托付给这个钩子的调用方在 paid:false 上会安静地什么都不交付 —— 正是这张票要消灭的那类
    // 静默失败,只不过换了个入口。交付照旧在一笔事务里(要么整份货都在,要么一点都不在);
    // 这里没有预扣,所以抛错就是抛错,没有可退的钱。
    const freeCommit = args.commitInSettleTx;
    if (freeCommit) await prisma.$transaction((tx) => freeCommit(tx));
    return out.result;
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

  // Reserve the worst-case budget BEFORE calling the model — the ONE definition of the hold
  // (llmHoldInternal above), so a read-only preflight and the real reserve can never disagree.
  // turnBudgetInternal(prices, margin, 1) === oneStepFloorInternal(prices, margin); #543's
  // composition cap may only LOWER it, and a malformed cap is ignored.
  const capped = llmHoldInternal(args);
  // #898: same validity rule as #543's cap — anything that is not a positive integer is ignored,
  // so a malformed minimum falls back to the fixed hold rather than opening the door wider.
  const min = args.reserveMinInternal;
  const balanceAware = typeof min === "number" && Number.isInteger(min) && min >= 1;
  // #524 r5 (judge r4 P1-B): when this turn is one leg of a bigger approved action, the cap is
  // judged against the WHOLE action first — in this same transaction, so a cap the merchant moved
  // after the preflight is the one that decides. Only ever stricter: a value at or below the hold,
  // or a malformed one, is ignored and the reserve's own per-charge verdict stands alone.
  // #524 r6 (judge r5 P1-A②): "same transaction" is not by itself "same ceiling" — READ COMMITTED
  // gives each statement its own snapshot, so this verdict and reserveCredits' own could read a
  // cap the merchant changed in between. assertWithinSpendCap takes the Organization row FOR
  // UPDATE, which makes the pair atomic: one ceiling, no window before the first credit moves.
  const capCost = args.capCostInternal;
  const judgeWholeAction =
    typeof capCost === "number" && Number.isFinite(capCost) && capCost > capped;

  // Invariant #1: reserve first. InsufficientCredits (and #524's SpendCapBlocked) propagate;
  // fn is never called, and NOTHING the caller does after this line has happened yet.
  // `reserve` is the amount ACTUALLY held — on the balance-aware path (#898) it can be less than
  // `capped`, and the no-usage settle below must charge the real hold, not the intended one.
  let reserve = capped;
  await prisma.$transaction(async (tx) => {
    if (judgeWholeAction) await assertWithinSpendCap(tx, args.orgId, capCost as number);
    if (balanceAware) {
      // #898 — the hold fits the balance. Founder 2026-08-13 also exempted this hold from the
      // spend cap (see reserveCreditsUpTo in @fikirtive/db): the ceiling governs new paid actions,
      // not a conversation already under way, so this leg reserves against the balance alone.
      reserve = await reserveCreditsUpTo(tx, {
        orgId: args.orgId,
        refId: args.refId,
        capInternal: capped,
        minimumInternal: min,
      });
    } else {
      await reserveCredits(tx, { orgId: args.orgId, refId: args.refId, cost: reserve });
    }
  });

  // #524 r3 — the claim window. It sits HERE, between a successful hold and the model call, so a
  // caller consuming a one-shot consent does it only once the ledger has already agreed to pay.
  // A lost or failed claim refunds the whole hold through the ordinary path and never calls fn.
  if (args.afterReserve) {
    let claimed: boolean;
    try {
      claimed = await args.afterReserve();
    } catch (e) {
      await prisma.$transaction((tx) =>
        refundReservation(tx, { orgId: args.orgId, refId: args.refId }),
      );
      // Wrapped, not re-thrown bare: "the claim blew up after we had already reserved" is a
      // different fact from "the work refused before anything was held", and the caller has to
      // tell them apart to know whether this refId is now spent (#524 r5).
      throw new ClaimFailed(e);
    }
    if (!claimed) {
      await prisma.$transaction((tx) =>
        refundReservation(tx, { orgId: args.orgId, refId: args.refId }),
      );
      throw new ReservationNotClaimed();
    }
  }

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
      // Nothing was charged. Tell the caller so it can be honest about it (#524 r5); a throw here
      // must never mask the real failure, so it is swallowed and logged.
      try {
        args.onRefundedFailure?.();
      } catch (hookErr) {
        console.warn("[withLlmBudget] onRefundedFailure hook threw; ignoring.", hookErr);
      }
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

  // 钱路 M1-b —— 结算与交付同一笔提交(见 `commitInSettleTx` 的字段说明)。
  // 没有钩子的调用方走的还是原来那一行:同样的事务、同样的抛法、不新增任何退款。
  const commit = args.commitInSettleTx;
  try {
    await prisma.$transaction(async (tx) => {
      await settleCredits(tx, { orgId: args.orgId, refId: args.refId, actualInternal });
      if (commit) await commit(tx);
    });
  } catch (e) {
    if (!commit) throw e; // 零行为变更:没托付交付给我们的调用方,原样抛出
    // 事务已经整笔回滚 ⇒ SETTLE 那一行不存在 ⇒ 预扣还挂着。把它全额退掉,商家才不会为一件
    // 没交付的东西付钱。refundReservation 自带 finalizer-once 唯一索引:万一另一条路径真的
    // 已经结算成功,这里拿到 "already-settled" 而不会多退一分钱。
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: args.orgId, refId: args.refId }));
    throw e;
  }

  return out.result;
}
