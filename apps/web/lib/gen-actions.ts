"use server";
/**
 * Shot/session generation actions (redesign Gen space). Validate → persist a
 * GenJob → dispatch → poll. The worker resolves conditioning, calls the
 * provider, and writes Generation candidates (optionally bound to a shot).
 */
import { revalidatePath } from "next/cache";
import { prisma, reserveCredits, refundReservation, InsufficientCredits } from "@artlio/db";
import {
  genRequest,
  newId,
  GEN_QUEUE,
  storageKey,
  storageKeyToSrc,
  videoDefaults,
  isModelDisabled,
  pricedGenCredits,
  type GenJobData,
  type GenVideoModel,
} from "@artlio/core";
import { getBoss } from "./queue";
import { checkCast } from "./cowork-guardian";
import { requireOwner } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";

export async function startGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const parsed = genRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { projectId, shotId, sourceGenerationId, tailGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel, threadId } = parsed.data;

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
      where: { ownerId, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
      orderBy: { createdAt: "desc" }, select: { id: true },
    });
    if (active) return { id: active.id };
  }

  // resolve the per-model video controls to concrete values (defaults fill any the
  // composer didn't override) so the worker has everything it needs to spend once.
  let videoOptions: { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } | undefined;
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
  const block = await checkCast({ ownerId, projectId, entityIds, variantSel: effectiveVariantSel, sourceGenerationId, tailGenerationId, model, kind });
  if (block) {
    try {
      await prisma.actionEvent.create({ data: { id: newId(), ownerId, projectId, type: "gen.guardian-block", payload: { findings: block.report.findings } } });
    } catch { /* audit best-effort — a log hiccup must not swallow the block */ }
    return { error: block.error };
  }

  // OPT-6 P2: reject an admin-disabled model BEFORE the spend commit. This is
  // ADDITIVE narrowing — the typed superRefine above stays the authority over
  // which (model,params) may spend; this only subtracts a turned-off model.
  // Fail-closed-to-typed-menu on a DB fault (resolveDisabledModels → empty set).
  const disabled = await resolveDisabledModels();
  if (isModelDisabled(model, disabled)) {
    return { error: "That model is currently turned off — pick another." };
  }

  // P2: the deterministic CHARGE in internal credits — reserved atomically with the
  // job insert below, settled at commit, refunded on terminal failure (the worker).
  // Same value the worker recomputes from the frozen job row → reserve == settle.
  const cost = pricedGenCredits({
    kind: kind === "video" ? "VIDEO" : "IMAGE",
    model,
    count: kind === "video" ? 1 : count,
    videoOptions: videoOptions ?? null,
  });

  let job: { id: string };
  try {
    // RESERVE the charge in the SAME transaction as the insert: if the balance can't
    // cover it, reserveCredits throws and the whole tx rolls back (no job, no queue,
    // no spend) → the catch returns a friendly out-of-credits message. A concurrent
    // submit can't drive the balance negative (conditional decrement on the account row).
    job = await prisma.$transaction(async (tx) => {
      const created = await tx.genJob.create({
        data: {
          id: newId(), ownerId, projectId, shotId: shotId ?? null,
          sourceGenerationId: sourceGenerationId ?? null,
          tailGenerationId: tailGenerationId ?? null,
          prompt, entityIds, count: kind === "video" ? 1 : count, model,
          kind: kind === "video" ? "VIDEO" : "IMAGE",
          idempotencyKey: idempotencyKey ?? null,
          threadId: threadId ?? null, // cowork tag — keeps this job out of the GenSpace/Assets/Editor views
          ...(videoOptions ? { videoOptions } : {}),
          // Phase C: persist the @mention→variant bindings so the worker conditions on
          // the right variant. Image-only (effectiveVariantSel drops it for video).
          // Omitted when empty → column stays null (old/bare/video gens unchanged).
          ...(effectiveVariantSel ? { variantSel: effectiveVariantSel } : {}),
        },
        select: { id: true },
      });
      await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
      return created;
    });
  } catch (e) {
    // out of credits: the reserve rolled the tx back, so no job was created/queued.
    if (e instanceof InsufficientCredits) {
      return { error: "You've used up your beta credits — reply and we'll top you up." };
    }
    // partial-unique index race: a concurrent same-key submit won the insert → return
    // ITS job instead of creating (and paying for) a duplicate. The tx rolled back, so
    // no reserve happened for this attempt. Scope the lookup to mirror each key's index:
    // a general (shot-frame) key conflicts only while ACTIVE (active-only index), so match
    // active — keeping the original behavior and not masking a future unrelated unique
    // conflict; a cowork:<cardId> key is exactly-once-ever (GenJob_cowork_idempotency_once
    // is all-status), so match ANY status — a re-insert after the first job is DONE/FAILED
    // must also return that job, never spend again, never re-throw P2002 to the caller.
    if (idempotencyKey && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const coworkKey = idempotencyKey.startsWith("cowork:");
      const existing = await prisma.genJob.findFirst({
        where: { ownerId, projectId, idempotencyKey, ...(coworkKey ? {} : { status: { in: ["QUEUED", "GENERATING"] } }) },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      if (existing) return { id: existing.id };
    }
    throw e;
  }
  // ONLY the enqueue (getBoss/boss.send) is in this try: if the message was never sent, no
  // worker can run the job, so terminal-fail AND release the hold (else the reservation leaks).
  // Status is still QUEUED (nothing claimed it), so there's no running worker to clobber.
  let queueJobId: string | null = null;
  try {
    const boss = await getBoss();
    queueJobId = await boss.send(GEN_QUEUE, { genJobId: job.id } satisfies GenJobData);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.$transaction(async (tx) => {
      await tx.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `dispatch failed: ${message}` } });
      await refundReservation(tx, { orgId: ownerId, refId: job.id });
    });
    return { error: "Could not reach the generation queue — is the worker up?" };
  }
  // BEST-EFFORT: the job is ALREADY enqueued (the payload carries its id), so a failure
  // persisting queueJobId (tracking only) must NOT terminal-fail/refund a job the worker will
  // process — that would be a delivered-but-refunded leak. Log + continue.
  try {
    await prisma.genJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    console.warn(`startGen: queueJobId persist failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  // BEST-EFFORT: the GenJob is already created + queued (paid path committed) above, so
  // an audit-write failure must NOT throw past here — else the caller returns an error
  // and a retry (esp. a keyless GenSpace direct gen) could enqueue a SECOND paid job.
  // Log + swallow. (Keyed callers dedupe on retry; keyless ones must not even reach here.)
  try {
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId, projectId, type: "gen.start", payload: { jobId: job.id, shotId: shotId ?? null, count } },
    });
  } catch (e) {
    console.warn(`startGen: gen.start audit write failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll a gen job + return its produced generations' image URLs when DONE. */
export async function getGenJob(jobId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const job = await prisma.genJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) return null;
  let urls: string[] = [];
  if (job.generationIds.length) {
    const gens = await prisma.generation.findMany({
      where: { id: { in: job.generationIds }, ownerId },
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
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return [];
  const jobs = await prisma.genJob.findMany({
    where: { projectId, ownerId, threadId: null },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, status: true, prompt: true, model: true, kind: true, error: true, generationIds: true },
  });
  const ids = jobs.flatMap((j) => j.generationIds);
  const gens = ids.length ? await prisma.generation.findMany({ where: { id: { in: ids }, ownerId, deletedAt: null }, include: { asset: true } }) : [];
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
