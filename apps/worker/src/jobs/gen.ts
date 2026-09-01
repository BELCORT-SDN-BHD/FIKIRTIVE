/**
 * Shot/session generation handler (redesign Gen space). Mirrors handleRefGen's
 * money-safety, but the output is a Generation candidate (source GENERATED),
 * optionally bound to a shot — the same row uploadCandidates writes.
 *
 *  - exactly-once spend: provider runs only when the job has no recorded
 *    generationIds; a retry after a crash resumes from stored rows.
 *  - validate before spend: project (+ shot) re-checked owned/live; gone →
 *    terminal-fail without spending.
 *  - conditioning reachable: a real provider refuses to silently drop to
 *    unconditioned t2i when the entity refs can't be signed.
 *
 * Conditioning = the @mentioned entities' reference images, resolved here from
 * the job's entityIds (D19 trust boundary).
 */
import { prisma, settleCredits, refundReservation, settleCanvasCardsForGenJob, type GenJob, type RefundOutcome } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import {
  storageKey,
  newId,
  GEN_RETRY_LIMIT,
  GEN_QUEUE,
  videoDefaults,
  imageDefaults,
  conditioningCap,
  withReferenceMap,
  approvedEntityMap,
  type ReferenceSlot,
  type ReferenceSlotType,
  REF_VIDEO_MIN_SECONDS,
  REF_VIDEO_MAX_SECONDS,
  genSpentUsd,
  pricedGenCredits,
  isGuardrailPricedVideo,
  displayCredits,
  genJobEndedWithoutDelivering,
  merchantGenFailureMessage,
  type GenJobData,
  type GenModel,
  type GenVideoModel,
  type GenerationReceipt,
} from "@fikirtive/core";
import { storage } from "../storage.js";
import { captureMoneyPathError, founderAlert } from "../alerting.js";
import { sanitizeError, scrubUrls } from "../redact.js";
import { provider } from "../generation.js";
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";

/** 这一行 GenJob 的计价输入 —— 报价与报警必须看**同一个**对象,否则两边可能各算各的。 */
function genSpendInputOf(job: GenJob) {
  return {
    kind: job.kind as "IMAGE" | "VIDEO",
    model: job.model,
    count: job.count,
    referenceVideoGenerationId: job.referenceVideoGenerationId,
    videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null,
  };
}

/**
 * MONEY-A3 后半句:**结算路径落到护栏价就报警**。
 *
 * 护栏价按定义只该给「下架前存下的历史行」和「畸形 videoOptions JSON」兜底 —— 一条
 * **新**的付费任务走到护栏上,意思是请求侧的菜单闸(zod 契约 + assertSpendableModel)
 * 被绕过去了。那是要人看一眼的事,不是静静按一个更贵的价收一笔就算了。
 *
 * 只报警、不改钱:这一步跑在 settle 之后,商家已经收到片子、账也已经落定。`founderAlert`
 * 自己吞掉所有投递失败(返回空数组),所以 `await` 不可能把交付路弄崩;await 是照本文件
 * 既有报警的写法(`gen.paid_for_nothing`,见下),理由也一样 —— fire-and-forget 会让报警
 * 死在进程退出的竞态里。
 */
async function alertIfGuardrailPriced(job: GenJob, spendInput: ReturnType<typeof genSpendInputOf>): Promise<void> {
  if (!isGuardrailPricedVideo(spendInput)) return;
  const vo = spendInput.videoOptions;
  await founderAlert({
    key: "gen.video_guardrail_price",
    title: `一条视频按**护栏价**结算了:job ${job.id}(${job.model} / ${String(vo?.resolution ?? "(无分辨率)")} / ${String(vo?.seconds ?? "(无秒数)")}秒)—— 这一档没有菜单价`,
    action:
      "核对这一行是不是历史行(下架前存下的、或 videoOptions JSON 畸形)。若是**新**下的单,菜单闸被绕过去了:查请求侧的 zod 契约与 assertSpendableModel,别让第二单再走到这里。护栏价只保证不低于该档 65% 公式价,它不是 Founder 裁过的菜单价。",
    context: {
      genJobId: job.id,
      orgId: job.ownerId,
      kind: job.kind,
      model: job.model,
      resolution: vo?.resolution ?? null,
      seconds: vo?.seconds ?? null,
      chargedCredits: displayCredits(pricedGenCredits(spendInput)),
    },
  });
}

/**
 * #776 —— 这一单**引擎自报的真实计费量**,或者 null = 未知。
 *
 * 全报了才求和。**少一个就整单未知**,这是刻意的:图片一单是 count 次付费调用,一次没报
 * 就把剩下几次加起来,得到的是一个**偏低**的成本,而它会挨着 spentUsd 躺在同一行上,看起
 * 来像一个可以拿去对账的数。低估成本的假数字比空着危险得多 —— 毛利地板正是靠这类数守的。
 *
 * 单位是引擎自己的口径(图 = 张,视频 = token),由同一行的 kind 决定。
 * 纯函数,不读库、不参与任何 spend 判定。
 */
function jobBilledUnits(outputs: { receipt?: GenerationReceipt }[]): number | null {
  if (outputs.length === 0) return null;
  let total = 0;
  for (const o of outputs) {
    const units = o.receipt?.billedUnits;
    if (typeof units !== "number") return null; // 有一个没报 ⇒ 整单未知
    total += units;
  }
  return total;
}

/**
 * #776 —— 回执落库:**在钱的事务之外**,尽最大努力,永不抛。
 *
 * r1 把这两列写在 commit 事务**里面**(跟着 Generation.create 和 spent/spentUsd/settle 一起)。
 * 那样写的代价在判官那一轮被指出来,而它是真的:回执是**记账**,却因此有了否决**交付**的
 * 权力。`billedUnits` 是 PostgreSQL `INTEGER`,`finalPromptText` 是 `TEXT`(存不下 U+0000),
 * 而这两个值都来自**引擎的响应** —— 一个我们不控制的输入。引擎哪天报回一个溢出的数或一
 * 个带 NUL 的字符串,那次 INSERT 就会失败,整个事务回滚,四次重试全部撞同一堵墙,最后走到
 * 终态失败:一单**已经付过钱、已经做出来**的生成,因为一个记账字段而丢掉。
 *
 * 所以顺序改成:钱和产出先各自落定(与 #776 之前**逐字节相同**的那一笔事务),回执随后
 * 单独补写。补写失败 ⇒ 两列留 null,而 null 的语义本来就是「引擎没报,我们不知道」——
 * 一个我们本来就要如实展示的状态,不是一个需要拿钱去换的状态。
 *
 * 代价说清楚:这两列因此**不再**与 spentUsd 在同一次写入里冻结。值本身没变(都从同一批
 * `stored` 推出、描述同一单),换来的是「回执永远不能反过来影响钱路和交付」——这是本票
 * 的硬约束,而「同一次写入」只是它当初的一种实现口味。
 */
async function recordGenerationReceipts(
  job: { id: string; ownerId: string },
  rows: { generationId: string; receipt?: GenerationReceipt }[],
  billedUnits: number | null,
): Promise<void> {
  try {
    for (const row of rows) {
      const finalPrompt = row.receipt?.finalPrompt;
      if (finalPrompt === undefined) continue; // 没报 ⇒ 列留 null = 未知,绝不回落成商家那句
      await prisma.generation.updateMany({
        where: { id: row.generationId, ownerId: job.ownerId },
        data: { finalPromptText: finalPrompt },
      });
    }
    if (billedUnits !== null) {
      await prisma.genJob.updateMany({ where: { id: job.id, ownerId: job.ownerId }, data: { billedUnits } });
    }
  } catch (e) {
    // 记账写不进去就是记账写不进去 —— 已经交付的产出和已经结算的钱一个字节都不动。
    console.warn(`[gen] ${job.id}: receipt columns not recorded (left Unknown) — ${e instanceof Error ? e.message : String(e)}`);
    captureMoneyPathError(e, { event: "gen.receipt_not_recorded", jobId: job.id, orgId: job.ownerId });
  }
}

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp"
    : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime"
    : "image/jpeg";

// A GENERATING row older than this is treated as crashed/stale (its worker died or
// the message was redelivered past queue expiry). Kept ABOVE the realistic engine call
// time and BELOW the GEN/REFGEN queue expiry (20m), so an actively-running gen is
// never failed closed by a duplicate delivery, but a truly stuck one eventually is.
//
// #796/#760 — WHY CONCURRENCY DOES NOT MOVE THIS NUMBER. Every clock below is measured from
// a single job's OWN timestamp (startedAt / createdAt), and under `localConcurrency` each
// poller fetches, runs and finishes one job on its own clock. So a job's active window is its
// own duration, exactly as it was when the queue ran one job at a time — N in flight does not
// stretch any of these windows. (Under the `batchSize: N` + Promise.all shape it WOULD: a
// fast job stays `active` until the slowest job in its batch resolves, so the queue expiry
// would have to cover max(batch) instead of max(job). That is a second reason not to use it.)
// The invariants are pinned by clock-invariants.test.ts — change a number there too, or the
// suite fails, which is the point.
export const GEN_STALE_MS = 1000 * 60 * 18;
// The PROACTIVE reaper (reapStaleGenJobs) runs on its OWN timer, independent of pg-boss
// redelivery — so its cutoff must exceed the gen-queue expiry (GEN_QUEUE_POLICY.expireInSeconds
// = 20m). Otherwise it could fail-close a long (18–20m) engine call that pg-boss still considers
// alive, refunding the merchant + eating the founder's engine cost. The on-redelivery stale path
// keeps GEN_STALE_MS (a redelivery already implies the 20m expiry has passed).
export const GEN_REAP_MS = 1000 * 60 * 25;
// A job that has sat in QUEUED this long was never claimed by a worker (worker down / message
// lost). Fail it closed and refund — the credit hold would otherwise leak forever and the
// cowork chat spins on a stuck "making this…" indefinitely (audit GEN-6 / P0-11).
// Like GEN_REAP_MS, this proactive cutoff MUST exceed the gen-queue expiry (GEN_QUEUE_POLICY
// .expireInSeconds = 20m) plus retry backoff. A job can legitimately sit QUEUED past a few
// minutes while the worker is saturated (pg-boss still owns the message and will deliver it)
// or while a recoverable pre-charge retry is rescheduled (status reset to QUEUED, original
// createdAt kept). At 10m we fail-closed + refunded jobs pg-boss would still deliver — a false
// "you weren't charged" that pushes the user to resubmit a duplicate paid job. 25m clears that.
//
// #796: concurrency makes this cutoff SAFER, never tighter — the queue drains N times faster,
// so a job that is still QUEUED at 25 minutes is even more certainly a lost message than it was
// under the serial queue. Kept where it is: the F07 pg-boss liveness check below, not this
// wall-clock number, is what actually protects a job that is merely waiting its turn.
export const GEN_QUEUED_REAP_MS = 1000 * 60 * 25;
// #782 r13 (judge r12 P1-F1) — how long a DONE row is allowed to point at nothing before the
// reaper calls it what it is.
//
// Unlike every clock above, this one is NOT protecting a call that might still be running: a
// job's `generationIds` is written in the same transaction that settles its charge and BEFORE
// its DONE, so the instant a row says DONE its outputs are already final. Zero would be correct.
// It is ten minutes because a sweep that fails jobs closed should never be the FIRST thing to
// notice a row — if some other writer ever lands DONE ahead of its outputs, ten minutes lets it
// finish and this scan sees nothing, while a genuinely broken row still reaches the merchant's
// rescue path inside one sitting (the card's own fast watch is ~10 minutes wide).
export const GEN_DONE_EMPTY_GRACE_MS = 1000 * 60 * 10;

