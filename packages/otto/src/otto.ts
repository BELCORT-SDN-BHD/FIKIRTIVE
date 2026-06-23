import { Agent } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk"; // SUBPATH, not the package root
import { anthropic } from "@ai-sdk/anthropic";
import { OTTO_OUTPUT_CAP_TOKENS } from "@artlio/core";
import type { OttoContext } from "./context.js";
import { ottoInstructions } from "./instructions.js";
import { propose } from "./tools/propose.js";
import { generate } from "./tools/generate.js";
import { updateBrief } from "./tools/update-brief.js";
import { describeRefs } from "./tools/describe-refs.js";
import { setTitle } from "./tools/set-title.js";

/** Default model for Otto's agent loop (Phase-0 default; swap here when registry-driven selection lands). */
export const OTTO_DEFAULT_MODEL = "claude-sonnet-4-6";

/** Otto's durable identity + creative rules. Inlined as a TS constant (see instructions.ts) —
 *  NOT a runtime file read, so it loads in Next/Turbopack (web), tsx (worker), dist, and vitest. */
export { ottoInstructions };

export const otto = new Agent<OttoContext>({
  name: "Otto",
  instructions: ottoInstructions,
  model: aisdk(anthropic(OTTO_DEFAULT_MODEL)),
  modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
  tools: [propose, generate, updateBrief, describeRefs, setTitle],
  // maxTurns is a run() option, not an Agent constructor option — passed by the caller in Tasks 1.8/1.9
});
