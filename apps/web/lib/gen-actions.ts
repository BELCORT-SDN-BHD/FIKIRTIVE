"use server";
/**
 * Shot/session generation actions (redesign Gen space). Validate → persist a
 * GenJob → dispatch → poll. The worker resolves conditioning, calls the
 * provider, and writes Generation candidates (optionally bound to a shot).
 */
import { revalidatePath } from "next/cache";
import { prisma, reserveCredits, refundReservation, InsufficientCredits } from "@fikirtive/db";
import {
  genRequest,
  newId,
  GEN_QUEUE,
  storageKey,
  storageKeyToSrc,
  isModelDisabled,
  assertSpendableModel,
  pricedGenCredits,
  activeImageModel,
  activeVideoModel,
  type GenJobData,
} from "@fikirtive/core";
import { getBoss } from "./queue";
import { checkCast } from "./cowork-guardian";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import {
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  parseFactoryAttemptKey,
  type FactoryAttemptKey,
  type FactoryMaterial,
  type StoredFactoryMaterial,
} from "./batch-idempotency";

export type StartGenResult =
  | { id: string; disposition: "fresh" | "reused" }
  | { error: string; disposition?: "conflict" };

const FACTORY_HISTORY_SELECT = {
  id: true,
  status: true,
  idempotencyKey: true,
  prompt: true,
  model: true,
  kind: true,
  count: true,
  entityIds: true,
  variantSel: true,
  sourceGenerationId: true,
  tailGenerationId: true,
  referenceVideoGenerationId: true,
  shotId: true,
  videoOptions: true,
} as const;

type FactoryHistoryRow = StoredFactoryMaterial & {
  id: string;
  status: string;
  idempotencyKey: string | null;
};

/** Read-only history verdict. `null` means this attempt may be fresh, so the caller must run the
 * fresh-only gates and repeat this verdict under the project lock before create + reserve. */
function factoryHistoryVerdict(
  history: FactoryHistoryRow[],
  attempt: FactoryAttemptKey,
  material: FactoryMaterial,
): StartGenResult | null {
  if (history.some((prior) => !factoryMaterialMatches(prior, material))) {
    return {
      error: "That batchId is already in use for different content — start a new batch with a fresh id.",
      disposition: "conflict",
    };
  }
  const exact = history.find((prior) => prior.idempotencyKey === attempt.key);
  if (exact) return { id: exact.id, disposition: "reused" };
  const nonFailed = history.find((prior) => prior.status !== "FAILED");
  if (nonFailed) return { id: nonFailed.id, disposition: "reused" };
  return null;
}

