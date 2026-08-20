/**
 * Reference-generation handler (Phase 2 flagship). Mirrors the render job's
 * shape: load the RefGenJob, call the model provider, store outputs
 * content-addressed, attach them to the entity as ReferenceImages.
 *
 * This is a PAID call (byteplus in prod), so the money-safety invariants matter:
 *
 *  - exactly-once spend (codex review): an atomic QUEUED→GENERATING claim
 *    lets only one delivery reach the provider; outputAssetIds is written
 *    BEFORE attaching so a crash during attach resumes from stored assets.
 *    A failure AFTER the engine bills (res.ok, then parse/download/db) is terminal —
 *    the adapter marks it `charged` and the catch refuses to retry-and-re-
 *    charge; a lost claim (concurrent or crashed delivery) fails closed.
 *  - validate before spend (codex P1): the entity is re-loaded owned + live
 *    before the provider is called; a deleted/forged target terminal-fails
 *    without spending.
 *  - conditioning must be reachable (codex P1): if the entity has refs but
 *    the real provider can't fetch them, fail before spending rather than
 *    silently degrade to unconditioned text-to-image.
 *
 * Conditioning (D19 trust boundary): the request never carried image URLs —
 * the worker resolves them HERE from the entity's own references.
 */
import { prisma, Prisma, settleCredits, refundReservation, type RefGenMode, type RefGenJob } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import {
  storageKey,
  newId,
  REFGEN_QUEUE,
  REFGEN_RETRY_LIMIT,
  MAX_CONDITIONING_IMAGES,
  refgenSpentUsd,
  type RefGenJobData,
  type RefGenModel,
} from "@fikirtive/core";
import { storage } from "../storage.js";
import { captureMoneyPathError } from "../alerting.js";
import { provider } from "../generation.js";
import { sanitizeError, scrubUrls } from "../redact.js";
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";

/** Seedream edit caps total (inputs + outputs) at 15 images (codex P2). */
const MAX_EDIT_INPUT_PLUS_OUTPUT = 15;

// A GENERATING row older than this is treated as crashed/stale (mirrors gen.ts GEN_STALE_MS):
// kept above the realistic provider call time and below the queue expiry, so an actively-
// running gen is never failed-closed by a duplicate delivery, but a truly stuck one is.
export const REFGEN_STALE_MS = 1000 * 60 * 18;

// The proactive reaper's windows (mirror gen.ts GEN_REAP_MS / GEN_QUEUED_REAP_MS). Both sit
// ABOVE the 20-min queue expiry so the reaper never races a delivery pg-boss will still
// redeliver — it only sweeps jobs whose message is truly lost/dead-lettered (REFGEN_DLQ has
// no consumer), whose RESERVE hold would otherwise leak forever.
export const REFGEN_REAP_MS = 1000 * 60 * 25;
export const REFGEN_QUEUED_REAP_MS = 1000 * 60 * 25;

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

/**
 * #951 —— 与 gen.ts 的 GEN_IN_FLIGHT_STATUSES(#602 r2,判官 P1-2)同一道理:一个作业的终态
 * 只能被「第一个到场的人」决定一次,而下面每个调用点靠的都是**调用方内存里那份快照**,不是
 * 这一刻库里的真相。entity-gone / variant-gone 这两道闸都站在 claim **之前**——此时这一单
 * 是否已经被另一条并发的 delivery(迟到重投)赢下 claim、跑完 provider、连产出带结算一起
 * 提交,调用方并不知道。旧写法只认调用方自己的信念,无条件把行写成 FAILED——若那一刻产出
 * 已经提交、DONE 也已经写下,这一笔无条件写会把一单**已经收钱、已经交付**的作业重新盖成
 * FAILED,而它的 outputAssetIds/spentUsd 仍留着交付的痕迹,形成自相矛盾的行。
 */
const REFGEN_IN_FLIGHT_STATUSES = ["QUEUED", "GENERATING"] as const;

/** Thrown INSIDE failClosedRefund's transaction to roll the FAILED flip back when the ledger
 *  says the charge was already SETTLED (mirrors gen.ts's SETTLED_PRE_SPEND_FAIL). */
const REFGEN_SETTLED_PRE_SPEND_FAIL = new Error("pre-spend fail-close but the charge is already settled");

