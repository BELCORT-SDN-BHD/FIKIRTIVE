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
import { prisma, settleCredits, refundReservation, type GenJob } from "@fikirtive/db";
import {
  storageKey,
  newId,
  GEN_RETRY_LIMIT,
  GEN_QUEUE,
  videoDefaults,
  MAX_CONDITIONING_IMAGES,
  REF_VIDEO_MIN_SECONDS,
  REF_VIDEO_MAX_SECONDS,
  genSpentUsd,
  pricedGenCredits,
  displayCredits,
  type GenJobData,
  type GenModel,
  type GenVideoModel,
} from "@fikirtive/core";
import { storage } from "../storage.js";
import { sanitizeError, scrubUrls } from "../redact.js";
import { provider } from "../generation.js";
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";
import { resumeOttoAfterGen } from "../otto-resume.js";

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp"
    : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime"
    : "image/jpeg";

// A GENERATING row older than this is treated as crashed/stale (its worker died or
// the message was redelivered past queue expiry). Kept ABOVE the realistic fal call
// time and BELOW the GEN/REFGEN queue expiry (20m), so an actively-running gen is
// never failed closed by a duplicate delivery, but a truly stuck one eventually is.
const GEN_STALE_MS = 1000 * 60 * 18;
// The PROACTIVE reaper (reapStaleGenJobs) runs on its OWN timer, independent of pg-boss
// redelivery — so its cutoff must exceed the gen-queue expiry (GEN_QUEUE_POLICY.expireInSeconds
// = 20m). Otherwise it could fail-close a long (18–20m) fal call that pg-boss still considers
// alive, refunding the merchant + eating the founder's fal cost. The on-redelivery stale path
// keeps GEN_STALE_MS (a redelivery already implies the 20m expiry has passed).
const GEN_REAP_MS = 1000 * 60 * 25;
// A job that has sat in QUEUED this long was never claimed by a worker (worker down / message
// lost). Fail it closed and refund — the credit hold would otherwise leak forever and the
// cowork chat spins on a stuck "making this…" indefinitely (audit GEN-6 / P0-11).
// Like GEN_REAP_MS, this proactive cutoff MUST exceed the gen-queue expiry (GEN_QUEUE_POLICY
// .expireInSeconds = 20m) plus retry backoff. A job can legitimately sit QUEUED past a few
// minutes while the worker is saturated (pg-boss still owns the message and will deliver it)
// or while a recoverable pre-charge retry is rescheduled (status reset to QUEUED, original
// createdAt kept). At 10m we fail-closed + refunded jobs pg-boss would still deliver — a false
// "you weren't charged" that pushes the user to resubmit a duplicate paid job. 25m clears that.
const GEN_QUEUED_REAP_MS = 1000 * 60 * 25;

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

// D2: the worker is the DURABLE writer of a cowork job's result/error message. Post-commit +
// best-effort (like attachBestEffort): it can never throw into the completion path, never flip
// `committed`, never re-spend, never delay DONE. Exactly-once is the partial-unique index
// ChatMessage(genJobId) WHERE kind IN (GEN_RESULT,TURN_ERROR) — a resume/redelivery re-attempt
// hits P2002 and is swallowed.
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
    await prisma.genJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "outputs were recorded but the charge was refunded — not delivering (free-delivery guard)", finishedAt: new Date() },
    });
    // accurate terminal message (idempotent via the genJobId unique index): refund won → not charged
    await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
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
  await appendCoworkResult(job, "GEN_RESULT", job.generationIds, "", displayCredits(pricedGenCredits({ kind: job.kind as "IMAGE" | "VIDEO", model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }))); // idempotent — P2002 swallowed if already written
  await resumeOttoAfterGen(job); // best-effort; at-most-once via ottoVerdictAt claim
}

/** Terminal-fail a job that NEVER delivered AND release its credit hold, atomically.
 *  Used by every pre-commit fail-closed branch (no outputs recorded) so a merchant is
 *  never charged for a generation they didn't receive. refundReservation is idempotent
 *  and no-ops when there's no open reservation (a historical/pre-credits job) or the
 *  job was already settled — so this is always safe to call. */
async function failClosedWithRefund(
  job: { id: string; ownerId: string; threadId: string | null; kind: string; model: string },
  error: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error, finishedAt: new Date() } });
    await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
  });
  // Tell the cowork UI the turn is over (idempotent via the genJobId unique index).
  // Without a terminal message the client polls forever on a stuck "making this…".
  // Generic, reassuring text; the specific reason stays in GenJob.error for ops.
  await appendCoworkResult(job, "TURN_ERROR", [], "I couldn't finish that one — and you weren't charged. Want to try again?");
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

