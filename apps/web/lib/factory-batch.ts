/**
 * factory-batch — the B3 factory batch ORCHESTRATION core (W-B3-F-P, spec §5.2).
 *
 * Headless batch orchestration over the ONE existing spend authority, `startGen`.
 * This file is deliberately a plain module (no server-action directive) and NOT
 * parity scanner (scripts/check-parity.mjs discoverActionSurfaces) does not treat
 * its exports as server actions — only the two thin wrappers in factory-actions.ts
 * are the owner-scoped action surface. Keeping the loop here lets tests drive it
 * with an injected `startGen` (a stub for behaviour, the real one for the ledger).
 *
 * MONEY SAFETY (money-safety-review, B0-16 "零新钱路复用现有管线"):
 *   - This layer NEVER touches credits. It does not import or call
 *     reserveCredits / settleCredits / refundReservation, never creates a GenJob,
 *     never calls a provider. Each cell's reserve (same-tx with the GenJob insert)
 *     and each cell's failure-refund happen INSIDE startGen / the worker — per cell.
 *   - Per-cell idempotency key = `batch:<batchId>:cell:<n>` (gate1 style: a stable
 *     parent id + a per-item index). A batch replay with the SAME caller-supplied
 *     batchId reproduces the SAME per-cell keys. startGen's own dedup is ACTIVE-only
 *     (it reuses a QUEUED/GENERATING job for a `batch:` key), so a replay AFTER a cell
 *     is DONE or FAILED would free that key and let startGen re-insert + re-reserve
 *     (double charge). To close that, this layer does an owner-scoped, read-only
 *     any-status precheck per cell BEFORE dispatch: an existing non-failed job (QUEUED/
 *     GENERATING/DONE) is REUSED at zero new charge; a terminal-FAILED job is legitimately
 *     re-dispatched (its refund already happened on the original refId); a reused-batchId
 *     whose stored request no longer matches this cell FAILS CLOSED (no reuse, no spend).
 *     PRECISE replay semantics: SEQUENTIAL replays are dedup-safe end to end. CONCURRENT
 *     replays of the SAME batch are NOT fully safe — in a narrow window a FAILED cell can be
 *     charged twice (replay A re-dispatches it and that fresh job reaches DONE before replay
 *     B's precheck+insert; the ACTIVE-only unique index does not block the second insert).
 *     The structural fix is an all-status partial-unique index for `batch:%` keys (cowork
 *     20260617 precedent) — a migration, pending founder adjudication; until then the
 *     pre-dispatch re-read below only NARROWS that window (登记于 B3-REPORT §⑫ 待裁).
 *     batchId MUST be caller-stable AND unique per batch — the caller owns that contract,
 *     exactly like `cowork:<cardId>` for the generate skill.
 *   - Quote = sum of per-cell `pricedGenCredits(...)` computed from the SAME inputs
 *     the cell hands startGen, so quote == reserve == settle per cell (no batch-level
 *     price constant; §6.5 credits-only via pricedGenCredits).
 *   - text cells are $0: they never enter startGen and never reserve.
 *   - Partial failure refunds ONLY the failed cells — that refund is startGen's /
 *     the worker's own per-cell refund. There is deliberately NO batch-level
 *     rollback / all-refund here (it would double-refund).
 *   - GenerationBatch grouping is a pure metadata write (GenJob.batchId soft-ref,
 *     schema.prisma:465) done AFTER startGen returns — it moves no money.
 */
import { pricedGenCredits, videoDefaults, GEN_MODELS, GEN_VIDEO_MODELS, type GenSpendInput, type GenVideoModel } from "@fikirtive/core";
import type { PrismaClient } from "@fikirtive/db";

/** Batch size ceiling. A money-safety guard: an unbounded batch would let one
 *  approved call fan out into unbounded per-cell reserves. 24 covers the widest
 *  realistic grid (platforms × sizes × hooks) and the F1 20-cell threshold. This
 *  is a COUNT limit, never a price. */
export const MAX_BATCH_CELLS = 24;

/** Bounds mirror genRequest's field bounds — but genRequest (inside startGen) stays
 *  the SOLE spend authority; these only shape the batch input. */
