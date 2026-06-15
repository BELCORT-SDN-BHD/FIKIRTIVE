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
import { prisma, Prisma, type RefGenMode } from "@artlio/db";
import {
  storageKey,
  newId,
  REFGEN_RETRY_LIMIT,
  MAX_CONDITIONING_IMAGES,
  type RefGenJobData,
  type RefGenModel,
} from "@artlio/core";
import { storage } from "../storage.js";
import { provider } from "../generation.js";

/** fal Seedream edit caps total (inputs + outputs) at 15 images (codex P2). */
const MAX_EDIT_INPUT_PLUS_OUTPUT = 15;

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

export async function handleRefGen(data: RefGenJobData, retryCount: number): Promise<void> {
  const job = await prisma.refGenJob.findUnique({ where: { id: data.refGenJobId } });
  if (!job) {
    console.error(`[refgen] job ${data.refGenJobId} missing — dropping`);
    return;
  }
  // DONE and FAILED are terminal: a redelivered or stale queue message must
  // never reprocess (and possibly re-spend on) a settled job.
  if (job.status === "DONE" || job.status === "FAILED") {
    console.log(`[refgen] ${job.id} already ${job.status} — skipping`);
    return;
  }

  // flips true the instant the paid provider call returns — any failure AFTER
  // this point must terminal-fail, never retry (a retry would re-spend).
  let spent = false;

  try {
    // re-validate the target before any spend (codex P1): a job whose entity
    // was deleted/never-existed must terminal-fail, not generate into the void
    const entity = await prisma.entity.findFirst({
      where: { id: job.entityId, ownerId: job.ownerId, deletedAt: null },
    });
    if (!entity) {
      console.error(`[refgen] ${job.id}: entity ${job.entityId} gone — failing without spend`);
      await prisma.refGenJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: "element was deleted before generation ran", finishedAt: new Date() },
      });
      return; // terminal, no throw → no retry, no spend
    }

    // exactly-once spend (codex P1): a prior delivery already paid and stored
    // these outputs — just (re-)attach them idempotently and finish
    if (job.outputAssetIds.length > 0) {
      await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds, job.variantId);
      await finalizeDone(job.id, job.mode, job.entityId, job.outputAssetIds[0]);
      console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
      return;
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
        await prisma.refGenJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: "variant was deleted before generation ran", finishedAt: new Date() },
        });
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
      where: { id: job.id, status: "QUEUED" },
      data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      await prisma.refGenJob.updateMany({
        where: { id: job.id, status: "GENERATING" },
        data: { status: "FAILED", error: "duplicate delivery or interrupted after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
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
    await prisma.refGenJob.update({ where: { id: job.id }, data: { outputAssetIds } });

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
    const final = spent || charged || retryCount >= REFGEN_RETRY_LIMIT;
    console.error(`[refgen] ${job.id}: ${final ? "FAILED" : "retrying"} — ${message}`);
    await prisma.refGenJob.update({
      where: { id: job.id },
      data: final
        ? { status: "FAILED", error: message, finishedAt: new Date() }
        : { status: "QUEUED", error: message, progress: 0 },
    });
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
 *  the same asset can legitimately exist as both a base ref and a variant ref. */
async function attachOutputs(entityId: string, ownerId: string, assetIds: string[], variantId: string | null = null): Promise<void> {
  let position = await nextRefPosition(entityId, ownerId);
  for (const assetId of assetIds) {
    const existing = await prisma.referenceImage.findFirst({
      where: { entityId, assetId, variantId, deletedAt: null },
    });
    if (existing) continue;
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId, entityId, assetId, variantId, position: position++ },
    });
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
