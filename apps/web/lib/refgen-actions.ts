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
  slugify,
  REFGEN_QUEUE,
  FOUNDER_OWNER_ID,
  type RefGenJobData,
} from "@artlio/core";
import { getBoss } from "./queue";
import { requireSession } from "./auth-guard";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;
// a job stuck QUEUED/GENERATING past the queue's expiry is treated as abandoned
// (worker died mid-run) so a new generation isn't blocked forever.
const STALE_MS = 15 * 60 * 1000;

export async function startRefGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireSession(); if ("error" in gate) return gate;
  const parsed = refGenRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds — check the prompt and count." };
  const { entityId, prompt, count, model, mode } = parsed.data;

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Element not found." };

  // Phase A fail-closed: VARIANT is not wired end-to-end yet. The worker can't
  // condition a variant on the base (i2i), the output would be mis-attached
  // (variantId stays null), and the variant isn't validated to exist — accepting
  // one would spend on a wrong result. Phase B adds the worker VARIANT path +
  // full EntityVariant validation, then lifts this gate. No UI issues VARIANT today.
  if (mode === "VARIANT") return { error: "Variant generation isn't available yet." };

  // BASE is single-image; only REFSHEET honors the requested count. (VARIANT is
  // rejected above; Phase B reintroduces its single-image + per-variant handling.)
  const effectiveCount = mode === "REFSHEET" ? count : 1;

  // one generation in flight per entity — double-clicks and duplicate tabs
  // must not stack (and stack spend); same guard shape as startRender. Only
  // RECENT active jobs block (STALE_MS): a job stuck past the queue's expiry
  // (worker died mid-run) is treated as abandoned so the founder isn't locked out.
  const active = await prisma.refGenJob.findFirst({
    where: {
      ownerId: FOUNDER_OWNER_ID,
      status: { in: ["QUEUED", "GENERATING"] },
      updatedAt: { gte: new Date(Date.now() - STALE_MS) },
      // serialize per entity (BASE/REFSHEET are the only modes reaching here).
      entityId,
    },
  });
  if (active) return { error: "A generation is already running for this element — wait for it to finish." };

  // the findFirst above is the friendly fast path; the partial-unique index
  // (RefGenJob_active_entity_variant_key) is the race-proof backstop underneath.
  // Its TOCTOU window: two near-simultaneous submits both pass findFirst and both
  // reach create — the index lets one win and rejects the other with P2002, which
  // we catch to return the in-flight job instead of creating (and paying for) a
  // duplicate. Mirrors startGen's idempotency backstop.
  let job: { id: string };
  try {
    job = await prisma.refGenJob.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count: effectiveCount, model, mode },
      select: { id: true },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const dupe = await prisma.refGenJob.findFirst({
        // variantId null: startRefGen creates only base/REFSHEET (COALESCE→'' in the
        // index). VARIANT jobs go through dispatchVariantJob and key on variantId.
        where: { ownerId: FOUNDER_OWNER_ID, entityId, variantId: null, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (dupe) return { id: dupe.id };
    }
    throw e;
  }
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
  const gate = await requireSession(); if ("error" in gate) return gate;
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

/** Dispatch a VARIANT i2i job for an existing variant (shared by create + regenerate).
 *  Per-VARIANT active-job guard (NOT per-entity — different variants run concurrently)
 *  prevents stacking spend; an in-flight job for the same variant is reused. */
async function dispatchVariantJob(entityId: string, variantId: string, prompt: string): Promise<{ jobId: string } | { error: string }> {
  const active = await prisma.refGenJob.findFirst({
    where: { variantId, ownerId: FOUNDER_OWNER_ID, status: { in: ["QUEUED", "GENERATING"] }, updatedAt: { gte: new Date(Date.now() - STALE_MS) } },
    select: { id: true },
  });
  if (active) return { jobId: active.id };
  // race-proof backstop (same as startRefGen): the findFirst above is the friendly
  // fast path; the partial-unique index keys on (entity, variantId) so two near-
  // simultaneous same-variant submits can't both create a paid job — the loser hits
  // P2002 and we reuse the in-flight job instead of double-spending.
  let job: { id: string };
  try {
    job = await prisma.refGenJob.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, prompt, count: 1, model: "seedream", mode: "VARIANT", variantId },
      select: { id: true },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const dupe = await prisma.refGenJob.findFirst({
        where: { ownerId: FOUNDER_OWNER_ID, entityId, variantId, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (dupe) return { jobId: dupe.id };
    }
    throw e;
  }
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(REFGEN_QUEUE, { refGenJobId: job.id } satisfies RefGenJobData);
    await prisma.refGenJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.refGenJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  return { jobId: job.id };
}

/** Derive a unique live handle for a variant (the partial unique index on
 *  (entityId, handle) WHERE deletedAt IS NULL is the race-proof backstop; we
 *  retry with -N suffixes on its P2002). Runs `write(handle)` which must return
 *  the created/updated id or throw P2002 on collision. */
async function withUniqueHandle(name: string, write: (handle: string) => Promise<string>): Promise<string | null> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 25; attempt++) {
    const handle = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      return await write(handle);
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
  return null;
}

/** Create a named variant and kick off its i2i generation from the locked base.
 *  Validate-before-spend: the entity must have a live owned base. The EntityVariant
 *  is created first (handle de-collided via the partial unique index) — a duplicate
 *  double-submit fails cleanly with no job; only after it commits do we dispatch. */
export async function createVariant(entityId: string, name: string, prompt: string): Promise<{ variantId: string; jobId: string } | { error: string }> {
  const gate = await requireSession(); if ("error" in gate) return gate;
  const cleanName = name.trim();
  const cleanPrompt = prompt.trim();
  if (!cleanName) return { error: "Give the variant a name." };
  if (!cleanPrompt) return { error: "Describe the variant." };
  if (cleanPrompt.length > 2000) return { error: "That description is too long." };

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED }, select: { id: true, baseAssetId: true } });
  if (!entity) return { error: "Element not found." };
  if (!entity.baseAssetId) return { error: "Set a base identity first — variants are generated from it." };
  const base = await prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, select: { id: true } });
  if (!base) return { error: "The base image is missing — set a new base before generating variants." };

  const variantId = await withUniqueHandle(cleanName, async (handle) => {
    const v = await prisma.entityVariant.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, name: cleanName, handle, prompt: cleanPrompt },
      select: { id: true },
    });
    return v.id;
  });
  if (!variantId) return { error: "Couldn't find a free name for that variant — try a different name." };

  const dispatched = await dispatchVariantJob(entityId, variantId, cleanPrompt);
  if ("error" in dispatched) return dispatched;
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "variant.create", payload: { entityId, variantId, jobId: dispatched.jobId } } });
  revalidatePath("/", "layout");
  return { variantId, jobId: dispatched.jobId };
}