const MAX_PROMPT = 2000;
const MAX_ID = 64;

/** A cell that produces a generation → goes through startGen (paid, per-cell reserve). */
export interface GenCell {
  type: "gen";
  prompt: string;
  /** image | video. Defaults to image when omitted. */
  kind?: "image" | "video";
  /** model id; startGen/genRequest defaults + validates it. */
  model?: string;
  /** 1..MAX_GEN_COUNT (image batch sampling). startGen/genRequest validates. */
  count?: number;
  entityIds?: string[];
  /** i2v source keyframe (owned Generation id). */
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null;
  variantSel?: Record<string, string>;
  shotId?: string | null;
  /** video controls (validated against the model in genRequest). */
  durationSeconds?: number | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  fps?: number | null;
  audio?: boolean | null;
}

/** A text-only cell (e.g. an ad hook/headline variant). ALWAYS $0 — never spends. */
export interface TextCell {
  type: "text";
  text: string;
}

export type BatchCell = GenCell | TextCell;

/** The startGen port — injected so the loop is testable and so this core never
 *  imports the server-action module directly (keeps the spend authority single). */
export type StartGenPort = (
  req: Record<string, unknown>,
) => Promise<{ id: string } | { error: string }>;

export interface OrchestrateDeps {
  startGen: StartGenPort;
  prisma: Pick<PrismaClient, "generationBatch" | "genJob">;
}

export interface OrchestrateArgs {
  ownerId: string;
  projectId: string;
  /** Caller-stable batch id = GenerationBatch.id AND the per-cell key stem. */
  batchId: string;
  name?: string;
  threadId?: string | null;
  cells: BatchCell[];
}

/** Per-cell dispatch outcome. `credits` = this cell's quote (== its reserve == its
 *  eventual settle). text cells report 0. */
export interface CellResult {
  index: number;
  type: "gen" | "text";
  /** queued = a fresh GenJob this run (charged); reused = an existing non-failed job from a prior
   *  run with the same batchId (zero new charge); text = $0 no-op; error = precheck/startGen refused
   *  this cell (zero charge). */
  status: "queued" | "reused" | "text" | "error";
  jobId?: string;
  /** This cell's NEW charge this run: the quote for a freshly dispatched (queued) cell; 0 for a
   *  reused / text / error cell (transparency — totalCredits must equal this run's reservation). */
  credits: number;
  error?: string;
}

export interface BatchResult {
  batchId: string;
  cells: CellResult[];
  /** sum of ONLY this run's newly-dispatched (queued) cells' quotes — reused / text / error cells
   *  contribute 0, so this equals the credits actually reserved this run (宪法 3 transparency). */
  totalCredits: number;
  /** dispatched = cells that enqueued a NEW job this run; reused = cells that hit an existing
   *  non-failed job (no new charge); failed = cells precheck/startGen refused. */
  dispatched: number;
  reused: number;
  failed: number;
}

/** The five concrete video controls startGen resolves (videoDefaults + the cell's overrides) and
 *  persists on GenJob.videoOptions — the SINGLE cell-side copy of that mapping (gen-actions.ts
 *  startGen), shared by the price quote (subset) and the replay precheck's full-field compare so
 *  there is never a second, drifting mapping. null for an image cell (startGen persists no
 *  videoOptions). Callers must have passed genCellError first — the model is guaranteed to be a
 *  real video model here, so videoDefaults never reads undefined. PURE. */
function cellVideoOptions(
  cell: GenCell,
): { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } | null {
  if (cell.kind !== "video") return null;
  const d = videoDefaults((cell.model ?? "seedream") as GenVideoModel);
  return {
    seconds: cell.durationSeconds ?? d.seconds,
    resolution: cell.resolution ?? d.resolution,
    aspectRatio: cell.aspectRatio ?? d.aspectRatio,
    fps: cell.fps ?? d.fps,
    audio: cell.audio ?? d.audio,
  };
}

/** Build the GenSpendInput a gen cell will hand startGen — the SAME shape
 *  pricedGenCredits + startGen reserve on, so quote == reserve. PURE. */
