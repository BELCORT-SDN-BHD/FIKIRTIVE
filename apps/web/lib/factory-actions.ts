"use server";
/**
 * factory-actions — owner-scoped entrypoints for B3 factory BATCH generation
 * (W-B3-F-P, spec §5.2). Two typed server actions over ONE orchestration core:
 *   - runVariantBatch: one base spec + N variant overrides (F2 ad-variant fan-out).
 *   - runBulkGrid:     an explicit heterogeneous cell list (F1 brief×platform×size grid).
 *
 * Both are thin: requireOwner + anti-impersonation guard (mirrors startGen) + a typed
 * request, then hand off to orchestrateBatch, which loops the EXISTING spend authority
 * `startGen` per cell. This file adds NO spend authority, NO provider call, NO credit
 * mutation — every dollar still flows through startGen's per-cell reserve/settle/refund.
 * genRequest (inside startGen) stays the sole
 * (model,params) spend gate; the zod schemas here only shape the batch envelope.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { z } from "zod";
import { startGen } from "./gen-actions";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { orchestrateBatch, MAX_BATCH_CELLS, type BatchCell, type BatchResult } from "./factory-batch";

const idField = z.string().min(1).max(64);

/** The spendable fields of a gen cell. Kept aligned with genRequest's field bounds,
 *  but genRequest's .superRefine (inside startGen) remains the authoritative
 *  (model,params) spend validation — this only shapes the batch envelope. */
const genCellCore = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    kind: z.enum(["image", "video"]).optional(),
    model: z.string().min(1).max(40).optional(),
    count: z.number().int().min(1).max(4).optional(),
    entityIds: z.array(z.string().min(1).max(64)).max(8).optional(),
    sourceGenerationId: z.string().min(1).max(64).nullish(),
    tailGenerationId: z.string().min(1).max(64).nullish(),
    referenceVideoGenerationId: z.string().min(1).max(64).nullish(),
    variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),
    shotId: z.string().min(1).max(64).nullish(),
    durationSeconds: z.number().int().min(1).max(60).nullish(),
    resolution: z.string().max(12).nullish(),
    aspectRatio: z.string().max(12).nullish(),
    fps: z.number().int().min(1).max(120).nullish(),
    audio: z.boolean().nullish(),
  })
  .strict();

const genCellInput = genCellCore.extend({ type: z.literal("gen") });
const textCellInput = z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000) }).strict();
const cellInput = z.discriminatedUnion("type", [genCellInput, textCellInput]);

const variantBatchInput = z
  .object({
    batchId: idField,
    attemptId: idField,
    projectId: idField,
    name: z.string().min(1).max(120).optional(),
    base: genCellCore,
    variants: z.array(genCellCore.partial()).min(1).max(MAX_BATCH_CELLS),
  })
  .strict();

const bulkGridInput = z
  .object({
    batchId: idField,
    attemptId: idField,
    projectId: idField,
    name: z.string().min(1).max(120).optional(),
    cells: z.array(cellInput).min(1).max(MAX_BATCH_CELLS),
  })
  .strict();

type Err = { error: string };

/** Shared owner-scoped batch runner. The two exported actions below are the public surface. */
async function runBatch(
  batchId: string,
  attemptId: string,
  projectId: string,
  name: string | undefined,
  cells: BatchCell[],
): Promise<BatchResult | Err> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;

  // Fast owner-scoped project check (mirrors startGen) so we never mint a batch row
  // pointing at a project this owner doesn't own. Per-cell startGen re-checks anyway.
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return { error: "Project not found." };

  const result = await orchestrateBatch({ startGen, prisma }, { ownerId, projectId, batchId, attemptId, name, cells });
  if (!("error" in result)) revalidatePath("/", "layout");
  return result;
}

export async function runVariantBatch(raw: unknown): Promise<BatchResult | Err> {
  const parsed = variantBatchInput.safeParse(raw);
  if (!parsed.success) return { error: "That batch request is out of bounds." };
  const { batchId, attemptId, projectId, name, base, variants } = parsed.data;
  // Each variant overrides the base → one gen cell.
  const cells: BatchCell[] = variants.map((v) => ({ type: "gen" as const, ...base, ...v }));
  return runBatch(batchId, attemptId, projectId, name, cells);
}

export async function runBulkGrid(raw: unknown): Promise<BatchResult | Err> {
  const parsed = bulkGridInput.safeParse(raw);
  if (!parsed.success) return { error: "That batch request is out of bounds." };
  const { batchId, attemptId, projectId, name, cells } = parsed.data;
  return runBatch(batchId, attemptId, projectId, name, cells as BatchCell[]);
}
