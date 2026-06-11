"use server";
/**
 * Reference-generation actions (Phase 2 flagship — first cost-incurring API).
 * Mirrors the editor's startRender/getRenderJobs: validate → persist a job
 * row → dispatch to the worker → poll. The worker resolves conditioning,
 * calls the provider, and attaches generated ReferenceImages to the entity.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import {
  refGenRequest,
  newId,
  REFGEN_QUEUE,
  FOUNDER_OWNER_ID,
  type RefGenJobData,
} from "@artlio/core";
import { getBoss } from "./queue";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

export async function startRefGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = refGenRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds — check the prompt and count." };
  const { entityId, prompt, count, model } = parsed.data;

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Element not found." };

  // one generation in flight per entity — double-clicks and duplicate tabs
  // must not stack (and stack spend); same guard shape as startRender
  const active = await prisma.refGenJob.findFirst({
    where: { entityId, ownerId: FOUNDER_OWNER_ID, status: { in: ["QUEUED", "GENERATING"] } },
  });
  if (active) return { error: "A generation is already running for this element — wait for it to finish." };

  const job = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count, model },
  });
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(REFGEN_QUEUE, { refGenJobId: job.id } satisfies RefGenJobData);
    await prisma.refGenJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.refGenJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `dispatch failed: ${message}` },
    });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "refgen.start", payload: { jobId: job.id, entityId, count } },
  });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll target for the entity detail's generation block. */
export async function getRefGenJobs(entityId: string) {
  const jobs = await prisma.refGenJob.findMany({
    where: { entityId, ownerId: FOUNDER_OWNER_ID },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return jobs.map((j) => ({
    id: j.id,
    status: j.status,
    progress: j.progress,
    count: j.count,
    produced: j.outputAssetIds.length,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
  }));
}
