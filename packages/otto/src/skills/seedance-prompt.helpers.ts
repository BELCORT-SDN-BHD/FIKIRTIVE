import { z } from "zod";
import { promptRef, identityLockClauseZh } from "./prompt-vocab.js";

export const seedanceShot = z.object({
  subject: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  shotFraming: z.string().optional(),
  sceneLight: z.string().optional(),
  mood: z.string().optional(),
  audio: z.string().optional(),
});

// 追加式扩展（#437）：mode 增加 'edit'（定向修改已有片段），editInstruction/preserve 仅 edit 用；
// shots 对 i2v/t2v 仍必填（superRefine 保底），对 edit 可空 —— 旧调用方形状全部兼容。
export const seedancePromptInput = z
  .object({
    mode: z.enum(["i2v", "t2v", "edit"]).default("i2v"),
    style: z.string().optional(),
    pacing: z.string().optional(),
    shots: z.array(seedanceShot).max(4).default([]),
    continuesFromPrev: z.boolean().default(false),
    references: z.array(promptRef).max(8).default([]),
    cleanFootage: z.boolean().default(true),
    constraints: z.string().optional(),
    editInstruction: z.string().optional(),
    preserve: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "edit" && !v.editInstruction?.trim()) {
      ctx.addIssue({ code: "custom", message: "mode:'edit' requires editInstruction", path: ["editInstruction"] });
    }
    if (v.mode !== "edit" && v.shots.length === 0) {
      ctx.addIssue({ code: "custom", message: "at least one shot is required for i2v/t2v", path: ["shots"] });
    }
  });
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/** edit 模式缺省保持句（三保：画面/动作/运镜）——缺保持句 = 整片重绘。 */
export const EDIT_PRESERVE_DEFAULT = "其余画面、人物动作与运镜保持不变";

/**
 * 纯：结构化意图 → 视频引擎创作 prompt（正文中文 —— 实测中文提示词语义还原更优；
 * 运镜/景别等行业词保留英文；无技术 flag —— provider 追加 --resolution/--duration/--ratio）。
 */
export function assembleSeedance(i: SeedancePromptInput): string {
  const locks = identityLockClauseZh(i.references);

  // edit：指令 + 身份锁 + 保持句 + 附加约束，一行输出（对已有片段的定向修改，不是重新生成）。
  if (i.mode === "edit") {
    return [(i.editInstruction ?? "").trim(), locks, i.preserve ?? EDIT_PRESERVE_DEFAULT, i.constraints]
      .filter(Boolean)
      .join("，");
  }

  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    const seg = [
      idx === 0 && i.continuesFromPrev && "承接上一段画面",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "从给定的首帧画面开始",
      s.shotFraming,
      s.subject,
      s.action,
      s.camera,
      s.sceneLight,
      s.mood,
    ].filter(Boolean).join(", ");
    lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
    if (s.audio) lines.push(`声音: ${s.audio}`);
  });
  if (i.mode === "i2v") lines.push("主体与首帧画面保持一致");
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  const hasLockedBrandmark = i.references.some((r) => r.role === "brandmark" && r.lock);
  if (i.cleanFootage && !hasLockedBrandmark) lines.push("画面中不出现文字、水印或 logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}