function cellSpendInput(cell: GenCell): GenSpendInput {
  if (cell.kind !== "video") {
    // image price is flat per image (model-independent); model only shapes validation.
    return {
      kind: "IMAGE",
      model: cell.model ?? "seedream",
      count: cell.count ?? 1,
      referenceVideoGenerationId: null,
      videoOptions: null,
    };
  }
  // VIDEO: resolve the price-relevant controls via the shared cellVideoOptions mapping (the same
  // videoDefaults resolution startGen applies) BEFORE pricing, so the GenSpendInput handed to
  // pricedGenCredits is identical -> quote == reserve (NODE-280 item 4). aspectRatio/fps don't
  // price but ride along harmlessly (pricedGenCredits reads only seconds/resolution/audio).
  return {
    kind: "VIDEO",
    model: cell.model ?? "seedream",
    count: 1, // video is always 1 clip per job (mirrors startGen)
    referenceVideoGenerationId: cell.referenceVideoGenerationId ?? null,
    videoOptions: cellVideoOptions(cell),
  };
}

/** Per-cell shape/model validity — mirrors genRequest's model-menu check (defence in depth;
 *  genRequest inside startGen stays the authoritative (model,params) spend gate). Returns an
 *  error message for an invalid cell, else null. A video cell whose model isn't a real video
 *  model is the case that would otherwise crash videoDefaults — catching it here turns a
 *  mid-loop throw into a clean per-cell error. Reuses core's closed model sets (NOT price config). */
function genCellError(cell: GenCell): string | null {
  const kind = cell.kind ?? "image";
  const model = cell.model ?? "seedream";
  const menu: readonly string[] = kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
  if (!menu.includes(model)) {
    return kind === "video"
      ? `"${model}" isn't a valid video model — pick a supported one.`
      : `"${model}" isn't a valid image model — pick a supported one.`;
  }
  return null;
}

/** The per-cell quote in internal credits. Same authority as startGen's reserve
 *  (pricedGenCredits) — never a batch-level constant. NEVER throws for a schema-allowed cell:
 *  an invalid (e.g. bad/absent video model) cell can't be priced and returns 0 — orchestrateBatch
 *  turns it into a per-cell error (it is never dispatched, so 0 is never charged). */
export function quoteCell(cell: BatchCell): number {
  if (cell.type === "text") return 0;
  if (genCellError(cell)) return 0;
  return pricedGenCredits(cellSpendInput(cell));
}

/** Assemble the genRequest a cell hands startGen. idempotencyKey is derived from the
 *  stable batchId + cell index so a replay dedups. genRequest (in startGen) validates. */
function cellGenRequest(
  cell: GenCell,
  args: OrchestrateArgs,
  index: number,
): Record<string, unknown> {
  const req: Record<string, unknown> = {
    projectId: args.projectId,
    prompt: cell.prompt,
    entityIds: cell.entityIds ?? [],
    count: cell.kind === "video" ? 1 : cell.count ?? 1,
    kind: cell.kind ?? "image",
    model: cell.model ?? "seedream",
    idempotencyKey: `batch:${args.batchId}:cell:${index}`,
  };
  if (args.threadId) req.threadId = args.threadId;
  if (cell.shotId) req.shotId = cell.shotId;
  if (cell.sourceGenerationId) req.sourceGenerationId = cell.sourceGenerationId;
  if (cell.tailGenerationId) req.tailGenerationId = cell.tailGenerationId;
  if (cell.referenceVideoGenerationId) req.referenceVideoGenerationId = cell.referenceVideoGenerationId;
  if (cell.variantSel) req.variantSel = cell.variantSel;
  if (cell.durationSeconds != null) req.durationSeconds = cell.durationSeconds;
  if (cell.resolution != null) req.resolution = cell.resolution;
  if (cell.aspectRatio != null) req.aspectRatio = cell.aspectRatio;
  if (cell.fps != null) req.fps = cell.fps;
  if (cell.audio != null) req.audio = cell.audio;
  return req;
}

/**
 * Orchestrate one batch. Headless: dispatches every cell through startGen (or skips
 * text cells at $0), groups the resulting jobs under a GenerationBatch, and returns
 * the per-cell quotes + dispatch outcomes. Does NOT wait for generation to finish and
 * does NOT touch credits.
 */
