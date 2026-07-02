/**
 * Prompt-authority registry (D/E design decision 6).
 *
 * Some model families own a dedicated, deterministic prompt-assembly skill
 * (seedreamPrompt / seedancePrompt). For those families the skill is the SOLE
 * prompt authority: the spend path must NOT stack the legacy family×mode
 * ModelDirective (packages/core/cowork-directives.ts) on top of the
 * skill-assembled prompt — the directive remains a fallback ONLY for families
 * that have no such skill.
 *
 * SINGLE SOURCE OF TRUTH: add an entry to PROMPT_SKILLS when you add a family's
 * prompt skill; the derived family set and both spend surfaces update
 * automatically. Colocated with the skills so it evolves with them.
 */
import type { ModelFamily } from "@fikirtive/core";
import type { OttoSkill } from "./skill.js";
import { seedreamPromptSkill } from "./skills/seedream-prompt.js";
import { seedancePromptSkill } from "./skills/seedance-prompt.js";

/** Each dedicated prompt-assembly skill + the model family it authors prompts for.
 *  Pairing the skill object with the family lets a test assert the skill is really
 *  registered — you cannot declare a family "skilled" without a live skill. */
export const PROMPT_SKILLS: ReadonlyArray<{ skill: OttoSkill; family: ModelFamily }> = [
  { skill: seedreamPromptSkill, family: "seedream" },
  { skill: seedancePromptSkill, family: "seedance" },
];

/** The families whose prompt is authored by a dedicated skill (sole authority). */
export const PROMPT_SKILLED_FAMILIES: ReadonlySet<ModelFamily> = new Set(
  PROMPT_SKILLS.map((p) => p.family),
);

/** True when `family` has a dedicated prompt skill → the spend path skips the
 *  legacy ModelDirective for it. Undefined (unknown model) → false (keep fallback). */
export function familyHasPromptSkill(family: ModelFamily | undefined): boolean {
  return !!family && PROMPT_SKILLED_FAMILIES.has(family);
}
