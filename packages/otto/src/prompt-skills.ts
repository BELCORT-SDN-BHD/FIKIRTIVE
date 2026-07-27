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

/**
 * Per-engine prompt LANGUAGE (#437; Blueprint v2.13 relocated this out of the
 * constitution: prompt language is decided per engine by its prompt-authority
 * module — this registry — following measured best practice).
 *
 * - seedance → "zh": the video engine measurably performs best with a CHINESE
 *   prompt body; industry camera/framing terms stay in English.
 * - seedream → "en": current measurements show no Chinese advantage for the
 *   image engine; prompts stay English (front-loaded token weighting).
 *
 * Changing an entry requires new measured evidence FIRST, then the matching
 * assembler + skill description in the same PR — never a silent language switch.
 */
export const PROMPT_LANGUAGES: ReadonlyArray<{ family: ModelFamily; language: "zh" | "en" }> = [
  { family: "seedream", language: "en" },
  { family: "seedance", language: "zh" },
];

/** The tuned prompt language for a family, or undefined when it has no dedicated prompt skill. */
export function promptLanguageFor(family: ModelFamily | undefined): "zh" | "en" | undefined {
  return PROMPT_LANGUAGES.find((p) => p.family === family)?.language;
}
