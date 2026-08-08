/**
 * campaign-approval-lock — the ONE gate that keeps "what the merchant approved" and "what the
 * merchant is charged for" from disagreeing (#744 判官 r1 P1-2 / r2 P1).
 *
 * THE RACE IT CLOSES
 * Confirming a campaign reads the approved set, then dispatches it cell by cell. Undo/remove
 * writes the approved set. With no shared gate the two interleave as:
 *
 *     confirm reads "entry X approved" ─┐
 *                                       ├─ undo checks history (nothing charged yet) → writes proposed ✔
 *     confirm dispatches X, charges  ───┘
 *
 * and the merchant ends on the one state that must never exist: the entry is gone from the plan
 * and the credits are gone from the balance.
 *
 * HOW — AND WHY THE GATE LIVES INSIDE THE MONEY TRANSACTION
 * A PostgreSQL transaction-scoped advisory lock keyed by campaign, taken by BOTH sides:
 *   - undo/remove take it, check dispatch history and write the plan inside one transaction;
 *   - each paid dispatch takes it INSIDE THE TRANSACTION THAT COMMITS THE CHARGE — startGen's
 *     create+reserve+enqueue transaction — and re-reads the persisted plan under it before
 *     anything is created or reserved.
 *
 * The second half is the whole point of this rewrite. An earlier shape wrapped startGen in an
 * OUTER transaction that held the lock: because startGen opens its own transaction, the outer
 * one could time out (or lose its connection) and release the lock while the inner charge was
 * still uncommitted. An undo could then take the lock, see no GenJob (it was not committed yet),
 * write "proposed" — and the charge would commit afterwards. Exactly `charged && !approved`.
 * Handing the gate to the charging transaction removes the window by construction: the lock is
 * released by the same COMMIT that makes the charge visible, so an undo that gets the lock can
 * never fail to see a charge that happened.
 *
 * The two survivors are then exactly the two legal outcomes: "still approved and charged", or
 * "undone and not charged".
 *
 * WHAT #749 ADDED TO THE SAME GATE
 * 「批准的还是这些内容吗」只是承诺的一半。另一半是「这一格会扣多少、这一批会交付什么」,
 * 而那两样在确认动作里原本是**锁外快照**:报价读一次历史,派发在几十毫秒后才真扣钱。中间
 * 一单复用中的任务变成失败,商家签的 0 就会变成全价;中间另一个标签页用别的规格占住一个
 * 条目,交付会缩水而已派发的条目照收钱(#749 判官 r2 P1)。修法不是再造一把锁,是让这两样
 * **骑上这一把**:交付面在锁内重判(见 {@link applyCampaignApprovalGate} 末段),每一格的
 * 收费判决与费用上限拿 startGen 项目锁里的真判决对签(见 {@link applyCampaignDispatchVerdict})。
 *
 * LOCK ORDER
 * This key is per CAMPAIGN and startGen's own is per PROJECT, and this one is taken FIRST inside
 * that transaction — campaign then project, always the same order, so no cycle exists. The undo
 * side takes the campaign key only.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * A failure to take the lock, to re-read the plan, or to re-derive the approval fingerprint all
 * raise {@link CampaignApprovalGateRefused} from inside the money transaction: it rolls back
 * before create/reserve, so nothing is dispatched and nothing is charged.
 *
 * SERVER PROVENANCE
 * The gate travels on the in-process request object through a module-local WeakMap, the same
 * device gen-actions already uses for its trusted canvas/cowork/asset requests: a serialized
 * client payload can never be a member of it. Note the direction of trust — a gate can only
 * REFUSE a dispatch, never authorize one, so a forged one could not buy anything.
 */
import type { PrismaClient } from "@fikirtive/db";

/** Copy that says what happened, in the merchant's terms: their own edit won the race. */
export const CAMPAIGN_PLAN_CHANGED_MID_DISPATCH =
  "This campaign's approved list changed while this was starting, so nothing was started for it. Review the updated plan and confirm again.";

/** Copy for "we could not check", which is NOT the same as "it was fine". Nothing was charged
 *  because the check runs before create/reserve inside the same transaction. */
export const CAMPAIGN_APPROVAL_CHECK_UNKNOWN =
  "We couldn't confirm this campaign's approved list before starting, so nothing was started and nothing was charged. Try again.";

/** #749 判官 r2 P1 —— 交付面在锁内变了。措辞与上面那条分开:变的不是「批准了哪些条目」,
 *  是「这一批真会交付出什么」。这一格停在 create/reserve 之前,所以它确实零扣费。 */
