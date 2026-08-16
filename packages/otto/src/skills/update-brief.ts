/**
 * updateBrief — $0 tool
 *
 * Refines the project's creative brief. Spends NO money, creates NO GenJob,
 * calls NO generation-provider code.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input — the
 * model cannot spoof ownerId or projectId.
 */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------
const updateBriefInput = z.object({
  brief: z.string().min(1).max(600),
});

type UpdateBriefInput = z.infer<typeof updateBriefInput>;

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeUpdateBrief(
  input: UpdateBriefInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: boolean }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const result = await prisma.project.updateMany({
    where: { id: ctx.projectId, ownerId: ctx.orgId, deletedAt: null },
    data: { coworkBrief: input.brief.trim() },
  });

  return { ok: result.count > 0 };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const updateBriefSkill = defineOttoSkill({
  name: "updateBrief",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Refine the project's creative brief with durable creative direction " +
    "(tone, visual style, recurring constraints like aspect ratio or language, key characters). " +
    "Call only when you have a clear, durable signal — ≤60 words. The user can edit it anytime. " +
    "This is $0 and persists across turns.",
  parameters: updateBriefInput,
  execute: executeUpdateBrief,
});

export const updateBrief = updateBriefSkill.tool;
