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
 *   - Per-cell identity has TWO stable parts: logical cell (batchId + index) and caller attempt.
 *     The 79-char key is `batch:<logical hash>:attempt:<attempt hash>`. startGen parses that key
 *     and, under its existing owner/project advisory transaction lock, binds the logical cell's
 *     full material request and decides fresh/reused/conflict from any-status history. The same
 *     attempt is reusable forever (FAILED included); a new attempt creates only after every prior
 *     job FAILED. That atomic decision — not this layer's read-only early reject — controls reserve.
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
import { pricedGenCredits, GEN_MODELS, GEN_VIDEO_MODELS, type GenSpendInput } from "@fikirtive/core";
import type { PrismaClient } from "@fikirtive/db";
import {
  factoryAttemptKey,
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  type FactoryMaterial,
} from "./batch-idempotency";

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
) => Promise<
  | { id: string; disposition: "fresh" | "reused" }
  | { error: string; disposition?: "conflict" }
>;

export interface OrchestrateDeps {
  startGen: StartGenPort;
  prisma: Pick<PrismaClient, "generationBatch" | "genJob">;
}

export interface OrchestrateArgs {
  ownerId: string;
  projectId: string;
  /** Caller-stable logical batch id = GenerationBatch.id and an input to the per-cell hash. */
  batchId: string;
  /** Caller-stable for one confirmation/network replay; a later explicit Retry uses a new id. */
  attemptId: string;
  name?: string;
  threadId?: string | null;
  cells: BatchCell[];
}

/** Per-cell dispatch outcome. `credits` = this cell's quote (== its reserve == its
 *  eventual settle). text cells report 0. */
export interface CellResult {
  index: number;
  type: "gen" | "text";
  /** queued = a fresh GenJob this run (charged); reused = an existing job selected atomically by
   *  startGen (zero new charge); text = $0 no-op; error = precheck/startGen refused
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
   *  attempt/logical job (no new charge); failed = cells precheck/startGen refused. */
  dispatched: number;
  reused: number;
  failed: number;
}

/** Exact persisted request shape, shared with startGen's lock-time binding. Callers pass
 *  genCellError first so a video model is valid before video defaults are resolved. */
function cellMaterial(cell: GenCell): FactoryMaterial {
  return normalizeFactoryMaterial({
    prompt: cell.prompt,
    model: cell.model ?? "seedream",
    kind: cell.kind ?? "image",
    count: cell.count ?? 1,
    entityIds: cell.entityIds,
    variantSel: cell.variantSel,
    sourceGenerationId: cell.sourceGenerationId,
    tailGenerationId: cell.tailGenerationId,
    referenceVideoGenerationId: cell.referenceVideoGenerationId,
    shotId: cell.shotId,
    durationSeconds: cell.durationSeconds,
    resolution: cell.resolution,
    aspectRatio: cell.aspectRatio,
    fps: cell.fps,
    audio: cell.audio,
  });
}

/** Build the GenSpendInput a gen cell will hand startGen — the SAME shape
 *  pricedGenCredits + startGen reserve on, so quote == reserve. PURE. */
function cellSpendInput(cell: GenCell): GenSpendInput {
  const material = cellMaterial(cell);
  return {
    kind: material.kind,
    model: material.model,
    count: material.count,
    referenceVideoGenerationId: material.referenceVideoGenerationId,
    videoOptions: material.videoOptions,
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

/** Assemble the genRequest a cell hands startGen. The key binds stable logical-cell + attempt
 *  identities while remaining under genRequest's 80-char cap. */
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
    idempotencyKey: factoryAttemptKey(args.batchId, index, args.attemptId).key,
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
  if (args.attemptId.length < 1 || args.attemptId.length > MAX_ID) return { error: "Invalid attempt id." };

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

    // Read-only early reject: content drift can fail before entering startGen, but this read is
    // NEVER the reserve/reuse authority. startGen repeats the same full binding and disposition
    // decision under the owner/project advisory transaction lock, closing every concurrency gap.
    const identity = factoryAttemptKey(args.batchId, i, args.attemptId);
    const expectedMaterial = cellMaterial(cell);
    const history = await deps.prisma.genJob.findMany({
      where: {
        ownerId: args.ownerId,
        projectId: args.projectId,
        idempotencyKey: { startsWith: identity.logicalPrefix },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true, idempotencyKey: true, prompt: true, model: true, kind: true, count: true,
        entityIds: true, variantSel: true, sourceGenerationId: true, tailGenerationId: true,
        referenceVideoGenerationId: true, shotId: true, videoOptions: true,
      },
    });
    if (history.some((prior) => !factoryMaterialMatches(prior, expectedMaterial))) {
      cells.push({
        index: i,
        type: "gen",
        status: "error",
        credits: 0,
        error: "That batchId is already in use for different content — start a new batch with a fresh id.",
      });
      continue;
    }

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
    if (res.disposition === "fresh") {
      cells.push({ index: i, type: "gen", status: "queued", jobId: res.id, credits: quoteCell(cell) });
    } else {
      cells.push({ index: i, type: "gen", status: "reused", jobId: res.id, credits: 0 });
    }
  }

  const totalCredits = cells.reduce((sum, c) => sum + c.credits, 0);
  const dispatched = cells.filter((c) => c.status === "queued").length;
  const reused = cells.filter((c) => c.status === "reused").length;
  const failed = cells.filter((c) => c.status === "error").length;
  return { batchId: args.batchId, cells, totalCredits, dispatched, reused, failed };
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
