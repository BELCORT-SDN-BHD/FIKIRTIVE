/**
 * Reference-generation handler (Phase 2 flagship). Mirrors the render job's
 * shape: load the RefGenJob, call the model provider, store outputs
 * content-addressed, attach them to the entity as ReferenceImages.
 *
 * Conditioning (D19 trust boundary): the request never carried image URLs —
 * the worker resolves them HERE from the entity's own existing references
 * (e.g. the logo to print on a garment), as short-lived presigned GETs the
 * provider can fetch.
 *
 * Idempotency: content-addressed outputs upsert by (owner, hash); a retry
 * re-stores identical bytes and re-attaches the same images without
 * duplicating ReferenceImages (guarded by an assetId existence check).
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
    await prisma.refGenJob.update({
      where: { id: job.id },
      data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
    });

    // resolve conditioning from the entity's existing refs → presigned GETs.
    // local driver returns null presignedGet, so fall back to the app URL
    // (mock ignores the bytes anyway; fal needs reachable https in prod r2).
    const refs = await prisma.referenceImage.findMany({
      where: { entityId: job.entityId, ownerId: job.ownerId, deletedAt: null },
      orderBy: { position: "asc" },
      include: { asset: true },
      take: MAX_CONDITIONING_IMAGES,
    });
    const inputImageUrls: string[] = [];
    for (const ref of refs) {
      const key = storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext);
      const signed = await storage.presignedGet(key, 3600);
      if (signed) inputImageUrls.push(signed);
    }

    const images = await provider.generate({
      prompt: job.prompt,
      inputImageUrls,
      count: job.count,
      model: job.model as RefGenModel,
    });

    // store each output + attach as a ReferenceImage on the entity
    const outputAssetIds: string[] = [];
    let position = await nextRefPosition(job.entityId, job.ownerId);
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
          mime: img.ext === "png" ? "image/png" : img.ext === "webp" ? "image/webp" : "image/jpeg",
          sizeBytes: BigInt(img.bytes.byteLength),
          originalFilename: `gen-${job.id}-${position}.${img.ext}`,
          source: "GENERATED",
        },
      });
      outputAssetIds.push(asset.id);
      // idempotent attach: a retry that re-stored the same asset must not
      // create a second ReferenceImage for it on this entity
      const existing = await prisma.referenceImage.findFirst({
        where: { entityId: job.entityId, assetId: asset.id, deletedAt: null },
      });
      if (!existing) {
        await prisma.referenceImage.create({
          data: {
            id: newId(),
            ownerId: job.ownerId,
            entityId: job.entityId,
            assetId: asset.id,
            position: position++,
          },
        });
      }
    }

    await prisma.refGenJob.update({
      where: { id: job.id },
      data: { status: "DONE", progress: 100, outputAssetIds, finishedAt: new Date(), error: "" },
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

/** Append generated refs after any existing ones (upload + prior gens). */
async function nextRefPosition(entityId: string, ownerId: string): Promise<number> {
  const last = await prisma.referenceImage.findFirst({
    where: { entityId, ownerId, deletedAt: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
