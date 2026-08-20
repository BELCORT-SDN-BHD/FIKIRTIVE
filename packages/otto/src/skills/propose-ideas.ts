/**
 * proposeIdeas — $0 idea-suggestion skill (W-B3-D, anchor I1 "反 Buffer 自证").
 *
 * The Otto side of "Suggest 3 ideas". The model brainstorms a few concrete content ideas (grounded in
 * the brand context already in its system message) and hands them here; the skill validates, caps,
 * de-dupes, and returns a clean, actionable list with the honest $0 / next-step framing.
 *
 * Deliberately extremely light (anchor I1: 极轻不做 Buffer 式重管道): it persists NOTHING and creates
 * no new object — the user turns an idea into a creation on the canvas (manageCanvas.place / composer),
 * where generation asks before it spends. $0 by construction: no GenJob, no credits, no provider, no DB.
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval=false. effect is "read" — the
 * skill returns suggestions and writes nothing.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

export const MAX_IDEAS = 5;

const ideaSchema = z.object({
  title: z.string().trim().min(1).max(140).describe("The idea in one line, as the user would see it (e.g. 'POV: the 3pm croissant craving')."),
  why: z.string().trim().max(240).optional().describe("One phrase on why it fits this brand / what's worked."),
  format: z.string().trim().max(60).optional().describe("Optional suggested format (e.g. 'POV short-form', 'steam macro', 'restock teaser')."),
});

const params = z.object({
  theme: z.string().trim().max(160).optional().describe("Optional angle these ideas are for (e.g. 'this week', 'Ramadan promo')."),
  ideas: z
    .array(ideaSchema)
    .min(1)
    .max(MAX_IDEAS)
    .describe("The concrete content ideas you're suggesting (usually 3). Ground them in the brand's products/tone from your context."),
});

type ProposeIdeasInput = z.infer<typeof params>;

const NEXT_STEP =
  "Ideas are free. To turn one into a creation, open the canvas (or the composer) — generation asks before it spends. " +
  "You can also drop one onto the canvas as a note with manageCanvas.";

/** Pure: cap + de-dupe by case-insensitive title, preserving order. Exported for unit tests. */
export function normalizeIdeas(ideas: { title: string; why?: string; format?: string }[]): {
  title: string;
  why?: string;
  format?: string;
}[] {
  const seen = new Set<string>();
  const out: { title: string; why?: string; format?: string }[] = [];
  for (const idea of ideas) {
    const key = idea.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: idea.title.trim(),
      ...(idea.why ? { why: idea.why.trim() } : {}),
      ...(idea.format ? { format: idea.format.trim() } : {}),
    });
    if (out.length >= MAX_IDEAS) break;
  }
  return out;
}

export async function executeProposeIdeas(
  input: ProposeIdeasInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ideas = normalizeIdeas(input.ideas);
  if (ideas.length === 0) return { ok: false, error: "Give me at least one concrete idea to suggest." };
  return {
    ok: true,
    ...(input.theme ? { theme: input.theme } : {}),
    count: ideas.length,
    ideas,
    nextStep: NEXT_STEP,
  };
}

export const proposeIdeasSkill = defineOttoSkill({
  name: "proposeIdeas",
  // $0 suggestion surface: pure, persists nothing, spends nothing. free + read + internal ⇒
  // needsApproval=false.
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Suggest a few concrete content ideas (usually 3) when the user is stuck or asks for ideas. " +
    "Brainstorm them yourself from what you know about their brand (products, tone, what's worked), then pass them here as `ideas` " +
    "(each a one-line title, optionally why it fits and a format). $0 — this only suggests; it saves nothing and never generates. " +
    "The user turns an idea into a creation on the canvas, where generation asks before it spends.",
  parameters: params,
  execute: executeProposeIdeas,
});
