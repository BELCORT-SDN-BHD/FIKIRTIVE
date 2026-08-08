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
 * WHY A PER-CELL LOCK IS NOT ENOUGH — THE DISPATCH LEASE (#749 判官 r3 P1)
 * This lock is transaction-scoped, so it is released by every cell's COMMIT while the batch
 * keeps dispatching the remaining cells. That leaves a gap BETWEEN cells, and the merchant's
 * promise is not per cell — it is "this whole set gets delivered". Two tabs interleave in the
 * gap: B pays for the shared image cell, A then takes the video cell with a different spec, and
 * B only discovers the shrunken delivery at its second cell — with its first charge already
 * committed. No amount of extra checking INSIDE a cell can close that, because the gap is
 * between cells.
 *
 * A batch-level promise needs a batch-level mechanism: {@link claimCampaignDispatch} takes the
 * whole signed delivery face in ONE short transaction under this same lock, commits it, and
 * every later confirmation of the same campaign+project is refused at ITS batch start — before
 * it has spent anything. The lease is the batch-level lock; this advisory lock only makes taking
 * it atomic.
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

// ── The dispatch lease (#749 判官 r3 P1) ────────────────────────────────────
/**
 * 商家签的是「这一整组交付」,而扣费锁的粒度是一格 —— 格与格之间必然有缝。租约就是那把
 * **批次级**的锁:开工时一次性把整个交付面认下来,认领期间别人的确认在**它自己花钱之前**
 * 被挡住。
 *
 * 它存在哪:`GenerationBatch` 这一行。这一行是**每个战役+项目恰好一行**(id 就是服务端
 * 派生的 batch id),两个标签页争的正是同一行;它 owner-scoped、在任何一格派发之前就已经
 * 存在,而且它的 `status` 列今天没有任何读者(全仓每一处读 GenerationBatch 都是
 * `select: { id: true }`,create 也从不写它)。「这一批此刻在不在派发、归谁」本来就是这一行
 * 的状态,所以这不是借位,是把这一列第一次真正用起来。**零 schema 变更。**
 *
 * 活性判据用 `updatedAt`,不在字符串里编时间戳:每一次写都会刷新它,被遗弃的租约自己老死。
 */
const DISPATCH_LEASE_PREFIX = "dispatching:";

/** 没有派发在飞时这一行的值 —— 也就是建表时的默认值。 */
export const BATCH_IDLE_STATUS = "active";

/**
 * 租约多久没被刷新就算过期。
 *
 * 派发只**入队**、从不等生成结果,所以一格就是一笔短事务;而且每一格在自己的扣费事务里都会
 * 把租约刷新一次(见 {@link campaignDispatchLeaseHeldBy} 的调用点),所以这个时长只需要覆盖
 * **相邻两格之间**的间隙 —— 那是亚秒级的。两分钟是两个数量级的余量,同时又给「进程崩了」
 * 定了个上限:最多两分钟之后商家就能重新确认,不需要人工介入。
 */
export const CAMPAIGN_DISPATCH_LEASE_MS = 2 * 60_000;

/** 这一行此刻的租约归谁;没有活租约就是 null。**认不出来的值一律当作没有租约** —— 唯一
 *  的写入者是本模块,而把陌生值读成「有人占着」会把这个战役永久钉死,那是比重新确认一次
 *  严重得多的坏结果。钱那一侧的 fail-closed 由「认领失败即整批拒绝」保证,不靠这一行。 */
export function campaignDispatchLeaseHolder(
  row: { status: string; updatedAt: Date },
  now: number = Date.now(),
): string | null {
  if (!row.status.startsWith(DISPATCH_LEASE_PREFIX)) return null;
  if (row.updatedAt.getTime() + CAMPAIGN_DISPATCH_LEASE_MS <= now) return null;
  return row.status.slice(DISPATCH_LEASE_PREFIX.length);
}

function dispatchLeaseToken(attemptId: string): string {
  return `${DISPATCH_LEASE_PREFIX}${attemptId}`;
}

/** 另一次确认正在派发同一个战役到同一个项目。对客说人话:等它做完再来。 */
export const CAMPAIGN_DISPATCH_IN_FLIGHT =
  "Another confirmation for this campaign is still starting its items, so nothing was started here and nothing was charged. Wait for it to finish, then review the updated plan and confirm again.";

/** 连「有没有人在派发」都读不出来 —— 同样停在花钱之前。 */
export const CAMPAIGN_DISPATCH_CLAIM_UNKNOWN =
  "We couldn't confirm whether this campaign is already being generated, so nothing was started and nothing was charged. Try again.";

/** 认领/续租/归还需要的那点客户端能力 —— 读写这一行,外加取锁。 */
export type DispatchLeaseClient = Pick<PrismaClient, "$executeRaw" | "generationBatch">;

export interface CampaignDispatchLease {
  ownerId: string;
  /** 取的是**同一把** campaign 锁(见 {@link campaignApprovalLockKey})—— 认领与扣费必须
   *  在同一把锁上排队,否则「认领」和「花钱」还是两条互不相干的队。 */
  campaignId: string;
  /** 服务端派生的 batch id —— 同一个战役+项目的每一次确认都是这一个值。 */
  batchId: string;
  projectId: string;
  attemptId: string;
  /** 这一行第一次被建出来时的名字(与 orchestrateBatch 建的那次一致)。 */
  name: string;
}

/**
 * 开工认领:在 campaign 锁内把这一批的交付面整个认下来,**立刻提交**。
 *
 * 调用方自己开那笔短事务(见 campaign-generation-confirm),因为认领与「交付面还对得上吗」
 * 必须同生共死 —— 面对不上时抛出,租约随事务一起回滚,不留残迹、不需要补偿归还。
 *
 * 返回 `true` = 认下来了;`false` = 另一次派发正握着它(调用方整批拒绝,零扣费)。
 */
export async function claimCampaignDispatch(
  tx: DispatchLeaseClient,
  lease: CampaignDispatchLease,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${campaignApprovalLockKey(lease.campaignId)}, 0::bigint))`;
  const row = await tx.generationBatch.findFirst({
    where: { id: lease.batchId, ownerId: lease.ownerId },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!row) {
    // 第一次确认:这一行还不存在,连行带租约一起建出来。orchestrateBatch 随后会读到它。
    try {
      await tx.generationBatch.create({
        data: {
          id: lease.batchId,
          ownerId: lease.ownerId,
          projectId: lease.projectId,
          name: lease.name,
          status: dispatchLeaseToken(lease.attemptId),
        },
        select: { id: true },
      });
      return true;
    } catch (error) {
      // 建行撞了唯一键 = 有人在这一瞬间抢先建了(锁挡不住不走这把锁的路径)。重读一次,
      // 按同一条规则再判 —— 抢不到就老老实实认输,绝不覆盖别人的租约。
      if (typeof error !== "object" || error === null || (error as { code?: string }).code !== "P2002") {
        throw error;
      }
      const again = await tx.generationBatch.findFirst({
        where: { id: lease.batchId, ownerId: lease.ownerId },
        select: { id: true, status: true, updatedAt: true },
      });
      if (!again) return false; // 存在但不归这个 owner —— 认不了,也不许碰。
      return takeLeaseOn(tx, again, lease);
    }
  }
  return takeLeaseOn(tx, row, lease);
}

/** 一行已经存在时的认领判定 + 写入。规则只有一处,建行竞态那一支也走它。
 *  写用 `updateMany` 而不是 `update`:租户守卫要求每一次写都带 ownerId,而 `update` 的
 *  where 只收唯一键 —— 带上 ownerId 是对的,别把守卫绕开(#463 起的租户隔离底线)。 */
async function takeLeaseOn(
  tx: DispatchLeaseClient,
  row: { status: string; updatedAt: Date },
  lease: CampaignDispatchLease,
): Promise<boolean> {
  const holder = campaignDispatchLeaseHolder(row);
  if (holder !== null && holder !== lease.attemptId) return false;
  const { count } = await tx.generationBatch.updateMany({
    where: { id: lease.batchId, ownerId: lease.ownerId },
    data: { status: dispatchLeaseToken(lease.attemptId) },
  });
  return count === 1;
}

/**
 * 续租 + 确认还归自己 —— 在**这一格的扣费事务里**跑(campaign 锁已经握着)。
 *
 * 为什么要续:租约只需要覆盖相邻两格的间隙,于是它可以短到「崩了很快就放」,又不会在一趟
 * 正常派发的中途过期。为什么要确认:万一真过期了、且别人抢了去,这一格必须在花钱之前停住,
 * 而不是继续往一份已经缩水的交付里付钱。
 */
export async function renewCampaignDispatchLease(
  tx: DispatchLeaseClient,
  lease: Pick<CampaignDispatchLease, "ownerId" | "batchId" | "attemptId">,
): Promise<boolean> {
  const row = await tx.generationBatch.findFirst({
    where: { id: lease.batchId, ownerId: lease.ownerId },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!row || campaignDispatchLeaseHolder(row) !== lease.attemptId) return false;
  const { count } = await tx.generationBatch.updateMany({
    where: { id: lease.batchId, ownerId: lease.ownerId },
    data: { status: dispatchLeaseToken(lease.attemptId) },
  });
  return count === 1;
}

/**
 * 归还:派发结束(成功、部分成功、失败,都一样)。
 *
 * **只在还归自己时才清**,而且失败不上抛 —— 归还失败的唯一后果是这一批的租约要等到老死,
 * 那期间下一次确认会被挡住并被告知稍后再来。那是保守方向:残留的租约只会让后面更小心,
 * 绝不会让任何一笔钱走通。
 */
export async function releaseCampaignDispatch(
  db: Pick<PrismaClient, "generationBatch">,
  lease: Pick<CampaignDispatchLease, "ownerId" | "batchId" | "attemptId">,
): Promise<void> {
  try {
    await db.generationBatch.updateMany({
      where: { id: lease.batchId, ownerId: lease.ownerId, status: dispatchLeaseToken(lease.attemptId) },
      data: { status: BATCH_IDLE_STATUS },
    });
  } catch (error) {
    console.warn(
      "campaign-approval-lock: dispatch lease release failed (it will simply age out):",
      error instanceof Error ? error.message : error,
    );
  }
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
 *   - `stillDelivering`(#749)—— 这一批真会**交付**的还是商家签过的那一组条目吗,而且这一批
 *     **还归我派发**吗(租约续期,判官 r3 P1)。返回 null 放行,返回一句人话就拒绝。
 *   - `stillPriced`(#749)—— **这一格**的收费判决与费用,还是商家签名时的那一份吗。它拿的是
 *     startGen 在项目锁里算出的真判决,所以中间没有第二个时间窗。
 *
 * 后两项省略时,行为与 #744 出厂时逐字相同。
 */
export interface CampaignApprovalGate {
  ownerId: string;
  campaignId: string;
  stillApproved: (planJson: unknown) => boolean;
  stillDelivering?: (tx: ApprovalGateClient) => Promise<string | null>;
  /** 返回 null 放行;返回一句人话就拒绝(fail closed,回滚在 create/reserve 之前)。 */
  stillPriced?: (verdict: CampaignDispatchVerdict) => string | null;
}

/** The surface the gate needs from the money transaction's client — read + lock only.
 *  `genJob` is read-only history: the delivery face is re-derived from it, never written. */
export type ApprovalGateClient = Pick<PrismaClient, "$executeRaw" | "campaign" | "genJob" | "generationBatch">;

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
  let refusal: string | null;
  try {
    refusal = await gate.stillDelivering(tx);
  } catch (error) {
    console.warn(
      "campaign-approval-lock: delivery check failed before dispatch (nothing charged):",
      error instanceof Error ? error.message : error,
    );
    throw new CampaignApprovalGateRefused(CAMPAIGN_DELIVERY_CHECK_UNKNOWN, "retryable");
  }
  if (refusal) throw new CampaignApprovalGateRefused(refusal, "conflict");
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