export async function orchestrateBatch(
  deps: OrchestrateDeps,
  args: OrchestrateArgs,
): Promise<BatchResult | { error: string }> {
  if (args.cells.length === 0) return { error: "A batch needs at least one cell." };
  if (args.cells.length > MAX_BATCH_CELLS) {
    return { error: `A batch can have at most ${MAX_BATCH_CELLS} cells.` };
  }
  // Shape guard (defence in depth — genRequest is still the spend authority per cell).
  for (const cell of args.cells) {
    if (cell.type === "gen") {
      if (!cell.prompt || cell.prompt.length > MAX_PROMPT) return { error: "A cell prompt is out of bounds." };
    } else if (cell.type === "text") {
      if (!cell.text || cell.text.length > MAX_PROMPT) return { error: "A text cell is out of bounds." };
    } else {
      return { error: "Unknown cell type." };
    }
  }
  if (args.batchId.length < 1 || args.batchId.length > MAX_ID) return { error: "Invalid batch id." };

  // Resolve-or-create the grouping row, owner-scoped. The batchId IS the id, so a
  // replay reuses the same row (idempotent grouping). A cross-tenant id collision
  // fails closed (no leak, no spend has happened yet).
  const batch = await resolveOrCreateBatch(deps.prisma, args);
  if ("error" in batch) return batch;

  const cells: CellResult[] = [];
  // Sequential dispatch: startGen only ENQUEUES (reserve + boss.send) and returns
  // immediately — it never blocks on generation — so a for-loop enqueues all cells
  // promptly and the worker pool runs them in parallel. The batch never polls for a
  // cell to finish before dispatching the next (that is what "不串行阻塞" forbids).
  for (let i = 0; i < args.cells.length; i++) {
    const cell = args.cells[i];
    if (cell.type === "text") {
      cells.push({ index: i, type: "text", status: "text", credits: 0 });
      continue;
    }

    // Per-cell validity precheck (defence in depth; genRequest inside startGen stays the
    // authority). A THROW here would abandon the cells already dispatched (+ charged) with no
    // BatchResult, so a bad cell must become a clean per-cell error, never an exception.
    const invalid = genCellError(cell);
    if (invalid) {
      cells.push({ index: i, type: "gen", status: "error", credits: 0, error: invalid });
      continue;
    }

    // Any-status replay precheck (owner-scoped READ; the orchestration layer may read, never
    // mutate credits). startGen's own dedup is active-only, so without this a DONE/FAILED cell's
    // freed key would let a same-batchId replay re-insert + re-charge. Decide reuse vs re-dispatch.
    // The select covers EVERY content field startGen persists so the reuse compare is full-field.
    const findPriorCellJob = () =>
      deps.prisma.genJob.findFirst({
        where: { ownerId: args.ownerId, projectId: args.projectId, idempotencyKey: `batch:${args.batchId}:cell:${i}` },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, status: true, prompt: true, model: true, kind: true, count: true,
          entityIds: true, variantSel: true, sourceGenerationId: true, tailGenerationId: true,
          referenceVideoGenerationId: true, shotId: true, videoOptions: true,
        },
      });
    let prior = await findPriorCellJob();
    if (!prior || isFailedStatus(prior.status)) {
      // Defensive NARROWING of the concurrent-replay window — NOT a structural fix (that is the
      // all-status partial-unique index for `batch:%` keys, cowork 20260617 precedent, which needs
      // a migration and is pending founder adjudication; B3-REPORT §⑫ 待裁): between the precheck
      // above and startGen's insert, a CONCURRENT replay of this batch may have re-dispatched this
      // cell and its fresh job may even reach DONE — startGen's ACTIVE-only dedup would then not
      // block a second insert (double charge). Re-reading immediately before dispatch shrinks that
      // window to this read→insert gap; it CANNOT close it.
      prior = await findPriorCellJob();
    }
    if (prior && !isFailedStatus(prior.status)) {
      // Fail closed if the batchId was reused for DIFFERENT content: reusing the old job would
      // silently deliver stale content (and misreport this cell's price). No reuse, no spend.
      if (!priorMatchesCell(prior, cell)) {
        cells.push({
          index: i,
          type: "gen",
          status: "error",
          credits: 0,
          error: "That batchId is already in use for different content — start a new batch with a fresh id.",
        });
        continue;
      }
      // Reuse the existing (in-flight or done) job — zero NEW charge this run. Re-tag is a cheap,
      // idempotent, owner-scoped metadata self-heal (grouping is best-effort).
      await tagJobToBatch(deps.prisma, args.ownerId, prior.id, args.batchId);
      cells.push({ index: i, type: "gen", status: "reused", jobId: prior.id, credits: 0 });
      continue;
    }
    // prior is terminal-FAILED (a legitimate retry — its refund already happened on that refId)
    // or absent → dispatch a fresh paid job.

    const credits = quoteCell(cell);
    const res = await deps.startGen(cellGenRequest(cell, args, i));
    if ("error" in res) {
      // startGen refused this cell (out of credits / disabled model / …). No job, no reserve →
      // 0 new credits for this cell (transparency: totalCredits == this run's reservation).
      cells.push({ index: i, type: "gen", status: "error", credits: 0, error: res.error });
      continue;
    }
    // Group the job under the batch — a pure metadata write (no money). Owner-scoped
    // updateMany so a cross-owner id can never be written; best-effort so a grouping
    // hiccup never fails a cell whose spend already committed inside startGen.
    await tagJobToBatch(deps.prisma, args.ownerId, res.id, args.batchId);
    cells.push({ index: i, type: "gen", status: "queued", jobId: res.id, credits });
  }

  const totalCredits = cells.reduce((sum, c) => sum + c.credits, 0);
  const dispatched = cells.filter((c) => c.status === "queued").length;
  const reused = cells.filter((c) => c.status === "reused").length;
  const failed = cells.filter((c) => c.status === "error").length;
  return { batchId: args.batchId, cells, totalCredits, dispatched, reused, failed };
}

