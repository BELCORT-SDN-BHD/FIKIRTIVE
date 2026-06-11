/**
 * Reference-generation handler (Phase 2 flagship). Mirrors the render job's
 * shape: load the RefGenJob, call the model provider, store outputs
 * content-addressed, attach them to the entity as ReferenceImages.
 *
 * This is a PAID call (fal in prod), so the money-safety invariants matter:
 *
 *  - exactly-once spend (codex P1): the provider runs only when the job has
 *    no recorded outputs. outputAssetIds is written BEFORE attaching, so a
 *    crash during attach resumes from stored assets instead of re-calling
 *    fal. The only re-spend window is a crash between fal's return and that
 *    write — bounded by the retry limit, worst case one extra generation.
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
import { prisma } from "@artlio/db";
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
  if (job.status === "DONE") {
    console.log(`[refgen] ${job.id} already DONE — skipping`);
    return;
  }

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
      await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds);
      await prisma.refGenJob.update({
        where: { id: job.id },
        data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
      });
      console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
      return;
    }

    await prisma.refGenJob.update({
      where: { id: job.id },
      data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
    });

    // resolve conditioning from the entity's existing refs → presigned GETs
    const refs = await prisma.referenceImage.findMany({
      where: { entityId: job.entityId, ownerId: job.ownerId, deletedAt: null },
      orderBy: { position: "asc" },
      include: { asset: true },
      // Seedream edit: inputs + outputs ≤ 15 (codex P2)
      take: Math.max(0, Math.min(MAX_CONDITIONING_IMAGES, MAX_EDIT_INPUT_PLUS_OUTPUT - job.count)),
    });
    const inputImageUrls: string[] = [];
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

    // THE paid call — happens exactly once per job (guarded above)
    const images = await provider.generate({
      prompt: job.prompt,
      inputImageUrls,
      count: job.count,
      model: job.model as RefGenModel,
    });

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

    // attach (idempotent: skips assets already attached to this entity)
    await attachOutputs(job.entityId, job.ownerId, outputAssetIds);

    await prisma.refGenJob.update({
      where: { id: job.id },
      data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
    });
    console.log(`[refgen] ${job.id}: DONE → ${outputAssetIds.length} images via ${provider.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // terminal only when retries are exhausted (same delivery math as render:
    // limit 2 → deliveries at retryCount 0,1,2; `>=` marks terminal once)
    const final = retryCount >= REFGEN_RETRY_LIMIT;
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

/** Attach generated assets to the entity as ReferenceImages, after any
 *  existing ones. Idempotent: an asset already attached (live) is skipped, so
 *  a resumed/retried job never double-attaches. */
async function attachOutputs(entityId: string, ownerId: string, assetIds: string[]): Promise<void> {
  let position = await nextRefPosition(entityId, ownerId);
  for (const assetId of assetIds) {
    const existing = await prisma.referenceImage.findFirst({
      where: { entityId, assetId, deletedAt: null },
    });
    if (existing) continue;
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId, entityId, assetId, position: position++ },
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
