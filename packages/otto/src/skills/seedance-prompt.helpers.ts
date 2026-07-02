import { z } from "zod";
import { promptRef, identityLockClause } from "./prompt-vocab.js";

export const seedanceShot = z.object({
  subject: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  shotFraming: z.string().optional(),
  sceneLight: z.string().optional(),
  mood: z.string().optional(),
  audio: z.string().optional(),
});

export const seedancePromptInput = z.object({
  mode: z.enum(["i2v", "t2v"]).default("i2v"),
  style: z.string().optional(),
  pacing: z.string().optional(),
  shots: z.array(seedanceShot).min(1).max(4),
  continuesFromPrev: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  cleanFootage: z.boolean().default(true),
  constraints: z.string().optional(),
});
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/** 纯：结构化意图 → Seedance 创作 prompt（英文，无技术 flag —— provider 追加 --resolution/--duration/--ratio）。 */
export function assembleSeedance(i: SeedancePromptInput): string {
  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    const seg = [
      idx === 0 && i.continuesFromPrev && "continuing from the previous frame,",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "starting from the given first frame,",
      s.shotFraming,
      s.subject,
      s.action,
      s.camera,
      s.sceneLight,
      s.mood,
    ].filter(Boolean).join(", ");
    lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
    if (s.audio) lines.push(`Audio: ${s.audio}`);
  });
  if (i.mode === "i2v") lines.push("keep the subject consistent with the source frame, preserve face and outfit");
  const locks = identityLockClause(i.references);
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  const hasLockedBrandmark = i.references.some((r) => r.role === "brandmark" && r.lock);
  if (i.cleanFootage && !hasLockedBrandmark) lines.push("no on-screen text, watermark, or logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}