export async function startGen(raw: unknown): Promise<StartGenResult> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  const parsed = genRequest.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { projectId, shotId, sourceGenerationId, tailGenerationId, referenceVideoGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel, threadId } = parsed.data;

  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  // variantSel conditions IMAGE generation (which keyframe to anchor on). Video (i2v)
  // conditions on the source keyframe, not entity refs — the chosen variant is already
  // baked into that keyframe — so it's not meaningful for video and the worker ignores
  // it. The shared material normalizer drops video maps and canonicalizes an empty image
  // map to absent, matching the worker's `job.variantSel ?? {}` semantics.
  const material = normalizeFactoryMaterial({
    prompt,
    model,
    kind,
    count,
    entityIds,
    variantSel,
    sourceGenerationId,
    tailGenerationId,
    referenceVideoGenerationId,
    shotId,
    durationSeconds,
    resolution,
    aspectRatio,
    fps,
    audio,
  });
  const effectiveVariantSel = material.variantSel ?? undefined;
  const factoryAttempt = parseFactoryAttemptKey(idempotencyKey);

  // Durable factory replay fast path. Dynamic fresh-only gates (guardian/model switches/pricing)
  // may legitimately change after a job was accepted, but they must not make the same attempt's
  // response stop being idempotent. This owner+project-scoped read can only reuse/refuse — never
  // create or reserve. A miss still runs every gate, then repeats the verdict under the project
  // advisory lock before the only create + reserve authority.
  if (factoryAttempt) {
    const history = await prisma.genJob.findMany({
      where: {
        ownerId,
        projectId,
        idempotencyKey: { startsWith: factoryAttempt.logicalPrefix },
      },
      orderBy: { createdAt: "desc" },
      select: FACTORY_HISTORY_SELECT,
    });
    const early = factoryHistoryVerdict(history, factoryAttempt, material);
    if (early) return early;
  }

  // double-submit guard (fast path): a reload re-sends the same stable key, so
  // reuse the in-flight job instead of starting (and paying for) a 2nd one. The
  // partial-unique index on the create below is the race-proof backstop. Factory keys
  // deliberately skip this shortcut: their full material + attempt decision belongs
  // under the existing project advisory transaction lock below.
  if (idempotencyKey && !factoryAttempt) {
    const active = await prisma.genJob.findFirst({
      where: { ownerId, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
      orderBy: { createdAt: "desc" }, select: { id: true },
    });
    if (active) return { id: active.id, disposition: "reused" };
  }

  // The shared material normalizer resolves the exact five video controls persisted below.
  const videoOptions = material.videoOptions ?? undefined;

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

  const kindForModel = kind === "image" ? "image" : "video";
  const spendable = assertSpendableModel(model, kindForModel);
  if (!spendable.ok) return { error: spendable.error };

  // P2: the deterministic CHARGE in internal credits — reserved atomically with the
  // job insert below, settled at commit, refunded on terminal failure (the worker).
  // Same value the worker recomputes from the frozen job row → reserve == settle.
  const cost = pricedGenCredits({
    kind: kind === "video" ? "VIDEO" : "IMAGE",
    model,
    count: kind === "video" ? 1 : count,
    referenceVideoGenerationId: referenceVideoGenerationId ?? null,
    videoOptions: videoOptions ?? null,
  });

  let decision: StartGenResult;
  try {
    // RESERVE the charge in the SAME transaction as the insert: if the balance can't
    // cover it, reserveCredits throws and the whole tx rolls back (no job, no queue,
    // no spend) → the catch returns a friendly out-of-credits message. A concurrent
    // submit can't drive the balance negative (conditional decrement on the account row).
    decision = await prisma.$transaction(async (tx): Promise<StartGenResult> => {
      const projectLockKey = `project:${projectId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectLockKey}, 0::bigint))`;
      const liveProject = await tx.project.findFirst({
        where: { id: projectId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!liveProject) throw new Error("PROJECT_DELETED_DURING_GENERATION_START");

      if (factoryAttempt) {
        // Factory's exact attempt + logical-cell content binding is decided under the SAME
        // owner/project advisory lock as create+reserve. No time window and no all-status index:
        // an exact attempt is reused forever; a new attempt may create only after every prior
        // logical-cell job FAILED; content never changes across attempts (FAILED included).
        const history = await tx.genJob.findMany({
          where: {
            ownerId,
            projectId,
            idempotencyKey: { startsWith: factoryAttempt.logicalPrefix },
          },
          orderBy: { createdAt: "desc" },
          select: FACTORY_HISTORY_SELECT,
        });
        const locked = factoryHistoryVerdict(history, factoryAttempt, material);
        if (locked) return locked;
      }

      const created = await tx.genJob.create({
        data: {
          id: newId(), ownerId, projectId, shotId: shotId ?? null,
          sourceGenerationId: sourceGenerationId ?? null,
          tailGenerationId: tailGenerationId ?? null,
          referenceVideoGenerationId: referenceVideoGenerationId ?? null,
          prompt, entityIds, count: kind === "video" ? 1 : count, model,
          kind: kind === "video" ? "VIDEO" : "IMAGE",
          idempotencyKey: idempotencyKey ?? null,
          threadId: threadId ?? null, // cowork tag — keeps this job out of the GenSpace/Assets/Editor views
          ...(videoOptions ? { videoOptions } : {}),
          // Phase C: persist the @mention→variant bindings so the worker conditions on
          // the right variant. Image-only (the shared material normalizer drops it for video).
          // Omitted when empty → column stays null (old/bare/video gens unchanged).
          ...(material.variantSel ? { variantSel: material.variantSel } : {}),
        },
        select: { id: true },
      });
      await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
      return { id: created.id, disposition: "fresh" };
    });
  } catch (e) {
    // out of credits: the reserve rolled the tx back, so no job was created/queued.
    if (e instanceof InsufficientCredits) {
      return { error: "You've used up your beta credits — reply and we'll top you up." };
    }
    if (e instanceof Error && e.message === "PROJECT_DELETED_DURING_GENERATION_START") {
      return { error: "Project not found." };
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
      if (factoryAttempt) {
        const existing = await prisma.genJob.findFirst({
          where: { ownerId, projectId, idempotencyKey: factoryAttempt.key },
          orderBy: { createdAt: "desc" },
          select: FACTORY_HISTORY_SELECT,
        });
        if (existing) {
          if (!factoryMaterialMatches(existing, material)) {
            return {
              error: "That batchId is already in use for different content — start a new batch with a fresh id.",
              disposition: "conflict",
            };
          }
          return { id: existing.id, disposition: "reused" };
        }
        // A factory recovery must never fall through to the generic id-only lookup below: doing
        // so would reuse a late-visible winner without verifying its full material binding.
        // PostgreSQL unique conflicts normally make the winner visible before this catch; if an
        // unrelated P2002 reaches here, refuse safely instead of guessing.
        return { error: "That batch request could not be safely deduplicated — retry it." };
      }
      const coworkKey = idempotencyKey.startsWith("cowork:");
      const existing = await prisma.genJob.findFirst({
        where: { ownerId, projectId, idempotencyKey, ...(coworkKey ? {} : { status: { in: ["QUEUED", "GENERATING"] } }) },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      if (existing) return { id: existing.id, disposition: "reused" };
    }
    throw e;
  }
  if ("error" in decision) return decision;
  if (decision.disposition === "reused") return decision;
  const job = { id: decision.id };
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
  return { id: job.id, disposition: "fresh" };
}

/** F18: resolve the active image/video models SERVER-side (where OTTO_DEFAULT_VIDEO_MODEL is
 *  actually in the environment). Client components must NOT call activeImageModel()/
 *  activeVideoModel() directly — that env is not bundled, so the browser computes the code
 *  default instead of the server-configured model and can mismatch what the server gate
 *  accepts. Clients fetch this instead so their gen requests carry the real model. */
export async function getActiveGenModels(): Promise<{ image: string; video: string }> {
  return { image: activeImageModel(), video: activeVideoModel() };
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
