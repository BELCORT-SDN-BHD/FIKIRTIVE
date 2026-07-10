import { Agent } from "@openai/agents";
import { OTTO_OUTPUT_CAP_TOKENS } from "@fikirtive/core";
import type { OttoContext } from "./context.js";
import { ottoInstructions } from "./instructions.js";
import { ottoModel, OTTO_DEFAULT_MODEL } from "./model.js";
import { allSkills } from "./registry.js";

/** Re-exported for credit price lookup (withLlmBudget). Model selection + 529 failover live in ./model.ts. */
export { OTTO_DEFAULT_MODEL };

/** Otto's durable identity + creative rules. Inlined as a TS constant (see instructions.ts) —
 *  NOT a runtime file read, so it loads in Next/Turbopack (web), tsx (worker), dist, and vitest. */
export { ottoInstructions };

export const otto = new Agent<OttoContext>({
  name: "Otto",
  instructions: ottoInstructions,
  model: ottoModel,
  modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
  tools: allSkills.map((s) => s.tool),
  // maxTurns is a run() option, not an Agent constructor option — passed by the caller in Tasks 1.8/1.9
});

/**
 * ottoVerdict — an INDEPENDENT system profile used ONLY by the worker's post-generation verdict
 * turn (apps/worker/src/otto-resume.ts). It shares Otto's durable identity (ottoInstructions),
 * model, and output cap — so the verdict copy keeps Otto's voice — but carries ZERO tools.
 *
 * Why a separate profile: the verdict turn only speaks one sentence ("does this look right?").
 * Running the full `otto` (all 25 skills, up to OTTO_MAX_STEPS billed turns) just to say that is
 * COGS waste AND an over-privilege surface (a write/spend tool could be reached). An empty toolset
 * removes that surface entirely — no tool can be called — and lets the run finish in a single step
 * (the caller runs it with maxTurns:1 and reserves maxSteps:1). Do NOT add tools here.
 */
export const ottoVerdict = new Agent<OttoContext>({
  name: "Otto",
  instructions: ottoInstructions,
  model: ottoModel,
  modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
  tools: [],
});
