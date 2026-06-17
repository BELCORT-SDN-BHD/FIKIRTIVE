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
      "Lead with MOTION and CAMERA — say how the subject moves and how the shot moves through time (speed, trajectory, what changes across the clip); keep static scene description brief, since temporal/motion detail is what a video model needs. Describe one clear primary action — Kling loses subject stability past ~2 concurrent motions, so don't stack simultaneous movements; keep the camera move simple and singular.",
    rules: { maxConcurrentMotions: 2 },
    confidence: "untested",
    notes: "Vision-level claim: Kling destabilizes past ~2 concurrent motions. Untested. Directive reallocates the prompt budget toward motion+camera for t2v.",
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
      "Lead with MOTION and CAMERA — how the subject moves and how the shot moves through time; keep static scene description brief. Prefer a single clear subject. LTX tends to face-merge multiple characters — for multi-character scenes, separate them spatially or generate them in separate shots, and if multiple people are unavoidable keep each face MINIMAL: distinguish them by position and framing, not by piling on distinct hair, glasses, or beards (fine-grained distinct faces are exactly what makes LTX merge them).",
    rules: { castSeverity: "warn" },
    confidence: "untested",
    notes: "Vision-level claim: LTX face-merges multiple characters. Untested. Adds a forced-multi-character clause + t2v motion budget.",
  },
  {
    family: "ltx",
    mode: "i2v",
    directive:
      "Describe MOTION and CAMERA, not the scene (the input image provides it). Keep to a single clear subject — LTX face-merges multiple characters; if multiple people are unavoidable, keep each face minimal and distinguish them by position and framing, not by distinct hair, glasses, or beards.",
    rules: { i2vMotionNotScene: true, castSeverity: "warn" },
    confidence: "untested",
    notes: "i2v motion-not-scene + LTX multi-character caution (incl. forced-multi-character). Untested.",
  },
  {
    family: "seedream",
    mode: "i2i",
    directive:
      "Write the prompt as natural, descriptive sentences — name the subject, setting, framing, lighting, and mood in prose. The reference image already supplies the base subject; describe the change/edit you want in sentences, not comma-separated keyword/tag soup. Seedream follows natural language best.",
    rules: { noTagCommas: true },
    confidence: "untested",
    notes: "Seedream's natural-language preference is a family property — applies to i2i as well as t2i (was unseeded → fell back to base prompt and drifted to comma-soup).",
  },
  {
    family: "veo",
    mode: "t2v",
    directive:
      "Veo follows rich, cinematic natural-language prompts and renders native audio — describe the SHOT like a director: subject and primary action, then camera move (dolly/pan/orbit and speed), lens feel, lighting, and mood; if you want sound, name it explicitly (dialogue, ambient, score). Keep one clear primary action per clip; Veo handles detail well but a single coherent motion reads cleaner than several competing ones.",
    confidence: "untested",
    notes: "Veo 3.1 family: cinematic NL + native audio. Lead with action+camera; name desired audio. Untested.",
  },
  {
    family: "seedance",
    mode: "t2v",
    directive:
      "Seedance leads with MOTION — state how the subject moves and how the camera moves through the clip (trajectory, speed, what changes over time); keep static scene description brief. Prefer one decisive primary action plus one camera move; stacking many simultaneous motions degrades coherence. Audio is generated, so a short ambient/sound cue helps.",
    confidence: "untested",
    notes: "Seedance 2.0 family: motion+camera lead, single primary action. Untested.",
  },
  {
    family: "wan",
    mode: "t2v",
    directive:
      "Wan responds to clear motion and camera direction with native (always-on) audio — describe the primary action and the camera move plainly; keep the scene description tight and the motion specific. Don't over-specify many concurrent movements; one clean action + one camera move yields the most stable result.",
    confidence: "untested",
    notes: "Wan 2.5 family: native audio (not toggleable), motion+camera lead. Untested.",
  },
  {
    family: "pixverse",
    mode: "t2v",
    directive:
      "PixVerse favors a single clear subject and a well-defined motion — lead with the action and a simple camera move, keep the look description concise. Avoid crowding the frame with multiple moving subjects; a focused single-action clip is more reliable than a busy multi-action one.",
    confidence: "untested",
    notes: "PixVerse V6 family: single subject + one clear motion. Untested.",
  },
  {
    family: "grok",
    mode: "t2v",
    directive:
      "Grok Imagine is silent and short — write a punchy, concrete prompt: one subject, one vivid primary action, one simple camera move. Front-load the most important visual; with a brief clip there's no room for multi-beat sequences, so describe a single moment of motion rather than a story.",
    confidence: "untested",
    notes: "Grok Imagine family: silent, short clips → single decisive moment. Untested.",
  },
  {
    family: "hailuo",
    mode: "t2v",
    directive:
      "Hailuo renders a fixed short clip — describe one clear subject and a single, well-defined motion with a simple camera move; keep the scene description concise and put the budget on the action. One coherent movement reads far better than several competing ones.",
    confidence: "untested",
    notes: "Hailuo 02 family: fixed short clip → one clear motion. Untested.",
  },
];
