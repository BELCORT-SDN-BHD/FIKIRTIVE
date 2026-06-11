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
import { prisma } from "@artlio/db";
import {
  storageKey,
  newId,
  GEN_RETRY_LIMIT,
  MAX_CONDITIONING_IMAGES,
  type GenJobData,
  type GenModel,
} from "@artlio/core";
import { storage } from "../storage.js";
import { provider } from "../generation.js";

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

export async function handleGen(data: GenJobData, retryCount: number): Promise<void> {
  const job = await prisma.genJob.findUnique({ where: { id: data.genJobId } });
  if (!job) {
    console.error(`[gen] job ${data.genJobId} missing — dropping`);
    return;
  }
  if (job.status === "DONE") return;

  try {
    const project = await prisma.project.findFirst({ where: { id: job.projectId, ownerId: job.ownerId, deletedAt: null } });
    if (!project) {
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "project gone before generation ran", finishedAt: new Date() } });
      return;
    }
    if (job.shotId) {
      const shot = await prisma.shot.findFirst({ where: { id: job.shotId, ownerId: job.ownerId, deletedAt: null } });
      if (!shot) {
        await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "shot gone before generation ran", finishedAt: new Date() } });
        return;
      }
    }

    // resume — already paid + persisted on a prior delivery
    if (job.generationIds.length > 0) {
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
      return;
    }

    await prisma.genJob.update({ where: { id: job.id }, data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } } });

    // resolve conditioning from the @mentioned entities' refs
    const refs = job.entityIds.length
      ? await prisma.referenceImage.findMany({
          where: { entityId: { in: job.entityIds }, ownerId: job.ownerId, deletedAt: null },
          orderBy: { position: "asc" },
          include: { asset: true },
          take: MAX_CONDITIONING_IMAGES,
        })
      : [];
    const inputImageUrls: string[] = [];
    for (const ref of refs) {
      const signed = await storage.presignedGet(storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext), 3600);
      if (signed) inputImageUrls.push(signed);
    }
    const isMock = provider.name === "mock";
    if (!isMock && refs.length > 0 && inputImageUrls.length < refs.length) {
      throw new Error(`conditioning refs unreachable (${inputImageUrls.length}/${refs.length}) — refusing to spend`);
    }

    // frozen provenance snapshot (same shape as uploadCandidates)
    const entities = await prisma.entity.findMany({
      where: { id: { in: job.entityIds }, ownerId: job.ownerId },
      include: { referenceImages: { where: { deletedAt: null }, include: { asset: true } } },
    });
    const entitySnapshot = {
      entities: entities.map((e) => ({ id: e.id, name: e.name, type: e.type, refHashes: e.referenceImages.map((r) => r.asset.contentHash) })),
    };

    // THE paid call (image) — exactly once per job
    const images = await provider.generate({ prompt: job.prompt, inputImageUrls, count: job.count, model: job.model as GenModel });

    // store + create a Generation per output. version: next per shot, else 1.
    let nextVersion = 1;
    if (job.shotId) {
      const last = await prisma.generation.findFirst({ where: { shotId: job.shotId, deletedAt: null }, orderBy: { version: "desc" }, select: { version: true } });
      nextVersion = (last?.version ?? 0) + 1;
    }
    const generationIds: string[] = [];
    const assetIds: string[] = [];
    for (const img of images) {
      const { contentHash } = await storage.put(job.ownerId, img.bytes, img.ext);
      const asset = await prisma.asset.upsert({
        where: { ownerId_contentHash: { ownerId: job.ownerId, contentHash } },
        update: { deletedAt: null },
        create: { id: newId(), ownerId: job.ownerId, contentHash, ext: img.ext, mime: mimeForExt(img.ext), sizeBytes: BigInt(img.bytes.byteLength), originalFilename: `gen-${job.id}.${img.ext}`, source: "GENERATED" },
      });
      assetIds.push(asset.id);
      const gen = await prisma.generation.create({
        data: {
          id: newId(), ownerId: job.ownerId, projectId: job.projectId, shotId: job.shotId ?? null,
          assetId: asset.id, source: "GENERATED", promptText: job.prompt, modelRef: job.model,
          entitySnapshot, version: job.shotId ? nextVersion++ : 1,
        },
      });
      generationIds.push(gen.id);
    }
    await prisma.genJob.update({ where: { id: job.id }, data: { generationIds, status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
    void assetIds; // metadata probe (ingest) is a follow-up; images default to 3s in the editor
    console.log(`[gen] ${job.id}: DONE → ${generationIds.length} generations via ${provider.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    const final = retryCount >= GEN_RETRY_LIMIT;
    console.error(`[gen] ${job.id}: ${final ? "FAILED" : "retrying"} — ${message}`);
    await prisma.genJob.update({
      where: { id: job.id },
      data: final ? { status: "FAILED", error: message, finishedAt: new Date() } : { status: "QUEUED", error: message, progress: 0 },
    });
    throw err;
  }
}