export const CAMPAIGN_DELIVERY_CHANGED_MID_DISPATCH =
  "What this campaign will deliver changed while this was starting, so this item wasn't started and wasn't charged. Review the updated plan and confirm again.";

/** …而「查不出来」不等于「没问题」。同样停在花钱之前。 */
export const CAMPAIGN_DELIVERY_CHECK_UNKNOWN =
  "We couldn't confirm what this campaign will deliver before starting, so this item wasn't started and wasn't charged. Try again.";

/** Server-derived lock name. One derivation, so both sides cannot drift onto different locks. */
export function campaignApprovalLockKey(campaignId: string): string {
  return `campaign-approval:${campaignId}`;
}

/**
 * startGen 在**项目锁里**算出来的那一格的真实判决 —— 不是任何锁外快照(#749 判官 r2 P1)。
 * 报价那一侧签的是「这一格会不会新做、会扣多少」,这里给的就是同一个问题在真判决点的答案。
 */
export interface CampaignDispatchVerdict {
  /** `fresh` = 这一趟真会新建 + 预扣;`reused` = 复用一单已存在的,零新扣费。 */
  disposition: "fresh" | "reused";
  /** 这一趟真会预扣的**显示** credits。`reused` 为 0。 */
  displayCredits: number;
  /**
   * 这一趟是不是调用方**自己那次尝试**的原样重放(命中同一把幂等键)。
   *
   * 重放永远不许被拒:钱在第一次就已经扣过了,拒了就等于对商家说「这一格什么都没开始」,
   * 而那是假话。幂等性优先于对签 —— 对签防的是「签的不是这一份」,不是「同一份做了两次」。
   */
  exactReplay: boolean;
}

/**
 * What a dispatch must still be true for.
 *
 *   - `stillApproved`(#744)—— 批准的还是这些**内容**吗。对着 RIGHT NOW 持久化的 plan 重判。
 *   - `stillDelivering`(#749)—— 这一批真会**交付**的还是商家签过的那一组条目吗。它读的是
 *     持久化的派发历史,与报价那一侧同一个判据。放在 campaign 锁里是有理由的:一个条目
 *     变成「不会交付」只可能来自另一次派发,而同一个战役的派发被这把锁串起来了。
 *   - `stillPriced`(#749)—— **这一格**的收费判决与费用,还是商家签名时的那一份吗。它拿的是
 *     startGen 在项目锁里算出的真判决,所以中间没有第二个时间窗。
 *
 * 后两项省略时,行为与 #744 出厂时逐字相同。
 */
export interface CampaignApprovalGate {
  ownerId: string;
  campaignId: string;
  stillApproved: (planJson: unknown) => boolean;
  stillDelivering?: (tx: ApprovalGateClient) => Promise<boolean>;
  /** 返回 null 放行;返回一句人话就拒绝(fail closed,回滚在 create/reserve 之前)。 */
  stillPriced?: (verdict: CampaignDispatchVerdict) => string | null;
}

/** The surface the gate needs from the money transaction's client — read + lock only.
 *  `genJob` is read-only history: the delivery face is re-derived from it, never written. */
export type ApprovalGateClient = Pick<PrismaClient, "$executeRaw" | "campaign" | "genJob">;

/**
 * Gates ride on the exact in-process request object handed to startGen. They are never removed:
 * the entry dies with the request object, and a gate can only ever add a refusal, so a lingering
 * one cannot loosen anything.
 */
const CAMPAIGN_APPROVAL_GATES = new WeakMap<object, CampaignApprovalGate>();

/** Bind a gate to THIS request object and hand the object straight on to startGen. */
export function attachCampaignApprovalGate<T extends object>(req: T, gate: CampaignApprovalGate): T {
  CAMPAIGN_APPROVAL_GATES.set(req, gate);
  return req;
}

/** The gate this request carries, if any. Requests without one are dispatched unchanged. */
export function campaignApprovalGateFor(req: unknown): CampaignApprovalGate | undefined {
  if (req === null || typeof req !== "object") return undefined;
  return CAMPAIGN_APPROVAL_GATES.get(req as object);
}

/** Raised inside the money transaction so it rolls back before create/reserve. */
export class CampaignApprovalGateRefused extends Error {
  constructor(
    readonly userError: string,
    /** `conflict` = a decided "no" (the plan moved); `retryable` = we could not tell, and
     *  stopped before spending, so the same logical action may be retried as itself. */
    readonly refusal: "conflict" | "retryable",
  ) {
    super("CAMPAIGN_APPROVAL_GATE_REFUSED");
    this.name = "CampaignApprovalGateRefused";
  }
}

