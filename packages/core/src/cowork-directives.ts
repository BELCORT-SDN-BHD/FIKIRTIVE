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
import { MODEL_FAMILIES, GEN_MODES, familyModes, type ModelFamily, type GenMode } from "./gen.js";

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "untested"] as const;
export const DIRECTIVE_SOURCES = ["research", "founder", "vision-v2"] as const;
export const MAX_DIRECTIVE_LEN = 2000;
export const MAX_DIRECTIVE_NOTES = 1000;

/** Closed structured-rules shape (R5) — Guardian/Coach read these without a
 *  second migration. Every field optional; `.strict()` rejects unknown keys so
 *  the admin can't silently store a typo the skills will never read. */
export const modelDirectiveRules = z
  .object({
    maxConcurrentMotions: z.number().int().min(1).max(10).optional(), // subject-stability ceiling per engine
    noTagCommas: z.boolean().optional(), // Seedream: natural language, not comma-tag soup
    i2vMotionNotScene: z.boolean().optional(), // i2v: describe motion/camera, the image gives the scene
    castSeverity: z.enum(["warn", "block"]).optional(), // multi-character handling (Guardian reads this)
    pitfalls: z.array(z.string().max(40)).max(12).optional(),
  })
  .strict();
export type ModelDirectiveRules = z.infer<typeof modelDirectiveRules>;

/** 这一格是不是**真会被读到**的格 —— 知识库的读法是 (实际模型的家族 × 实际请求的模式),
 *  所以跨 kind 的组合(图像家族 × t2v)永远取不到值。#647 T6。 */
export function isRealDirectiveCell(family: ModelFamily, mode: GenMode): boolean {
  return (familyModes(family) as readonly string[]).includes(mode);
}

/** The founder-editable input the admin save action validates (R7 boundary).
 *  #647 T6:除了家族与模式各自合法,(家族, 模式) 这一对也必须是真格 —— 否则后台可以
 *  存进一条谁也读不到的指令,而 Founder 会以为自己调过它了。 */
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
  .strict()
  .superRefine((v, ctx) => {
    if (!isRealDirectiveCell(v.family, v.mode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "that engine family never runs in this mode" });
    }
  });
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
 * cites, every one `confidence:"untested"` / `source:"research"`. An absent or
 * disabled cell → the skill falls back to its family-neutral base prompt. The
 * seed inserts when-absent and NEVER clobbers a founder edit.
 *
 * #647 T6:原本 13 条种子里有 10 条属于那 12 台已下架的假视频引擎(kling/ltx/veo/wan/
 * pixverse/grok/hailuo)。引擎下架,种子跟着下架 —— 留下来的三条正好落在两台在产引擎的
 * 真格上。剩下两个真格(seedance 的 i2v / i2v-tail)刻意留空:那两格没有做过研究,
 * 空着让技能回落到家族中性提示,比现编一条像模像样的指令诚实。
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
    family: "seedream",
    mode: "i2i",
    directive:
      "Write the prompt as natural, descriptive sentences — name the subject, setting, framing, lighting, and mood in prose. The reference image already supplies the base subject; describe the change/edit you want in sentences, not comma-separated keyword/tag soup. Seedream follows natural language best.",
    rules: { noTagCommas: true },
    confidence: "untested",
    notes: "Seedream's natural-language preference is a family property — applies to i2i as well as t2i (was unseeded → fell back to base prompt and drifted to comma-soup).",
  },
  {
    family: "seedance",
    mode: "t2v",
    directive:
      "Seedance leads with MOTION — state how the subject moves and how the camera moves through the clip (trajectory, speed, what changes over time); keep static scene description brief. Prefer one decisive primary action plus one camera move; stacking many simultaneous motions degrades coherence. Audio is generated, so a short ambient/sound cue helps.",
    confidence: "untested",
    notes: "Seedance 2.0 family: motion+camera lead, single primary action. Untested.",
  },
];
