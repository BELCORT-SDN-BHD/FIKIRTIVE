/**
 * cowork model-knowledge contract (Phase 0B). The per-(family × mode) directive
 * shape + the closed structured-rules schema + the founder-editable input
 * contract + the research seed. Shared by the admin save action (validation),
 * the seed script, and the knowledge read. Pure (no DB) so it stays in core and
 * is unit-testable.
 *
 * Phase 0B ships the table + admin + read; the enhance skill INJECTS the
 * directive in Phase 1. The research is thin (a handful of vision-level claims,
 * all "untested") — by design: the admin panel is the curation surface, the
 * seed is just a scaffold the founder sharpens.
 */
import { z } from "zod";
import { MODEL_FAMILIES, GEN_MODES, type ModelFamily, type GenMode } from "./gen.js";

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "untested"] as const;
export const DIRECTIVE_SOURCES = ["research", "founder", "vision-v2"] as const;
export const MAX_DIRECTIVE_LEN = 2000;
export const MAX_DIRECTIVE_NOTES = 1000;

/** Closed structured-rules shape (R5) — Guardian/Coach read these without a
 *  second migration. Every field optional; `.strict()` rejects unknown keys so
 *  the admin can't silently store a typo the skills will never read. */
export const modelDirectiveRules = z
  .object({
    maxConcurrentMotions: z.number().int().min(1).max(10).optional(), // Kling/LTX subject-stability ceiling
    noTagCommas: z.boolean().optional(), // Seedream: natural language, not comma-tag soup
    i2vMotionNotScene: z.boolean().optional(), // i2v: describe motion/camera, the image gives the scene
    castSeverity: z.enum(["warn", "block"]).optional(), // multi-character handling (LTX warns)
    pitfalls: z.array(z.string().max(40)).max(12).optional(),
  })
  .strict();
export type ModelDirectiveRules = z.infer<typeof modelDirectiveRules>;

/** The founder-editable input the admin save action validates (R7 boundary). */
export const modelDirectiveInput = z
  .object({
    family: z.enum(MODEL_FAMILIES),
    mode: z.enum(GEN_MODES),
    directive: z.string().trim().max(MAX_DIRECTIVE_LEN).default(""),
    rules: modelDirectiveRules.nullish(),
    notes: z.string().trim().max(MAX_DIRECTIVE_NOTES).default(""),
    confidence: z.enum(CONFIDENCE_LEVELS).default("untested"),
    enabled: z.boolean().default(true),
    source: z.enum(DIRECTIVE_SOURCES).default("founder"),
  })
  .strict();
export type ModelDirectiveInput = z.infer<typeof modelDirectiveInput>;

export type DirectiveSeed = {
  family: ModelFamily;
  mode: GenMode;
  directive: string;
  rules?: ModelDirectiveRules;
  confidence: (typeof CONFIDENCE_LEVELS)[number];
  notes: string;
};

/**
 * The research seed — ONLY the cells the per-(family×mode) study concretely
 * cites, every one `confidence:"untested"` / `source:"research"`. ~18 of 25
 * cells are deliberately absent (unresearched: Veo, Seedance, most i2i); an
 * absent/disabled cell → the skill falls back to its family-neutral base prompt.
 * The seed inserts when-absent and NEVER clobbers a founder edit.
 */
export const DIRECTIVE_SEED: DirectiveSeed[] = [
  {
    family: "seedream",
    mode: "t2i",
    directive:
      "Write the prompt as natural, descriptive sentences — name the subject, setting, framing, lighting, and mood in prose. Avoid comma-separated keyword/tag soup; Seedream follows natural language best.",
    rules: { noTagCommas: true },
    confidence: "untested",
    notes: "Vision-level claim (masterplan): Seedream wants natural language, not tag soup. Verify with an ablation.",
  },
  {
    family: "kling",
    mode: "t2v",
    directive:
      "Describe one clear primary action. Kling loses subject stability past ~2 concurrent motions, so avoid stacking simultaneous movements; keep the camera move simple and singular.",
    rules: { maxConcurrentMotions: 2 },
    confidence: "untested",
    notes: "Vision-level claim: Kling destabilizes past ~2 concurrent motions. Untested.",
  },
  {
    family: "kling",
    mode: "i2v",
    directive:
      "The input image already provides the subject, setting, and composition — describe MOTION and CAMERA, not the scene. Say how the subject moves and how the camera moves; keep to ~2 concurrent motions.",
    rules: { i2vMotionNotScene: true, maxConcurrentMotions: 2 },
    confidence: "untested",
    notes: "i2v: motion-not-scene (general truth) + Kling motion ceiling. Untested.",
  },
  {
    family: "kling",
    mode: "i2v-tail",
    directive:
      "Start and end frames are given — describe the MOTION that interpolates between them (and the camera move), not the scene. Keep to ~2 concurrent motions for subject stability.",
    rules: { i2vMotionNotScene: true, maxConcurrentMotions: 2 },
    confidence: "untested",
    notes: "i2v-tail: describe the transition motion. Untested.",
  },
  {
    family: "ltx",
    mode: "t2v",
    directive:
      "Prefer a single clear subject. LTX tends to face-merge multiple characters — for multi-character scenes, separate them spatially or generate them in separate shots.",
    rules: { castSeverity: "warn" },
    confidence: "untested",
    notes: "Vision-level claim: LTX face-merges multiple characters. Untested.",
  },
  {
    family: "ltx",
    mode: "i2v",
    directive:
      "Describe MOTION and CAMERA, not the scene (the input image provides it). Keep to a single clear subject — LTX face-merges multiple characters.",
    rules: { i2vMotionNotScene: true, castSeverity: "warn" },
    confidence: "untested",
    notes: "i2v motion-not-scene + LTX multi-character caution. Untested.",
  },
];
