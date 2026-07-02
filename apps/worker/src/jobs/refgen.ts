/**
 * Reference-generation handler (Phase 2 flagship). Mirrors the render job's
 * shape: load the RefGenJob, call the model provider, store outputs
 * content-addressed, attach them to the entity as ReferenceImages.
 *
 * This is a PAID call (fal in prod), so the money-safety invariants matter:
 *
 *  - exactly-once spend (codex review): an atomic QUEUED→GENERATING claim
 *    lets only one delivery reach the provider; outputAssetIds is written
 *    BEFORE attaching so a crash during attach resumes from stored assets.
 *    A failure AFTER fal bills (res.ok, then parse/download/db) is terminal —
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
import { prisma, Prisma, settleCredits, refundReservation, type RefGenMode } from "@fikirtive/db";
import {
  storageKey,
  newId,
  REFGEN_RETRY_LIMIT,
  MAX_CONDITIONING_IMAGES,
  refgenSpentUsd,
  type RefGenJobData,
  type RefGenModel,
} from "@fikirtive/core";
import { storage } from "../storage.js";
import { provider } from "../generation.js";
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";

/** fal Seedream edit caps total (inputs + outputs) at 15 images (codex P2). */
const MAX_EDIT_INPUT_PLUS_OUTPUT = 15;

// A GENERATING row older than this is treated as crashed/stale (mirrors gen.ts GEN_STALE_MS):
// kept above the realistic provider call time and below the queue expiry, so an actively-
// running gen is never failed-closed by a duplicate delivery, but a truly stuck one is.
const REFGEN_STALE_MS = 1000 * 60 * 18;

// The proactive reaper's windows (mirror gen.ts GEN_REAP_MS / GEN_QUEUED_REAP_MS). Both sit
// ABOVE the 20-min queue expiry so the reaper never races a delivery pg-boss will still
// redeliver — it only sweeps jobs whose message is truly lost/dead-lettered (REFGEN_DLQ has
// no consumer), whose RESERVE hold would otherwise leak forever.
const REFGEN_REAP_MS = 1000 * 60 * 25;
const REFGEN_QUEUED_REAP_MS = 1000 * 60 * 25;

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

/** Terminal-fail a refgen job that NEVER delivered AND release its credit hold, atomically.
 *  refundReservation is idempotent and no-ops when there's no open reservation (historical
 *  job) or it was already settled — so every pre-commit fail-closed branch can call this. */
async function failClosedRefund(jobId: string, ownerId: string, error: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.refGenJob.update({ where: { id: jobId }, data: { status: "FAILED", error, finishedAt: new Date() } });
    await refundReservation(tx, { orgId: ownerId, refId: jobId });
  });
}

/** Proactive reaper for RefGenJob — the analog of reapStaleGenJobs (gen.ts). refgen's
 *  on-claim stale branch only runs on a pg-boss REDELIVERY; a job whose message is lost or
 *  dead-lettered on its final attempt (REFGEN_DLQ has no consumer) is never redelivered, so
 *  it sits GENERATING forever and its RESERVE hold leaks — and the partial-unique active
 *  index keeps blocking new generations for that entity/variant. This sweeps such jobs.
 *
 *  Each transition is a CONDITIONAL updateMany (the at-most-once claim): it loses to a worker
 *  that concurrently owns the job, so a live delivery is never clobbered. The GENERATING
 *  branch also requires outputAssetIds isEmpty, so a job that already committed outputs (and
 *  was charged) is never fail-closed + refunded. Refund runs only when WE won the claim.
 *  No cowork message — refgen has no chat thread. Returns how many jobs it reaped. */
export async function reapStaleRefGenJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - REFGEN_REAP_MS);
  const queuedCutoff = new Date(Date.now() - REFGEN_QUEUED_REAP_MS);
  let reaped = 0;

  const stuck = await prisma.refGenJob.findMany({
    where: { status: "GENERATING", startedAt: { lt: cutoff }, outputAssetIds: { isEmpty: true } },
    select: { id: true, ownerId: true },
  });
  for (const job of stuck) {
    await prisma.$transaction(async (tx) => {
      const staled = await tx.refGenJob.updateMany({
        where: { id: job.id, status: "GENERATING", startedAt: { lt: cutoff }, outputAssetIds: { isEmpty: true } },
        data: { status: "FAILED", error: "stale GENERATING reaped — worker hung or crashed; refunded", finishedAt: new Date() },
      });
      if (staled.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); reaped++; }
    });
  }

  const stuckQueued = await prisma.refGenJob.findMany({
    where: { status: "QUEUED", createdAt: { lt: queuedCutoff } },
    select: { id: true, ownerId: true },
  });
  for (const job of stuckQueued) {
    await prisma.$transaction(async (tx) => {
      const failed = await tx.refGenJob.updateMany({
        where: { id: job.id, status: "QUEUED", createdAt: { lt: queuedCutoff } },
        data: { status: "FAILED", error: "queued too long — worker never picked it up; refunded", finishedAt: new Date() },
      });
      if (failed.count > 0) { await refundReservation(tx, { orgId: job.ownerId, refId: job.id }); reaped++; }
    });
  }

  return reaped;
}