export async function reapStaleGenJobs(): Promise<number> {
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
    await prisma.$transaction(async (tx) => {
      const staled = await tx.genJob.updateMany({
        where: { id: job.id, ownerId: job.ownerId, status: "GENERATING", startedAt: { lt: cutoff }, generationIds: { isEmpty: true } },
        data: { status: "FAILED", error: "stale GENERATING reaped — worker hung or crashed; refunded", finishedAt: new Date() },
      });
      if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
    });
    if (failedClosed) {
      await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
      reaped++;
    }
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
    await prisma.$transaction(async (tx) => {
      const failed = await tx.genJob.updateMany({
        where: { id: job.id, ownerId: job.ownerId, status: "QUEUED", createdAt: { lt: queuedCutoff }, generationIds: { isEmpty: true } },
        data: { status: "FAILED", error: "queued too long — worker never picked it up; refunded", finishedAt: new Date() },
      });
      if (failed.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
    });
    if (failedClosed) {
      await appendCoworkResult(job, "TURN_ERROR", [], "That one didn't start in time — the generator may be busy. You weren't charged; please try again.");
      reaped++;
    }
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
      await resumeCommittedGenJob(job);
      console.log(`[gen] reaper finished committed-but-stuck job ${job.id} → DONE (no re-spend, no refund)`);
      reaped++;
    } catch (e) {
      console.error(`[gen] reaper resume failed for ${job.id} (retries next sweep):`, e instanceof Error ? e.message : e);
    }
  }

  return reaped;
}

