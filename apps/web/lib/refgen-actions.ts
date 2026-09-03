"use server";
/**
 * Reference-generation actions (Phase 2 flagship — first cost-incurring API).
 * Mirrors the editor's startRender/getRenderJobs: validate → persist a job
 * row → dispatch to the worker → poll. The worker resolves conditioning,
 * calls the provider, and attaches generated ReferenceImages to the entity.
 */
import { revalidatePath } from "next/cache";
import { prisma, reserveCredits, refundReservation, InsufficientCredits, SpendCapBlocked } from "@fikirtive/db";
import {
  refGenRequest,
  newId,
  slugify,
  REFGEN_QUEUE,
  isModelDisabled,
  displayCredits,
  pricedRefgenCredits,
  merchantGenFailureCopy,
  type RefGenJobData,
} from "@fikirtive/core";
import { runAsUser } from "@fikirtive/db/principal";
import { getBoss } from "./queue";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import { outOfCreditsMessage, spendCapBlockedMessage } from "./credit-format";

// a job stuck QUEUED/GENERATING past the queue's expiry is treated as abandoned
// (worker died mid-run) so a new generation isn't blocked forever.
const STALE_MS = 15 * 60 * 1000;

/** #781 r3 P1 — the two halves of the variant/delete race, as errors that never leave their action.
 *
 *  "Is anything running for this variant?" and "is this variant still there?" used to be READS taken
 *  outside the write that depended on them, so the two actions could interleave: delete counts zero,
 *  regenerate creates a paid job, delete tombstones anyway — and the worker then settles a charge
 *  onto a variant the merchant can never see. Both actions now CLAIM the same EntityVariant row with
 *  an UPDATE at the top of their transaction, which takes that row's write lock until commit, so one
 *  of them always waits for the other and then sees the committed truth. Whoever loses throws one of
 *  these, and its transaction rolls back whole — no tombstone, or no paid job and no reserve. */
class VariantStillRunning extends Error {}
class VariantGone extends Error {}

export async function startRefGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
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
    // #647 T6 修复轮 P1-3:开关读不到 ⇒ 不许扣款(空集合等于替 Founder 把开关打开)。
    const registry = await resolveDisabledModels();
    if ("error" in registry) return registry;
    if (isModelDisabled(model, registry.disabled)) {
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
      // #524 — the merchant's own cap refused this action inside the reserve: nothing was
      // created, reserved or queued. More specific than the out-of-credits arm below.
      if (e instanceof SpendCapBlocked) {
        return {
          error: spendCapBlockedMessage(
            displayCredits(cost),
            e.capInternal === null ? null : displayCredits(e.capInternal),
          ),
        };
      }
      if (e instanceof InsufficientCredits) {
        return { error: outOfCreditsMessage(displayCredits(cost)) };
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
  });
}

/** Pin the entity's locked base to one of its OWN live reference images' assets.
 *  Validate-before-write: the asset must already be a live ref of this entity
 *  (no arbitrary asset ids), then set Entity.baseAssetId. No spend. */
export async function setBaseAsset(entityId: string, assetId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
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
  });
}

/** Dispatch a VARIANT i2i job for an existing variant (shared by create + regenerate).
 *  Per-VARIANT active-job guard (NOT per-entity — different variants run concurrently)
 *  prevents stacking spend; an in-flight job for the same variant is reused. */
