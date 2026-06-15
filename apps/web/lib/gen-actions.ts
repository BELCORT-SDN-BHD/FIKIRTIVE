"use server";
/**
 * Shot/session generation actions (redesign Gen space). Validate → persist a
 * GenJob → dispatch → poll. The worker resolves conditioning, calls the
 * provider, and writes Generation candidates (optionally bound to a shot).
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import {
  genRequest,
  newId,
  GEN_QUEUE,
  FOUNDER_OWNER_ID,
  storageKey,
  storageKeyToSrc,
  videoDefaults,
  type GenJobData,
  type GenVideoModel,
} from "@artlio/core";
import { getBoss } from "./queue";
import { checkCast } from "./cowork-guardian";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

export async function startGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = genRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { projectId, shotId, sourceGenerationId, tailGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel } = parsed.data;

  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  // variantSel conditions IMAGE generation (which keyframe to anchor on). Video (i2v)
  // conditions on the source keyframe, not entity refs — the chosen variant is already
  // baked into that keyframe — so it's not meaningful for video and the worker ignores
  // it. Drop it for video so a job never persists/claims (in its snapshot) a variant it
  // didn't actually condition on. The @mention itself still works (name in the prompt).
  const effectiveVariantSel = kind === "video" ? undefined : variantSel;

  // double-submit guard (fast path): a reload re-sends the same stable key, so
  // reuse the in-flight job instead of starting (and paying for) a 2nd one. The
  // partial-unique index on the create below is the race-proof backstop.
  if (idempotencyKey) {
    const active = await prisma.genJob.findFirst({
      where: { ownerId: FOUNDER_OWNER_ID, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
      orderBy: { createdAt: "desc" }, select: { id: true },
    });
    if (active) return { id: active.id };
  }

  // resolve the per-model video controls to concrete values (defaults fill any the
  // composer didn't override) so the worker has everything it needs to spend once.
  let videoOptions;
  if (kind === "video") {
    const d = videoDefaults(model as GenVideoModel);
    videoOptions = {
      seconds: durationSeconds ?? d.seconds,
      resolution: resolution ?? d.resolution,
      aspectRatio: aspectRatio ?? d.aspectRatio,
      fps: fps ?? d.fps,
      audio: audio ?? d.audio,
    };
  }

  // consistencyGuardian (Phase 2): block obvious money-wasters BEFORE the spend
  // commit (a CHARACTER with no refs, a deleted @mention, a cross-project i2v
  // frame). Fail-OPEN — checkCast returns null on its own faults — and additive
  // only: it never loosens the existing gate.
  const block = await checkCast({ projectId, entityIds, variantSel: effectiveVariantSel, sourceGenerationId, tailGenerationId, model, kind });
  if (block) {
    try {
      await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "gen.guardian-block", payload: { findings: block.report.findings } } });
    } catch { /* audit best-effort — a log hiccup must not swallow the block */ }
    return { error: block.error };
  }

  let job: { id: string };
  try {
    job = await prisma.genJob.create({
      data: {
        id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, shotId: shotId ?? null,
        sourceGenerationId: sourceGenerationId ?? null,
        tailGenerationId: tailGenerationId ?? null,
        prompt, entityIds, count: kind === "video" ? 1 : count, model,
        kind: kind === "video" ? "VIDEO" : "IMAGE",
        idempotencyKey: idempotencyKey ?? null,
        ...(videoOptions ? { videoOptions } : {}),
        // Phase C: persist the @mention→variant bindings so the worker conditions on
        // the right variant. Image-only (effectiveVariantSel drops it for video).
        // Omitted when empty → column stays null (old/bare/video gens unchanged).
        ...(effectiveVariantSel ? { variantSel: effectiveVariantSel } : {}),
      },
      select: { id: true },
    });
  } catch (e) {
    // partial-unique index race: a concurrent same-key submit won the insert →
    // return ITS active job instead of creating (and paying for) a duplicate
    if (idempotencyKey && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const active = await prisma.genJob.findFirst({
        where: { ownerId: FOUNDER_OWNER_ID, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      if (active) return { id: active.id };
    }
    throw e;
  }
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(GEN_QUEUE, { genJobId: job.id } satisfies GenJobData);
    await prisma.genJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "gen.start", payload: { jobId: job.id, shotId: shotId ?? null, count } },
  });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll a gen job + return its produced generations' image URLs when DONE. */
export async function getGenJob(jobId: string) {
  const job = await prisma.genJob.findFirst({ where: { id: jobId, ownerId: FOUNDER_OWNER_ID } });
  if (!job) return null;
  let urls: string[] = [];
  if (job.generationIds.length) {
    const gens = await prisma.generation.findMany({
      where: { id: { in: job.generationIds } },
      include: { asset: true },
    });
    // return urls in the order the worker produced them — findMany order is the
    // DB's, so a multi-image batch would otherwise come back shuffled
    const byId = new Map(gens.map((g) => [g.id, g]));
    urls = job.generationIds
      .map((gid) => byId.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext)));
  }
  return { id: job.id, status: job.status, progress: job.progress, error: job.error, urls, generationIds: job.generationIds, spent: job.spent };
}

/** Recent gen results for a project, newest first. Gen space rehydrates its result
 *  list from this on mount — the panel is client-state, so navigating to another
 *  surface (or a reload) would otherwise lose finished generations from view (they
 *  stay in Assets, but the user expects them in the gen panel too). */
export async function getRecentGenResults(projectId: string, limit = 12) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, select: { id: true } });
  if (!project) return [];
  const jobs = await prisma.genJob.findMany({
    where: { projectId, ownerId: FOUNDER_OWNER_ID },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, status: true, prompt: true, model: true, kind: true, error: true, generationIds: true },
  });
  const ids = jobs.flatMap((j) => j.generationIds);
  const gens = ids.length ? await prisma.generation.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { asset: true } }) : [];
  const byId = new Map(gens.map((g) => [g.id, g]));
  return jobs.map((j) => ({
    jobId: j.id,
    status: j.status,
    prompt: j.prompt,
    model: j.model,
    kind: j.kind === "VIDEO" ? ("video" as const) : ("image" as const),
    error: j.error,
    urls: j.generationIds
      .map((gid) => byId.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))),
  }));
}