export async function handleGen(data: GenJobData, retryCount: number): Promise<void> {
  const job = await prisma.genJob.findUnique({ where: { id: data.genJobId } });
  if (!job) {
    console.error(`[gen] job ${data.genJobId} missing — dropping`);
    return;
  }
  // DONE is terminal/idempotent. FAILED is handled INSIDE the try, AFTER the resume
  // check, so a committed job (outputs recorded) that a prior delivery wrongly left
  // FAILED can still finish via attach+DONE without re-spending.
  if (job.status === "DONE") return;

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
    // the FAILED short-circuit and the project/shot validation, so a deleted shot or
    // a wrongly-FAILED-but-committed job still completes (attachToShot no-ops if the
    // shot is gone; the candidate generations remain, reusable) (#2/#3).
    if (job.generationIds.length > 0) {
      committed = true; // outputs recorded on a prior delivery — never re-spend; finish best-effort
      await resumeCommittedGenJob(job);
      return;
    }
    if (job.status === "FAILED") return; // terminal with no recorded outputs — nothing to resume

    // OPT-6 P2 (highest-trust): a job whose model was admin-disabled AFTER it was
    // queued must FAIL WITHOUT SPENDING. Runs AFTER the resume short-circuit (a
    // committed job still finishes — its money already spent) and BEFORE the spend
    // claim + provider call. Fail-closed-to-typed-menu: a DB fault → empty set →
    // the job proceeds (the typed gate that admitted it is the authority).
    const disabled = await workerDisabledModels();
    if (isModelDisabled(job.model, disabled)) {
      await failClosedWithRefund(job,"this model was turned off before the job ran — not spending");
      return; // terminal, no throw → no retry, no spend
    }

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
        // any real fal cost on the possibly-paid call.
        if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); failedClosed = true; }
      });
      // Only when WE failed it closed (not when an active winner still owns it): tell the
      // cowork UI the turn is over so it stops polling on a stuck "making this…".
      if (failedClosed) await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again. You weren't charged.");
      return;
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
    }
    // cap the aggregate at the model's input limit, ROUND-ROBIN across entities so an
    // early entity with many base refs can't starve a later @mentioned variant of its
    // conditioning (which would spend without the requested variant). MAX_GEN_ENTITIES(8)
    // ≤ the cap(10), so round 0 always seats ≥1 ref for every mention that has one.
    const cappedRefs: { asset: { ownerId: string; contentHash: string; ext: string } }[] = [];
    for (let round = 0; cappedRefs.length < MAX_CONDITIONING_IMAGES; round++) {
      let progressed = false;
      for (const refsForEntity of perEntity) {
        const ref = refsForEntity[round];
        if (!ref) continue;
        cappedRefs.push(ref);
        progressed = true;
        if (cappedRefs.length >= MAX_CONDITIONING_IMAGES) break;
      }
      if (!progressed) break;
    }
    const inputImageUrls: string[] = [];
    for (const ref of cappedRefs) {
      const signed = await storage.presignedGet(storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext), 3600);
      if (signed) inputImageUrls.push(signed);
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
    let outputs: { bytes: Uint8Array; ext: string }[];
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
      const video = await provider.generateVideo({
        prompt: job.prompt, imageUrl, tailImageUrl: tailImageUrl || undefined,
        refVideoUrl: refVideoUrl || undefined,
        durationSeconds: vo?.seconds ?? videoDefaults(job.model as GenVideoModel).seconds,
        resolution: vo?.resolution, aspectRatio: vo?.aspectRatio, fps: vo?.fps, audio: vo?.audio,
        model: job.model,
      });
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
        if (srcUrl) inputImageUrls.unshift(srcUrl);
      }
      outputs = await provider.generate({ prompt: job.prompt, inputImageUrls, count: job.count, model: job.model as GenModel });
    }
    spent = true; // the paid call has returned — past here, a failure must not retry

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
    for (let attempt = 1; ; attempt++) {
      try {
        const stored: { contentHash: string; ext: string; size: number }[] = [];
        for (const img of outputs) {
          const { contentHash } = await storage.put(job.ownerId, img.bytes, img.ext);
          stored.push({ contentHash, ext: img.ext, size: img.bytes.byteLength });
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
                entitySnapshot, version: 1, attachedAt: null,
              },
            });
            ids.push(gen.id);
          }
          // CONDITIONAL commit: write the resume marker + settle ONLY if we still own the
          // GENERATING claim. A duplicate delivery that expired our in-flight fal call (>20min
          // hang) may have already taken the stale-claim branch above → FAILED + refunded this
          // job. If so this matches 0 rows: THROW to ROLL BACK this whole transaction — the
          // Asset + Generation rows just created are USER-VISIBLE (project media/candidate
          // queries read Generation), so a plain `return` would COMMIT them = a free delivery.
          // Rolling back discards them; the founder absorbed the fal cost, the merchant stays
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
          console.warn(`[gen] ${job.id}: redelivery already failed+refunded this job mid-flight — rolled back outputs, not delivering. Founder absorbed the fal cost.`);
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
    await appendCoworkResult(job, "GEN_RESULT", generationIds, "", displayCredits(pricedGenCredits({ kind: job.kind as "IMAGE" | "VIDEO", model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null })));
    await resumeOttoAfterGen(job); // best-effort; at-most-once via ottoVerdictAt claim
  } catch (err) {
    // PERSISTED error surfaces in the admin UI — strip any signed URL / argv a
    // provider or subprocess error may carry. Full (URL-scrubbed) detail → logs.
    const message = sanitizeError(err);
    // a failure after the paid call is terminal — retrying would re-spend.
    // `spent` covers post-provider failures here; `charged` covers a failure
    // INSIDE the adapter after fal already billed (it ran the model, then the
    // result parse/download threw). Only a genuinely pre-charge throw retries.
    const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
    // a POST-COMMIT failure (outputs stored + recorded) must NOT terminal-fail —
    // requeue so the resume path re-attaches without re-spending. Only a pre-commit
    // post-charge failure is terminal (charged, but no resume marker).
    const final = !committed && (spent || charged || retryCount >= GEN_RETRY_LIMIT);
    console.error(`[gen] ${job.id}: ${final ? "FAILED" : committed ? "requeue → resume attach" : "retrying"} — ${scrubUrls(err instanceof Error ? err.message : String(err)).slice(0, 1000)}`);
    if (final) {
      // terminal fail → release the hold (the merchant got no result; the founder
      // absorbs any real fal cost on a paid-but-undelivered call). A `final` failure
      // is by definition pre-commit (committed → final is false), so settle never ran;
      // and the finalizer unique index makes refund safe even against a racing settle.
      // A post-charge failure still records spent=true + spentUsd so "paid but not
      // delivered" stays auditable (told apart from a free pre-charge failure).
      await prisma.$transaction(async (tx) => {
        await tx.genJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: message, finishedAt: new Date(), spent: spent || charged, ...((spent || charged) ? { spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, referenceVideoGenerationId: job.referenceVideoGenerationId, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } : {}) },
        });
        await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
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
    // user-facing chat text stays generic; the sanitized provider error is kept in GenJob.error (ops/DB)
    if (final) await appendCoworkResult(job, "TURN_ERROR", [], "That generation didn't go through — you can try again.");
    // rethrow SANITIZED: pg-boss serializes the thrown error into its own job.output,
    // so throwing the raw `err` would re-leak any signed URL/argv it carries there.
    throw new Error(message);
  }
}
