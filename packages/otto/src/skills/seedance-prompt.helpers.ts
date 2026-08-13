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
  references: z.array(promptRef).max(8).default([]),
  cleanFootage: z.boolean().default(true),
  constraints: z.string().optional(),
});
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/** 纯：结构化意图 → Seedance 创作 prompt（英文，无技术 flag —— 时长/清晰度/画幅/声音都由
 *  provider 作为严格顶层字段发送，#646 T5 起 prompt 文本里一个 flag 都不再有）。 */
export function assembleSeedance(i: SeedancePromptInput): string {
  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    const seg = [
      // #782:这里原本还有一条 `continuesFromPrev` 分支,写出 "continuing from the previous
      // frame," —— 一句**文字暗示**。它暗示的那件事在执行层从来没有发生过:上一条片子的
      // 末帧根本没有被送进这一条,引擎手上只有一张与前一镜无关的首帧图,所以镜头之间接不上,
      // 而 prompt 里却写着「接着上一帧」。接续现在由真东西完成 —— 上一镜的**真实末帧**被灌
      // 进这一镜的首帧(分镜闸③),于是这一镜本来就是 i2v,下面这句「从给定的首帧起步」对
      // 接续与不接续同样为真。旧的暗示句因此退役,而不是与新机制并存:两条同名而不同真伪的
      // 路留在一起,迟早有人再问一次「到底哪一条在起作用」。
      idx === 0 && i.mode === "i2v" && "starting from the given first frame,",
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
  if (i.mode === "i2v") lines.push("keep the subject consistent with the source frame");
  const locks = identityLockClause(i.references);
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  const hasLockedBrandmark = i.references.some((r) => r.role === "brandmark" && r.lock);
  if (i.cleanFootage && !hasLockedBrandmark) lines.push("no on-screen text, watermark, or logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}