/** Terminal-fail a refgen job that NEVER delivered AND release its credit hold, atomically.
 *  refundReservation is idempotent and no-ops when there's no open reservation (historical
 *  job) or it was already settled — so every pre-commit fail-closed branch can call this.
 *
 *  #951 —— CONDITIONAL, like every terminal write in gen.ts (#602/#858): the FAILED flip only
 *  applies while the row is still in flight AND has recorded no outputs. `count === 0` means a
 *  concurrent delivery already ended this job (committed its outputs, or another finalizer got
 *  there first) — that write owns the truth, so this call does nothing further. If the flip DID
 *  land but refundReservation reports "already-settled" (the commit's SETTLE won a race against
 *  THIS transaction's own FAILED write), the whole transaction is rolled back instead of leaving
 *  a paid-and-delivered job shown FAILED — money was never at risk (refundReservation's own
 *  finalizer-once index blocks a real double-refund either way), but the row itself must not
 *  lie about what happened to it. */
async function failClosedRefund(jobId: string, ownerId: string, error: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.refGenJob.updateMany({
        where: {
          id: jobId, ownerId, status: { in: [...REFGEN_IN_FLIGHT_STATUSES] },
          // committed ⟹ delivered-and-settled — never terminable by a pre-spend gate.
          outputAssetIds: { isEmpty: true },
        },
        data: { status: "FAILED", error, finishedAt: new Date() },
      });
      if (count === 0) return;
      const outcome = await refundReservation(tx, { orgId: ownerId, refId: jobId });
      if (outcome === "already-settled") throw REFGEN_SETTLED_PRE_SPEND_FAIL; // roll the flip back
    });
  } catch (e) {
    if (e !== REFGEN_SETTLED_PRE_SPEND_FAIL) throw e;
    console.error(`[refgen] ${jobId}: a pre-spend gate wanted to fail this job closed, but the charge is already SETTLED — the delivery beat us to it. Left in flight on purpose: FAILED would promise a refund that never happened. Reason was: ${error}`);
    captureMoneyPathError(e, { event: "refgen.fail_closed_blocked_by_settle", jobId, orgId: ownerId, gateReason: error });
  }
}

/** F07-analog of gen.ts hasLiveGenMessage: does pg-boss still hold a deliverable message for
 *  this QUEUED refgen job? A paid job can wait past the 25-min wall-clock cutoff behind a
 *  congested worker — but if its message is still created/retry/active, pg-boss WILL deliver
 *  it, so fail-closing here would refund a job that then runs anyway (a free paid generation).
 *  Only a QUEUED job whose message is truly lost/expired-to-DLQ (no live row) should be reaped.
 *  Matched by the payload's refGenJobId, robust even when the best-effort queueJobId persist
 *  failed. Fails SAFE: if pg-boss state can't be read, assume a live message may exist and
 *  skip the reap this sweep (a delayed reap is far better than refunding a live paid job). */
