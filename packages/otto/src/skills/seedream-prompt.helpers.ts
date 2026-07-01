import { z } from "zod";
import { promptRef, identityLockClause } from "./prompt-vocab.js";

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
});
export type SeedreamPromptInput = z.infer<typeof seedreamPromptInput>;

/** 纯：结构化意图 → Seedream 偏好的英文 prose prompt（最前 token 权重最高）。 */
export function assembleSeedream(i: SeedreamPromptInput): string {
  const locks = identityLockClause(i.references);
  if (i.mode === "i2i") {
    const parts: (string | false | undefined)[] = [
      `${i.editVerb ?? "Change"} ${i.editTarget ?? ""}`.trim(),
      i.style && `restyle to ${i.style}`,
      i.lighting,
      locks,
      i.preserve ?? "keep everything else unchanged, maintain the same composition and lighting",
    ];
    return parts.filter(Boolean).join(", ");
  }
  const parts: (string | false | undefined)[] = [
    i.subject,
    i.actionPose,
    i.environment,
    i.style,
    i.lighting,
    i.colorPalette,
    i.cameraLens,
    i.mood,
    i.detail,
    i.forVideo && "clean uncluttered composition with headroom for motion, single dominant light direction",
    locks,
    i.textContent && `with the text "${i.textContent}" in bold sans-serif, placed prominently`,
  ];
  return parts.filter(Boolean).join(", ");
}
