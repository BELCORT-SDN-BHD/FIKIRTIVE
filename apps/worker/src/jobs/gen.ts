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
  GEN_VIDEO_SECONDS,
  MAX_CONDITIONING_IMAGES,
  type GenJobData,
  type GenModel,
} from "@artlio/core";
import { storage } from "../storage.js";
import { provider } from "../generation.js";

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp"
    : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime"
    : "image/jpeg";

export async function handleGen(data: GenJobData, retryCount: number): Promise<void> {
  const job = await prisma.genJob.findUnique({ where: { id: data.genJobId } });
  if (!job) {
    console.error(`[gen] job ${data.genJobId} missing — dropping`);
    return;
  }
  // DONE and FAILED are terminal: a redelivered or stale queue message must
  // never reprocess (and possibly re-spend on) a job that already settled.
  if (job.status === "DONE" || job.status === "FAILED") return;

  // flips true the instant the paid provider call returns — any failure AFTER
  // this point must terminal-fail, never retry (a retry would re-spend).
  let spent = false;

  try {
    const project = await prisma.project.findFirst({ where: { id: job.projectId, ownerId: job.ownerId, deletedAt: null } });
    if (!project) {
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "project gone before generation ran", finishedAt: new Date() } });
      return;
    }
    if (job.shotId) {
      // scope the shot to THIS job's project — a job must not animate (or spend
      // on) a shot/source image belonging to another project.
      const shot = await prisma.shot.findFirst({ where: { id: job.shotId, projectId: job.projectId, ownerId: job.ownerId, deletedAt: null } });
      if (!shot) {
        await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "shot gone or not in this project before generation ran", finishedAt: new Date() } });
        return;
      }
    }

    // resume — already paid + persisted on a prior delivery
    if (job.generationIds.length > 0) {
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
      return;
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
      where: { id: job.id, status: "QUEUED" },
      data: { status: "GENERATING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      await prisma.genJob.updateMany({
        where: { id: job.id, status: "GENERATING" },
        data: { status: "FAILED", error: "duplicate delivery or interrupted after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
      });
      return;
    }

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
          await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "image-to-video source not found (or not an image) in this project", finishedAt: new Date() } });
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
          await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "no source image to animate — generate an image for this shot first", finishedAt: new Date() } });
          return;
        }
        sourceAsset = sourceGen.asset;
      }
      if (sourceAsset) {
        imageUrl = (await storage.presignedGet(storageKey(sourceAsset.ownerId, sourceAsset.contentHash, sourceAsset.ext), 3600)) ?? "";
        if (provider.name !== "mock" && !imageUrl) throw new Error("source image unreachable — refusing to spend on i2v");
      }
      const video = await provider.generateVideo({ prompt: job.prompt, imageUrl, durationSeconds: GEN_VIDEO_SECONDS, model: job.model });
      outputs = [video];
    } else {
      outputs = await provider.generate({ prompt: job.prompt, inputImageUrls, count: job.count, model: job.model as GenModel });
    }
    spent = true; // the paid call has returned — past here, a failure must not retry

    // store + create a Generation per output. version: next per shot, else 1.
    let nextVersion = 1;
    if (job.shotId) {
      const last = await prisma.generation.findFirst({ where: { shotId: job.shotId, deletedAt: null }, orderBy: { version: "desc" }, select: { version: true } });
      nextVersion = (last?.version ?? 0) + 1;
    }
    const generationIds: string[] = [];
    const assetIds: string[] = [];
    for (const img of outputs) {
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
          // a shot generation IS the shot's render (attached); a candidate (no
          // shotId) lands unattached for the board
          attachedAt: job.shotId ? new Date() : null,
        },
      });
      generationIds.push(gen.id);
    }
    // mark the shot rendered so the editor picks up its latest generation
    if (job.shotId) {
      await prisma.shot.update({ where: { id: job.shotId }, data: { status: "ATTACHED" } });
    }
    await prisma.genJob.update({ where: { id: job.id }, data: { generationIds, status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
    void assetIds; // metadata probe (ingest) is a follow-up; images default to 3s in the editor
    console.log(`[gen] ${job.id}: DONE → ${generationIds.length} generations via ${provider.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // a failure after the paid call is terminal — retrying would re-spend.
    // `spent` covers post-provider failures here; `charged` covers a failure
    // INSIDE the adapter after fal already billed (it ran the model, then the
    // result parse/download threw). Only a genuinely pre-charge throw retries.
    const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
    const final = spent || charged || retryCount >= GEN_RETRY_LIMIT;
    console.error(`[gen] ${job.id}: ${final ? "FAILED" : "retrying"} — ${message}`);
    await prisma.genJob.update({
      where: { id: job.id },
      data: final ? { status: "FAILED", error: message, finishedAt: new Date() } : { status: "QUEUED", error: message, progress: 0 },
    });
    throw err;
  }
}
