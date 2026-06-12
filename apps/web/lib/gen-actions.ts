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

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

export async function startGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = genRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { projectId, shotId, sourceGenerationId, tailGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio } = parsed.data;

  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

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

  const job = await prisma.genJob.create({
    data: {
      id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, shotId: shotId ?? null,
      sourceGenerationId: sourceGenerationId ?? null,
      tailGenerationId: tailGenerationId ?? null,
      prompt, entityIds, count: kind === "video" ? 1 : count, model,
      kind: kind === "video" ? "VIDEO" : "IMAGE",
      ...(videoOptions ? { videoOptions } : {}),
    },
  });
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
    urls = gens.map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext)));
  }
  return { id: job.id, status: job.status, progress: job.progress, error: job.error, urls };
}
