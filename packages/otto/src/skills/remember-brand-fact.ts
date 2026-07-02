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
// 6-section taxonomy (2026-07-02): free-text FACTS file to the 3 static sections only.
// Products / customer groups / offers are structured records → saveProduct / saveCustomerSegment / saveOffer.
// Legacy categories (Brand/Voice/Audience/Products/Rules) map at read time in @fikirtive/core sectionForCategory.
export const rememberBrandFactInput = z.object({
  category: z.enum(["about", "look", "rules"]),
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
    "Save ONE durable brand FACT to Brand Memory. $0, persists across campaigns. Categories: " +
    "'about' = who the brand is, story, voice, positioning; 'look' = visual style, colors, imagery mood; " +
    "'rules' = hard do/don't constraints (banned words, competitors, compliance). " +
    "Call ONLY for durable truths the user states or asks you to remember — never one-off creative choices. " +
    "For products, customer groups or offers/promotions use saveProduct / saveCustomerSegment / saveOffer instead.",
  parameters: rememberBrandFactInput,
  execute: executeRememberBrandFact,
});

// Backward-compatible bare-tool export (keeps existing imports + tests unchanged).
export const rememberBrandFact = rememberBrandFactSkill.tool;
