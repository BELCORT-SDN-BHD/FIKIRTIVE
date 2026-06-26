/**
 * rememberBrandFact — $0 skill
 *
 * Saves a durable brand fact to the Memory table (source: "otto").
 * Spends NO money, creates NO GenJob, calls NO fal/generation code.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input — the
 * model cannot spoof ownerId.
 */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------
const rememberBrandFactInput = z.object({
  category: z.enum(["Brand", "Voice", "Audience", "Products", "Rules"]),
  content: z.string().min(1).max(600),
});

type RememberBrandFactInput = z.infer<typeof rememberBrandFactInput>;

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeRememberBrandFact(
  input: RememberBrandFactInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true; id: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const id = newId();
  await prisma.memory.create({
    data: {
      id,
      ownerId: ctx.orgId,
      brandId: null,
      category: input.category,
      content: input.content.trim().slice(0, 600),
      source: "otto",
      pinned: false,
    },
  });

  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Skill definition (defineOttoSkill standard): free / write / internal → no approval.
// ---------------------------------------------------------------------------

export const rememberBrandFactSkill = defineOttoSkill({
  name: "rememberBrandFact",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save ONE durable fact about the user's brand to Brand Memory (their voice, audience, products, rules, or story). " +
    "$0, persists across all future campaigns. " +
    "Call this ONLY when the user clearly tells you to remember something, or states a durable brand fact you should keep — " +
    "never for one-off creative choices or to spam memory. Pick the best category.",
  parameters: rememberBrandFactInput,
  execute: executeRememberBrandFact,
});

// Backward-compatible bare-tool export (keeps existing imports + tests unchanged).
export const rememberBrandFact = rememberBrandFactSkill.tool;