async function dispatchVariantJob(ownerId: string, entityId: string, variantId: string, prompt: string): Promise<{ jobId: string } | { error: string }> {
  // OPT-6 P2: the variant path bypasses startRefGen — enforce disable here too.
  // dispatchVariantJob always uses model:"seedream", so this is the seedream toggle.
  // #647 T6 修复轮 P1-3:同上 —— 变体这条路同样不许在开关状态不明时扣款。
  const registry = await resolveDisabledModels();
  if ("error" in registry) return registry;
  if (isModelDisabled("seedream", registry.disabled)) {
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
      // #781 r3 P1 — CLAIM THE VARIANT ROW BEFORE SPENDING ON IT. This UPDATE is not cosmetic: it
      // takes the EntityVariant row's write lock and holds it until this transaction commits, and
      // deleteVariant claims the same row before it tombstones. So either we get here first (the
      // delete then waits, and its own check sees this job committed → it refuses), or the delete
      // got here first (our WHERE is re-evaluated against its committed row, `deletedAt IS NULL`
      // no longer matches, count is 0 → we spend nothing). Touching updatedAt is also true: work
      // was just dispatched for this variant.
      const claimed = await tx.entityVariant.updateMany({
        where: { id: variantId, ownerId, deletedAt: null },
        data: { updatedAt: new Date() },
      });
      if (claimed.count === 0) throw new VariantGone();
      const created = await tx.refGenJob.create({
        data: { id: newId(), ownerId, entityId, prompt, count: 1, model: "seedream", mode: "VARIANT", variantId },
        select: { id: true },
      });
      await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
      return created;
    });
  } catch (e) {
    if (e instanceof VariantGone) {
      // The whole transaction rolled back: no job, no reserve, nothing to refund.
      return { error: "That variant was deleted while this was starting, so nothing was generated and you weren't charged." };
    }
    // #524 — same cap refusal on the variant path (see startRefGen above).
    if (e instanceof SpendCapBlocked) {
      return {
        error: spendCapBlockedMessage(
          displayCredits(cost),
          e.capInternal === null ? null : displayCredits(e.capInternal),
        ),
      };
    }
    if (e instanceof InsufficientCredits) {
      return { error: outOfCreditsMessage(displayCredits(cost)) };
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

/** Take back the EntityVariant row a REFUSED dispatch left behind, and make a failure to take it
 *  back visible (#781 r3 P2).
 *
 *  The soft-delete IS the cleanup. When it throws there is nothing further this request can
 *  reliably write to that row — the marker would have to go on the very row whose write just failed
 *  — so the leftover is handed off instead of swallowed at warn level:
 *    1. one retry, because the usual cause is a transient blip and a retry that works leaves
 *       nothing to clean up at all;
 *    2. a console.error carrying owner/element/variant, so the orphan is greppable in the server
 *       log rather than filed under "non-fatal";
 *    3. an ActionEvent — a DIFFERENT row, which may well commit when that one would not. It is the
 *       durable, queryable record ("variant.rollback_failed") a sweep can find the orphan by, and
 *       the same audit trail every other variant write already lands in.
 *
 *  Returns whether the variant is really gone. The merchant hears the ORIGINAL refusal either way:
 *  a failed cleanup must not become a second, misleading error on top of the real one. */
async function rollbackUndispatchedVariant(ownerId: string, entityId: string, variantId: string): Promise<boolean> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.entityVariant.updateMany({
        where: { id: variantId, ownerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return true;
    } catch (e) {
      lastError = e;
    }
  }
  console.error(
    `createVariant: ROLLBACK FAILED — empty variant ${variantId} (entity ${entityId}, owner ${ownerId}) was left behind by a refused dispatch and needs cleaning up:`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  try {
    await prisma.actionEvent.create({
      data: {
        id: newId(),
        ownerId,
        type: "variant.rollback_failed",
        payload: { entityId, variantId, reason: "dispatch refused, but the empty variant could not be soft-deleted" },
      },
    });
  } catch (e) {
    console.error(
      `createVariant: could not even record stranded variant ${variantId} for cleanup:`,
      e instanceof Error ? e.message : e,
    );
  }
  return false;
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
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ variantId: string; jobId: string } | { error: string }> => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
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
    if ("error" in dispatched) {
      // #781 r2 P2 — ROLL THE VARIANT BACK. Every refusal dispatchVariantJob returns is a
      // before-or-instead-of-spend one (image generation turned off, not enough credits — reserved
      // in the same tx, so it rolled back — or the queue unreachable, which terminal-fails and
      // refunds). Nothing is running, and nothing ever will be: leaving the row behind strands an
      // empty variant that says "Making this look…" forever, and pushes the retry (after topping
      // up) onto a suffixed name the merchant never chose. Soft-delete, so the handle the merchant
      // picked is free again (the unique index is partial on deletedAt IS NULL) and the refusal —
      // not a stray leftover — is what they see.
      //
      // #781 r3 P2 — and if that rollback cannot be written, it is reported, not swallowed: see
      // rollbackUndispatchedVariant. Either way the merchant hears the original refusal.
      await rollbackUndispatchedVariant(ownerId, entityId, variantId);
      return dispatched;
    }
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
  });
}

/** Re-run a variant's generation (reuses its stored prompt). Per-variant guard
 *  (in dispatchVariantJob) prevents stacking spend. */
export async function regenerateVariant(variantId: string): Promise<{ jobId: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ jobId: string } | { error: string }> => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
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
  });
}

/** Rename a variant (re-derives the handle, de-collided via the unique index). */
export async function renameVariant(variantId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
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
  });
}