export async function handleRefGen(data: RefGenJobData, retryCount: number): Promise<void> {
  const job = await prisma.refGenJob.findUnique({ where: { id: data.refGenJobId } });
  if (!job) {
    console.error(`[refgen] job ${data.refGenJobId} missing — dropping`);
    return;
  }
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

    // OPT-6 P2 (highest-trust): fail-without-spend if the model was admin-disabled
    // after this job was queued. AFTER the resume short-circuit (a committed job
    // still finishes) and BEFORE the spend claim + provider call. Fail-closed-to-
    // typed-menu on a DB fault. (Variant jobs always use seedream → this is the
    // seedream/image toggle for the variant path too.)
    const disabled = await workerDisabledModels();
    if (isModelDisabled(job.model, disabled)) {
      await failClosedRefund(job.id, job.ownerId, "this model was turned off before the job ran — not spending");
      return; // terminal, no throw → no retry, no spend
    }

    // Atomic spend claim: QUEUED → GENERATING in a single conditional update,
    // so concurrent or duplicate deliveries can never both reach the provider.
    // A lost claim means another delivery owns the job, or a prior attempt
    // reached GENERATING and died (a hard crash — a *caught* provider error
    // resets status→QUEUED, which re-claims safely). It MAY mean a paid call
    // already happened, so fail the stuck GENERATING row closed (never
    // clobbering a winner's DONE) rather than risk a double charge.
    const claim = await prisma.refGenJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      // Only fail-closed a STALE GENERATING row (the owning attempt crashed or was
      // redelivered past expiry). A RECENT GENERATING is an actively-running winner (a
      // duplicate delivery) — leave it ALONE, so we never clobber + refund a job that is
      // about to commit (delivered-but-refunded). Mirrors gen.ts's stale cutoff.
      await prisma.$transaction(async (tx) => {
        const staled = await tx.refGenJob.updateMany({
          where: { id: job.id, status: "GENERATING", startedAt: { lt: new Date(Date.now() - REFGEN_STALE_MS) } },
          data: { status: "FAILED", error: "stale GENERATING after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
        });
        // refund only if WE just failed it closed (count>0) — never touch an active
        // winner's hold. The merchant got no result; the founder absorbs any fal cost.
        if (staled.count > 0) await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
      });
      return;
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
    const images = await provider.generate({
      prompt: job.prompt,
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
    // own the GENERATING claim. A redelivery that expired our in-flight fal call (>20min hang)
    // may have already taken the stale branch above → FAILED + refunded this job. If so this
    // matches 0 rows: do NOT settle (the REFUND already won the finalizer index) and do NOT
    // attach/deliver — discard. The stored assets become orphans (content-addressed, reusable,
    // harmless); the founder absorbed the fal cost and the merchant stays refunded (no free
    // delivery, no DONE-vs-REFUND mismatch). Returning false signals discard.
    const committedRefgen = await prisma.$transaction(async (tx) => {
      const marked = await tx.refGenJob.updateMany({
        where: { id: job.id, status: "GENERATING" },
        data: { outputAssetIds, spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) },
      });
      if (marked.count === 0) return false;
      await settleCredits(tx, { orgId: job.ownerId, refId: job.id });
      return true;
    });
    if (!committedRefgen) {
      console.warn(`[refgen] ${job.id}: redelivery already failed+refunded this job mid-flight — discarding the (orphan) outputs, not attaching. Founder absorbed the fal cost.`);
      return;
    }
    committed = true; // outputs recorded + settled — past here a failure RESUMES, never re-spends

    // attach (idempotent: skips assets already attached to this entity+variant)
    await attachOutputs(job.entityId, job.ownerId, outputAssetIds, job.variantId);
    await finalizeDone(job.id, job.mode, job.entityId, outputAssetIds[0]);
    console.log(`[refgen] ${job.id}: DONE (${job.mode}) → ${outputAssetIds.length} images via ${provider.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // a failure after the paid call is terminal — retrying would re-spend.
    // `spent` covers post-provider failures here; `charged` covers a failure
    // INSIDE the adapter after fal already billed (it ran the model, then the
    // result parse/download threw). Only a genuinely pre-charge throw retries,
    // up to the budget (limit 2 → deliveries at retryCount 0,1,2; `>=` once).
    const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
    // a POST-COMMIT failure (outputs recorded + settled) must NOT terminal-fail — requeue so a
    // redelivery RESUMES (re-attaches) without re-spending. Terminal-failing it would leave a
    // CHARGED job shown FAILED + free the active-job guard, letting a user retry pay a SECOND
    // time. Only a pre-commit failure (committed === false) is terminal.
    const final = !committed && (spent || charged || retryCount >= REFGEN_RETRY_LIMIT);
    console.error(`[refgen] ${job.id}: ${final ? "FAILED" : committed ? "requeue → resume attach" : "retrying"} — ${message}`);
    if (final) {
      // terminal fail → release the hold (the merchant got no result; the founder absorbs any
      // real fal cost). `final` is by definition pre-commit (committed → final is false), so
      // settle never ran; the finalizer index makes refund safe even against a racing settle.
      // A post-charge failure still records spentUsd so "paid but not delivered" stays auditable.
      await prisma.$transaction(async (tx) => {
        await tx.refGenJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: message, finishedAt: new Date(), ...((spent || charged) ? { spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } : {}) },
        });
        await refundReservation(tx, { orgId: job.ownerId, refId: job.id });
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
        where: { id: job.id, status: { in: ["QUEUED", "GENERATING"] } },
        data: { status: "QUEUED", error: message, progress: 0 },
      });
      if (requeued.count === 0) console.error(`[refgen] ${job.id}: not requeued — a finalizer already owns it (FAILED/DONE); discarding this delivery`);
    }
    throw err; // pg-boss owns the retry schedule
  }
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
