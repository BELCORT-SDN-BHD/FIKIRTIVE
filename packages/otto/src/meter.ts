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
 *     Callers that do not pass it are byte-identical to before. NOTE the one path it does NOT
 *     cover, spelled out on the field itself: a `usageOnError` settle (invariant #2's truncated
 *     turn) charges real tokens and never calls the hook — delivery-less but paid, by design.
 *     #1046-P1: before the hook runs, the SAME transaction reads this refId's finalizer directly.
 *     A REFUND already there ⇒ `SettleLostToRefund` ⇒ the whole transaction rolls back. "settle
 *     no-opped" is otherwise indistinguishable from "settle succeeded", and delivering on the
 *     first is handing a merchant goods the ledger has already refunded.
 * 11. (钱路 M1-c) `extraHoldInternal` / `extraSettleInternal` carry a NON-LLM leg of the same
 *     charge — today only the research search fee (Founder 2026-07-03's 3× ruling, finally
 *     implemented). It is the ONE bound that makes the hold BIGGER, and that is exactly why it
 *     is safe: a settle-side addition without a matching hold would be clamped away by
 *     settleCredits and the cost would silently land on us. Invariants 1–3 are untouched — a
 *     failed call still refunds the WHOLE hold (search fee included), and settle is still
 *     clamped to the held amount, so the pair can never over-charge.
 * 12. (MONEY-A10) `extraHoldUnits` / `onExtraUnitsGranted` are invariant 11's leg in WHOLE UNITS —
 *     for a leg with a fixed unit price and a per-turn cap (today: the chat turn's search leg).
 *     Under #898's balance-aware hold a FLAT extra gets squeezed together with the LLM leg while
 *     the tool keeps handing out full-price slots, and settle is then clamped: the merchant gets
 *     searches nobody paid for. So the ledger decides — in the reserve's own transaction — how
 *     many whole units this balance can buy, holds those FIRMLY (they are never squeezed), and
 *     reports the count back through the hook BEFORE fn runs. Invariants 1–3 and 9 are untouched:
 *     the count can only ever be smaller than the cap, and a caller that never hears it stays at
 *     0 (fail closed — reserve threw, so nothing may be spent).
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
  reserveChatTurnWithSearchSlots,
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
   * `withLlmBudget` 随即把整笔预扣退掉,再把原错误抛给调用方。于是**在这个钩子跑得到的那条路
   * 上**,终局只有两种:
   *   ① 交付落库 且 结算落库(同一笔提交,要么都在要么都不在);
   *   ② 什么都没交付 且 商家一分钱没花(全额退款)—— 引擎已经烧掉的 token 由 founder 承担,
   *      与 gen/refgen 终态失败时「商家没拿到结果就不收钱」的口径逐字一致。
   *
   * **但这不是这个函数的全部终局(判官 P2-3,说清楚而不是否认)。** 还有第三种,它先于这个钩子
   * 存在,这次也刻意没有改动 —— `usageOnError` 那条路(见下面 `fn` 的 catch):`fn` 抛了,而
   * `usageOnError` 从错误里取回了**真实用量**(典型是 Otto 跑满步数的 MaxTurnsExceeded)。那里
   * 按实际 token 结算,然后把错误抛出去 —— **这个钩子根本不会被调用**。于是:
   *   ③ 什么都没交付,但商家**按真实烧掉的 token 付了钱**。
   * 这是既有的定价决定(文件头不变量 #2/#3:截断的一轮按实际用量收费,绝不按预扣满额收费),
   * 不是这条缝带来的缺口 —— 模型确实替商家干了那些活,只是没干完。要改它得单独立项,由 Founder
   * 拍板;在此之前,谁读这段注释都必须知道它存在。
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
  /**
   * 钱路 M1-c — 这一次调用里 **LLM 之外**还要收的钱的**worst case**,单位 internal credits。
   *
   * 为什么需要它:深研的搜索此前是「free」的,而 free 的意思其实是**没人计价** ——
   * Founder 2026-07-03 就裁过搜索按 3× 收费,代码里一个字都没有。要把那条裁决落地,这个
   * wrapper 必须能持住一笔不是从 token 数算出来的钱;否则 settle 那边加了钱、hold 这边没加,
   * `settleCredits` 会把它 clamp 掉,商家一分没多付,成本全由我们自己吃 —— 那不叫计价,
   * 那叫换个地方漏。
   *
   * 语义与 #543 的 cap 相反:cap 只能把 hold 变**小**,这个只能把 hold 变**大**,而且必须
   * 大到足够覆盖 `extraSettleInternal` 可能返回的最大值(深研 = 档位的 maxSearches × 单次费率)。
   * 非正整数一律忽略 —— 坏值的方向是「不额外持有」,于是最坏情况退回到本次改动之前的行为。
   * 服务端组合期数据,永不来自请求或模型。
   */
  extraHoldInternal?: number;
  /**
   * 钱路 MONEY-A10 —— `extraHoldInternal` 的**按格版本**,给「单价固定、次数有上限」的那类腿
   * (今天唯一用户 = 聊天的搜索腿)。
   *
   * 为什么平的 `extraHoldInternal` 在聊天轮上不够用:聊天走 #898 的自适应预留
   * (`reserveMinInternal`),它把**整个** hold 压到余额。平的 extra 因此会跟 LLM 腿一起被压
   * 掉,而工具那边照发满额的搜索槽 —— 实测过:余额 10 的商家意图预留 55 被压成 10,应结 23
   * 实收 10,平台自己吃 13。深研不受影响:它走的是全额固定预留,没有压缩这回事,所以它继续
   * 用平的 `extraHoldInternal`,一个字都不用改。
   *
   * 传了它,预留就改走 `reserveChatTurnWithSearchSlots`:在**读余额的同一笔事务里**算出这一轮
   * 买得起几整格,坚实持有那几格,并把格数经 `onExtraUnitsGranted` 交回调用方。于是「发出去的
   * 槽」与「持住的钱」在同一个数上,`extraSettleInternal` 不可能再超出预扣。
   *
   * 与 `extraHoldInternal` 互斥:同时传时以本字段为准(它是更严格的那个)。
   */
  extraHoldUnits?: { unitInternal: number; maxUnits: number };
  /**
   * 钱路 MONEY-A10 —— 预留提交之后、`afterReserve` 与 `fn` 之前调用一次,告诉调用方账本**实际
   * 发放了几格**。没走按格预留的路径上,发放数 = 满额:全额固定预留(深研)本来就把 worst case
   * 持住了,而 `paid:false` 的免费路一分钱都不动 —— 那条路上「余额不够」是句假话。
   *
   * 预留抛错时它**不会**被调用 —— 调用方那边的初值必须是 0(发不出槽 = 不许花钱),
   * fail closed 由此成立。
   */
  onExtraUnitsGranted?: (grantedUnits: number) => void;
  /**
   * 钱路 M1-c — 这一次调用里 LLM 之外**实际**发生的钱,单位 internal credits。在 `fn` 之后读
   * (搜索次数只有跑完才知道),加进 settle。
   *
   * 三条不变量它一条都不动:
   *  · 只在**已经 settle** 的那条路上生效 —— fn 抛错且没有可用 usage 时走的仍是**全额退款**,
   *    搜索费一起退。跑失败的一轮不向商家收钱,这条比追回几分钱的搜索成本重要。
   *  · settle 仍然被 `settleCredits` clamp 到 ≤ 持有额,所以它永远不可能超收。
   *  · 返回非有限值/负数一律按 0 —— 计数器坏掉时不收费,不收一个编出来的数。
   */
  extraSettleInternal?: () => number;
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

/** #1046-P1 — thrown INSIDE the settle transaction when a REFUND already owns this refId's
 *  finalizer: the hold came back to the merchant before this run finished, so the SETTLE is a
 *  no-op and the delivery must not happen either. Rolls the whole transaction back, which is the
 *  point. Callers see it as an ordinary settle failure and mark their job failed. */
export class SettleLostToRefund extends Error {
  constructor(readonly refId: string) {
    super("this reservation was already refunded — not delivering against a released hold");
    this.name = "SettleLostToRefund";
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
  // 钱路 M1-c:非 LLM 的那一笔加在 cap **外面**。cap 是 #543 给对话轮的 LLM hold 定的天花板,
  // 它管的是 token 那条腿;一笔确定会被 settle 的非 token 费用如果被同一个 cap 压住,settle
  // 就会 clamp 掉它 —— 收费函数说收了,账本没收。
  //
  // MONEY-A10 之后这个数是**上界**而不再逐字等于实际预扣:走按格预留(`extraHoldUnits`)的
  // 聊天轮,低余额下账本只发得起更少的格,实际 hold 因此更小。作为预检它仍然正确——方向是
  // 「按最大可能判」,只会更严,不会放行一笔 reserve 会拒的动作。
  return llmLegInternal(args) + extraHoldOf(args);
}

/** hold 的 **LLM 那一条腿**(#543 的 cap 只管这一条)。MONEY-A10 的按格预留要把两条腿分开
 *  交给账本:弹性的这条随余额压缩,坚实的那条按整格发放,所以它必须能被单独取到。 */
function llmLegInternal(args: LlmBudgetArgs): number {
  if (!args.paid) return 0;
  const prices = args.prices ?? llmPricesFor(args.model);
  const margin = args.margin ?? ottoLlmMargin();
  const worstCase = turnBudgetInternal(prices, margin, args.maxSteps ?? 1);
  const cap = args.reserveCapInternal;
  return typeof cap === "number" && Number.isInteger(cap) && cap >= 1 ? Math.min(worstCase, cap) : worstCase;
}

/** 非 LLM 那条腿的 **worst case**。按格的(MONEY-A10)优先:它是更严格的那个,而且平的字段
 *  在按格路径上没有意义。坏值一律 0(坏值 = 不额外持有)。 */
function extraHoldOf(args: LlmBudgetArgs): number {
  const units = firmUnitsOf(args);
  if (units) return units.unitInternal * units.maxUnits;
  const extra = args.extraHoldInternal;
  return typeof extra === "number" && Number.isInteger(extra) && extra >= 1 ? extra : 0;
}

/** `extraHoldUnits` 的取值规则:两个数都必须是正整数,否则当没传(退回平的 extra 或 0)。 */
function firmUnitsOf(args: LlmBudgetArgs): { unitInternal: number; maxUnits: number } | undefined {
  const u = args.extraHoldUnits;
  if (!u) return undefined;
  const ok = Number.isInteger(u.unitInternal) && u.unitInternal >= 1 && Number.isInteger(u.maxUnits) && u.maxUnits >= 1;
  return ok ? { unitInternal: u.unitInternal, maxUnits: u.maxUnits } : undefined;
}

/** 把「这一轮发了几格坚实腿」交回调用方。付费路与免费路共用同一段,所以两条路不可能在
 *  「钩子抛错怎么办」上长出两套答案:吞掉并记日志(与 onRefundedFailure 同一条纪律),
 *  发放数就停在调用方 fail-closed 的初值 0 —— 方向是少搜,不是白搜。 */
function reportGrantedUnits(args: LlmBudgetArgs, grantedUnits: number): void {
  if (!args.onExtraUnitsGranted) return;
  try {
    args.onExtraUnitsGranted(grantedUnits);
  } catch (hookErr) {
    console.warn("[withLlmBudget] onExtraUnitsGranted hook threw; the turn keeps 0 granted units.", hookErr);
  }
}

/** `extraSettleInternal` 的取值规则:非负有限数向上取整,其余(含抛错)一律 0。
 *  一个坏掉的计数器不许变成一笔编出来的收费。 */
function extraSettleOf(args: LlmBudgetArgs): number {
  if (!args.extraSettleInternal) return 0;
  let v: number;
  try {
    v = Number(args.extraSettleInternal());
  } catch (e) {
    console.warn("[withLlmBudget] extraSettleInternal threw; charging 0 for the non-LLM leg.", e);
    return 0;
  }
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : 0;
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
    // MONEY-A10:免费路上一分钱都不动,所以坚实腿**满格**发放。少了这一行,调用方停在 fail-closed
    // 的 0 格,而工具会把每一次搜索都当成「余额不够」拒掉 —— 那句话在这条路上是假的(这里根本
    // 没有余额这回事),而且它悄悄改掉了 paid:false 从前的行为。发放数不是计量:免费路上没有
    // 预扣、没有结算,invariant #4 一个字未动。
    reportGrantedUnits(args, firmUnitsOf(args)?.maxUnits ?? 0);
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
  // MONEY-A10:账本这一轮实际发放了几格坚实腿。**初值 0 = fail closed** —— 预留抛错时下面那个
  // 回调不会被调用,调用方拿到的仍然是 0 格,于是一格也不许花。
  const firmUnits = firmUnitsOf(args);
  let grantedUnits = 0;
  await prisma.$transaction(async (tx) => {
    if (judgeWholeAction) await assertWithinSpendCap(tx, args.orgId, capCost as number);
    if (balanceAware && firmUnits) {
      // MONEY-A10 —— 两条腿分开交给账本,在**读余额的同一笔事务里**一起决定:
      // 弹性的 LLM 腿照旧被余额压缩(#898 不变),坚实的搜索腿按整格发放并被完整持有。
      // 一起压的旧形状会把搜索腿压没,而工具照发满额的槽 —— settle 随后被 clamp,平台吃差额。
      const out = await reserveChatTurnWithSearchSlots(tx, {
        orgId: args.orgId,
        refId: args.refId,
        llmCapInternal: llmLegInternal(args),
        minimumInternal: min,
        searchUnitInternal: firmUnits.unitInternal,
        maxSearchUnits: firmUnits.maxUnits,
      });
      reserve = out.holdInternal;
      grantedUnits = out.grantedSearchUnits;
    } else if (balanceAware) {
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
      // 全额固定预留(深研走这条):worst case 本来就被完整持住,所以坚实腿是满格发放。
      if (firmUnits) grantedUnits = firmUnits.maxUnits;
      await reserveCredits(tx, { orgId: args.orgId, refId: args.refId, cost: reserve });
    }
  });

  // MONEY-A10 —— 预留已经提交,把账本真正发放的格数交回调用方。位置刻意在**认领窗口与 fn
  // 之前**:工具在 fn 里才会被调用,它必须先知道这一轮能搜几次。一个抛错的钩子不许拖垮已经
  // 成功的预留,所以吞掉并记日志(与 onRefundedFailure 同一条纪律)——发放数就停在 0,
  // 方向是少搜,不是白搜。
  reportGrantedUnits(args, grantedUnits);

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
      // 优雅截断(MaxTurnsExceeded)= 这一轮**真的跑了**:token 照结,搜索费一并结。
      const actualInternal = actualCostInternal(errUsage, prices, margin) + extraSettleOf(args);
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
    // 钱路 M1-c:token 那一笔 + 非 LLM 那一笔(现役 = 搜索 3×)。settleCredits 仍然 clamp
    // 到 ≤ 持有额,所以加法不可能变成超收;而 hold 侧已经把 worst case 一起持住了。
    actualInternal = actualCostInternal(out.usage, prices, margin) + extraSettleOf(args);
  } else {
    // No usage info → LLM 腿按**预扣满额**收(#5 的既有保守行为:token 用量不可知,就按最坏收,
    // 不退)。但搜索腿不跟着走这条保守路 —— 七维审核 P2:`reserve` 里含着这一轮**持住**的搜索
    // 钱(按格路径 = granted×单价,深研的平铺路径 = worst case),照原样整包收,等于向一个
    // 0 次成功搜索的回合收满 5 格。
    //
    // 两条腿的可知性根本不同,这才是分开算的理由:token 用量只有模型返回才知道,而**成功搜索
    // 次数是我们自己数的**(OttoSearchSlots.succeeded),任何时候都可知,拿不到 usage 一点都
    // 不影响它。所以 LLM 腿收满、搜索腿收实数 —— 没搜就不收,搜了几次收几次。
    const firmHeldInternal = firmUnits ? grantedUnits * firmUnits.unitInternal : extraHoldOf(args);
    // 预扣里属于 LLM 的那一份。按格路径上 hold ≥ granted×单价 + 开门额,所以这个差非负;
    // `Math.max(0, …)` 是对平铺路径上「hold 被余额压到比 extra 还小」的兜底 —— 方向是不倒收。
    const llmHeldInternal = Math.max(0, reserve - firmHeldInternal);
    // 复审③ P1 —— 「满额」指的是**这条腿自己的**满额,不是它在账本里恰好占了多少位置。
    //
    // 账本为了守不变量会把弹性腿**钳**到开门额(credits.ts 的 elasticForHold),而那多出来的
    // 一截按定义是「超额预留,settle 时原样退回」。照 hold 收就等于把它收走 —— 实测:
    // cap=7 / 开门额=10 / 单价=3 / 余额=13 ⇒ 发 1 格、持 13,搜 0 次时 llmHeld=10,而这条腿
    // 本来最多只要 7。多收的 3 正是钳出来的那 3,与 credits.ts 那句承诺直接打架。
    //
    // 所以收之前先按这条腿自己的上限封顶。`llmLegInternal` 就是那个上限(worst case 与 #543
    // 的 cap 取小),两条既有路径上它不改变任何数:全额固定预留 llmHeld 恰好等于它,
    // 余额自适应路径上 llmHeld 只会更小。
    actualInternal = Math.min(llmHeldInternal, llmLegInternal(args)) + extraSettleOf(args);
  }

  // 钱路 M1-b —— 结算与交付同一笔提交(见 `commitInSettleTx` 的字段说明)。
  // 没有钩子的调用方走的还是原来那一行:同样的事务、同样的抛法、不新增任何退款。
  const commit = args.commitInSettleTx;
  try {
    await prisma.$transaction(async (tx) => {
      await settleCredits(tx, { orgId: args.orgId, refId: args.refId, actualInternal });
      if (commit) {
        // #1046-P1 —— 交付前**直接读一次终态**,不再拿间接信号当证据。
        //
        // 机理:`settleCredits` 返回 void,内部的 `createMany(skipDuplicates)` 把「计数 0」
        // 当成功的空操作 —— 而计数 0 也包括「REFUND 已经赢下 finalizer 唯一约束」。于是一次
        // 跑满 60 分钟被清道夫退了款的深研,模型随后返回结果时:SETTLE 空操作(商家的钱已经
        // 退回去了),`commitInSettleTx` 却照样把报告写出来、把 job 翻 DONE —— 商家白拿一份
        // 报告,权威账本记着 REFUND。
        //
        // 修法就是这一读:同一笔事务里查这个 refId 有没有 REFUND 行,有就抛。抛 ⇒ 整笔回滚
        // ⇒ 交付不存在 ⇒ 下面的 catch 走既有的退款兜底(对着已存在的 REFUND 是 no-op,退不了
        // 第二次)。fail closed:宁可让这一单报 FAILED,也不发一件账上已经退过钱的货。
        const refunded = await tx.creditLedger.findFirst({
          where: { orgId: args.orgId, refId: args.refId, kind: "REFUND" },
          select: { id: true },
        });
        if (refunded) throw new SettleLostToRefund(args.refId);
        await commit(tx);
      }
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
