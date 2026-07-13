/**
 * runFactoryBatch — GATED factory batch spend skill (W-B3-F-P, spec §5.2 + §5.7 dual-executor).
 *
 * Gate: cost:"spend" → deriveNeedsApproval = TRUE (skill.ts:66). MACHINE-derived from the
 * classification, never a hand-set flag, so Otto can never route around it (反翻转纪律,
 * identical to the `generate` skill). Every call PARKS as an approval interruption and runs
 * NOTHING until a human confirms — the human confirming a whole batch IS the spend consent.
 *
 * Zero new spend path (B0-16): this skill never touches credits, never creates a GenJob, never
 * calls a provider. It reaches the batch ONLY via ctx.runFactoryBatch (injected, owner-closed),
 * which loops the SAME startGen authority per cell — every reserve/settle/refund lives inside
 * startGen / the worker, per cell. text cells are $0. A replay with the same batchId dedups per
 * cell (batch:<batchId>:cell:<n>), so it never double-charges.
 *
 * Identity/scope come from ctx (orgId, projectId) — never from the model. The model supplies only
 * WHAT to make + a stable batchId; the owner-scoped server action re-validates ownership and every
 * (model,params) spend through genRequest (the sole spend authority).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

/** A gen cell the model can describe. Deliberately MINIMAL — the owner-scoped action's
 *  genRequest is the authoritative (model,params) spend gate; this only shapes intent. */
const skillGenCell = z.object({
  prompt: z.string().min(1).max(2000),
  kind: z.enum(["image", "video"]).optional(),
  model: z.string().min(1).max(40).optional(),
  count: z.number().int().min(1).max(4).optional(),
  aspectRatio: z.string().max(12).optional(),
  resolution: z.string().max(12).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
});

const skillTextCell = z.object({ type: z.literal("text"), text: z.string().min(1).max(2000) });

export const runFactoryBatchInput = z.object({
  mode: z.enum(["variant", "grid"]).describe(
    "variant = one base spec + N variant overrides (ad-variant fan-out); grid = an explicit list of cells (brief×platform×size grid, may mix gen and $0 text cells).",
  ),
  batchId: z.string().min(1).max(64).describe(
    "A STABLE id for this batch. Reuse the SAME id to retry a batch — it dedups per cell and never double-charges. Use a fresh id only for a genuinely new batch.",
  ),
  name: z.string().min(1).max(120).optional().describe("Human-readable batch name for the library grouping."),
  base: skillGenCell.optional().describe("variant mode: the base spec every variant overrides."),
  variants: z
    .array(skillGenCell.partial())
    .max(24)
    .optional()
    .describe("variant mode: one entry per output cell; each overrides fields of `base` (e.g. a different prompt/hook, aspect ratio, or model)."),
  cells: z
    .array(z.union([skillGenCell.extend({ type: z.literal("gen") }), skillTextCell]))
    .max(24)
    .optional()
    .describe("grid mode: the explicit cells. A gen cell generates (costs credits); a text cell {type:'text',text} is FREE."),
});

type RunFactoryBatchInput = z.infer<typeof runFactoryBatchInput>;

export async function executeRunFactoryBatch(
  input: RunFactoryBatchInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  if (!ctx.runFactoryBatch) return { error: "Batch generation isn't available right now." };

  const common = { batchId: input.batchId, projectId: ctx.projectId, name: input.name };

  if (input.mode === "variant") {
    if (!input.base || !input.variants || input.variants.length === 0) {
      return { error: "A variant batch needs a base spec and at least one variant." };
    }
    return ctx.runFactoryBatch.variant({ ...common, base: input.base, variants: input.variants });
  }

  // grid
  if (!input.cells || input.cells.length === 0) {
    return { error: "A grid batch needs at least one cell." };
  }
  return ctx.runFactoryBatch.bulk({ ...common, cells: input.cells });
}

export const runFactoryBatchSkill = defineOttoSkill({
  name: "runFactoryBatch",
  cost: "spend",
  effect: "write",
  reach: "internal",
  // The real exactly-once guard is the per-cell startGen dedup (batch:<batchId>:cell:<n>) plus
  // the GenJob_active_idempotency_key index. This declaration satisfies the factory's
  // "spend must declare an idempotency key" rule and documents the batch-level key shape.
  idempotencyKey: (i) => `batch:${i.batchId}`,
  description:
    "Generate a BATCH of ads/images/videos in one go — either a variant fan-out (one base spec + " +
    "several variant overrides) or an explicit grid of cells. This SPENDS the user's credits (one " +
    "charge per gen cell; text cells are free) and REQUIRES the user's approval — only call it when " +
    "the user has clearly asked to run a batch. Reuse the same batchId to retry without double-charging. " +
    "Scope (project) comes from the current context; you supply only what to make.",
  parameters: runFactoryBatchInput,
  execute: executeRunFactoryBatch,
});

// Bare-tool export (mirrors the generate skill convention).
export const runFactoryBatch = runFactoryBatchSkill.tool;