/** Re-run a variant's generation (reuses its stored prompt). Per-variant guard
 *  (in dispatchVariantJob) prevents stacking spend. */
export async function regenerateVariant(variantId: string): Promise<{ jobId: string } | { error: string }> {
  const gate = await requireSession(); if ("error" in gate) return gate;
  const variant = await prisma.entityVariant.findFirst({
    where: { id: variantId, ...OWNED },
    select: { id: true, entityId: true, prompt: true, entity: { select: { baseAssetId: true } } },
  });
  if (!variant) return { error: "Variant not found." };
  if (!variant.entity.baseAssetId) return { error: "The base image is missing — set a new base before regenerating." };
  const dispatched = await dispatchVariantJob(variant.entityId, variantId, variant.prompt);
  if ("error" in dispatched) return dispatched;
  revalidatePath("/", "layout");
  return dispatched;
}

/** Rename a variant (re-derives the handle, de-collided via the unique index). */
export async function renameVariant(variantId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireSession(); if ("error" in gate) return gate;
  const cleanName = name.trim();
  if (!cleanName) return { error: "Give the variant a name." };
  const exists = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true } });
  if (!exists) return { error: "Variant not found." };
  const done = await withUniqueHandle(cleanName, async (handle) => {
    const { count } = await prisma.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { name: cleanName, handle } });
    if (count === 0) throw new Error("gone");
    return variantId;
  }).catch((e) => { if (e instanceof Error && e.message === "gone") return null; throw e; });
  if (!done) return { error: "Couldn't rename — the name may be taken, try another." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Soft-delete a variant AND its tagged reference images (D21; onDelete:Restrict
 *  blocks a hard delete, so the app owns the cascade). */
export async function deleteVariant(variantId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireSession(); if ("error" in gate) return gate;
  const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true, entityId: true } });
  if (!variant) return { error: "Variant not found." };
  const now = new Date();
  await prisma.$transaction([
    prisma.referenceImage.updateMany({ where: { variantId, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { deletedAt: now } }),
    prisma.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { deletedAt: now } }),
  ]);
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "variant.delete", payload: { entityId: variant.entityId, variantId } } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Poll target for the entity detail's generation block. Optional variant scope:
 *  pass a variantId to see only that variant's jobs, or null for base/refsheet jobs. */
export async function getRefGenJobs(entityId: string, variantId?: string | null) {
  const gate = await requireSession(); if ("error" in gate) throw new Error(gate.error);
  const jobs = await prisma.refGenJob.findMany({
    where: { entityId, ownerId: FOUNDER_OWNER_ID, ...(variantId !== undefined ? { variantId } : {}) },
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
