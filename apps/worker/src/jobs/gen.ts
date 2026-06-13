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
  videoDefaults,
  MAX_CONDITIONING_IMAGES,
  type GenJobData,
  type GenModel,
  type GenVideoModel,
} from "@artlio/core";
import { storage } from "../storage.js";
import { provider } from "../generation.js";

const mimeForExt = (ext: string) =>
  ext === "png" ? "image/png" : ext === "webp" ? "image/webp"
    : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime"
    : "image/jpeg";

// A GENERATING row older than this is treated as crashed/stale (its worker died or
// the message was redelivered past queue expiry). Kept ABOVE the realistic fal call
// time and BELOW the GEN/REFGEN queue expiry (20m), so an actively-running gen is
// never failed closed by a duplicate delivery, but a truly stuck one eventually is.
const GEN_STALE_MS = 1000 * 60 * 18;

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
      if (job.shotId) await attachBestEffort(job.id, job.shotId, job.generationIds);
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "", spent: true } });
      return;
    }
    if (job.status === "FAILED") return; // terminal with no recorded outputs — nothing to resume

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
      // lost the QUEUED→GENERATING claim. If the owning attempt is still RECENT it's
      // ACTIVELY running (a duplicate delivery) — leave it alone. Only a STALE
      // GENERATING (the attempt crashed, or was redelivered past expiry) is failed
      // closed, since re-running a paid job risks a double charge.
      await prisma.genJob.updateMany({
        where: { id: job.id, status: "GENERATING", startedAt: { lt: new Date(Date.now() - GEN_STALE_MS) } },
        data: { status: "FAILED", error: "stale GENERATING after a possible paid call — not retrying, to avoid a double charge", finishedAt: new Date() },
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
      // optional end frame (last-frame i2v): interpolate source→tail. Resolved
      // server-side from an owned id, and only meaningful with a start image.
      let tailImageUrl = "";
      if (job.tailGenerationId && sourceAsset) {
        const tail = await prisma.generation.findFirst({
          where: { id: job.tailGenerationId, ownerId: job.ownerId, projectId: job.projectId, deletedAt: null, asset: { ext: { in: ["png", "jpg", "jpeg", "webp"] } } },
          include: { asset: true },
        });
        if (!tail) {
          await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "last-frame image not found (or not an image) in this project", finishedAt: new Date() } });
          return;
        }
        tailImageUrl = (await storage.presignedGet(storageKey(tail.asset.ownerId, tail.asset.contentHash, tail.asset.ext), 3600)) ?? "";
        if (provider.name !== "mock" && !tailImageUrl) throw new Error("last-frame image unreachable — refusing to spend on i2v");
      }
      // per-model controls chosen in the composer (resolved + stored at enqueue);
      // fall back to the legacy fixed duration if an older job has none.
      const vo = job.videoOptions as { seconds?: number; resolution?: string; aspectRatio?: string; fps?: number; audio?: boolean } | null;
      const video = await provider.generateVideo({
        prompt: job.prompt, imageUrl, tailImageUrl: tailImageUrl || undefined,
        durationSeconds: vo?.seconds ?? videoDefaults(job.model as GenVideoModel).seconds,
        resolution: vo?.resolution, aspectRatio: vo?.aspectRatio, fps: vo?.fps, audio: vo?.audio,
        model: job.model,
      });
      outputs = [video];
    } else {
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
    const stored: { contentHash: string; ext: string; size: number }[] = [];
    for (const img of outputs) {
      const { contentHash } = await storage.put(job.ownerId, img.bytes, img.ext);
      stored.push({ contentHash, ext: img.ext, size: img.bytes.byteLength });
    }
    const generationIds = await prisma.$transaction(async (tx) => {
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
            assetId: asset.id, source: "GENERATED", promptText: job.prompt, modelRef: job.model,
            entitySnapshot, version: 1, attachedAt: null,
          },
        });
        ids.push(gen.id);
      }
      await tx.genJob.update({ where: { id: job.id }, data: { generationIds: ids, spent: true } });
      return ids;
    });
    committed = true; // outputs stored + recorded — past here a failure resumes, never re-spends
    // best-effort attach: if it still fails, the outputs remain as reusable
    // candidates (visible, manually attachable) and we STILL mark DONE — never leave
    // the job stuck (a committed requeue could exhaust pg-boss retries) (#2)
    if (job.shotId) await attachBestEffort(job.id, job.shotId, generationIds);
    await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" } });
    console.log(`[gen] ${job.id}: DONE → ${generationIds.length} generations via ${provider.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    // a failure after the paid call is terminal — retrying would re-spend.
    // `spent` covers post-provider failures here; `charged` covers a failure
    // INSIDE the adapter after fal already billed (it ran the model, then the
    // result parse/download threw). Only a genuinely pre-charge throw retries.
    const charged = typeof err === "object" && err !== null && (err as { charged?: unknown }).charged === true;
    // a POST-COMMIT failure (outputs stored + recorded) must NOT terminal-fail —
    // requeue so the resume path re-attaches without re-spending. Only a pre-commit
    // post-charge failure is terminal (charged, but no resume marker).
    const final = !committed && (spent || charged || retryCount >= GEN_RETRY_LIMIT);
    console.error(`[gen] ${job.id}: ${final ? "FAILED" : committed ? "requeue → resume attach" : "retrying"} — ${message}`);
    await prisma.genJob.update({
      where: { id: job.id },
      // a post-charge failure records spent=true so "paid but not delivered" is
      // auditable (the UI/ops can tell it apart from a free pre-charge failure)
      data: final ? { status: "FAILED", error: message, finishedAt: new Date(), spent: spent || charged } : { status: "QUEUED", error: message, progress: 0 },
    });
    throw err;
  }
}