/** Soft-delete a variant AND its tagged reference images (D21; onDelete:Restrict
 *  blocks a hard delete, so the app owns the cascade).
 *
 *  #781 r2 P1 — IN-FLIGHT PAID WORK IS PROTECTED HERE, for every caller. The worker re-checks the
 *  variant before it spends, but a delete landing AFTER that check still lets the paid image settle
 *  onto a tombstoned variant: the merchant is charged for a look that no longer exists anywhere they
 *  can see it. Otto's port has refused this since debt-69 — but a gate that only one caller passes
 *  through is not a rule, and the merchant's own Delete button called this action directly. So the
 *  rule lives in the action both surfaces share.
 *
 *  Same semantics as the port's gate, deliberately: ANY QUEUED/GENERATING job for this variant
 *  blocks, with NO staleness window. A 15-minute abandonment window would be SHORTER than the
 *  worker's own liveness window (REFGEN_STALE_MS 18min / reaper 25min), so a job that was still
 *  genuinely running would be misjudged abandoned and let through — the exact hole this closes. A
 *  count read that fails refuses too (never "couldn't check, delete anyway"). A truly stuck job is
 *  released by the worker's reaper (reapStaleRefGenJobs — FAILED + refunded, ~25min + one 5min
 *  sweep); after that the delete goes through, so nothing is undeletable forever.
 *
 *  #781 r3 P1 — AND THE CHECK IS ATOMIC WITH THE DELETE. A count taken outside the write it guards
 *  is only a guess about the moment the write lands: delete counts zero, a re-run is dispatched and
 *  paid for, delete tombstones anyway. So the tombstone is written FIRST — that UPDATE takes the
 *  variant row's write lock, which dispatchVariantJob must also take before it may insert a paid job
 *  — and the count runs after it, inside the same transaction. A job that appears anyway rolls the
 *  tombstone back with it; a dispatch that was mid-flight finds the row tombstoned and spends
 *  nothing. Neither order can produce a paid job attached to a deleted variant. */
export async function deleteVariant(variantId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    const { ownerId } = gate;
    const OWNED = { ownerId, deletedAt: null } as const;
    const variant = await prisma.entityVariant.findFirst({ where: { id: variantId, ...OWNED }, select: { id: true, entityId: true } });
    if (!variant) return { error: "Variant not found." };
    const now = new Date();
    let claimed: boolean;
    try {
      claimed = await prisma.$transaction(async (tx) => {
        // Claim the row first (see header): the lock this takes is what a concurrent dispatch has
        // to queue behind, and it is what makes the count below a decision instead of a guess.
        const tombstoned = await tx.entityVariant.updateMany({ where: { id: variantId, ...OWNED }, data: { deletedAt: now } });
        if (tombstoned.count === 0) return false; // deleted by someone else in the meantime
        const activeJobs = await tx.refGenJob.count({
          where: { variantId, ownerId, status: { in: ["QUEUED", "GENERATING"] } },
        });
        if (activeJobs > 0) throw new VariantStillRunning();
        await tx.referenceImage.updateMany({ where: { variantId, ownerId, deletedAt: null }, data: { deletedAt: now } });
        return true;
      });
    } catch (e) {
      if (e instanceof VariantStillRunning) {
        return { error: "That variant is still being made — wait for it to finish before deleting it, so you don't lose an image you paid for." };
      }
      // Fail-closed, and now provably so: the transaction rolled back, so the tombstone it wrote
      // before the failing check is gone with it.
      return { error: "Couldn't check whether that variant is still being made, so nothing was deleted. Please try again in a moment." };
    }
    if (!claimed) return { error: "Variant not found." };
    await prisma.actionEvent.create({ data: { id: newId(), ownerId, type: "variant.delete", payload: { entityId: variant.entityId, variantId } } });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Poll target for the entity detail's generation block. Optional variant scope:
 *  pass a variantId to see only that variant's jobs, or null for base/refsheet jobs. */
export async function getRefGenJobs(entityId: string, variantId?: string | null) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
      // #781 r3 — WHICH assets, not only how many. A poller cannot tell a job that finished
      // BEFORE its page snapshot from one that finished after; both just say DONE. Comparing these
      // ids against the images already on screen answers it exactly (see lib/variant-progress).
      // Owner-scoped read, and the same ids the element's own reference images already carry.
      outputAssetIds: j.outputAssetIds,
      // Codex QA-CRE-007 — same rule as apps/web/lib/data.ts's AdJobItem: never the raw
      // RefGenJob.error ops string (it used to reach ElementVariantsDialog's "problem" line
      // verbatim, e.g. "conditioning refs unreachable (0/2 signable) — refusing to spend on a
      // degraded generation"). Honest mapped copy when the failure is one of ours, "" otherwise
      // — the dialog's own fallback sentence covers the unmapped/not-failed case.
      error: j.status === "FAILED" ? merchantGenFailureCopy(j.error) : "",
      createdAt: j.createdAt.toISOString(),
    }));
  });
}
