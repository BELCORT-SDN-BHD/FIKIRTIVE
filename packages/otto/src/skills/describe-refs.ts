/**
 * describeRefs — $0 tool
 *
 * See-once cache of reference-image descriptions. Spends NO money, creates NO GenJob,
 * calls NO generation-provider code.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input — the
 * model cannot spoof ownerId.
 *
 * v1 simplification: the original coworkTurn cached only entities whose pixels were
 * shown that turn (attachedRefIdByName). This tool relies on see-once + owner-scope
 * as the safety guard instead (a description can't overwrite an existing one and
 * can't cross tenants). A future ctx.shownRefNames guard can tighten this.
 */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { sanitizeRefDescription } from "./describe-refs.helpers.js";

export { sanitizeRefDescription };

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------
const describeRefsInput = z.object({
  descriptions: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .min(1)
    .max(20),
});

type DescribeRefsInput = z.infer<typeof describeRefsInput>;

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeDescribeRefs(
  input: DescribeRefsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cached: number }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  let cached = 0;

  for (const { name, description } of input.descriptions) {
    try {
      const cleanName = name.replace(/^@/, "");
      const clean = sanitizeRefDescription(description);

      // Skip empty descriptions after sanitization
      if (!clean) continue;

      // Resolve owned entity by name — skip if 0 or >1 (ambiguous)
      const ents = await prisma.entity.findMany({
        where: { name: cleanName, ownerId: ctx.orgId, deletedAt: null },
        select: { id: true },
      });

      if (ents.length !== 1) continue;

      // See-once write: only set descriptionJson where it's currently null (never overwrite).
      // Count the ACTUAL rows written — a pre-existing description means count:0 (suppressed by
      // the predicate), so `cached` must reflect what really changed, not how many names we tried.
      const { count } = await prisma.entity.updateMany({
        where: {
          id: ents[0]!.id,
          ownerId: ctx.orgId,
          descriptionJson: { equals: Prisma.DbNull },
        },
        data: { descriptionJson: { text: clean } },
      });

      cached += count;
    } catch {
      // Best-effort: a per-item DB hiccup must not throw the whole turn
    }
  }

  return { cached };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const describeRefsSkill = defineOttoSkill({
  name: "describeRefs",
  cost: "free",
  // Writes descriptions via prisma.entity.updateMany (see executeDescribeRefs) — a
  // state change, so effect is "write". free + write + internal still derives
  // needsApproval=false; the correct label keeps the fail-closed gate audit honest.
  effect: "write",
  reach: "internal",
  description:
    "Cache visual descriptions of reference images shown to you this turn. " +
    "For each reference image, provide its @name and a concise visual description " +
    "(appearance, wardrobe, style, distinctive features). " +
    "This is cached so later turns recall the look without re-sending the image. " +
    "See-once: a description is only written if one does not already exist (never overwrites). " +
    "This is $0.",
  parameters: describeRefsInput,
  execute: executeDescribeRefs,
});

export const describeRefs = describeRefsSkill.tool;