/** GenJob terminal-failure state. GenStatus has no CANCELLED — FAILED is the only terminal
 *  failure — so a job in any other state (QUEUED/GENERATING/DONE) is a live/succeeded reuse
 *  candidate. A FAILED job's `batch:` idempotency key is freed (active-only unique index), so a
 *  replay legitimately re-dispatches it; the original attempt's refund already happened. */
function isFailedStatus(status: string): boolean {
  return status === "FAILED";
}

/** Order-normalized id-array compare (entityIds are persisted verbatim; order isn't material). */
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Canonical compare of a stored variantSel Json against the cell's expected record (key-sorted;
 *  null when absent). startGen drops variantSel for video and persists it verbatim for image. */
function sameVariantSel(prior: unknown, expected: Record<string, string> | null): boolean {
  const p = prior !== null && typeof prior === "object" && !Array.isArray(prior) ? (prior as Record<string, unknown>) : null;
  if (p === null || expected === null) return p === null && expected === null;
  const pk = Object.keys(p).sort();
  const ek = Object.keys(expected).sort();
  if (pk.length !== ek.length || !pk.every((k, i) => k === ek[i])) return false;
  return pk.every((k) => p[k] === expected[k]);
}

/** Compare a stored videoOptions Json against the cell's expected resolved form (the SAME
 *  videoDefaults+overrides mapping startGen persisted — cellVideoOptions; null for image). */
function sameVideoOptions(
  prior: unknown,
  expected: { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } | null,
): boolean {
  const p = prior !== null && typeof prior === "object" && !Array.isArray(prior) ? (prior as Record<string, unknown>) : null;
  if (p === null || expected === null) return p === null && expected === null;
  return (
    p.seconds === expected.seconds &&
    p.resolution === expected.resolution &&
    p.aspectRatio === expected.aspectRatio &&
    p.fps === expected.fps &&
    p.audio === expected.audio
  );
}

/** Does an existing reuse-candidate job's stored request still match this cell? FULL-FIELD
 *  (NODE-280-R2 ①a): compares EVERY content field startGen persists — prompt/model/kind/count,
 *  the three generation refs + shotId (persisted `?? null`), entityIds (order-normalized),
 *  variantSel (canonical; startGen drops it for video), and videoOptions (compared against the
 *  cell's expected form built by the SAME cellVideoOptions mapping startGen resolves — never a
 *  second mapping). ANY mismatch means the caller reused a batchId for different content — fail
 *  closed rather than silently reuse the old job. Callers must have passed genCellError first. */