async function hasLiveRefGenMessage(refGenJobId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM pgboss.job
      WHERE name = ${REFGEN_QUEUE} AND state IN ('created', 'retry', 'active')
        AND data->>'refGenJobId' = ${refGenJobId}
      LIMIT 1`;
    return rows.length > 0;
  } catch (e) {
    console.warn(`[refgen] pg-boss liveness check failed for ${refGenJobId}; skipping reap this sweep:`, e instanceof Error ? e.message : e);
    return true;
  }
}

/** Finish a refgen job whose outputs are already COMMITTED (outputAssetIds recorded — and the
 *  commit tx settles atomically with that write, so committed ⟹ charged-and-settled):
 *  idempotent attach → spentUsd backfill → settle (no-op if already) → DONE. Shared by
 *  handleRefGen's redelivery-resume path and the reaper's committed-but-stuck scan. NEVER
 *  re-spends, never refunds — the only correct terminal state for a committed job is
 *  DONE-with-attach. Safe against a concurrently-finishing winner on the MONEY side (settle
 *  P2002 no-op, DONE re-assert); attachOutputs is idempotent against sequential re-runs but
 *  a true concurrent double-attach can duplicate a (cosmetic, deletable) ReferenceImage —
 *  a pre-existing race this shares with redelivery-resume vs the original delivery. */
async function resumeCommittedRefGenJob(job: RefGenJob): Promise<void> {
  // Free-delivery guard (Codex P1, 2026-07-03): in current worker code, outputs on the row
  // imply the commit tx settled the charge. But a LEGACY row (pre-conditional-commit era) or
  // a future out-of-worker refund path can carry outputs while a REFUND won the finalizer
  // index — the merchant got their money back, so attaching + DONE now would be a FREE
  // delivery. Fail it closed instead (frees the active-index slot), WITHOUT refunding again.
  const refunded = await prisma.creditLedger.findFirst({
    where: { orgId: job.ownerId, refId: job.id, kind: "REFUND" },
    select: { id: true },
  });
  if (refunded) {
    console.warn(`[refgen] ${job.id}: outputs recorded but a REFUND won the finalizer — failing closed, not delivering`);
    // #951 漏网(M1-b):gen.ts 的同一处(resumeCommittedGenJob 的 free-delivery guard)早就是
    // 条件写了,refgen 这一处还留着无条件 update。理由与那边逐字相同:一个已经提交产出的行
    // **此刻**是 GENERATING,所以「没有别的终态能和它抢」在今天成立 —— 但「这一处恰好抢不到」
    // 是一条会烂掉的事实,而一次无条件状态写就足以在将来盖掉别人写下的真相。
    await prisma.refGenJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, status: { in: [...REFGEN_IN_FLIGHT_STATUSES] } },
      data: { status: "FAILED", error: "outputs were recorded but the charge was refunded — not delivering (free-delivery guard)", finishedAt: new Date() },
    });
    return;
  }
  await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds, job.variantId);
  // defensive backfill: a row that recorded outputs before spentUsd existed (or crashed
  // between the outputAssetIds write and DONE) has the marker but null spentUsd — reconstruct
  // from the frozen job inputs. No re-spend (paid already).
  if (job.spentUsd == null) {
    await prisma.refGenJob.update({ where: { id: job.id }, data: { spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } });
  }
  // settle the hold (idempotent: P2002 no-op if the original commit already settled;
  // no-op if there was no reservation). Outputs exist → the charge is permanent.
  await prisma.$transaction(async (tx) => { await settleCredits(tx, { orgId: job.ownerId, refId: job.id }); });
  await finalizeDone(job.id, job.mode, job.entityId, job.outputAssetIds[0]);
}

/** Proactive reaper for RefGenJob — the analog of reapStaleGenJobs (gen.ts). refgen's
 *  on-claim stale branch only runs on a pg-boss REDELIVERY; a job whose message is lost or
 *  dead-lettered on its final attempt (REFGEN_DLQ has no consumer) is never redelivered, so
 *  it sits GENERATING forever and its RESERVE hold leaks — and the partial-unique active
 *  index keeps blocking new generations for that entity/variant. This sweeps such jobs.
 *
 *  Each transition is a CONDITIONAL updateMany (the at-most-once claim): it loses to a worker
 *  that concurrently owns the job, so a live delivery is never clobbered. The fail-close
 *  branches require outputAssetIds isEmpty, so a job that already committed outputs (and
 *  was charged) is never fail-closed + refunded — a third scan RESUMES those instead (see
 *  the inline comment on that scan). Refund runs only when WE won a fail-close claim.
 *  No cowork message — refgen has no chat thread. Returns how many jobs it reaped. */
export async function reapStaleRefGenJobs(): Promise<number> {
  return runAsSystem("refgen-reaper", async () => {
    const cutoff = new Date(Date.now() - REFGEN_REAP_MS);
    const queuedCutoff = new Date(Date.now() - REFGEN_QUEUED_REAP_MS);
    let reaped = 0;

    const stuck = await prisma.refGenJob.findMany({
      where: { ownerId: { not: "" }, status: "GENERATING", startedAt: { lt: cutoff }, outputAssetIds: { isEmpty: true } },
      select: { id: true, ownerId: true },
    });
    for (const job of stuck) {
      // #463 per-row phase: the scan above is cross-tenant, this refund is not.
      await runAsTenant(job.ownerId, () => prisma.$transaction(async (tx) => {
        const staled = await tx.refGenJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: "GENERATING", startedAt: { lt: cutoff }, outputAssetIds: { isEmpty: true } },
          data: { status: "FAILED", error: "stale GENERATING reaped — worker hung or crashed; refunded", finishedAt: new Date() },
        });
        if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); reaped++; }
      }));
    }

    // outputAssetIds isEmpty EXCLUDES a committed job that was requeued by a post-commit blip
    // and then lost its message: it was CHARGED (settled) and has outputs, so fail-closing it
    // would show FAILED on a delivered charge — the committed-but-stuck scan below finishes it.
    const stuckQueued = await prisma.refGenJob.findMany({
      where: { ownerId: { not: "" }, status: "QUEUED", createdAt: { lt: queuedCutoff }, outputAssetIds: { isEmpty: true } },
      select: { id: true, ownerId: true },
    });
    for (const job of stuckQueued) {
      // F07-analog: skip a job pg-boss will still deliver (worker congestion, not a lost message).
      if (await hasLiveRefGenMessage(job.id)) continue;
      // #463 per-row phase (the pg-boss liveness check above is platform state, not tenant data).
      await runAsTenant(job.ownerId, () => prisma.$transaction(async (tx) => {
        const failed = await tx.refGenJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: "QUEUED", createdAt: { lt: queuedCutoff }, outputAssetIds: { isEmpty: true } },
          data: { status: "FAILED", error: "queued too long — worker never picked it up; refunded", finishedAt: new Date() },
        });
        if (failed.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); reaped++; }
      }));
    }

    // Committed-but-stuck scan (Codex adversarial review, 2026-07-03): a job whose commit tx
    // landed (outputAssetIds + settle written, status still GENERATING) but whose delivery
    // crashed before attachOutputs/finalizeDone can be unreachable by redelivery — the LAST
    // redelivery may have snapshotted the row pre-commit (bypassing the resume short-circuit),
    // lost the claim, been correctly blocked by the isEmpty guards, and returned; or the
    // message dead-lettered. Both fail-close scans above skip committed rows BY DESIGN, so
    // without this scan the job sits GENERATING+charged forever: its ReferenceImage rows are
    // never created (the user never sees what they paid for) and the partial-unique active
    // index keeps the entity/variant slot hostage. Committed ⟹ settled ⟹ the ONLY correct
    // terminal state is DONE-with-attach — so RESUME it exactly like a redelivery would
    // (idempotent attach + settle no-op + DONE): no fail-close, no refund, no re-spend.
    // QUEUED covers a committed job requeued by a post-commit blip whose message then died.
    // FAILED is deliberately EXCLUDED (Codex P1): for QUEUED/GENERATING rows the current
    // worker invariants guarantee outputs ⟹ settle won, but a legacy FAILED row can carry
    // outputs while a REFUND won the finalizer — those stay inert (already terminal; a
    // redelivery that resumes one is caught by the free-delivery guard in the helper).
    // Per-job try/catch: one bad row must not halt the sweep — retries next sweep.
    const committedStuck = await prisma.refGenJob.findMany({
      where: { ownerId: { not: "" }, status: { in: ["QUEUED", "GENERATING"] }, startedAt: { lt: cutoff }, outputAssetIds: { isEmpty: false } },
    });
    for (const job of committedStuck) {
      try {
        // #463 per-row phase: attach + settle + finalize all belong to this job's owner.
        await runAsTenant(job.ownerId, () => resumeCommittedRefGenJob(job));
        console.log(`[refgen] reaper finished committed-but-stuck job ${job.id} → DONE (no re-spend, no refund)`);
        reaped++;
      } catch (e) {
        console.error(`[refgen] reaper resume failed for ${job.id} (retries next sweep):`, e instanceof Error ? e.message : e);
        captureMoneyPathError(e, { event: "refgen.reaper_resume_failed", jobId: job.id, orgId: job.ownerId });
      }
    }

    return reaped;
  });
}

export async function handleRefGen(data: RefGenJobData, retryCount: number): Promise<void> {
  const job = await runAsSystem("worker-job-dispatch", async () =>
    prisma.refGenJob.findUnique({ where: { id: data.refGenJobId } }),
  );
  if (!job) {
    console.error(`[refgen] job ${data.refGenJobId} missing — dropping`);
    return;
  }
  // #463: the payload carries only the job id, so the tenant is knowable only after the row
  // load above. The provider call, the settle/refund and the commit transaction all run scoped
  // to this job's owner.
  await runAsTenant(job.ownerId, async () => {
    // P2: the worker SETTLES the held charge at the commit point and REFUNDS it on every
    // terminal failure. settle/refund read the released amount FROM the RESERVE ledger row
    // (startRefGen/dispatchVariantJob wrote it) → release == reserve, never recomputed.

    // flips true the instant the paid provider call returns — any failure AFTER
    // this point must terminal-fail, never retry (a retry would re-spend).
    let spent = false;
    // flips true once outputs are stored + recorded + settled (the commit tx below): past here a
    // failure is RECOVERABLE — requeue so a redelivery RESUMES (re-attaches) without re-spending,
    // never terminal-fail (which would leave a CHARGED job shown FAILED + free the active-job
    // guard, letting a user retry pay again). Mirrors gen.ts's `committed`.
    let committed = false;

    try {
      // RESUME FIRST (mirror gen.ts): a prior delivery already paid + stored these outputs →
      // re-attach idempotently, settle (no-op), finalize, finish — NEVER re-spending and WITHOUT
      // re-running pre-spend validation. This MUST precede BOTH the terminal short-circuit and the
      // entity check: the outputs are already paid, so (a) a job that recorded them but never
      // finalized (a crash, or a late stale-FAILED redelivery) self-heals to DONE here, and (b) a
      // since-deleted entity must NOT flip an already-settled job to FAILED.
      if (job.outputAssetIds.length > 0) {
        committed = true; // outputs recorded on a prior delivery — never re-spend; finish best-effort
        await resumeCommittedRefGenJob(job);
        console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
        return;
      }

      // DONE/FAILED with NO recorded outputs is terminal — nothing to do (the resume above
      // already handled any job that DID record outputs). A redelivered/stale message must
      // never reprocess (and possibly re-spend on) a settled-or-failed job with no marker.
      if (job.status === "DONE" || job.status === "FAILED") {
        console.log(`[refgen] ${job.id} already ${job.status} — skipping`);
        return;
      }

      // re-validate the target before any spend (codex P1): a job whose entity
      // was deleted/never-existed must terminal-fail, not generate into the void
      const entity = await prisma.entity.findFirst({
        where: { id: job.entityId, ownerId: job.ownerId, deletedAt: null },
      });
      if (!entity) {
        console.error(`[refgen] ${job.id}: entity ${job.entityId} gone — failing without spend`);
        await failClosedRefund(job.id, job.ownerId, "element was deleted before generation ran");
        return; // terminal, no throw → no retry, no spend
      }

      // validate-before-spend (VARIANT): the target variant must still be a live,
      // owned variant of this entity. A variant soft-deleted between enqueue and run
      // must terminal-fail (no retry) WITHOUT spending — otherwise we'd pay for an
      // image attached to a hidden/stranded variant.
      if (job.mode === "VARIANT") {
        const variant = await prisma.entityVariant.findFirst({
          where: { id: job.variantId ?? "", entityId: job.entityId, ownerId: job.ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!variant) {
          console.error(`[refgen] ${job.id}: variant ${job.variantId} gone — failing without spend`);
          await failClosedRefund(job.id, job.ownerId, "variant was deleted before generation ran");
          return; // terminal, no throw → no retry, no spend
        }
      }

      // Atomic spend claim: QUEUED → GENERATING in a single conditional update,
      // so concurrent or duplicate deliveries can never both reach the provider.
      // A lost claim means another delivery owns the job, or a prior attempt
      // reached GENERATING and died (a hard crash — a *caught* provider error
      // resets status→QUEUED, which re-claims safely). It MAY mean a paid call
      // already happened, so fail the stuck GENERATING row closed (never
      // clobbering a winner's DONE) rather than risk a double charge.
      const claim = await prisma.refGenJob.updateMany({
        where: { id: job.id, ownerId: job.ownerId, status: "QUEUED" },
        data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        // Only fail-closed a STALE GENERATING row (the owning attempt crashed or was
        // redelivered past expiry). A RECENT GENERATING is an actively-running winner (a
        // duplicate delivery) — leave it ALONE, so we never clobber + refund a job that is
        // about to commit (delivered-but-refunded). Mirrors gen.ts's stale cutoff.
        await prisma.$transaction(async (tx) => {
          const staled = await tx.refGenJob.updateMany({
            // outputAssetIds isEmpty: never fail-close a job that already committed outputs (a
            // redelivery landing in the commit→DONE window) — its resume delivery must win.
            where: { id: job.id, ownerId: job.ownerId, status: "GENERATING", startedAt: { lt: new Date(Date.now() - REFGEN_STALE_MS) }, outputAssetIds: { isEmpty: true } },
            data: { status: "FAILED", error: "stale GENERATING after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
          });
          // refund only if WE just failed it closed (count>0) — never touch an active
          // winner's hold. The merchant got no result; the founder absorbs any engine cost.
          if (staled.count > 0) await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
        });
        return;
      }

      // OPT-6 P2 (highest-trust): fail-without-spend if the model was admin-disabled after this
      // job was queued. Still before any provider call — but now AFTER the claim. (Variant jobs
      // always use seedream → this is the seedream/image toggle for the variant path too.)
      //
      // #647 T6 修复轮 r2 P1-R2-1:与 gen.ts 同一处病、同一个修法。这道闸原本站在 claim 前面,
      // 而 r1 把它的失败语义改成「抛 PLAIN」之后,一个**重复** delivery 在这里读失败,抛出的
      // 错会落进通用 catch,catch 的 requeue 把状态写回 QUEUED —— 那一行可能正被另一个
      // delivery 拿着调 provider。挪到 claim 之后:能走到这里的一定是刚赢下 claim 的那个
      // delivery,requeue 动的是自己的行;输掉 claim 的早在上面返回,连读都不会读。
      const disabled = await workerDisabledModels();
      if (isModelDisabled(job.model, disabled)) {
        await failClosedRefund(job.id, job.ownerId, "this model was turned off before the job ran — not spending");
        return; // terminal, no throw → no retry, no spend
      }

      // BASE = text-to-image (no conditioning). VARIANT = image-to-image conditioned
      // on the LOCKED BASE only. REFSHEET = legacy conditioning on the entity's
      // base-level refs. All "unreachable" throws happen BEFORE the paid call below,
      // so a missing/unreachable base fails closed with no spend (codex P1).
      const inputImageUrls: string[] = [];
      if (job.mode === "VARIANT") {
        // re-validate the base at spend time (belt; createVariant validated pre-dispatch).
        // The base row must exist + be live (real check, always). Reachability of the
        // presigned URL is only enforced for a real (paid) provider — mock/local-disk
        // storage can't presign, and the mock provider ignores inputImageUrls anyway.
        if (!entity.baseAssetId) throw new Error("variant job has no base to condition on");
        const baseAsset = await prisma.asset.findFirst({
          where: { id: entity.baseAssetId, ownerId: job.ownerId, deletedAt: null },
        });
        if (!baseAsset) throw new Error("variant base asset is missing — refusing to spend");
        const signed = await storage.presignedGet(storageKey(baseAsset.ownerId, baseAsset.contentHash, baseAsset.ext), 3600);
        if (signed) inputImageUrls.push(signed);
        if (provider.name !== "mock" && !signed) {
          throw new Error("variant base unreachable — refusing to spend on a degraded generation");
        }
      } else if (job.mode !== "BASE") {
        const refs = await prisma.referenceImage.findMany({
          where: { entityId: job.entityId, ownerId: job.ownerId, deletedAt: null, variantId: null },
          orderBy: { position: "asc" },
          include: { asset: true },
          // Seedream edit: inputs + outputs ≤ 15 (codex P2)
          take: Math.max(0, Math.min(MAX_CONDITIONING_IMAGES, MAX_EDIT_INPUT_PLUS_OUTPUT - job.count)),
        });
        for (const ref of refs) {
          const key = storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext);
          const signed = await storage.presignedGet(key, 3600);
          if (signed) inputImageUrls.push(signed);
        }
        // a real (paid) provider must not silently degrade a conditioned request
        // to text-to-image because the refs weren't reachable (codex P1)
        const isMock = provider.name === "mock";
        if (!isMock && refs.length > 0 && inputImageUrls.length < refs.length) {
          throw new Error(
            `conditioning refs unreachable (${inputImageUrls.length}/${refs.length} signable) — refusing to spend on a degraded generation`,
          );
        }
      }

      // THE paid call — happens exactly once per job (claimed above)
      //
      // #914 r6(判官 r5 P1-1)—— 这是**第三个**付费发送点。回执的记录纪律与 gen.ts 的
      // 那两个逐字相同:交给 provider 的**那一个变量**随产出一起落库(下面 commit 那一笔),
      // 中间不许有第二个可以漂移的表达式。
      //
      // 这条产品线上 worker 不做任何拼装(没有 #774 的参考图编号句那一步),所以送出的
      // 恒等于 `job.prompt` —— 但「恒等」是**测试钉住的事实**,不是省掉记录的理由:少一个
      // 发送点的记录,「回执覆盖全部付费发送点」这句话就不成立(判官 r5 原话)。
      const sentPrompt = job.prompt;
      const images = await provider.generate({
        prompt: sentPrompt,
        inputImageUrls,
        count: job.count,
        model: job.model as RefGenModel,
      });
      spent = true; // the paid call has returned — past here, a failure must not retry

      // store every output FIRST and record them on the job — this is the
      // commit point past which a retry resumes instead of re-spending
      const outputAssetIds: string[] = [];
      for (const img of images) {
        const { contentHash } = await storage.put(job.ownerId, img.bytes, img.ext);
        const asset = await prisma.asset.upsert({
          where: { ownerId_contentHash: { ownerId: job.ownerId, contentHash } },
          update: { deletedAt: null },
          create: {
            id: newId(),
            ownerId: job.ownerId,
            contentHash,
            ext: img.ext,
            mime: mimeForExt(img.ext),
            sizeBytes: BigInt(img.bytes.byteLength),
            originalFilename: `gen-${job.id}.${img.ext}`,
            source: "GENERATED",
          },
        });
        outputAssetIds.push(asset.id);
      }
      // record outputs (the resume marker) AND the frozen spend in one update — past
      // here a retry resumes instead of re-spending, so spentUsd is committed exactly
      // when money is committed (refgenSpentUsd = REFGEN_PRICE_USD_PER_IMAGE * count).
      // SETTLE the credit hold atomically with the resume marker — the generation
      // succeeded, so the reserved charge becomes permanent in the same commit.
      // CONDITIONAL commit (mirror gen.ts): write the resume marker + settle ONLY if we still
      // own the GENERATING claim. A redelivery that expired our in-flight engine call (>20min hang)
      // may have already taken the stale branch above → FAILED + refunded this job. If so this
      // matches 0 rows: do NOT settle (the REFUND already won the finalizer index) and do NOT
      // attach/deliver — discard. The stored assets become orphans (content-addressed, reusable,
      // harmless); the founder absorbed the engine cost and the merchant stays refunded (no free
      // delivery, no DONE-vs-REFUND mismatch). Returning false signals discard.
      const committedRefgen = await prisma.$transaction(async (tx) => {
        const marked = await tx.refGenJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: "GENERATING" },
          // #914 r6:回执与产出、与结算同一笔提交 —— 交付成立的那一刻,「我们送出的是这一句」
          // 也就成立。它是我们自己的数据(`refGenRequest` 入队时已校长度,同一张表的
          // `prompt` 就装着同一段文字),不是引擎能撑爆的输入,所以进这笔事务不新增失败面。
          data: { outputAssetIds, spentUsd: refgenSpentUsd({ model: job.model, count: job.count }), sentPromptText: sentPrompt },
        });
        if (marked.count === 0) return false;
        await settleCredits(tx, { orgId: job.ownerId, refId: job.id });
        return true;
      });
      if (!committedRefgen) {
        console.warn(`[refgen] ${job.id}: redelivery already failed+refunded this job mid-flight — discarding the (orphan) outputs, not attaching. Founder absorbed the engine cost.`);
        // 同 gen.ts 的对应分支:商家已退款,平台真金白银付了一次引擎调用。零上报 = 没人
        // 知道它一天发生几次。这里没有异常对象,所以合成一个,让 Sentry 有一条可聚类的事件。
        captureMoneyPathError(new Error("refgen redelivery discarded paid outputs — founder absorbed the engine cost"), {
          event: "refgen.founder_absorbed_engine_cost",
          jobId: job.id,
          orgId: job.ownerId,
          mode: job.mode,
        });
        return;
      }
      committed = true; // outputs recorded + settled — past here a failure RESUMES, never re-spends

      // attach (idempotent: skips assets already attached to this entity+variant)
      await attachOutputs(job.entityId, job.ownerId, outputAssetIds, job.variantId);
      await finalizeDone(job.id, job.mode, job.entityId, outputAssetIds[0]);
      console.log(`[refgen] ${job.id}: DONE (${job.mode}) → ${outputAssetIds.length} images via ${provider.name}`);
    } catch (err) {
      const message = sanitizeError(err, 500);
      // a failure after the paid call is terminal — retrying would re-spend.
      // `spent` covers post-provider failures here; `charged` covers a failure
      // INSIDE the adapter after the engine already billed (it ran the model, then the
      // result parse/download threw). Only a genuinely pre-charge throw retries,
      // up to the budget (limit 2 → deliveries at retryCount 0,1,2; `>=` once).
      const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
      // #1001 判官 P3-4(M1-b)—— gen.ts 早就问了第三个问题,refgen 一直没问:`permanent`。
      // charged 问「这一次花钱了吗?」;permanent 问「同一个请求还有可能成功吗?」。适配器在
      // 引擎**看过商家送来的东西之后拒绝**时打上这个标记(packages/generation:
      // permanentInputError,例如参考图里有可辨认的真人),同一张图每一次都会得到同一个拒绝。
      // 少了这一格,一个必然失败的请求要跑满 REFGEN_RETRY_LIMIT 次重投才终结退款 —— 商家白等
      // 三轮队列,拿到的还是同一句拒绝。钱的结果一个字不变:permanent 的失败是**证明没花钱**的
      // (引擎跑之前的 4xx),spent 仍是 false、不记 spentUsd,退款走的还是每条 pre-charge 失败
      // 共用的那一条终态分支。它只改变「我们什么时候放弃」。
      const permanent = typeof err === "object" && err !== null && (err as { permanent?: unknown }).permanent === true;
      // a POST-COMMIT failure (outputs recorded + settled) must NOT terminal-fail — requeue so a
      // redelivery RESUMES (re-attaches) without re-spending. Terminal-failing it would leave a
      // CHARGED job shown FAILED + free the active-job guard, letting a user retry pay a SECOND
      // time. Only a pre-commit failure (committed === false) is terminal.
      const final = !committed && (spent || charged || permanent || retryCount >= REFGEN_RETRY_LIMIT);
      console.error(`[refgen] ${job.id}: ${final ? "FAILED" : committed ? "requeue → resume attach" : "retrying"} — ${scrubUrls(err instanceof Error ? err.message : String(err)).slice(0, 1000)}`);
      if (final) {
        // terminal fail → release the hold (the merchant got no result; the founder absorbs any
        // real engine cost). `final` is by definition pre-commit (committed → final is false), so
        // settle never ran; the finalizer index makes refund safe even against a racing settle.
        // A post-charge failure still records spentUsd so "paid but not delivered" stays auditable.
        //
        // #951 漏网(M1-b):这是这个文件里最后一处无条件终态写,而 gen.ts 的同一处(#602 r2,
        // 判官 P1-2)早已是条件写。它信的是**这条 delivery 内存里那份快照**:「这一单还什么都
        // 没交付」。谓词把这个前提交给库自己判 ——
        //   • status ∈ 在飞:别人已经写下的终态(取消、reaper 的 fail-close、另一条 delivery 的
        //     DONE)不许被这条迟到的失败盖掉;
        //   • outputAssetIds 为空:带着产出的行 ⟺ 提交事务落过(产出与 SETTLE 同一笔)⟹ 已交付
        //     已收钱,它永远不是「什么都没交付」,更不该被写成 FAILED。
        // count === 0 表示别人已经了结了这一单并做了它自己的钱 —— 我们这一笔退款连发都不发
        // (真发也是幂等 no-op,但一笔不该存在的退款尝试本身就不该留在钱路上)。
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.refGenJob.updateMany({
            where: {
              id: job.id, ownerId: job.ownerId, status: { in: [...REFGEN_IN_FLIGHT_STATUSES] },
              outputAssetIds: { isEmpty: true },
            },
            data: { status: "FAILED", error: message, finishedAt: new Date(), ...((spent || charged) ? { spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } : {}) },
          });
          if (count > 0) await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
        });
      } else {
        // recoverable: a pre-charge retry (keep the hold), OR a post-commit failure (committed:
        // already settled) — either way requeue so the resume path re-attaches without re-spending.
        // GUARDED conditional write: only requeue a row still QUEUED/GENERATING. If reapStaleRefGenJobs
        // already FAILED+refunded this job (message lost on a prior attempt), the updateMany matches 0
        // and we must NOT resurrect it — a redelivery would re-run the paid call against a refunded hold.
        // A committed job is still GENERATING here (the commit tx wrote outputAssetIds, not status), so
        // its resume requeue still matches. (Mirror of the gen.ts F04 guard.)
        const requeued = await prisma.refGenJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: { in: ["QUEUED", "GENERATING"] } },
          data: { status: "QUEUED", error: message, progress: 0 },
        });
        if (requeued.count === 0) console.error(`[refgen] ${job.id}: not requeued — a finalizer already owns it (FAILED/DONE); discarding this delivery`);
      }
      throw new Error(message); // pg-boss serializes thrown errors into job.output; keep it scrubbed
    }
  });
}

/** Flip the job DONE and, for a BASE job, pin Entity.baseAssetId in the SAME
 *  transaction — so a crash can never leave a DONE base job with a null base
 *  (it stays resumable until both commit together). */
async function finalizeDone(
  jobId: string,
  mode: RefGenMode,
  entityId: string,
  firstAssetId: string | undefined,
): Promise<void> {
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.refGenJob.update({
      where: { id: jobId },
      data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
    }),
  ];
  if (mode === "BASE" && firstAssetId) {
    ops.unshift(
      prisma.entity.update({ where: { id: entityId }, data: { baseAssetId: firstAssetId } }),
    );
  }
  await prisma.$transaction(ops);
}

/** Attach generated assets to the entity as ReferenceImages, after any
 *  existing ones. `variantId` tags them (null = base/entity-level). Idempotent
 *  within scope: an asset already attached (live) at the SAME (entityId, assetId,
 *  variantId) is skipped, so a resumed/retried job never double-attaches, while
 *  the same asset can legitimately exist as both a base ref and a variant ref.
 *
 *  The findFirst-then-create pre-check is a TOCTOU window against a CONCURRENT
 *  double-attach (a reaper-resumed redelivery racing a live delivery's attach, or
 *  two redeliveries): both pass the check, both create. ReferenceImage_live_entity_
 *  asset_variant_key (migration 20260703000000) closes it at the DB — the loser's
 *  create throws P2002, which we swallow (the concurrent winner already attached
 *  this exact asset, so the desired state is reached). */
async function attachOutputs(entityId: string, ownerId: string, assetIds: string[], variantId: string | null = null): Promise<void> {
  let position = await nextRefPosition(entityId, ownerId);
  for (const assetId of assetIds) {
    const existing = await prisma.referenceImage.findFirst({
      where: { entityId, assetId, variantId, deletedAt: null },
    });
    if (existing) continue;
    try {
      await prisma.referenceImage.create({
        data: { id: newId(), ownerId, entityId, assetId, variantId, position: position++ },
      });
    } catch (e) {
      // P2002 = a concurrent attacher won the live-uniqueness index for this
      // (entity, asset, variant) between our pre-check and create → already attached, skip.
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
}

/** Append generated refs after any existing ones (upload + prior gens). */
async function nextRefPosition(entityId: string, ownerId: string): Promise<number> {
  const last = await prisma.referenceImage.findFirst({
    where: { entityId, ownerId, deletedAt: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
