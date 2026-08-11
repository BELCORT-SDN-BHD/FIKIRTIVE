import { z } from "zod";
import {
  promptRef,
  sentence,
  numberedReferenceClauses,
  isPortraitAspect,
  PORTRAIT_IMAGE_CAPTION_BAN,
} from "./prompt-vocab.js";

export const seedreamPromptInput = z.object({
  mode: z.enum(["t2i", "i2i"]).default("t2i"),
  subject: z.string().min(1),
  actionPose: z.string().optional(),
  environment: z.string().optional(),
  style: z.string().optional(),
  lighting: z.string().optional(),
  colorPalette: z.string().optional(),
  cameraLens: z.string().optional(),
  mood: z.string().optional(),
  detail: z.string().optional(),
  textContent: z.string().max(60).optional(),
  forVideo: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  editVerb: z.enum(["Add", "Remove", "Replace", "Change"]).optional(),
  editTarget: z.string().optional(),
  preserve: z.string().optional(),
  /** #774 U4：这张图会以什么画幅交付。竖版另加一句 caption-free —— 竖版长鬼字幕的概率
   *  明显更高。传的必须是**同一趟** propose 的 `desiredAspect`；认不出来一律当非竖版。 */
  aspect: z.string().optional(),
  /** #774 U2：这一趟带着一张编辑底图吗（商家挂的图 / 详情页正在改的那张）。
   *  worker 把它 unshift 到第 0 位（`apps/worker/src/jobs/gen.ts:753`），所以它是
   *  `<Image_1>`，`references` 从 `<Image_2>` 起算。 */
  baseImage: z.boolean().default(false),
});
export type SeedreamPromptInput = z.infer<typeof seedreamPromptInput>;

/**
 * 纯：结构化意图 → 连贯自然语言的英文 prompt（最前 token 权重最高，所以主体永远第一句）。
 *
 * #774 U1：这里原本是 `parts.filter(Boolean).join(", ")` —— 一串逗号关键词，正是官方
 * 指南点名的「Avoid」反例。现在逐条成句：每个要素自成一句，句号收尾。改的是**说法**，
 * 不是内容 —— 字段、先后次序、取舍规则一条没动。
 */
export function assembleSeedream(i: SeedreamPromptInput): string {
  const refClauses = numberedReferenceClauses(i.references, { baseImage: i.baseImage });
  const portrait = isPortraitAspect(i.aspect);

  if (i.mode === "i2i") {
    const edit = [
      sentence(`${i.editVerb ?? "Change"} ${i.editTarget ?? ""}`),
      i.style && sentence(`restyle it to ${i.style}`),
      i.lighting && sentence(`the light is ${i.lighting}`),
      ...refClauses,
      sentence(i.preserve ?? "keep everything else unchanged, and maintain the same composition and lighting"),
    ];
    return edit.filter(Boolean).join(" ");
  }

  // 风格/光线/色彩并成一句：要素之间仍是并列，但整体是一句话，不是一串标签。
  const look = [
    i.style && `the style is ${i.style}`,
    i.lighting && `the light is ${i.lighting}`,
    i.colorPalette && `the color palette is ${i.colorPalette}`,
  ].filter(Boolean).join(", ");

  const sentences = [
    sentence(`${i.subject}${i.actionPose ? `, ${i.actionPose}` : ""}`),
    i.environment && sentence(`the setting is ${i.environment}`),
    look && sentence(look),
    i.cameraLens && sentence(`shot with ${i.cameraLens}`),
    i.mood && sentence(`the mood is ${i.mood}`),
    i.detail && sentence(i.detail),
    i.forVideo && "Leave clean, uncluttered space around the subject with headroom for motion, and keep a single dominant light direction.",
    ...refClauses,
    i.textContent && sentence(`render the text "${i.textContent}" in bold sans-serif, placed prominently`),
    // 商家自己要了画面上的字，就不该再禁字 —— 只有没要字的竖版才加这道防线。
    portrait && !i.textContent && PORTRAIT_IMAGE_CAPTION_BAN,
  ];
  return sentences.filter(Boolean).join(" ");
}
