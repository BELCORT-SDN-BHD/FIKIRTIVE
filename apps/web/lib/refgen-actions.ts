"use server";
/**
 * Reference-generation actions (Phase 2 flagship — first cost-incurring API).
 * Mirrors the editor's startRender/getRenderJobs: validate → persist a job
 * row → dispatch to the worker → poll. The worker resolves conditioning,
 * calls the provider, and attaches generated ReferenceImages to the entity.
 */
import { revalidatePath } from "next/cache";
import { prisma, reserveCredits, refundReservation, InsufficientCredits } from "@fikirtive/db";
import {
  refGenRequest,
  newId,
  slugify,
  REFGEN_QUEUE,
  isModelDisabled,
  pricedRefgenCredits,
  type RefGenJobData,
} from "@fikirtive/core";
import { getBoss } from "./queue";
import { requireOwner } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";

// a job stuck QUEUED/GENERATING past the queue's expiry is treated as abandoned
// (worker died mid-run) so a new generation isn't blocked forever.
const STALE_MS = 15 * 60 * 1000;

export async function startRefGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
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

  // OPT-6 P2: reject an admin-disabled model before the spend commit (additive
  // narrowing; refGenRequest.enum stays the authority). seedream is the only
  // refgen model today, so this is the image-toggle in the reference path.
  const disabled = await resolveDisabledModels();
  if (isModelDisabled(model, disabled)) {
    return { error: "Image generation is currently turned off." };
  }

  // BASE is single-image; only REFSHEET honors the requested count. (VARIANT is
  // rejected above; Phase B reintroduces its single-image + per-variant handling.)
  const effectiveCount = mode === "REFSHEET" ? count : 1;

  // one generation in flight per entity — double-clicks and duplicate tabs
  // must not stack (and stack spend); same guard shape as startRender. Only
  // RECENT active jobs block (STALE_MS): a job stuck past the queue's expiry
  // (worker died mid-run) is treated as abandoned so the founder isn't locked out.
  const active = await prisma.refGenJob.findFirst({
    where: {
      ownerId,
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
  // P2 charge — reserved atomically with the insert; settled/refunded by the worker.
  const cost = pricedRefgenCredits({ model, count: effectiveCount });
  let job: { id: string };
  try {
    // RESERVE in the SAME tx as the insert: an over-balance reserve throws and rolls
    // back the whole tx (no job, no queue, no spend) → friendly out-of-credits. (A stale
    // abandoned job that this new gen skipped past keeps its hold until the worker's
    // stale-claim branch refunds it — never double-charged.)
    job = await prisma.$transaction(async (tx) => {
      const created = await tx.refGenJob.create({
        data: { id: newId(), ownerId, entityId, prompt, count: effectiveCount, model, mode },
        select: { id: true },
      });
      await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
      return created;
    });
  } catch (e) {
    if (e instanceof InsufficientCredits) {
      return { error: "You've used up your beta credits — reply and we'll top you up." };
    }
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const dupe = await prisma.refGenJob.findFirst({
        // variantId null: startRefGen creates only base/REFSHEET (COALESCE→'' in the
        // index). VARIANT jobs go through dispatchVariantJob and key on variantId.
        where: { ownerId, entityId, variantId: null, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (dupe) return { id: dupe.id };
    }
    throw e;
  }
  // ONLY the enqueue is in this try: if the message was never sent, terminal-fail AND release
  // the hold (else it leaks). Status is still QUEUED, so no running worker to clobber.
  let queueJobId: string | null = null;
  try {
    const boss = await getBoss();
    queueJobId = await boss.send(REFGEN_QUEUE, { refGenJobId: job.id } satisfies RefGenJobData);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.$transaction(async (tx) => {
      await tx.refGenJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
      await refundReservation(tx, { orgId: ownerId, refId: job.id });
    });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  // BEST-EFFORT: the job is ALREADY enqueued — a queueJobId (tracking) persist failure must
  // NOT terminal-fail/refund a job the worker will process (delivered-but-refunded leak).
  try {
    await prisma.refGenJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    console.warn(`startRefGen: queueJobId persist failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  // BEST-EFFORT (mirror dispatchVariantJob): the job is already reserved + enqueued, so an
  // audit-write failure must NOT throw past here — else the caller returns an error and a
  // retry, once this job has left the active QUEUED/GENERATING dedup window, would enqueue a
  // SECOND paid job (delivered-but-double-charged). Log + swallow.
  try {
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId, type: "refgen.start", payload: { jobId: job.id, entityId, count: effectiveCount } },
    });
  } catch (e) {
    console.warn(`startRefGen: refgen.start audit write failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Pin the entity's locked base to one of its OWN live reference images' assets.
 *  Validate-before-write: the asset must already be a live ref of this entity
 *  (no arbitrary asset ids), then set Entity.baseAssetId. No spend. */
export async function setBaseAsset(entityId: string, assetId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
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
    data: { id: newId(), ownerId, type: "entity.update", payload: { entityId, action: "set-base", assetId } },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Dispatch a VARIANT i2i job for an existing variant (shared by create + regenerate).
 *  Per-VARIANT active-job guard (NOT per-entity — different variants run concurrently)
 *  prevents stacking spend; an in-flight job for the same variant is reused. */
async function dispatchVariantJob(ownerId: string, entityId: string, variantId: string, prompt: string): Promise<{ jobId: string } | { error: string }> {
  // OPT-6 P2: the variant path bypasses startRefGen — enforce disable here too.
  // dispatchVariantJob always uses model:"seedream", so this is the seedream toggle.
  const disabled = await resolveDisabledModels();
  if (isModelDisabled("seedream", disabled)) {
    return { error: "Image generation is currently turned off." };
  }
  const active = await prisma.refGenJob.findFirst({
    where: { variantId, ownerId, status: { in: ["QUEUED", "GENERATING"] }, updatedAt: { gte: new Date(Date.now() - STALE_MS) } },
    select: { id: true },
  });
  if (active) return { jobId: active.id };
  // race-proof backstop (same as startRefGen): the findFirst above is the friendly
  // fast path; the partial-unique index keys on (entity, variantId) so two near-
  // simultaneous same-variant submits can't both create a paid job — the loser hits
  // P2002 and we reuse the in-flight job instead of double-spending.
  // P2 charge — variant gens are always a single seedream image.
  const cost = pricedRefgenCredits({ model: "seedream", count: 1 });
  let job: { id: string };
  try {
    // RESERVE atomically with the insert (rolls back on over-balance → out-of-credits).
    job = await prisma.$transaction(async (tx) => {
      const created = await tx.refGenJob.create({
        data: { id: newId(), ownerId, entityId, prompt, count: 1, model: "seedream", mode: "VARIANT", variantId },
        select: { id: true },
      });
      await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
      return created;
    });
  } catch (e) {
    if (e instanceof InsufficientCredits) {
      return { error: "You've used up your beta credits — reply and we'll top you up." };
    }
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const dupe = await prisma.refGenJob.findFirst({
        where: { ownerId, entityId, variantId, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (dupe) return { jobId: dupe.id };
    }
    throw e;
  }
  // ONLY the enqueue in this try (see startRefGen — same leak guard): a true send failure
  // terminal-fails + refunds; the queueJobId persist below is best-effort.
  let queueJobId: string | null = null;
  try {
    const boss = await getBoss();
    queueJobId = await boss.send(REFGEN_QUEUE, { refGenJobId: job.id } satisfies RefGenJobData);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.$transaction(async (tx) => {
      await tx.refGenJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
      await refundReservation(tx, { orgId: ownerId, refId: job.id });
    });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  try {
    await prisma.refGenJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    console.warn(`dispatchVariantJob: queueJobId persist failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  // audit the paid variant path (M-c): createVariant/regenerateVariant dispatch a
  // real RefGenJob here but bypass startRefGen, so they emitted no refgen.start —
  // the money-gate audit would miss it. mode:"VARIANT" distinguishes it. BEST-EFFORT:
  // the job is already created + queued (paid path committed) above, so an audit-write
  // failure must NOT throw past this point — else the caller returns an error and a
  // retry could enqueue a SECOND paid variant job (double-spend). Log + swallow.
  try {
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId, type: "refgen.start", payload: { jobId: job.id, entityId, variantId, count: 1, mode: "VARIANT" } },
    });
  } catch (e) {
    console.warn(`dispatchVariantJob: refgen.start audit write failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
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
 *  Validate-before-spend: the entity must have a live owned base. An accidental
 *  same-(name,prompt) double-submit whose first job is still in-flight is deduped
 *  (reused, NOT a suffixed twin + second charge); only after the EntityVariant
 *  commits do we dispatch the paid job. */
export async function createVariant(entityId: string, name: string, prompt: string): Promise<{ variantId: string; jobId: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const cleanName = name.trim();
  const cleanPrompt = prompt.trim();
  if (!cleanName) return { error: "Give the variant a name." };
  if (!cleanPrompt) return { error: "Describe the variant." };
  if (cleanPrompt.length > 2000) return { error: "That description is too long." };

  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED }, select: { id: true, baseAssetId: true } });
  if (!entity) return { error: "Element not found." };
  if (!entity.baseAssetId) return { error: "Set a base identity first — variants are generated from it." };
  const base = await prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId, deletedAt: null }, select: { id: true } });
  if (!base) return { error: "The base image is missing — set a new base before generating variants." };

  // Dedup an accidental double-submit: withUniqueHandle de-collides the HANDLE by suffixing
  // ("<name>-2"), so two rapid clicks of the SAME name would otherwise create two variants +
  // two paid jobs. An identical (name, prompt) live variant of this entity that still has an
  // in-flight job is the same intent → reuse it. A DELIBERATE re-create after the first job
  // finishes still makes a fresh variant (no active job matches).
  // NOTE this is a findFirst check, NOT atomic: it closes the common SEQUENTIAL double-click
  // (the 2nd click sees the 1st's already-committed job) but two TRULY-CONCURRENT submits could
  // both pass it before either commits. That residual is bounded — an extra deletable variant,
  // never an unbounded drain; a full close would need a per-click idempotency key + unique index.
  const activeVariantJobs = await prisma.refGenJob.findMany({
    // mirror dispatchVariantJob's active guard: a stale (abandoned/dead) job is NOT a live
    // in-flight duplicate — without the freshness window we could hand back an abandoned jobId.
    where: { entityId, ownerId, mode: "VARIANT", variantId: { not: null }, status: { in: ["QUEUED", "GENERATING"] }, updatedAt: { gte: new Date(Date.now() - STALE_MS) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, variantId: true },
  });
  if (activeVariantJobs.length) {
    const variantIds = activeVariantJobs.map((j) => j.variantId).filter((v): v is string => !!v);
    const twin = await prisma.entityVariant.findFirst({
      where: { id: { in: variantIds }, entityId, ownerId, deletedAt: null, name: cleanName, prompt: cleanPrompt },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const job = twin ? activeVariantJobs.find((j) => j.variantId === twin.id) : undefined;
    if (twin && job) return { variantId: twin.id, jobId: job.id };
  }

  const variantId = await withUniqueHandle(cleanName, async (handle) => {
    const v = await prisma.entityVariant.create({
      data: { id: newId(), ownerId, entityId, name: cleanName, handle, prompt: cleanPrompt },
      select: { id: true },
    });
    return v.id;
  });
  if (!variantId) return { error: "Couldn't find a free name for that variant — try a different name." };

  const dispatched = await dispatchVariantJob(ownerId, entityId, variantId, cleanPrompt);
  if ("error" in dispatched) return dispatched;
  // BEST-EFFORT: the paid variant job is already created + queued (dispatchVariantJob),
  // so an audit-write failure must NOT throw past here — else the caller returns an
  // error and a retry could create a second suffixed variant + enqueue another paid
  // job (double-spend). Log + swallow.
  try {
    await prisma.actionEvent.create({ data: { id: newId(), ownerId, type: "variant.create", payload: { entityId, variantId, jobId: dispatched.jobId } } });
  } catch (e) {
    console.warn(`createVariant: variant.create audit write failed for job ${dispatched.jobId} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  return { variantId, jobId: dispatched.jobId };
}

/** Re-run a variant's generation (reuses its stored prompt). Per-variant guard
 *  (in dispatchVariantJob) prevents stacking spend. */
export async function regenerateVariant(variantId: string): Promise<{ jobId: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const variant = await prisma.entityVariant.findFirst({
    where: { id: variantId, ...OWNED },
    select: { id: true, entityId: true, prompt: true, entity: { select: { baseAssetId: true } } },
  });
  if (!variant) return { error: "Variant not found." };
  if (!variant.entity.baseAssetId) return { error: "The base image is missing — set a new base before regenerating." };
  const dispatched = await dispatchVariantJob(ownerId, variant.entityId, variantId, variant.prompt);
  if ("error" in dispatched) return dispatched;
  revalidatePath("/", "layout");
  return dispatched;
}

/** Rename a variant (re-derives the handle, de-collided via the unique index). */
export async function renameVariant(variantId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
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
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true, entityId: true } });
  if (!variant) return { error: "Variant not found." };
  const now = new Date();
  await prisma.$transaction([
    prisma.referenceImage.updateMany({ where: { variantId, ownerId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { deletedAt: now } }),
  ]);
  await prisma.actionEvent.create({ data: { id: newId(), ownerId, type: "variant.delete", payload: { entityId: variant.entityId, variantId } } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Poll target for the entity detail's generation block. Optional variant scope:
 *  pass a variantId to see only that variant's jobs, or null for base/refsheet jobs. */
export async function getRefGenJobs(entityId: string, variantId?: string | null) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const jobs = await prisma.refGenJob.findMany({
    where: { entityId, ownerId, ...(variantId !== undefined ? { variantId } : {}) },
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