// Written onto the REFUND row so a later audit can tell THIS sweep's refunds from a merchant's
// cancel or an ordinary terminal failure ("this reservation has a REFUND" says nothing about who
// wrote it — see refundReservation's `reason` argument).
const DONE_WITHOUT_OUTPUT_REFUND_REASON = "gen:done-without-output";

// Thrown INSIDE the self-heal transaction to roll the FAILED flip back when the ledger says the
// charge was already SETTLED. See the scan for why that case must not be flipped.
const SETTLED_DONE_EMPTY = new Error("done-without-output-but-charge-settled");

// Thrown INSIDE the commit transaction to roll it back (discarding the just-created,
// user-visible Asset+Generation rows) when a redelivery has already FAILED+refunded the job
// mid-flight. A plain `return` would commit those rows = a free delivery. The store/commit
// retry loop recognizes this exact instance and discards instead of retrying or failing.
const REDELIVERY_DISCARD = new Error("redelivery-already-failed-and-refunded");

// The store+record step after the paid call is FREE and idempotent (content-addressed
// R2 put + one atomic tx) and the result bytes are already in memory — so a transient
// R2/DB hiccup is retried IN-PROCESS rather than terminal-failing a job we ALREADY paid
// for (a terminal FAILED+spent pushes the user to retry, paying a SECOND time). ~4 tries
// over a few seconds rides out a blip; a persistent outage still falls through to the
// terminal post-charge path. The provider is NEVER re-called here, so this cannot re-spend.
const STORE_COMMIT_ATTEMPTS = 4;
const STORE_COMMIT_BACKOFF_MS = 500;

/** Idempotently attach a job's stored generations to its shot: assign per-shot
 *  versions to any not-yet-attached one, set shotId+attachedAt, mark the shot
 *  ATTACHED. Runs on the happy path AND on resume, so a crash between recording
 *  the outputs and attaching them can never leave an attached render with no
 *  resume marker (the #2 fix — mirrors refgen's record-before-attach ordering).
 *  The version allocation retries on the partial-unique (shotId,version) index so
 *  two concurrent same-shot jobs can't both claim the same version (#6). */