/**
 * Run the gate inside the transaction that is about to commit the charge. Call it FIRST, before
 * the project lock and before anything is created or reserved.
 *
 * 两步都在**同一把 campaign 锁**里,而这把锁是 transaction-scoped —— 它一直握到 COMMIT。
 * 所以下面 {@link applyCampaignDispatchVerdict} 虽然发生在项目锁之后,也仍然在这把锁里。
 */
export async function applyCampaignApprovalGate(
  tx: ApprovalGateClient,
  gate: CampaignApprovalGate,
): Promise<void> {
  const lockKey = campaignApprovalLockKey(gate.campaignId);
  let approved: boolean;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
    const campaign = await tx.campaign.findFirst({
      where: { id: gate.campaignId, ownerId: gate.ownerId, deletedAt: null },
      select: { planJson: true },
    });
    approved = campaign !== null && gate.stillApproved(campaign.planJson);
  } catch (error) {
    console.warn(
      "campaign-approval-lock: approval check failed before dispatch (nothing charged):",
      error instanceof Error ? error.message : error,
    );
    throw new CampaignApprovalGateRefused(CAMPAIGN_APPROVAL_CHECK_UNKNOWN, "retryable");
  }
  if (!approved) throw new CampaignApprovalGateRefused(CAMPAIGN_PLAN_CHANGED_MID_DISPATCH, "conflict");

  // #749 判官 r2 P1 —— 交付面。为什么它属于**这把锁**而不属于下面那个判决点:一个条目从
  // 「会交付」变成「不会交付」,只可能是另一次派发写了对不上的材料;同一个战役的每一次
  // 付费派发都握这把锁,所以在这里读到的交付面,在这笔事务里不会再动。
  if (!gate.stillDelivering) return;
  let delivering: boolean;
  try {
    delivering = await gate.stillDelivering(tx);
  } catch (error) {
    console.warn(
      "campaign-approval-lock: delivery check failed before dispatch (nothing charged):",
      error instanceof Error ? error.message : error,
    );
    throw new CampaignApprovalGateRefused(CAMPAIGN_DELIVERY_CHECK_UNKNOWN, "retryable");
  }
  if (!delivering) throw new CampaignApprovalGateRefused(CAMPAIGN_DELIVERY_CHANGED_MID_DISPATCH, "conflict");
}

/**
 * 门的**后半扇**(#749 判官 r2 P1)。
 *
 * 前半扇问「批准的还是这些东西吗」,后半扇问「这一格的收费判决与费用,还是商家签名时的
 * 那一份吗」。它必须在这里跑,而不是在前半扇里跑:「新做还是复用」取决于历史行的**状态**,
 * 而状态会被 worker 改。若在事务开头照一张快照再去比,快照与 startGen 真正据以扣费的那次
 * 读之间还留着一条缝 —— 一单复用中的任务恰好在这条缝里变成失败,商家签的是 0,扣的却是全价
 * (判官 r2 P1 的第一个情形)。所以对签的对象只能是 startGen 在项目锁里算出的**那一个**判决。
 *
 * 调用点:项目锁之内、create/reserve 之前、campaign 锁仍然握着。抛出即回滚,零扣费。
 */
export function applyCampaignDispatchVerdict(
  gate: CampaignApprovalGate,
  verdict: CampaignDispatchVerdict,
): void {
  // 原样重放不许被拒:钱早在第一次就扣过了,拒它等于对商家说「什么都没开始」。
  if (!gate.stillPriced || verdict.exactReplay) return;
  let refusal: string | null;
  try {
    refusal = gate.stillPriced(verdict);
  } catch (error) {
    console.warn(
      "campaign-approval-lock: price re-check failed before dispatch (nothing charged):",
      error instanceof Error ? error.message : error,
    );
    throw new CampaignApprovalGateRefused(CAMPAIGN_APPROVAL_CHECK_UNKNOWN, "retryable");
  }
  if (refusal) throw new CampaignApprovalGateRefused(refusal, "conflict");
}

/** The ONE translation from a gate refusal to a caller-visible result, so every caller (and
 *  every test double standing in for startGen) reports the same thing. */
export function campaignApprovalGateRefusal(
  error: unknown,
): { error: string; disposition: "conflict" | "retryable" } | null {
  return error instanceof CampaignApprovalGateRefused
    ? { error: error.userError, disposition: error.refusal }
    : null;
}
