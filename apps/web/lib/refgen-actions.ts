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
  const { entityId, prompt, count, model, mode, variantId } = parsed.data;

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Element not found." };

  // validate-before-spend: a VARIANT generation conditions on the locked base
  // (i2i), so the base must exist as a live owned asset BEFORE we create a paid
  // job. A BASE generation has no precondition (it produces the base).
  if (mode === "VARIANT") {
    if (!entity.baseAssetId) return { error: "Set a base identity first — variants are generated from it." };
    const base = await prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, select: { id: true } });
    if (!base) return { error: "The base image is missing — set a new base before generating variants." };
  }

  // BASE and VARIANT are single-image; only REFSHEET honors the requested count.
  const effectiveCount = mode === "REFSHEET" ? count : 1;

  // one generation in flight per entity — double-clicks and duplicate tabs
  // must not stack (and stack spend); same guard shape as startRender. Only
  // RECENT active jobs block: a job stuck QUEUED/GENERATING past the queue's
  // expiry (worker died mid-run, codex P2) is treated as abandoned so the
  // founder isn't locked out while pg-boss re-delivers/expires it.
  const STALE_MS = 15 * 60 * 1000;
  const active = await prisma.refGenJob.findFirst({
    where: {
      ownerId: FOUNDER_OWNER_ID,
      status: { in: ["QUEUED", "GENERATING"] },
      updatedAt: { gte: new Date(Date.now() - STALE_MS) },
      // BASE/REFSHEET serialize per entity; VARIANT serializes per variant.
      ...(mode === "VARIANT" ? { variantId } : { entityId, mode: { not: "VARIANT" } }),
    },
  });
  if (active) return { error: "A generation is already running for this element — wait for it to finish." };

  const job = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count: effectiveCount, model, mode, variantId: variantId ?? null },
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
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "refgen.start", payload: { jobId: job.id, entityId, count: effectiveCount } },
  });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Pin the entity's locked base to one of its OWN live reference images' assets.
 *  Validate-before-write: the asset must already be a live ref of this entity
 *  (no arbitrary asset ids), then set Entity.baseAssetId. No spend. */
export async function setBaseAsset(entityId: string, assetId: string): Promise<{ ok: true } | { error: string }> {
  const ref = await prisma.referenceImage.findFirst({
    where: { entityId, assetId, ...OWNED, variantId: null },
    select: { id: true },
  });
  if (!ref) return { error: "That image is not a base reference of this element." };
  // updateMany + count: the entity may have been concurrently soft-deleted between
  // the ref check and here — a bare update({where:{id}}) would throw P2025. ...OWNED
  // scopes to a live owned row; count===0 means it's gone, not an unhandled throw.
  const { count } = await prisma.entity.updateMany({
    where: { id: entityId, ...OWNED },
    data: { baseAssetId: assetId },
  });
  if (count === 0) return { error: "Element not found." };
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "entity.update", payload: { entityId, action: "set-base", assetId } },
  });
  revalidatePath("/", "layout");
  return { ok: true };
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
