import { Agent } from "@openai/agents";
import { OTTO_OUTPUT_CAP_TOKENS } from "@fikirtive/core";
import type { OttoContext } from "./context.js";
import { ottoInstructions } from "./instructions.js";
import { ottoModel, OTTO_DEFAULT_MODEL } from "./model.js";
import { propose } from "./tools/propose.js";
import { generate } from "./tools/generate.js";
import { updateBrief } from "./tools/update-brief.js";
import { describeRefs } from "./tools/describe-refs.js";
import { setTitle } from "./tools/set-title.js";
import { rememberBrandFact } from "./tools/remember-brand-fact.js";

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
  tools: [propose, generate, updateBrief, describeRefs, setTitle, rememberBrandFact],
  // maxTurns is a run() option, not an Agent constructor option — passed by the caller in Tasks 1.8/1.9
});
