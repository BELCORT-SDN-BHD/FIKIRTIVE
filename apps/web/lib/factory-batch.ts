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
 *     batchId reproduces the SAME per-cell keys, so startGen's dedup (findFirst +
 *     the GenJob_active_idempotency_key partial-unique index) returns the existing
 *     job and never charges twice. batchId MUST be caller-stable — the caller owns
 *     that contract, exactly like `cowork:<cardId>` for the generate skill.
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
import { pricedGenCredits, type GenSpendInput } from "@fikirtive/core";
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
  /** queued = a fresh (or reused-in-flight) GenJob; text = $0 no-op; error = startGen refused. */
  status: "queued" | "text" | "error";
  jobId?: string;
  credits: number;
  error?: string;
}

export interface BatchResult {
  batchId: string;
  cells: CellResult[];
  /** sum of every cell's quote (text cells contribute 0). */
  totalCredits: number;
  /** dispatched = cells that enqueued a job; failed = cells startGen refused. */
  dispatched: number;
  failed: number;
}

/** Build the GenSpendInput a gen cell will hand startGen — the SAME shape
 *  pricedGenCredits + startGen reserve on, so quote == reserve. PURE. */
function cellSpendInput(cell: GenCell): GenSpendInput {
  const kind = cell.kind === "video" ? "VIDEO" : "IMAGE";
  const videoOptions =
    kind === "VIDEO"
      ? {
          seconds: cell.durationSeconds ?? undefined,
          resolution: cell.resolution ?? undefined,
          audio: cell.audio ?? undefined,
        }
      : null;
  return {
    kind,
    model: cell.model ?? "seedream",
    // video is always 1 clip per job (mirrors startGen); image uses count.
    count: kind === "VIDEO" ? 1 : cell.count ?? 1,
    referenceVideoGenerationId: cell.referenceVideoGenerationId ?? null,
    videoOptions,
  };
}

/** The per-cell quote in internal credits. Same authority as startGen's reserve
 *  (pricedGenCredits) — never a batch-level constant. */
export function quoteCell(cell: BatchCell): number {
  if (cell.type === "text") return 0;
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
    const credits = quoteCell(cell);
    const res = await deps.startGen(cellGenRequest(cell, args, i));
    if ("error" in res) {
      cells.push({ index: i, type: "gen", status: "error", credits, error: res.error });
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
  const failed = cells.filter((c) => c.status === "error").length;
  return { batchId: args.batchId, cells, totalCredits, dispatched, failed };
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