function priorMatchesCell(
  prior: {
    prompt: string;
    model: string;
    kind: string;
    count: number;
    entityIds: string[];
    variantSel: unknown;
    sourceGenerationId: string | null;
    tailGenerationId: string | null;
    referenceVideoGenerationId: string | null;
    shotId: string | null;
    videoOptions: unknown;
  },
  cell: GenCell,
): boolean {
  const kind = cell.kind === "video" ? "VIDEO" : "IMAGE";
  const model = cell.model ?? "seedream";
  const count = cell.kind === "video" ? 1 : cell.count ?? 1;
  if (prior.prompt !== cell.prompt || prior.model !== model || prior.kind !== kind || prior.count !== count) return false;
  if ((prior.sourceGenerationId ?? null) !== (cell.sourceGenerationId ?? null)) return false;
  if ((prior.tailGenerationId ?? null) !== (cell.tailGenerationId ?? null)) return false;
  if ((prior.referenceVideoGenerationId ?? null) !== (cell.referenceVideoGenerationId ?? null)) return false;
  if ((prior.shotId ?? null) !== (cell.shotId ?? null)) return false;
  if (!sameIdSet(prior.entityIds ?? [], cell.entityIds ?? [])) return false;
  // startGen: effectiveVariantSel = kind === "video" ? undefined : variantSel (persisted or null).
  const expectedSel = cell.kind === "video" ? null : cell.variantSel ?? null;
  if (!sameVariantSel(prior.variantSel ?? null, expectedSel)) return false;
  if (!sameVideoOptions(prior.videoOptions ?? null, cellVideoOptions(cell))) return false;
  return true;
}

async function resolveOrCreateBatch(
  db: Pick<PrismaClient, "generationBatch">,
  args: OrchestrateArgs,
): Promise<{ id: string } | { error: string }> {
  const existing = await db.generationBatch.findFirst({
    where: { id: args.batchId, ownerId: args.ownerId },
    select: { id: true },
  });
  if (existing) return existing;
  try {
    return await db.generationBatch.create({
      data: {
        id: args.batchId,
        ownerId: args.ownerId,
        projectId: args.projectId,
        name: args.name ?? "Batch",
      },
      select: { id: true },
    });
  } catch (e) {
    // A concurrent same-batchId create (or a cross-tenant id collision) → re-read
    // owner-scoped; if it's ours use it, else refuse (fail closed, no spend yet).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const again = await db.generationBatch.findFirst({
        where: { id: args.batchId, ownerId: args.ownerId },
        select: { id: true },
      });
      if (again) return again;
      return { error: "That batch id is unavailable." };
    }
    throw e;
  }
}

async function tagJobToBatch(
  db: Pick<PrismaClient, "genJob">,
  ownerId: string,
  jobId: string,
  batchId: string,
): Promise<void> {
  try {
    await db.genJob.updateMany({ where: { id: jobId, ownerId }, data: { batchId } });
  } catch (e) {
    // Grouping is best-effort metadata: the job is already created + reserved + queued
    // inside startGen, so a failed batchId write must NOT surface as a cell error (that
    // would misreport a cell that is really generating). Log + continue.
    console.warn(`factory-batch: batchId tag failed for job ${jobId} (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

/** Six-state rollup for a batch: read the grouped jobs' live statuses and count them.
 *  Pure read — never touches money. Used by callers/tests to aggregate
 *  "批状态 = 逐格六态聚合". */
export interface BatchStatus {
  batchId: string;
  /** GenJob status counts among the batch's grouped jobs. */
  queued: number;
  generating: number;
  done: number;
  failed: number;
  total: number;
}

export async function batchCellStatuses(
  db: Pick<PrismaClient, "genJob">,
  ownerId: string,
  batchId: string,
): Promise<BatchStatus> {
  const jobs = await db.genJob.findMany({
    where: { ownerId, batchId },
    select: { status: true },
  });
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  return {
    batchId,
    queued: count("QUEUED"),
    generating: count("GENERATING"),
    done: count("DONE"),
    failed: count("FAILED"),
    total: jobs.length,
  };
}
