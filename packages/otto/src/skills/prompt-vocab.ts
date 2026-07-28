/**
 * 共享 prompt 构件 —— 词表常量 + reference 身份锁定措辞。
 * 被 seedream-prompt / seedance-prompt 两个 skill 复用。纯数据 + 纯函数，无 DB/网络。
 */
import { z } from "zod";

// 参考列表（给 skill 的 description 引导 Otto 用“画得出来”的词），不做 enum —— 字段保持自由文本。
export const CAMERA_MOVES = [
  "dolly in (推镜头)", "pull out (拉镜头)", "pan (摇镜头)", "tracking (跟拍)",
  "orbit (环绕)", "aerial (航拍)", "handheld follow (手持跟拍)", "crane up/down (升降)",
  "fixed (固定)", "one continuous take (一镜到底)",
] as const; // 规则：每 shot 只用一个
export const SHOT_SCALES = ["extreme wide", "wide", "full", "medium", "medium close-up", "close-up", "extreme close-up"] as const;
export const CAMERA_ANGLES = ["eye-level", "high-angle", "low-angle", "bird's-eye", "POV"] as const;
export const LIGHTING = [
  "golden hour", "dramatic side light", "soft diffused", "moody low-key", "bright high-key",
  "studio soft box (45°)", "backlight / rim", "neon", "volumetric", "natural window light",
] as const; // 规则：给方向 + 色温，别写“漂亮的光”
export const STYLES = [
  "cinematic", "photorealistic", "editorial photography", "product photography", "documentary",
  "film grain", "3D CG render", "ink-wash (水墨)", "cyberpunk neon", "minimalist",
] as const;
export const PACING = ["slow-motion", "hard cut", "fast cut", "timelapse", "one continuous take"] as const;

/** 纯：去掉词表条目末尾的中文括注，只留英文（喂给 skill description，模型只看英文）。 */
export const enOnly = (list: readonly string[]) => list.map((s) => s.replace(/\s*\(.*\)$/, ""));

// ---------------------------------------------------------------------------
// 语言执法（#437 复审 P1-B）：按「主体文字系统」判定，不逐字符 ——
// 中文正文里夹英文行业词（dolly in）合法；整段英文冒充中文正文非法。
// 度量：CJK 按字计（一字≈一语素），拉丁按词计（一词≈一语素以上），谁多算谁。
// ---------------------------------------------------------------------------
const CJK_CHARS = /[㐀-鿿豈-﫿]/g;
const LATIN_WORDS = /[a-zA-Z][a-zA-Z'’-]*/g;

/** 纯：一段自由文本的主体文字系统。无任何文字（纯数字/标点）→ "neither"，不判罚。 */
export function majorityScript(text: string): "cjk" | "latin" | "neither" {
  const cjk = (text.match(CJK_CHARS) ?? []).length;
  const latin = (text.match(LATIN_WORDS) ?? []).length;
  if (cjk === 0 && latin === 0) return "neither";
  return cjk >= latin ? "cjk" : "latin";
}

/** reference：像素不在这里（走 propose 的 entityIds → API 参数）。只承载织入措辞所需的 role + name。 */
export const promptRef = z.object({
  role: z.enum(["character", "product", "location", "brandmark"]),
  name: z.string().min(1).max(64),
  lock: z.boolean().default(true), // true=锁一致；false=只借鉴风格
});
export type PromptRef = z.infer<typeof promptRef>;
type Role = PromptRef["role"];

/** 纯：把每个 reference 织成一句英文身份锁定/风格借鉴短语，用 "; " 连接。空 refs → ""。图像路径（英文 prompt）用。 */
export function identityLockClause(refs: PromptRef[]): string {
  if (refs.length === 0) return "";
  const lock: Record<Role, (n: string) => string> = {
    character: (n) => `keep ${n} identical to the reference, same face, hairstyle, and build`,
    product: (n) => `feature ${n} exactly as in the reference, same shape, color, and label`,
    location: (n) => `match the setting of ${n} to the reference environment`,
    brandmark: (n) => `reproduce the ${n} logo exactly as in the reference, unaltered`,
  };
  const style = (n: string) => `draw stylistic inspiration from ${n}`;
  return refs.map((r) => (r.lock ? lock[r.role] : style)(r.name)).join("; ");
}

/** 纯：中文身份锁 —— 视频路径用（视频引擎 prompt 正文为中文，锁句同语言权重更稳）。空 refs → ""。 */
export function identityLockClauseZh(refs: PromptRef[]): string {
  if (refs.length === 0) return "";
  const lock: Record<Role, (n: string) => string> = {
    character: (n) => `${n} 与参考图保持同一人：同脸、同发型、同体型`,
    product: (n) => `${n} 与参考图完全一致：同形状、同颜色、同标签`,
    location: (n) => `场景与 ${n} 的参考环境保持一致`,
    brandmark: (n) => `${n} logo 按参考图原样呈现，不得变形`,
  };
  const style = (n: string) => `画风参考 ${n}，不锁定其外观`;
  return refs.map((r) => (r.lock ? lock[r.role] : style)(r.name)).join("；");
}