async function attachToShot(shotId: string, generationIds: string[]): Promise<void> {
  // shot gone (deleted between gen-start and attach)? leave the outputs as
  // candidates (reusable) instead of failing the job or pointing at a dead shot.
  const shot = await prisma.shot.findFirst({ where: { id: shotId, deletedAt: null }, select: { id: true } });
  if (!shot) return;
  const gens = await prisma.generation.findMany({
    where: { id: { in: generationIds }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, shotId: true },
  });
  for (const g of gens) {
    if (g.shotId != null) continue; // already attached (resume) — skip, stays idempotent
    for (let attempt = 0; ; attempt++) {
      const last = await prisma.generation.findFirst({ where: { shotId, deletedAt: null }, orderBy: { version: "desc" }, select: { version: true } });
      try {
        await prisma.generation.update({ where: { id: g.id }, data: { shotId, attachedAt: new Date(), version: (last?.version ?? 0) + 1 } });
        break;
      } catch (e) {
        // a concurrent same-shot attach took that version → re-read + retry
        if (attempt < 5 && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
        throw e;
      }
    }
  }
  await prisma.shot.updateMany({ where: { id: shotId, deletedAt: null }, data: { status: "ATTACHED" } });
}

/** attachToShot with a few inline retries, swallowing a persistent failure: the
 *  outputs stay reusable candidates and the job still finishes DONE rather than
 *  stranding (a committed requeue could exhaust pg-boss retries). Used by BOTH the
 *  happy path and resume so they behave identically. */
async function attachBestEffort(jobId: string, shotId: string, generationIds: string[]): Promise<void> {
  for (let a = 0; a < 3; a++) {
    try { await attachToShot(shotId, generationIds); return; }
    catch (e) { if (a === 2) console.error(`[gen] ${jobId}: attach failed (candidates remain): ${e instanceof Error ? e.message : e}`); }
  }
}

/**
 * #782 r2 — how long the free last frame may hold up a paid clip's DONE.
 *
 * "Best-effort" has to mean best-effort against a HANG, not only against a fast throw. R2 and
 * Postgres do not always fail loudly; they sometimes just stop answering, and the three awaits
 * below sit between a settled charge and the merchant's DONE. Left unbounded, one stalled
 * connection would keep this job GENERATING until the queue expiry redelivered a clip we had
 * already paid for and already stored. Eight seconds is far past a real 1–2 MB PNG put plus two
 * small writes, and far short of every clock in the worker's chain, so it can only fire on a
 * genuine stall. Firing it means one storyboard link gets its first frame made by hand — the
 * pre-#782 behaviour.
 */
export const LAST_FRAME_STORE_TIMEOUT_MS = 8_000;

/**
 * #782 — store the clip's free last frame and point the job at it. Post-commit, best-effort.
 *
 * The frame is NOT an output: it is stored as an Asset only, and the job keeps a soft pointer
 * to it. Minting a Generation here would put a picture nobody asked for into the merchant's
 * candidate area after every single clip; the storyboard's continuation gate mints that row
 * later, and only for the frame it actually uses.
 *
 * Every failure is swallowed on purpose — including running out of time. This runs after the
 * charge is settled and the clip is committed, so the worst case is "this link of the storyboard
 * needs a first frame generated by hand", which is exactly what happened before this ticket
 * existed.
 *
 * #782 r4 (judge r3 P1-a) — THE POINTER WRITE STOPS AT DONE.
 *
 * A timeout abandons the WAIT, not the work: the losing store chain keeps running and can come
 * back seconds later. R3 let its final write land whenever it arrived, INCLUDING after the job
 * was already DONE — and the storyboard's continuation gate reads "DONE and no last frame" as
 * the final word, immediately opens the next shot for a PAID first frame, and charges the
 * merchant for a picture that was about to arrive free.
 *
 * So the pointer write is CONDITIONAL on the job still being GENERATING (it is: the commit
 * marker above only succeeds while we hold that claim, and DONE is written after this returns).
 * DONE is an UPDATE on the same row, so Postgres serializes the two on that row's lock and
 * re-checks the WHERE after waiting: a write that beats DONE counts, a write that arrives after
 * it matches zero rows and evaporates. That makes one sentence true by construction —
 *
 *     the instant a GenJob is DONE, its lastFrameAssetId is its final value
 *
 * — which is exactly the fact syncStoryboardMedia's gate③ relies on when it rules that a clip
 * can never hand a closing frame over. No new column, no migration, no timer to tune.
 */
async function storeLastFrameBestEffort(
  jobId: string,
  ownerId: string,
  frame: { bytes: Uint8Array; ext: string },
): Promise<void> {
  let stop: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const { contentHash } = await storage.put(ownerId, frame.bytes, frame.ext);
        const asset = await prisma.asset.upsert({
          where: { ownerId_contentHash: { ownerId, contentHash } },
          update: { deletedAt: null },
          create: {
            id: newId(), ownerId, contentHash, ext: frame.ext, mime: mimeForExt(frame.ext),
            sizeBytes: BigInt(frame.bytes.byteLength), originalFilename: `last-frame-${jobId}.${frame.ext}`,
            source: "GENERATED",
          },
        });
        const claimed = await prisma.genJob.updateMany({
          where: { id: jobId, ownerId, status: "GENERATING" },
          data: { lastFrameAssetId: asset.id },
        });
        if (claimed.count === 0) {
          // We came back after the job left GENERATING (timed out → DONE, or a redelivery
          // failed it). Dropping the pointer here is the POINT: downstream already read the
          // absence of a last frame as final and may have acted on it.
          console.warn(`[gen] ${jobId}: last frame stored but arrived after the job settled — pointer discarded`);
        }
      })(),
      new Promise<never>((_, reject) => {
        stop = setTimeout(() => reject(new Error("last frame store timed out")), LAST_FRAME_STORE_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.warn(`[gen] ${jobId}: last frame not stored (non-fatal, clip unaffected):`, e instanceof Error ? e.message : e);
  } finally {
    clearTimeout(stop);
  }
}

// D2: the worker is the DURABLE writer of a cowork job's result/error message. Post-commit +
// best-effort (like attachBestEffort): it can never throw into the completion path, never flip
// `committed`, never re-spend, never delay DONE. Exactly-once is the partial-unique index
// ChatMessage(genJobId) WHERE kind IN (GEN_RESULT,TURN_ERROR) — a resume/redelivery re-attempt
// hits P2002 and is swallowed.
//
// #782 r5 (judge r4 P1-①) — WHAT "BEST-EFFORT" IS ALLOWED TO COST. This swallows persistence
// failures on purpose, and nothing downstream retries it (a redelivery sees DONE and returns).
// That is only acceptable while this message is a DELIVERY of the outcome and never the RECORD
// of it: the record is GenJob.generationIds, written inside the commit transaction that settles
// the charge — so it exists before DONE and outlives any failure here. The storyboard's sync
// reads that column when this message is missing (apps/web/lib/storyboard-gate1-actions.ts,
// firstGenerationIdOf); before r5 it read only this message, and one swallowed error meant a
// paid frame could never reach the storyboard again. Anything else that starts depending on
// this row must read the job row the same way, or give this write a real backstop.
async function appendCoworkResult(
  job: { id: string; threadId: string | null; ownerId: string; kind: string; model: string },
  kind: "GEN_RESULT" | "TURN_ERROR",
  generationIds: string[],
  errorText = "",
  costCredits?: number,
): Promise<void> {
  if (!job.threadId) return;
  try {
    const last = await prisma.chatMessage.findFirst({ where: { threadId: job.threadId, ownerId: job.ownerId }, orderBy: { seq: "desc" }, select: { seq: true } });
    await prisma.chatMessage.create({
      data: {
        id: newId(), threadId: job.threadId, ownerId: job.ownerId, role: "AGENT", kind,
        seq: (last?.seq ?? 0) + 1, text: errorText,
        genJobId: job.id,
        payload: {
          kind: job.kind === "VIDEO" ? "video" : "image", model: job.model, generationIds,
          ...(kind === "GEN_RESULT" && typeof costCredits === "number" ? { costCredits } : {}),
        },
      },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return; // already written (resume) → no-op
    console.warn(`[gen] ${job.id}: ${kind} append failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

// #601 T2b / #612 T2c: the LAST step of a FINISHED job — write that job's cards on the canvas
// board, so a merchant who closed the tab comes back to every output they paid for, and to a
// definite ending for the work that never arrived instead of a card that spins for ever. Same
// contract as appendCoworkResult above and deliberately placed next to it at every call site: it
// runs ONLY after the job row is terminal and its charge is settled or refunded, it reads/writes
// no money column, no ledger, no provider, and it can never throw into the completion path. A
// failure is swallowed — a charge cannot be taken back, a card can be written again. What writes
// a DELIVERED job's cards again is NOT this path: once the job is DONE no redelivery and no
// stale-job scan will ever look at it, so the retry is the worker's canvas backfill sweep
// (apps/worker/src/jobs/canvas-backfill.ts). That sweep looks at DELIVERED jobs only, so a
// terminal card this call could not write is repaired by the board reader instead — which makes
// it T2d's business: whichever slice removes that read-time repair owes the terminal cards a
// backstop of their own (findCanvasSettlementBacklog is where it would go).
// Idempotent: settleCanvasCardsForGenJob no-ops on a board that already says this.
async function settleCanvasBoard(job: { id: string; ownerId: string }): Promise<void> {
  try {
    await settleCanvasCardsForGenJob(job.id, job.ownerId);
  } catch (e) {
    console.warn(`[gen] ${job.id}: canvas settlement failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

/**
 * A job's own status is decided ONCE, by whoever gets there first (#602 r2, judge P1-2).
 *
 * Every terminal write below is conditional on the row still being in flight, and this is the
 * list it is conditional on. The reason is a race the whole file is otherwise careful about:
 * `handleGen` snapshots the job row at the top and then runs a long sequence of gates against
 * that snapshot. A merchant can press Cancel anywhere in that window — `cancelGenJob` matches
 * QUEUED, writes CANCELLED and refunds — and an UNCONDITIONAL terminal write afterwards would
 * silently rewrite their decision to FAILED and post "I couldn't finish that one" on top of it.
 * (No double refund either way: `refundReservation` is idempotent on `refund:<jobId>`. What was
 * lost was the truth about who stopped the job.)
 *
 * The same shape the reaper has always used, applied to the two writes that lacked it.
 */
const GEN_IN_FLIGHT_STATUSES = ["QUEUED", "GENERATING"] as const;

/** Finish a job whose outputs are already COMMITTED (generationIds recorded — and the commit
 *  tx settles atomically with that write, so committed ⟹ charged-and-settled): idempotent
 *  attach → DONE + settle (no-op if already) → GEN_RESULT → otto resume. Shared by handleGen's
 *  redelivery-resume path and the reaper's committed-but-stuck scan. NEVER re-spends, never
 *  refunds — the only correct terminal state for a committed job is DONE-with-attach. Safe
 *  against a concurrently-finishing winner: money steps are idempotent (settle P2002 no-op,
 *  DONE re-assert, GEN_RESULT unique-indexed, otto at-most-once), and attachToShot tolerates
 *  the concurrent-attach race via its (shotId, version) P2002 retry — the identical race
 *  already exists between a redelivery-resume and the original delivery. */
async function resumeCommittedGenJob(job: GenJob): Promise<void> {
  // Free-delivery guard (Codex P1, 2026-07-03): in current worker code, outputs on the row
  // imply the commit tx settled the charge (settle is atomic with the outputs write, and every
  // refund path flips status away from GENERATING in the same tx, which makes the conditional
  // commit discard). But a LEGACY row (pre-conditional-commit / pre-F04-guard era) or a future
  // out-of-worker refund path can carry outputs while a REFUND won the finalizer index — the
  // merchant got their money back, so delivering now would be a FREE delivery. Fail it closed
  // instead, WITHOUT refunding again.
  const refunded = await prisma.creditLedger.findFirst({
    where: { orgId: job.ownerId, refId: job.id, kind: "REFUND" },
    select: { id: true },
  });
  if (refunded) {
    console.warn(`[gen] ${job.id}: outputs recorded but a REFUND won the finalizer — failing closed, not delivering`);
    // Guarded like every other terminal write in this file (#602 r2, judge P1-2). A committed job
    // is GENERATING, so no cancel can be racing it — but "this particular terminal write happens
    // to be unreachable by that race" is a fact that rots, and one unconditional status write is
    // all it takes to overwrite somebody else's truth later.
    const { count } = await prisma.genJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, status: { in: [...GEN_IN_FLIGHT_STATUSES] } },
      data: { status: "FAILED", error: "outputs were recorded but the charge was refunded — not delivering (free-delivery guard)", finishedAt: new Date() },
    });
    // accurate terminal message (idempotent via the genJobId unique index): refund won → not charged
    if (count > 0) {
      await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
    }
    await settleCanvasBoard(job);
    return;
  }
  if (job.shotId) await attachBestEffort(job.id, job.shotId, job.generationIds);
  await prisma.$transaction(async (tx) => {
    await tx.genJob.update({
      where: { id: job.id },
      data: {
        status: "DONE", progress: 100, finishedAt: new Date(), error: "", spent: true,
        // defensive backfill: a row committed before spentUsd existed (or a partial
        // write) has the marker but null spentUsd — reconstruct from the frozen job
        // inputs. Never overwrites a value the commit tx already froze.
        ...(job.spentUsd == null ? { spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } : {}),
      },
    });
    // settle the hold (idempotent: P2002 no-op if a prior delivery's commit tx
    // already settled; no-op if there was no reservation). Outputs exist → the
    // generation succeeded → the charge becomes permanent.
    await settleCredits(tx, { orgId: job.ownerId, refId: job.id });
  });
  const resumeSpendInput = genSpendInputOf(job);
  await appendCoworkResult(job, "GEN_RESULT", job.generationIds, "", displayCredits(pricedGenCredits(resumeSpendInput))); // idempotent — P2002 swallowed if already written
  await alertIfGuardrailPriced(job, resumeSpendInput);
  await settleCanvasBoard(job);
  // #791-4: the automatic post-generation "does this look right?" Otto turn used to run
  // here — and bill for itself. Founder ruling 2026-08-08: the merchant can see the result
  // and decide for themselves, so the round is gone, not merely made free.
}

/** Terminal-fail a job that NEVER delivered AND release its credit hold, atomically.
 *  Used by every pre-commit fail-closed branch (no outputs recorded) so a merchant is
 *  never charged for a generation they didn't receive.
 *
 *  CONDITIONAL: `count === 0` means someone else already ended this job (a cancel, the reaper, a
 *  concurrent delivery). They wrote the truth and did their own money and messaging; this path
 *  says nothing further — but it still settles the board, so the card learns whatever ending did
 *  land.
 *
 *  #782 r17(判官 r16 P1-2)—— **翻转以钱为条件**,与第 4 扫的自愈逐字同形。
 *
 *  每个调用点都是「花钱之前」的闸,所以它们全都相信「这一单还什么都没交付」。那个前提是
 *  **调用方内存里那份快照**说的,不是这一刻的库说的:一条迟到的重投可以在提交事务落库之前
 *  把行读进内存(generationIds 还是空的,于是 resume 那条路认不出它),然后一路走到这里 ——
 *  而此时原 worker 的提交事务已经落定(产出 + SETTLE 同一笔),DONE 却还没写,行仍是
 *  GENERATING。旧写法只看状态:它把一条**已经收了钱、也已经交付了**的作业写成 FAILED,
 *  拿到 already-settled 也照走,还发一句「你没有被扣钱」。原 worker 随后把 DONE 写回去。
 *
 *  那一段 FAILED 不是无害的中间态:FAILED 与 CANCELLED 在整个产品里只承诺一件事 ——
 *  「你没有被扣钱」(不变量见 apps/web/lib/storyboard-gate1-actions.ts 的 JOB_DEAD_STATUSES)。
 *  分镜的编辑闸就是照这句话放行的:读到 FAILED 即视作「预扣已退、什么都没交付」,于是删掉
 *  指针 —— 而第 5 步那个写回 DONE 的 update 不取卡锁,#782 r15 的串行化管不到它。
 *
 *  所以这里问 refundReservation **到底做了什么**(#858 的四态答复),只在商家确实没有出钱时
 *  才保留翻转:
 *    • refunded / already-refunded / no-reservation —— 那句话是真的,照翻。
 *    • already-settled —— 钱**收了**。翻转整笔回滚(行留在 GENERATING,让原 worker 的 DONE
 *      按它本来的样子落地),一个字都不对商家说,并大声报错。这里不是决定「要不要把钱还
 *      回去」的地方 —— 那是一笔已经正确收下的钱。
 *
 *  产出那一格也一并复核:`generationIds` 非空 ⟺ 提交事务落过(它与 SETTLE 同一笔),这样的
 *  行永远不是「什么都没交付」。谓词写进 where,于是「已交付的作业不许被这条路终结」不再靠
 *  调用点自觉,而是条件写自己保证。 */
const SETTLED_PRE_SPEND_FAIL = new Error("pre-spend fail-close but the charge is already settled");

async function failClosedWithRefund(
  job: { id: string; ownerId: string; threadId: string | null; kind: string; model: string },
  error: string,
): Promise<void> {
  let ended = false;
  try {
    ended = await prisma.$transaction(async (tx) => {
      const { count } = await tx.genJob.updateMany({
        where: {
          id: job.id, ownerId: job.ownerId, status: { in: [...GEN_IN_FLIGHT_STATUSES] },
          // committed ⟹ delivered-and-settled — never terminable by a pre-spend gate.
          generationIds: { isEmpty: true },
        },
        data: { status: "FAILED", error, finishedAt: new Date() },
      });
      if (count === 0) return false;
      const outcome = await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
      if (outcome === "already-settled") throw SETTLED_PRE_SPEND_FAIL; // roll the flip back
      return true;
    });
  } catch (e) {
    if (e !== SETTLED_PRE_SPEND_FAIL) throw e;
    console.error(`[gen] ${job.id}: a pre-spend gate wanted to fail this job closed, but the charge is already SETTLED — the delivery beat us to it. Left in flight on purpose: FAILED would promise a refund that never happened, and the storyboard edit gate reads FAILED as "dead, safe to unlink". Reason was: ${error}`);
    captureMoneyPathError(e, { event: "gen.fail_closed_blocked_by_settle", jobId: job.id, orgId: job.ownerId, gateReason: error });
  }
  // Tell the cowork UI the turn is over (idempotent via the genJobId unique index).
  // Without a terminal message the client polls forever on a stuck "making this…".
  // Generic, reassuring text; the specific reason stays in GenJob.error for ops.
  // Only when WE ended it: the winner posted its own terminal message, and a cancel's message
  // must not be replaced by an apology for a failure that did not happen.
  if (ended) {
    await appendCoworkResult(job, "TURN_ERROR", [], "I couldn't finish that one — and you weren't charged. Want to try again?");
  }
  await settleCanvasBoard(job);
}

/** Proactive reaper: a job the worker hung/crashed on during its FINAL attempt can sit in
 *  GENERATING forever — pg-boss never redelivers it, so the on-claim stale path (above) never
 *  runs, the credit hold never releases, and the UI spins. Run on a timer to fail-close +
 *  refund + post a terminal message for any GENERATING row older than the stale window. The
 *  conditional updateMany is the at-most-once claim (a late finisher or another instance wins
 *  instead), so this is safe under concurrency and never clobbers a DONE. A third scan
 *  RESUMES (never refunds) committed-but-stuck rows — outputs recorded but the finisher
 *  crashed and no redelivery will ever come (see the inline comment on that scan). */
/** F07: does pg-boss still hold a deliverable message for this QUEUED gen job? Under the serial
 *  (batchSize:1) queue, a paid job can wait past the 25-min wall-clock cutoff behind a burst of
 *  long video jobs — but if its message is still created/retry/active, pg-boss WILL deliver it,
 *  so fail-closing here would spuriously refund a job that's about to run. Only a QUEUED job whose
 *  message is truly lost/expired-to-DLQ (no live row) should be reaped. Matched by the payload's
 *  genJobId, robust even when the best-effort queueJobId persist failed. Fails SAFE: if pg-boss
 *  state can't be read, assume a live message may exist and skip the reap this sweep (a delayed
 *  reap is far better than refunding a live paid job). */
async function hasLiveGenMessage(genJobId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM pgboss.job
      WHERE name = ${GEN_QUEUE} AND state IN ('created', 'retry', 'active')
        AND data->>'genJobId' = ${genJobId}
      LIMIT 1`;
    return rows.length > 0;
  } catch (e) {
    console.warn(`[gen] pg-boss liveness check failed for ${genJobId}; skipping reap this sweep:`, e instanceof Error ? e.message : e);
    return true;
  }
}

/**
 * 这一单**实际被扣掉**多少(商家看得懂的口径),读不到就 null(= unknown,绝不猜)。
 *
 * 直接从 SETTLE 那一行算,而不是重新按价目表推导:报警里那个数字要能拿去跟账本对,
 * 所以它必须是账本自己说的。settleCredits 写的是 `balanceDelta = B - A`、
 * `reservedDelta = -B`(B=预扣,A=实扣),于是 A = -reservedDelta - balanceDelta。
 * 只在报警路径上用,失败一律吞掉——报警读不到金额,也不该把巡检拖下水。
 */
async function settledDisplayCredits(orgId: string, refId: string): Promise<number | null> {
  try {
    const settle = await prisma.creditLedger.findFirst({
      where: { orgId, refId, kind: "SETTLE" },
      select: { balanceDelta: true, reservedDelta: true },
    });
    if (!settle) return null;
    return displayCredits(-settle.reservedDelta - settle.balanceDelta);
  } catch {
    return null;
  }
}

/**
 * 「这一行的 paid-for-nothing 报警,是不是第一次发?」—— 返回 true 表示这一趟拿到了首发权。
 *
 * 为什么必须有它:那一行是**故意不清理**的(翻成 FAILED 会许下一句没发生的退款),而巡检
 * 每 5 分钟来一趟。没有这道闸,一行卡住就是每天约 288 封邮件 + 288 条 Telegram —— 而那把
 * `RESEND_API_KEY` 与商家登录的魔法链接是同一把:一条报警足以把登录打挂。报警把自己变成
 * 事故,是这一族缺陷里最难看的一种。
 *
 * 用 ActionEvent 的主键做一次性标记,形状照抄同仓已有的做法(stripe webhook 的
 * `stripe_failed:<sessionId>`):**由数据库唯一约束裁决,不是 check-then-act**,所以两个巡检
 * 同时扫到同一行也只有一个拿到首发权。刻意不动 GenJob 行、不动账本 —— 那一行「一个字都不动」
 * 本身就是这条分支的语义。
 *
 * 失败方向是 fail-OPEN:只有**确凿的主键冲突**(P2002)才降级为重复;任何其它写库故障都当作
 * 首发,宁可多发一条也不让一次 DB 抖动把「商家付了钱什么都没拿到」永久静音。这和同仓
 * stripe 分支「告警至少一次,DB 故障不许消音」是同一条纪律。
 */
async function claimPaidForNothingAlert(job: { id: string; ownerId: string }): Promise<boolean> {
  try {
    await prisma.actionEvent.create({
      data: {
        id: `gen_paid_for_nothing:${job.id}`,
        ownerId: job.ownerId,
        type: "gen.paid_for_nothing",
        payload: { genJobId: job.id, alertedAt: new Date().toISOString() },
      },
    });
    return true;
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return false;
    console.warn(`[gen] ${job.id}: could not record the paid-for-nothing alert marker; alerting anyway:`, e instanceof Error ? e.message : e);
    return true;
  }
}

export async function reapStaleGenJobs(): Promise<number> {
  return runAsSystem("gen-reaper", async () => {
    const cutoff = new Date(Date.now() - GEN_REAP_MS);
    const queuedCutoff = new Date(Date.now() - GEN_QUEUED_REAP_MS);
    // generationIds isEmpty EXCLUDES a job that has already committed its outputs (the commit
    // marker writes generationIds while status is briefly still GENERATING, before the DONE
    // flip). Without this, the reaper could fail-close + post a false "you weren't charged"
    // TURN_ERROR on a job that WAS charged and DID produce assets, and that terminal message
    // would win the single-message unique index, swallowing the real GEN_RESULT.
    const stuck = await prisma.genJob.findMany({
      where: { ownerId: { not: "" }, status: "GENERATING", startedAt: { lt: cutoff }, generationIds: { isEmpty: true } },
      select: { id: true, ownerId: true, threadId: true, kind: true, model: true },
    });
    let reaped = 0;
    for (const job of stuck) {
      let failedClosed = false;
      // #463 per-row phase: the scan above is cross-tenant, this refund is not.
      await runAsTenant(job.ownerId, async () => {
        await prisma.$transaction(async (tx) => {
          const staled = await tx.genJob.updateMany({
            where: { id: job.id, ownerId: job.ownerId, status: "GENERATING", startedAt: { lt: cutoff }, generationIds: { isEmpty: true } },
            data: { status: "FAILED", error: "stale GENERATING reaped — worker hung or crashed; refunded", finishedAt: new Date() },
          });
          if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
        });
        if (failedClosed) {
          await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
          await settleCanvasBoard(job);
          reaped++;
        }
      });
    }

    // Reap jobs stuck in QUEUED: worker never picked them up (worker down / message lost).
    // The conditional updateMany (where: { status: "QUEUED" }) is the at-most-once claim —
    // it loses to a worker that simultaneously claims the job (QUEUED→GENERATING), so we
    // never clobber a job that just started. generationIds isEmpty EXCLUDES a committed job
    // that was requeued by a post-commit blip and then lost its message: it was CHARGED
    // (settled) and has outputs, so fail-closing it would post a FALSE "you weren't charged"
    // TURN_ERROR that wins the single-terminal-message index over the real GEN_RESULT — the
    // committed-but-stuck scan below finishes it instead.
    const stuckQueued = await prisma.genJob.findMany({
      where: { ownerId: { not: "" }, status: "QUEUED", createdAt: { lt: queuedCutoff }, generationIds: { isEmpty: true } },
      select: { id: true, ownerId: true, threadId: true, kind: true, model: true },
    });
    for (const job of stuckQueued) {
      // F07: skip a job pg-boss will still deliver (serial-queue starvation, not a lost message).
      if (await hasLiveGenMessage(job.id)) continue;
      let failedClosed = false;
      // #463 per-row phase (the pg-boss liveness check above is platform state, not tenant data).
      await runAsTenant(job.ownerId, async () => {
        await prisma.$transaction(async (tx) => {
          const failed = await tx.genJob.updateMany({
            where: { id: job.id, ownerId: job.ownerId, status: "QUEUED", createdAt: { lt: queuedCutoff }, generationIds: { isEmpty: true } },
            data: { status: "FAILED", error: "queued too long — worker never picked it up; refunded", finishedAt: new Date() },
          });
          if (failed.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
        });
        if (failedClosed) {
          await appendCoworkResult(job, "TURN_ERROR", [], "That one didn't start in time — the generator may be busy. You weren't charged; please try again.");
          await settleCanvasBoard(job);
          reaped++;
        }
      });
    }

    // Committed-but-stuck scan (Codex adversarial review, 2026-07-03): a job whose commit tx
    // landed (generationIds + settle written, status still GENERATING) but whose delivery
    // crashed before attach/DONE can be unreachable by redelivery — the LAST redelivery may
    // have snapshotted the row pre-commit (bypassing the resume short-circuit), lost the
    // claim, been correctly blocked by the isEmpty guards, and returned; or the message
    // dead-lettered. Both fail-close scans above skip committed rows BY DESIGN, so without
    // this scan the job sits GENERATING+charged forever (no result message, and for refgen
    // the active-index slot stays hostage). Committed ⟹ settled ⟹ the ONLY correct terminal
    // state is DONE-with-attach — so RESUME it exactly like a redelivery would (idempotent
    // attach + DONE + settle no-op + GEN_RESULT): no fail-close, no refund, no re-spend.
    // QUEUED covers a committed job requeued by a post-commit blip whose message then died.
    // FAILED is deliberately EXCLUDED (Codex P1): for QUEUED/GENERATING rows the current
    // worker invariants guarantee outputs ⟹ settle won, but a legacy FAILED row can carry
    // outputs while a REFUND won the finalizer — those stay inert (already terminal; a
    // redelivery that resumes one is caught by the free-delivery guard in the helper).
    // startedAt < cutoff (25m > queue expiry): any live delivery has finished or hung by
    // then, and a concurrent finisher is safe anyway (every step is idempotent).
    // Per-job try/catch: one bad row must not halt the sweep — it retries next sweep.
    const committedStuck = await prisma.genJob.findMany({
      where: { ownerId: { not: "" }, status: { in: ["QUEUED", "GENERATING"] }, startedAt: { lt: cutoff }, generationIds: { isEmpty: false } },
    });
    for (const job of committedStuck) {
      try {
        // #463 per-row phase: resume fans out into attach + DONE + settle + a ChatMessage
        // write — all of it belongs to this job's owner.
        await runAsTenant(job.ownerId, () => resumeCommittedGenJob(job));
        console.log(`[gen] reaper finished committed-but-stuck job ${job.id} → DONE (no re-spend, no refund)`);
        reaped++;
      } catch (e) {
        console.error(`[gen] reaper resume failed for ${job.id} (retries next sweep):`, e instanceof Error ? e.message : e);
        captureMoneyPathError(e, { event: "gen.reaper_resume_failed", jobId: job.id, orgId: job.ownerId });
      }
    }

    // DONE-with-nothing self-heal (#782 r13, judge r12 P1-F1). A row that says DONE and cannot
    // point at a single Generation is a state no surface has an honest word for: "absent" claims
    // nothing was ever spent, the old result claims a replacement succeeded, and "dead" promises
    // a refund. The merchant is left with a spinner nothing updates, or an entrance that bills
    // them again.
    //
    // Going forward the shape is unreachable — handleGen's zero-output guard fails closed and
    // refunds before anything is stored, so DONE ⟹ generationIds is non-empty by construction.
    // This scan exists for rows that ALREADY carry it: the commit marker landed 2026-06-13
    // (98f789e7) and the output-count check only on 2026-07-15 (#325, 1fae4dbc), so for a month
    // a provider that returned nothing wrote exactly this row — marker with an empty array,
    // charge settled beside it, DONE on top.
    //
    // THE FLIP IS CONDITIONAL ON THE MONEY, not merely on the row. FAILED and CANCELLED carry one
    // promise everywhere they are read — "you weren't charged" — and it is true today only
    // because every path to those two words releases the hold in the same transaction that writes
    // them (the invariant `JOB_DEAD_STATUSES` states in apps/web/lib/storyboard-gate1-actions.ts).
    // So we ask refundReservation what it actually DID (#858's four-state answer) and keep the
    // flip only where the merchant is provably not out of pocket:
    //   • refunded         — we released the hold. Flip, and say "you weren't charged".
    //   • already-refunded — someone else released it first. Flip; the sentence is still true,
    //                        and we take no credit for their refund.
    //   • no-reservation   — nothing was ever held (a pre-credits row). Flip.
    //   • already-settled  — THE CHARGE STANDS. Flipping would make every surface promise a
    //                        refund that did not happen, so the flip is rolled back and the row
    //                        is raised loudly instead. Putting that merchant right means moving
    //                        money that was correctly taken, and a background sweep is not where
    //                        that decision gets made.
    const doneEmptyCutoff = new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS);
    const doneEmpty = await prisma.genJob.findMany({
      // finishedAt is written by BOTH DONE writers in the same update as the status, so a DONE
      // row always has one — no row hides from this scan behind a null.
      where: { ownerId: { not: "" }, status: "DONE", generationIds: { isEmpty: true }, finishedAt: { lt: doneEmptyCutoff } },
      select: { id: true, ownerId: true, threadId: true, kind: true, model: true },
    });
    for (const job of doneEmpty) {
      // Per-row try/catch, like the resume scan above: one bad row must not halt the sweep.
      try {
        let healed = false;
        // #463 per-row phase: the scan above is cross-tenant, the refund and the message are not.
        await runAsTenant(job.ownerId, async () => {
          let outcome: RefundOutcome | null;
          try {
            outcome = await prisma.$transaction(async (tx) => {
              // The conditional updateMany is the at-most-once claim, and it re-asserts every
              // predicate: a concurrent resume that recorded outputs (or another instance's
              // sweep) makes this match zero rows, and we then say nothing at all.
              const { count } = await tx.genJob.updateMany({
                where: { id: job.id, ownerId: job.ownerId, status: "DONE", generationIds: { isEmpty: true }, finishedAt: { lt: doneEmptyCutoff } },
                data: { status: "FAILED", error: "DONE with no outputs recorded — nothing was ever delivered; reaped and refunded", finishedAt: new Date() },
              });
              if (count === 0) return null;
              const o = await refundReservation(tx, { orgId: job.ownerId, refId: job.id, reason: DONE_WITHOUT_OUTPUT_REFUND_REASON });
              if (o === "already-settled") throw SETTLED_DONE_EMPTY; // roll the flip back
              return o;
            });
          } catch (e) {
            if (e !== SETTLED_DONE_EMPTY) throw e;
            console.error(`[gen] ${job.id}: DONE with no outputs AND the charge is settled — this merchant paid for nothing. Left untouched on purpose: FAILED would promise a refund that never happened. Needs a founder decision.`);
            // 整顿 C1a:这句求救过去只落 console.error,而生产日志没有人二十四小时盯着——
            // 一句「需要 founder 裁决」事实上说给了没有人。三条通道一起发,`await` 是故意的:
            // 这一趟巡检不差这几百毫秒,而 fire-and-forget 会让报警死在进程退出的竞态里。
            //
            // 首发权由 claimPaidForNothingAlert 的主键裁决:这一行**故意不清理**,而巡检每 5
            // 分钟来一趟,所以第二趟起只让 Sentry 承载(它本来就是按 key 聚类计数的那一层,
            // 「这一行今天被扫到几次」正好归它答),邮件与 Telegram 不再打扰人。
            const firstAlert = await claimPaidForNothingAlert(job);
            await founderAlert(
              {
                key: "gen.paid_for_nothing",
                title: "A merchant paid for a generation and received nothing",
                action:
                  "Decide this one by hand — nothing automatic can fix it. The job is DONE with zero outputs and the charge is SETTLED, so the sweep deliberately left the row alone (flipping it to FAILED would promise a refund that never happened). Refund in the credits ledger if that is the call.",
                context: {
                  genJobId: job.id,
                  orgId: job.ownerId,
                  kind: job.kind,
                  model: job.model,
                  chargedCredits: await settledDisplayCredits(job.ownerId, job.id),
                  // 重复那几条要一眼看得出是重复,否则 Sentry 里读起来像「又出了一单」。
                  repeatOfEarlierAlert: !firstAlert,
                },
              },
              { repeat: !firstAlert },
            );
            return;
          }
          if (outcome === null) return; // someone else ended this row — their truth stands
          healed = true;
          // Idempotent via the genJobId unique index; a GEN_RESULT that was somehow written for
          // this empty job wins it, and this is best-effort exactly like every other call site.
          await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
          await settleCanvasBoard(job);
          console.log(`[gen] ${job.id}: DONE with no outputs → FAILED (${outcome})`);
        });
        if (healed) reaped++;
      } catch (e) {
        console.error(`[gen] reaper self-heal failed for ${job.id} (retries next sweep):`, e instanceof Error ? e.message : e);
        captureMoneyPathError(e, { event: "gen.reaper_self_heal_failed", jobId: job.id, orgId: job.ownerId });
      }
    }

    return reaped;
  });
}

export async function handleGen(data: GenJobData, retryCount: number): Promise<void> {
  const job = await runAsSystem("worker-job-dispatch", async () =>
    prisma.genJob.findUnique({ where: { id: data.genJobId } }),
  );
  if (!job) {
    console.error(`[gen] job ${data.genJobId} missing — dropping`);
    return;
  }
  // DONE is terminal/idempotent. FAILED is handled INSIDE the try, AFTER the resume
  // check, so a committed job (outputs recorded) that a prior delivery wrongly left
  // FAILED can still finish via attach+DONE without re-spending.
  if (job.status === "DONE") return;
  // #463: the payload carries only the job id, so the tenant is knowable only after the row
  // load above. Everything from here — the provider call, the credit settle/refund and the
  // commit transaction — runs scoped to this job's owner.
  await runAsTenant(job.ownerId, async () => {

    // P2: the worker SETTLES the held charge at the commit point and REFUNDS it on every
    // terminal failure. settle/refund read the released amount FROM the RESERVE ledger row
    // (startGen wrote it), so the worker never recomputes a price → release == reserve always.

    // flips true the instant the paid provider call returns — a failure after this
    // but BEFORE the commit point must terminal-fail (a retry would re-spend).
    let spent = false;
    // flips true once outputs are stored + recorded (generationIds written): past
    // here a failure is RECOVERABLE — requeue so the resume path re-attaches without
    // re-spending, never terminal-fail (which would block resume).
    let committed = false;

    try {
      // RESUME FIRST: outputs already stored + recorded (generationIds) on a prior
      // delivery → finish the idempotent attach + DONE, never re-spending. Runs BEFORE
      // the terminal short-circuit and the project/shot validation, so a deleted shot or
      // a wrongly-FAILED-but-committed job still completes (attachToShot no-ops if the
      // shot is gone; the candidate generations remain, reusable) (#2/#3).
      if (job.generationIds.length > 0) {
        committed = true; // outputs recorded on a prior delivery — never re-spend; finish best-effort
        await resumeCommittedGenJob(job);
        return;
      }
      // Terminal with no recorded outputs — nothing to resume. This asks "did it END", not "did it
      // FAIL" (#602 T3): a message pg-boss still delivers for a job the merchant cancelled would
      // otherwise walk on into the pre-spend gates below, and a deleted project there would
      // fail-close it — overwriting CANCELLED with FAILED and posting "I couldn't finish that
      // one" for something they stopped on purpose. (No double refund either way:
      // refundReservation is idempotent on `refund:<jobId>` — but the merchant would have been
      // told a lie about their own decision.)
      if (genJobEndedWithoutDelivering(job.status)) return;

      const project = await prisma.project.findFirst({ where: { id: job.projectId, ownerId: job.ownerId, deletedAt: null } });
      if (!project) {
        await failClosedWithRefund(job,"project gone before generation ran");
        return;
      }
      if (job.shotId) {
        // scope the shot to THIS job's project — a job must not animate (or spend
        // on) a shot/source image belonging to another project.
        const shot = await prisma.shot.findFirst({ where: { id: job.shotId, projectId: job.projectId, ownerId: job.ownerId, deletedAt: null } });
        if (!shot) {
          await failClosedWithRefund(job,"shot gone or not in this project before generation ran");
          return;
        }
      }

      // Atomic spend claim: QUEUED → GENERATING in a single conditional update.
      // Only one delivery can win the transition, so concurrent or duplicate
      // deliveries can never both reach the provider. Losing the claim means
      // either another delivery already owns the job, or a prior attempt reached
      // GENERATING and died (a hard crash — a *caught* provider error resets
      // status→QUEUED, which re-claims safely). A lost claim MAY mean a paid call
      // already happened, so fail the stuck GENERATING row closed rather than risk
      // a double charge — but only GENERATING, never clobbering a winner's DONE.
      const claim = await prisma.genJob.updateMany({
        where: { id: job.id, ownerId: job.ownerId, status: "QUEUED" },
        data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        // lost the QUEUED→GENERATING claim. If the owning attempt is still RECENT it's
        // ACTIVELY running (a duplicate delivery) — leave it alone. Only a STALE
        // GENERATING (the attempt crashed, or was redelivered past expiry) is failed
        // closed, since re-running a paid job risks a double charge.
        let failedClosed = false;
        await prisma.$transaction(async (tx) => {
          const staled = await tx.genJob.updateMany({
            // generationIds isEmpty: never fail-close a job that already committed outputs (a
            // redelivery landing in the commit→DONE window) — its real GEN_RESULT must win.
            where: { id: job.id, ownerId: job.ownerId, status: "GENERATING", startedAt: { lt: new Date(Date.now() - GEN_STALE_MS) }, generationIds: { isEmpty: true } },
            data: { status: "FAILED", error: "stale GENERATING after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
          });
          // refund only if WE just failed it closed (count>0) — never touch the hold of an
          // actively-running winner. The merchant didn't get a result; the founder absorbs
          // any real engine cost on the possibly-paid call.
          if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
        });
        // Only when WE failed it closed (not when an active winner still owns it): tell the
        // cowork UI the turn is over so it stops polling on a stuck "making this…".
        if (failedClosed) {
          await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
          await settleCanvasBoard(job);
        }
        return;
      }

      // OPT-6 P2 (highest-trust): a job whose model was admin-disabled AFTER it was queued
      // must FAIL WITHOUT SPENDING. Still before any provider call — but now AFTER the claim.
      //
      // #647 T6 修复轮 r2 P1-R2-1:这道闸原本站在 claim **前面**,而 r1 把它的失败语义从
      // 「回空集合」改成「抛 PLAIN」之后,那个位置就成了一条 exactly-once 的洞:
      // 一个**重复** delivery 只要在这里读失败,抛出去的错就会落进通用 catch,而 catch 的
      // requeue 会把状态写回 QUEUED —— 那一行可能正被另一个 delivery 拿着调 provider。
      // 于是活跃 winner 被打回 QUEUED、重投再 claim 再调 provider = 同一单付两次。
      //
      // 挪到 claim 之后,这条路就不存在了:能走到这里的,一定是**刚刚亲手赢下 claim** 的那个
      // delivery,这一行就是它的。requeue 自己的行天经地义,而输掉 claim 的 delivery 早在上面
      // 那个分支返回了 —— 它连读都不会读。
      //
      // 抛的仍然是 PLAIN:落进 catch ⇒ requeue、预扣挂着、零 provider 调用;重试用尽才终态 +
      // 退款。「不知道有没有被关」绝不许当成「没被关」往下走 —— 往下走一步就是真花钱。
      const disabled = await workerDisabledModels();
      if (isModelDisabled(job.model, disabled)) {
        await failClosedWithRefund(job,"this model was turned off before the job ran — not spending");
        return; // terminal, no throw → no retry, no spend
      }

      // resolve conditioning PER @mentioned entity, scoped to the variant it selected
      // (Phase C). A bare mention → the entity's base refs (variantId null); a selected
      // variant → only that variant's refs. A selected variant with zero live refs is a
      // permanent, user-fixable condition (its images were deleted) → terminal-fail
      // BEFORE the paid call so a retry can't later find none and we never spend on a
      // degraded result. (The guardian also blocks this pre-spend; this is the race
      // backstop for refs deleted between that check and now.)
      const variantSel = (job.variantSel as Record<string, string> | null) ?? {};
      const perEntity: { asset: { ownerId: string; contentHash: string; ext: string } }[][] = [];
      // #774 U2:编号要说出「<Image_2> 是谁」,所以这里顺手记下每个 @元素的身份。
      // 顺序 = job.entityIds 顺序 = perEntity 顺序 —— 三者共用同一趟循环。
      //
      // #774 判官 r2 P1 —— **名字只来自审批快照**(`job.approvedEntities`,由 startGen 在
      // 批准那一刻冻结),绝不来自这里现读的活行。元素名是商家随时能改的自由文本,现读
      // 等于:批准之后改一次名,就能把没过审批的指令送进这次已经批准的付费调用。
      // 快照里没有的元素 → `name: null` → 编号句照写,只是不写名字(降级方向是少一个
      // 名字,不是多一条没批准的指令)。类型可以来自活行:它是四选一的枚举 —— beta bug 4
      // 起商家能改它,但改到的永远是那四个值之一,结构上写不进指令。改类型这个动作本身在
      // 作业在飞期间被 `updateEntity` 挡着(apps/web/lib/actions.ts),挡的是下面那道定锚闸
      // 被抽走,不是这一句。
      const approvedById = approvedEntityMap(job.approvedEntities);
      const entityMeta: { id: string; type: ReferenceSlotType; name: string | null }[] = [];
      for (const entityId of job.entityIds) {
        const variantId = variantSel[entityId] ?? null;
        // the parent entity must still be live + owned. softDeleteEntity doesn't cascade to
        // refs, so an entity deleted AFTER the guardian check would otherwise leave live refs
        // the worker would spend on. (Guardian blocks a deleted entity pre-spend; this is the
        // race backstop.)
        const liveEntity = await prisma.entity.findFirst({ where: { id: entityId, ownerId: job.ownerId, deletedAt: null }, select: { id: true, type: true } });
        if (!liveEntity) {
          await failClosedWithRefund(job,"an @mentioned element was deleted — remove it and try again");
          return;
        }
        if (variantId) {
          // the variant must still be live + owned — a soft-delete AFTER the guardian
          // check must not let us spend. (deleteVariant cascades its refs, so found
          // would also be empty, but don't rely on that invariant here — verify the
          // variant directly, mirroring the VARIANT refgen worker.)
          const liveVariant = await prisma.entityVariant.findFirst({ where: { id: variantId, entityId, ownerId: job.ownerId, deletedAt: null }, select: { id: true } });
          if (!liveVariant) {
            await failClosedWithRefund(job,"an @mentioned variant was deleted — pick another or use the base");
            return;
          }
        }
        const found = await prisma.referenceImage.findMany({
          where: { entityId, variantId, ownerId: job.ownerId, deletedAt: null },
          orderBy: { position: "asc" },
          include: { asset: true },
        });
        if (variantId && found.length === 0) {
          await failClosedWithRefund(job,"an @mentioned variant has no image to condition on — generate it first, or use the base");
          return;
        }
        // bare mention (no variant) of a CHARACTER whose base refs resolve to zero →
        // terminal-fail BEFORE the paid call, so an unanchored character can't slip
        // through to an unconditioned t2i spend when the (fail-OPEN) guardian faults.
        // Only CHARACTER must be anchored — LOCATION/PRODUCT/BRANDMARK with 0 refs are an
        // intended t2i, mirroring castFindings' "character-no-refs" rule.
        if (!variantId && liveEntity.type === "CHARACTER" && found.length === 0) {
          await failClosedWithRefund(job,"a @mentioned character has no base reference image — add one first");
          return;
        }
        perEntity.push(found);
        const approved = approvedById.get(liveEntity.id);
        entityMeta.push({ id: liveEntity.id, type: approved?.type ?? liveEntity.type, name: approved?.name ?? null });
      }
      // cap the aggregate at the model's input limit, ROUND-ROBIN across entities so an
      // early entity with many base refs can't starve a later @mentioned variant of its
      // conditioning (which would spend without the requested variant). On the image side
      // MAX_GEN_ENTITIES(8) ≤ the cap(10), so round 0 always seats ≥1 ref for every mention
      // that has one; on the video side the cap can be smaller, and whatever gets left behind
      // is disclosed on the card BEFORE approval (referenceBudget.truncated).
      //
      // #785 — the cap is NOT a local literal any more: `conditioningCap` (@fikirtive/core) is
      // the ONE place that knows it, and `referenceBudget` (what the card counts) reads the same
      // function. A video job's ceiling depends on how many image_url slots its frames take, so
      // it is derived from the job's OWN shape — the same shape the card had at approval time.
      const refCap = conditioningCap({
        kind: job.kind === "VIDEO" ? "video" : "image",
        hasVideoStartFrame: !!(job.sourceGenerationId || job.shotId),
        hasVideoTailFrame: !!job.tailGenerationId,
        hasReferenceVideo: !!job.referenceVideoGenerationId,
      });
      // #774 U2:每张上车的图连它属于哪个 @元素一起记 —— 编号(`<Image_N>`)就是从这里
      // 长出来的,与 `inputImageUrls` 同一趟循环、同一个下标,所以两者不可能各说各话。
      // 名额被 `refCap` 截掉的那些图从来没上过车,所以也永远拿不到编号 —— 「说的几张」
      // 「送的几张」「第几张是谁」在被截断的那一档同样只有这一份答案。
      const cappedRefs: { entity: number; asset: { ownerId: string; contentHash: string; ext: string } }[] = [];
      for (let round = 0; cappedRefs.length < refCap; round++) {
        let progressed = false;
        for (const [entity, refsForEntity] of perEntity.entries()) {
          const ref = refsForEntity[round];
          if (!ref) continue;
          cappedRefs.push({ entity, asset: ref.asset });
          progressed = true;
          if (cappedRefs.length >= refCap) break;
        }
        if (!progressed) break;
      }
      const inputImageUrls: string[] = [];
      /** 与 `inputImageUrls` 逐项同步的槽位身份(编辑底图 unshift 时一起 unshift)。 */
      const refSlots: ReferenceSlot[] = [];
      for (const ref of cappedRefs) {
        const signed = await storage.presignedGet(storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext), 3600);
        if (signed) {
          inputImageUrls.push(signed);
          const meta = entityMeta[ref.entity]!;
          refSlots.push({ kind: "entity", entityId: meta.id, type: meta.type, name: meta.name });
        }
      }
      const isMock = provider.name === "mock";
      if (!isMock && cappedRefs.length > 0 && inputImageUrls.length < cappedRefs.length) {
        throw new Error(`conditioning refs unreachable (${inputImageUrls.length}/${cappedRefs.length}) — refusing to spend`);
      }

      // frozen provenance snapshot (same shape as uploadCandidates)
      const entities = await prisma.entity.findMany({
        where: { id: { in: job.entityIds }, ownerId: job.ownerId },
        include: { referenceImages: { where: { deletedAt: null }, include: { asset: true } } },
      });
      const entitySnapshot = {
        entities: entities.map((e) => {
          // record WHICH variant conditioned this gen + only that variant's ref hashes
          // (base = variantId null), so provenance reflects what was actually sent.
          const variantId = variantSel[e.id] ?? null;
          const refsForHash = e.referenceImages.filter((r) => r.variantId === variantId);
          return { id: e.id, name: e.name, type: e.type, variantId, refHashes: refsForHash.map((r) => r.asset.contentHash) };
        }),
      };

      // THE paid call — exactly once per job. Image: t2i/edit. Video (i2v):
      // animate the shot's latest IMAGE generation into a clip.
      let outputs: { bytes: Uint8Array; ext: string; receipt?: GenerationReceipt }[];
      // #782 — the clip's free last frame, if the engine returned one. Persisted AFTER the
      // commit point (see below), never inside it: it is not a paid output and must never be
      // able to roll back, delay, or fail the delivery of a clip the merchant already paid for.
      let lastFrame: { bytes: Uint8Array; ext: string } | undefined;
      // #914 r4 —— 生成回执「平台到底把哪一句交给了引擎」的**唯一**记录点。
      //
      // 为什么在这里而不在写提示词的那一端(判官 r3 定案):web 层记不到真话 —— 到这里
      // 之前提示词还会再被拼一次(#774 的参考图编号句就是下面那趟循环现产的),入队时
      // 那几句根本还不存在。而五类花钱入口(画布 / 工厂 / 战役 / 模板 / 详情页编辑 /
      // Otto)全都汇到这一个发送点,所以记在这里是**结构性**的全覆盖:覆盖不靠逐个入口
      // 接线,将来多一个入口也漏不掉。
      //
      // 纪律:下面两个分支都把**这一个变量**交给 provider(不是各自现算一遍再抄一份),
      // 落库落的也是它 —— 记录与实发之间没有第二个可以漂移的表达式。
      let sentPrompt = job.prompt;
      if (job.kind === "VIDEO") {
        // i2v source priority: an explicit owned still (Gen space upload→animate)
        // → the shot's latest still (Storyboard Animate) → none (text-to-video).
        // The source is always resolved server-side from an owned id (D19).
        let imageUrl = "";
        let sourceAsset: { ownerId: string; contentHash: string; ext: string } | null = null;
        if (job.sourceGenerationId) {
          const src = await prisma.generation.findFirst({
            where: { id: job.sourceGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
            include: { asset: true },
          });
          if (!src) {
            await failClosedWithRefund(job,"image-to-video source not found (or not an image) in this project");
            return;
          }
          sourceAsset = src.asset;
        } else if (job.shotId) {
          const sourceGen = await prisma.generation.findFirst({
            where: { shotId: job.shotId, deletedAt: null, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
            orderBy: { version: "desc" }, include: { asset: true },
          });
          if (!sourceGen) {
            // permanent user error (no still yet) — fail closed so a retry can't
            // later find a fresh image and spend on it.
            await failClosedWithRefund(job,"no source image to animate — generate an image for this shot first");
            return;
          }
          sourceAsset = sourceGen.asset;
        }
        if (sourceAsset) {
          imageUrl = (await storage.presignedGet(storageKey(sourceAsset.ownerId, sourceAsset.contentHash, sourceAsset.ext), 3600)) ?? "";
          if (provider.name !== "mock" && !imageUrl) throw new Error("source image unreachable — refusing to spend on i2v");
        }
        // #646: an end frame with NO start frame used to fall through the `&& sourceAsset`
        // guard below — the tail silently vanished and the merchant was charged for an
        // ordinary clip. `genRequest` now rejects that shape at enqueue, so this only catches
        // a job queued before that rule; either way it must never spend. Permanent (a retry
        // can't grow a start frame), so fail closed with the refund, like its siblings above.
        if (job.tailGenerationId && !sourceAsset) {
          await failClosedWithRefund(job, "an end frame needs a start frame — pick a source image, or a shot that has one");
          return;
        }
        // optional end frame (last-frame i2v): interpolate source→tail. Resolved
        // server-side from an owned id, and only meaningful with a start image.
        let tailImageUrl = "";
        if (job.tailGenerationId && sourceAsset) {
          const tail = await prisma.generation.findFirst({
            where: { id: job.tailGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
            include: { asset: true },
          });
          if (!tail) {
            await failClosedWithRefund(job,"last-frame image not found (or not an image) in this project");
            return;
          }
          tailImageUrl = (await storage.presignedGet(storageKey(tail.asset.ownerId, tail.asset.contentHash, tail.asset.ext), 3600)) ?? "";
          if (provider.name !== "mock" && !tailImageUrl) throw new Error("last-frame image unreachable — refusing to spend on i2v");
        }
        // Whole-clip reference video (整段视频参考). Resolved server-side from an owned,
        // in-project, video-ext Generation; fail-closed if set-but-missing (never spend).
        let refVideoUrl = "";
        if (job.referenceVideoGenerationId) {
          const rv = await prisma.generation.findFirst({
            where: { id: job.referenceVideoGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["mp4", "mov", "webm"] } } },
            include: { asset: true },
          });
          if (!rv) {
            await failClosedWithRefund(job, "reference video not found (or not a video) in this project");
            return;
          }
          // Margin guard: BytePlus bills reference-video input by duration while our charge is
          // fixed at the 6s-input/5s-output costing model. The composer gates 2–6s client-side; re-enforce here from
          // ingest's ffprobe (Asset.durationS). null = probe pending/failed → allow (the async
          // ingest race is the NORMAL flow right after attach; the client already gated it).
          const refDur = rv.asset.durationS;
          if (refDur != null && (refDur < REF_VIDEO_MIN_SECONDS || refDur > REF_VIDEO_MAX_SECONDS)) {
            await failClosedWithRefund(job, `reference video must be ${REF_VIDEO_MIN_SECONDS}–${REF_VIDEO_MAX_SECONDS}s (this clip is ~${Math.round(refDur)}s)`);
            return;
          }
          refVideoUrl = (await storage.presignedGet(storageKey(rv.asset.ownerId, rv.asset.contentHash, rv.asset.ext), 3600)) ?? "";
          if (provider.name !== "mock" && !refVideoUrl) throw new Error("reference video unreachable — refusing to spend");
        }
        // per-model controls chosen in the composer (resolved + stored at enqueue);
        // fall back to the legacy fixed duration if an older job has none.
        const vo = job.videoOptions as { seconds?: number; resolution?: string; aspectRatio?: string; fps?: number; audio?: boolean } | null;
        // #785 —— @元素(产品图 / 代言人)的参考照真的进视频引擎。
        //
        // `inputImageUrls` 就是上面 round-robin 选出来、逐张 presign 成功的那一批(选片上限
        // 已由 `conditioningCap` 按这一单的场景算好:带首帧/末帧/参考视频的档上限为 0,
        // 所以那些档这里天然是空数组,与卡面说的 0 张一致)。数组**顺序即引擎收到的顺序**,
        // 没有第二次挑选、第二次排序 —— 「说的几张」「送的几张」「第几张是谁」共用这一份。
        //
        // 花钱安全:上面那道 presign 完整性闸(`inputImageUrls.length < cappedRefs.length`
        // 就抛)已经保证「少一张就不花钱」,所以到这里要么全都在,要么根本没走到这一行。
        const video = await provider.generateVideo({
          prompt: sentPrompt, imageUrl, tailImageUrl: tailImageUrl || undefined,
          refVideoUrl: refVideoUrl || undefined,
          ...(inputImageUrls.length > 0 ? { refImageUrls: inputImageUrls } : {}),
          durationSeconds: vo?.seconds ?? videoDefaults(job.model as GenVideoModel).seconds,
          resolution: vo?.resolution, aspectRatio: vo?.aspectRatio, fps: vo?.fps, audio: vo?.audio,
          model: job.model,
          // #782 — always ask for the clip's last frame. It is FREE (the engine bills the
          // render, and the still comes out of that same render), so there is no price to
          // weigh against: the only question is whether the frame exists when something
          // later wants it, and the answer has to be yes at generation time or never. A
          // storyboard that turns on continuation AFTER its first clip rendered cannot go
          // back and ask for a frame of a video that is already delivered.
          returnLastFrame: true,
        });
        lastFrame = video.lastFrame;
        outputs = [video];
      } else {
        // F09: an "edit @composer" from DetailPanel sets sourceGenerationId on an IMAGE job —
        // condition the gen on that owned still (resolved server-side from an owned id, D19) so a
        // paid edit relates to the image the user was viewing, not an unconditioned fresh gen.
        // Prepended so it's the primary reference (byteplus sends inputImageUrls[0] first; with
        // multi-reference conditioning the @ref images ride along after it). Pre-spend.
        if (job.sourceGenerationId) {
          const src = await prisma.generation.findFirst({
            where: { id: job.sourceGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
            include: { asset: true },
          });
          if (!src) { await failClosedWithRefund(job, "edit source image not found (or not an image) in this project"); return; }
          const srcUrl = (await storage.presignedGet(storageKey(src.asset.ownerId, src.asset.contentHash, src.asset.ext), 3600)) ?? "";
          if (provider.name !== "mock" && !srcUrl) throw new Error("edit source image unreachable — refusing to spend");
          if (srcUrl) {
            inputImageUrls.unshift(srcUrl);
            refSlots.unshift({ kind: "baseImage" }); // 底图坐第 0 位 → 它就是 <Image_1>
          }
        }
        // #642: the shape the merchant bought, frozen onto the job at enqueue. A legacy row
        // (or a malformed snapshot) has none → the model's default square, which is exactly
        // what those runs produced before the column existed.
        const io = job.imageOptions as { aspectRatio?: unknown; coherentSet?: unknown } | null;
        const aspectRatio = typeof io?.aspectRatio === "string"
          ? io.aspectRatio
          : imageDefaults(job.model as GenModel).aspectRatio;
        // #774 U2:官方编号句由**这里**产出 —— `refSlots` 与 `inputImageUrls` 是同一趟
        // 循环装的同一个次序,所以 `<Image_2>` 说的一定就是引擎收到的第 2 张。写提示词
        // 的那一端反而编不了:那时谁有几张活图、商家挂没挂底图、镜头后来被改成了别的
        // 元素,统统还不知道。零参考图 → 零编号句 → prompt 原样。
        //
        // #777:「这几张是一组连贯的图」同样是**冻在任务上**的那份规格,不是这里现算的。
        // 只认写死的 true —— 快照里没有这一格(既有行、散图行)就是散图,与今日逐字一致。
        const coherentSet = io?.coherentSet === true;
        // #914 r4:编号句在这一行才长出来 —— 所以「实际送出的那一整句」也只有在这一行
        // 之后才存在。落库落的就是这个变量本身(见 sentPromptText 的写入)。
        sentPrompt = withReferenceMap(job.prompt, refSlots);
        outputs = await provider.generate({ prompt: sentPrompt, inputImageUrls, count: job.count, model: job.model as GenModel, aspectRatio, coherentSet });
      }
      spent = true; // the paid call has returned — past here, a failure must not retry
      // #782 r13 (judge r12 P1-F1) — THE WRITE-POINT INVARIANT: a DONE job can always point at
      // something it produced.
      //
      // Everything downstream reads DONE as "the merchant paid AND the result is reachable",
      // and it is entitled to: `generationIds` is written inside the very transaction that
      // settles the charge (the commit marker below), so the two facts land together. A DONE row
      // with an empty `generationIds` breaks that implication, and every reader then has to
      // invent a meaning for it — the storyboard's sync invented "absent" (which its own type
      // defines as "never started, never charged"), and the money guard read it as "not in
      // flight" and happily minted a second, second-billed card.
      //
      // So zero outputs stops here, one line ABOVE the store/commit loop, and takes the ordinary
      // terminal post-charge path: FAILED + `refundReservation` in one transaction, exactly like
      // the seven fail-closed branches above. Nothing is stored, no marker is written, DONE is
      // never reached. The count check right below already rejected this shape (job.count is
      // ≥ 1 at enqueue — packages/core/src/gen.ts), but it rejected it as an arithmetic mismatch;
      // stating the invariant in its own words is what stops the next person from "relaxing" the
      // count rule and reopening the hole underneath it.
      if (outputs.length === 0) {
        throw new Error("the engine returned nothing to deliver — failing closed so the hold goes back (a DONE job must be able to point at what it made)");
      }
      if (outputs.length !== job.count) {
        throw new Error(`provider returned ${outputs.length} outputs; expected ${job.count} outputs`);
      }

      // store every output's bytes in R2 FIRST (content-addressed → reusable on a
      // retry), THEN create the rows + write the resume marker ATOMICALLY in one
      // transaction, so a crash can never leave orphan candidate rows without a
      // marker. The marker (generationIds + spent) is the commit point: past it a
      // retry RESUMES (re-attaches) instead of re-spending. Attaching to the shot
      // happens AFTER, so an attached render can never exist without a resume marker
      // (the #2 fix — mirrors refgen's record-before-attach ordering).
      //
      // Both steps are FREE + idempotent (content-addressed put, atomic tx) and the paid
      // bytes are in memory, so a transient R2/DB hiccup is RETRIED in-process — never
      // terminal-failing a paid job (which would make the user retry and pay twice). The
      // provider is never re-called in this loop, so no retry here can re-spend.
      let generationIds: string[] = [];
      // #776:回执随字节一起走完这一段 —— 它属于**这一个**产出,顺序即绑定,不能靠事后按 id
      // 找回来。但它**不进**下面这笔事务:落库在事务提交之后单独补写
      // (recordGenerationReceipts),所以记账字段永远没有否决交付与结算的权力。声明提到循环
      // 外,只是为了提交后还读得到它;每次重试照旧从零重建(内容寻址 put 幂等,哈希不变)。
      let stored: { contentHash: string; ext: string; size: number; receipt?: GenerationReceipt }[] = [];
      for (let attempt = 1; ; attempt++) {
        try {
          stored = [];
          for (const img of outputs) {
            const { contentHash } = await storage.put(job.ownerId, img.bytes, img.ext);
            stored.push({ contentHash, ext: img.ext, size: img.bytes.byteLength, ...(img.receipt ? { receipt: img.receipt } : {}) });
          }
          generationIds = await prisma.$transaction(async (tx) => {
            const ids: string[] = [];
            for (const s of stored) {
              const asset = await tx.asset.upsert({
                where: { ownerId_contentHash: { ownerId: job.ownerId, contentHash: s.contentHash } },
                update: { deletedAt: null },
                create: { id: newId(), ownerId: job.ownerId, contentHash: s.contentHash, ext: s.ext, mime: mimeForExt(s.ext), sizeBytes: BigInt(s.size), originalFilename: `gen-${job.id}.${s.ext}`, source: "GENERATED" },
              });
              const gen = await tx.generation.create({
                data: {
                  id: newId(), ownerId: job.ownerId, projectId: job.projectId, shotId: null,
                  threadId: job.threadId ?? null, // cowork tag (null for normal studio gens) → keeps it out of candidate/asset views
                  assetId: asset.id, source: "GENERATED", promptText: job.prompt, modelRef: job.model,
                  // #914 r4 — the string we ACTUALLY handed the engine, taken from the very
                  // variable the paid call above was given. Unlike finalPromptText/billedUnits
                  // below, this is OUR OWN data (job.prompt was length-bounded by genRequest at
                  // enqueue; the reference-map lines are our own bounded text), never an
                  // engine-controlled response — nothing about it can make this insert fail, so
                  // it rides in the SAME commit as promptText rather than the post-commit
                  // best-effort receipt write. Always written on a row THIS handler creates, so a
                  // null in this column means the row is not the product of an engine call:
                  // it predates the column, or it came from an ingest path that never calls one
                  // (upload-actions, asset-actions.saveCroppedGeneration).
                  sentPromptText: sentPrompt,
                  entitySnapshot, version: 1, attachedAt: null,
                },
              });
              ids.push(gen.id);
            }
            // CONDITIONAL commit: write the resume marker + settle ONLY if we still own the
            // GENERATING claim. A duplicate delivery that expired our in-flight engine call (>20min
            // hang) may have already taken the stale-claim branch above → FAILED + refunded this
            // job. If so this matches 0 rows: THROW to ROLL BACK this whole transaction — the
            // Asset + Generation rows just created are USER-VISIBLE (project media/candidate
            // queries read Generation), so a plain `return` would COMMIT them = a free delivery.
            // Rolling back discards them; the founder absorbed the engine cost, the merchant stays
            // refunded (no free delivery, no DONE-vs-REFUND mismatch). The outer catch handles it.
            const marked = await tx.genJob.updateMany({
              where: { id: job.id, ownerId: job.ownerId, status: "GENERATING" },
              data: { generationIds: ids, spent: true, spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) },
            });
            if (marked.count === 0) throw REDELIVERY_DISCARD;
            // SETTLE the hold atomically with the resume marker — the generation succeeded,
            // so the reserved charge becomes permanent in the SAME tx that commits outputs.
            await settleCredits(tx, { orgId: job.ownerId, refId: job.id });
            return ids;
          });
          break; // stored + recorded — the resume marker is written
        } catch (storeErr) {
          // a redelivery already FAILED+refunded this job mid-flight: the commit tx threw the
          // discard sentinel and ROLLED BACK (no Asset/Generation rows persisted). Discard
          // cleanly — never retry (would re-create) and never terminal-fail (already FAILED).
          if (storeErr === REDELIVERY_DISCARD) {
            console.warn(`[gen] ${job.id}: redelivery already failed+refunded this job mid-flight — rolled back outputs, not delivering. Founder absorbed the engine cost.`);
            // 商家没损失(已退款),平台损失了一次真实的引擎调用。它不是缺陷,是竞态的正确
            // 结局——但它是**真钱**,零上报就等于没人知道它一天发生几次。
            captureMoneyPathError(storeErr, { event: "gen.founder_absorbed_engine_cost", jobId: job.id, orgId: job.ownerId, kind: job.kind, model: job.model });
            // MONEY-A13(规格 §7.5 平台损失台账):此前这里连**多少钱**都不记 —— 只有一条
            // 「发生过一次」的 Sentry 事件,而台账要的是金额。按这一单自己的参数现算 COGS
            // (与写进 spentUsd 的是同一个函数、同一批参数),再指路去登记。
            await founderAlert({
              key: "gen.founder_absorbed_engine_cost",
              title: "The platform paid for a generation nobody received (a redelivery had already refunded the merchant)",
              action:
                "No merchant action needed — they were refunded. Log the platform loss in docs/ops/manual-money-ledger.md (event = 吸收引擎成本) with the job id and the USD below.",
              context: {
                jobId: job.id,
                orgId: job.ownerId,
                kind: job.kind,
                model: job.model,
                absorbedUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }),
              },
            });
            return;
          }
          // exhausted: a persistent R2/DB outage. Re-throw to the terminal post-charge
          // path (FAILED + spent) — we can't hold the paid bytes forever in one process.
          if (attempt >= STORE_COMMIT_ATTEMPTS) throw storeErr;
          console.warn(`[gen] ${job.id}: store/commit attempt ${attempt}/${STORE_COMMIT_ATTEMPTS} failed, retrying (free, no re-charge) — ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`);
          await new Promise((r) => setTimeout(r, STORE_COMMIT_BACKOFF_MS * attempt));
        }
      }
      committed = true; // outputs stored + recorded — past here a failure resumes, never re-spends
      // #782 — park the free last frame, best-effort, AFTER the money is settled. Same
      // contract as attachBestEffort/appendCoworkResult below it: it can never throw into
      // the completion path, never re-spend, never delay DONE. A failure means one
      // storyboard link has to be filled by hand — the pre-#782 behaviour — which is a far
      // smaller harm than a paid clip that fails to deliver because a free extra didn't store.
      //
      // MUST stay above the DONE write: its pointer write is conditional on the job still being
      // GENERATING (#782 r4) — that is what makes "DONE and no last frame" final. Anything that
      // flips status must not come between this line and that condition.
      if (lastFrame) await storeLastFrameBestEffort(job.id, job.ownerId, lastFrame);
      // #776 —— 记账在钱之后。产出、resume marker、settle 都已经各自落定;这一步只往两列上补
      // 写引擎自报的事实,失败就留 null(= 未知),永不抛、不重试、不改状态。
      await recordGenerationReceipts(job, generationIds.map((generationId, i) => ({ generationId, ...(stored[i]?.receipt ? { receipt: stored[i]!.receipt } : {}) })), jobBilledUnits(stored));
      // best-effort attach: if it still fails, the outputs remain as reusable
      // candidates (visible, manually attachable) and we STILL mark DONE — never leave
      // the job stuck (a committed requeue could exhaust pg-boss retries) (#2)
      if (job.shotId) await attachBestEffort(job.id, job.shotId, generationIds);
      // Unconditional DONE is correct: the conditional MARKER above already discarded (early
      // return) the only racy ordering (a redelivery FAILED+refunded us BEFORE we committed). In
      // the reverse ordering (we settled first, a late redelivery then stale-FAILED us) the refund
      // no-ops against the won SETTLE, and this DONE correctly reasserts DONE over that transient
      // FAILED — keeping status DONE ⟺ settled. (A conditional DONE here would instead leave a
      // FAILED+settled+delivered mismatch in that ordering.)
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
      console.log(`[gen] ${job.id}: DONE → ${generationIds.length} generations via ${provider.name}`);
      const spendInput = genSpendInputOf(job);
      await appendCoworkResult(job, "GEN_RESULT", generationIds, "", displayCredits(pricedGenCredits(spendInput)));
      await alertIfGuardrailPriced(job, spendInput);
      await settleCanvasBoard(job);
    } catch (err) {
      // PERSISTED error surfaces in the admin UI — strip any signed URL / argv a
      // provider or subprocess error may carry. Full (URL-scrubbed) detail → logs.
      const message = sanitizeError(err);
      // a failure after the paid call is terminal — retrying would re-spend.
      // `spent` covers post-provider failures here; `charged` covers a failure
      // INSIDE the adapter after the engine already billed (it ran the model, then the
      // result parse/download threw). Only a genuinely pre-charge throw retries.
      const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
      // #765 — `permanent` is the OTHER reason to stop, and it asks a different question from
      // `charged`. Charged asks "did this cost money?"; permanent asks "can the same request
      // ever succeed?" The adapter marks it when the engine examined what the merchant sent and
      // refused it — a reference image showing a recognisable real person — which the same
      // picture earns every single time. Retrying buys nothing but minutes of the merchant's
      // day before the same non-answer.
      //
      // It changes WHEN we give up and nothing else: a permanent failure is provably free (a
      // 4xx rejected before the engine ran), so `spent` stays false, no spentUsd is recorded,
      // and the hold is refunded by the very same terminal branch every pre-charge failure
      // uses. Post-commit is still not terminal — `committed` wins, exactly as before.
      const permanent = typeof err === "object" && err !== null && (err as { permanent?: unknown }).permanent === true;
      // a POST-COMMIT failure (outputs stored + recorded) must NOT terminal-fail —
      // requeue so the resume path re-attaches without re-spending. Only a pre-commit
      // post-charge failure is terminal (charged, but no resume marker).
      const final = !committed && (spent || charged || permanent || retryCount >= GEN_RETRY_LIMIT);
      console.error(`[gen] ${job.id}: ${final ? "FAILED" : committed ? "requeue → resume attach" : "retrying"} — ${scrubUrls(err instanceof Error ? err.message : String(err)).slice(0, 1000)}`);
      if (final) {
        // terminal fail → release the hold (the merchant got no result; the founder
        // absorbs any real engine cost on a paid-but-undelivered call). A `final` failure
        // is by definition pre-commit (committed → final is false), so settle never ran;
        // and the finalizer unique index makes refund safe even against a racing settle.
        // A post-charge failure still records spent=true + spentUsd so "paid but not
        // delivered" stays auditable (told apart from a free pre-charge failure).
        // CONDITIONAL, like every other terminal write here (#602 r2, judge P1-2): a throw from a
        // gate that runs BEFORE the QUEUED→GENERATING claim reaches this branch on the last retry
        // while the row may still be QUEUED — so a cancel that landed meanwhile must not be
        // rewritten to FAILED. `count === 0` means someone else already ended the job and did
        // their own refund; ours would be a no-op anyway (idempotent on `refund:<jobId>`).
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.genJob.updateMany({
            where: { id: job.id, ownerId: job.ownerId, status: { in: [...GEN_IN_FLIGHT_STATUSES] } },
            data: { status: "FAILED", error: message, finishedAt: new Date(), spent: spent || charged, ...((spent || charged) ? { spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } : {}) },
          });
          if (count > 0) await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
        });
      } else {
        // recoverable pre-charge retry — requeue and keep the hold (the resume path
        // settles it on success, or a later terminal failure refunds it). GUARDED
        // conditional write: only requeue a row still QUEUED/GENERATING. If a finalizer
        // (reaper / stale fail-close) already FAILED+refunded this job mid-flight, the
        // updateMany matches 0 rows and we must NOT resurrect it — otherwise a redelivery
        // would run the paid call and deliver a free result against a refunded hold (F04).
        const requeued = await prisma.genJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: { in: ["QUEUED", "GENERATING"] } },
          data: { status: "QUEUED", error: message, progress: 0 },
        });
        if (requeued.count === 0) console.error(`[gen] ${job.id}: not requeued — a finalizer already owns it (FAILED/DONE); discarding this delivery`);
      }
      // User-facing chat text stays generic — the sanitized provider error is kept in
      // GenJob.error (ops/DB) — EXCEPT where the failure is one the merchant can act on
      // (#765). Then they read what was wrong and what to do about it, in the same words the
      // board reads back off `GenJob.error`: one sentence, one source, both entries.
      //
      // `merchantGenFailureMessage` is a WHITELIST over that same persisted string, never a
      // passthrough of it. GenJob.error also carries lines like "conditioning refs unreachable
      // (0/1) — refusing to spend", and forwarding whatever happened to be there would sooner
      // or later hand a merchant an internal error string as advice. Only a sentence this
      // system wrote for merchants comes back out; everything else keeps the generic apology.
      if (final) {
        await appendCoworkResult(
          job,
          "TURN_ERROR",
          [],
          merchantGenFailureMessage(message) ?? "That generation didn't go through — you can try again.",
        );
        // #612 T2c: this is the ordinary way a generation ends badly (the provider, or storing
        // what it returned). The card settles to that ending BEFORE the rethrow below, which
        // pg-boss needs — and, like every other call site, after the money transaction.
        await settleCanvasBoard(job);
      }
      // rethrow SANITIZED: pg-boss serializes the thrown error into its own job.output,
      // so throwing the raw `err` would re-leak any signed URL/argv it carries there.
      throw new Error(message);
    }
  });
}
