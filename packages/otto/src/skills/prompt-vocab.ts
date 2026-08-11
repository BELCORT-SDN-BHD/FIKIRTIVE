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

/** reference：像素不在这里（走 propose 的 entityIds → API 参数）。只承载织入英文措辞所需的 role + name。 */
export const promptRef = z.object({
  role: z.enum(["character", "product", "location", "brandmark"]),
  name: z.string().min(1).max(64),
  lock: z.boolean().default(true), // true=锁一致；false=只借鉴风格
});
export type PromptRef = z.infer<typeof promptRef>;
type Role = PromptRef["role"];

/** 纯：把每个 reference 织成一句英文身份锁定/风格借鉴短语，用 "; " 连接。空 refs → ""。 */
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

// ═══════════════════════════════════════════════════════════════════════════
// #774 —— 官方提示词指南对齐用的纯构件（成句 / 编号 / 声音 / 情绪 / 画幅）
// ═══════════════════════════════════════════════════════════════════════════

/** 纯：把一段自由文本规整成一句话（首字母大写 + 句号，内部空白归一）。空 → ""。 */
export function sentence(raw: string): string {
  const t = raw.trim().replace(/\s+/gu, " ");
  if (!t) return "";
  const head = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/u.test(head) ? head : `${head}.`;
}

/**
 * 约束词表（祈使式）—— 官方要求约束写成命令，不是形容词堆。
 * 这份表只喂给 skill 的 description（教 Otto 怎么写），字段本身保持自由文本。
 */
export const VIDEO_CONSTRAINTS = [
  "Keep the camera steady.",
  "Hold one continuous take.",
  "Keep the subject's outfit unchanged.",
  "Avoid distorted hands and faces.",
  "Avoid sudden cuts.",
  "Keep the background stable.",
  "Do not add people who were not described.",
] as const;

/** 画质段 —— 官方建议每条视频提示词先给一句质感基调，再进分镜。 */
export const VIDEO_QUALITY = "cinematic quality, natural motion, film-grade color, sharp focus";

/** 纯：把 `constraints` 自由文本拆成逐句祈使句（用 `;` 或换行分隔）。 */
export function imperativeConstraints(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(/[;\n]+/u).map(sentence).filter(Boolean);
}

/**
 * 声音符号规范（官方符号）：音乐 `（）`、音效 `<>`、台词 `{}`、字幕 `【】`。
 *
 * `【】` **故意只作为禁令出现**，装配结果里永远不会主动写它 —— 我们从不替商家要求
 * 烧录字幕（见 `PORTRAIT_CAPTION_BAN`）。这份常量存在是为了让「我们用的符号」有一处
 * 可引用的定义，而不是散落在两个组装器里各写各的。
 */
export const SOUND_MARKS = {
  music: ["（", "）"],
  sfx: ["<", ">"],
  dialogue: ["{", "}"],
  subtitle: ["【", "】"],
} as const;

/** 纯：结构化声音 → 官方符号串。全空 → ""。 */
export function soundNotation(i: { music?: string; sfx?: string; dialogue?: string }): string {
  const wrap = (v: string | undefined, mark: readonly [string, string]) => {
    const t = v?.trim();
    return t ? `${mark[0]}${t}${mark[1]}` : "";
  };
  return [
    wrap(i.music, SOUND_MARKS.music),
    wrap(i.sfx, SOUND_MARKS.sfx),
    wrap(i.dialogue, SOUND_MARKS.dialogue),
  ].filter(Boolean).join(" ");
}

/**
 * 情绪外化对照表 —— 官方要求把「开心」写成镜头**看得见**的动作，而不是一个感受词。
 * 键是商家/Otto 会用的英文情绪词；值是身体信号，逐条都是画面里能拍到的东西。
 */
export const EMOTION_CUES: Record<string, string> = {
  happy: "the corners of the mouth lift, the eyes soften, the steps turn light",
  sad: "the shoulders drop, the gaze falls, the movements slow down",
  angry: "the jaw tightens, the brows draw in, the steps land hard",
  nervous: "the fingers fidget, the eyes dart, the breathing goes shallow",
  surprised: "the eyes widen, the head pulls back, the hands freeze mid-motion",
  confident: "the chin lifts, the shoulders open, the stride lengthens",
  tired: "the eyelids droop, the head tips forward, the feet drag",
  excited: "the hands move quickly, the weight shifts forward, there is a bounce in the step",
  calm: "the breathing slows, the shoulders settle, the hands rest still",
  proud: "the back straightens, the chin lifts, a small smile holds",
};

/** 纯：情绪词 → 可拍摄的身体信号。表里没有的词返回 null（**不猜**，由调用方兜底）。 */
export function externalizeEmotion(raw?: string): string | null {
  if (!raw) return null;
  return EMOTION_CUES[raw.trim().toLowerCase()] ?? null;
}

/** 竖版画幅集合。写法归一（`9x16` / `9 : 16` 都算），认不出来一律 false —— **绝不猜**。 */
const PORTRAIT_ASPECTS = new Set(["9:16", "3:4", "4:5", "2:3"]);
const PORTRAIT_WORDS = new Set(["portrait", "vertical"]);

export function isPortraitAspect(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const t = raw.trim().toLowerCase();
  if (!t) return false;
  if (PORTRAIT_WORDS.has(t)) return true;
  return PORTRAIT_ASPECTS.has(t.replace(/[x×:：\s]+/gu, ":"));
}

/**
 * 竖版防字幕 —— 官方明言竖版输出出现「鬼字幕」的概率显著更高，所以竖版要**额外**
 * 再说一次，并且点名 `【】` 这个符号（模型认得它就是字幕位）。
 *
 * 两个版本的区别只有一处：商家锁了品牌标识时，禁的是字幕而**不是**那枚 logo。
 */
export const PORTRAIT_CAPTION_BAN =
  "this is a vertical clip — do not burn in any subtitles or captions, and never render a 【】 caption bar";
export const PORTRAIT_CAPTION_BAN_KEEPING_LOGO =
  "this is a vertical clip — keep the brand mark, but do not burn in any subtitles or captions, and never render a 【】 caption bar";
/** 图片侧的同一件事（竖版首帧同样会长出鬼字幕）。 */
export const PORTRAIT_IMAGE_CAPTION_BAN =
  "Keep the frame free of subtitles, captions, and watermarks.";

/**
 * 参考图编号（官方句式 `Define … in <Image_N> as <Subject_N>`）。
 *
 * ── 为什么编号必须与**真实发送顺序**一致 ──────────────────────────────────
 * 编错位比不编号更糟：模型会照着编号去认人，一旦 `<Image_2>` 指的不是它以为的那张，
 * 串脸串产品就从「可能」变成「必然」。所以这里的槽位不是随手编的，而是逐条对着
 * worker 真正发出去的那个数组来的（`apps/worker/src/jobs/gen.ts`）：
 *
 *   1. `:607-618` 元素参考照按 **round-robin** 装进 `cappedRefs` —— 第 0 轮给每个
 *      @到的元素各坐一张，因此第 k 个元素的第一张图就是第 k 个槽位。上限
 *      `MAX_CONDITIONING_IMAGES` 是 10，而元素上限是 8（`references` 的 `.max(8)`
 *      与 `MAX_GEN_ENTITIES` 一致），所以第 0 轮**一定**坐得下每一个元素。
 *   2. `:753` 编辑底图（商家挂的那张图 / 详情页在改的那张）走 `unshift`，插到第 0 位
 *      —— 所以有底图时它就是 `<Image_1>`，元素从 `<Image_2>` 起算。
 *
 * ── 调用方必须守的两条契约（description 里逐字写给 Otto）──────────────────
 *   · `references` 的顺序 = 传给 propose 的 `entityIds` 顺序；
 *   · 只列**确实有参考图**的元素 —— 一个零张图的元素在 worker 那边不占槽位，把它
 *     写进来会让它后面所有编号整体错一位。
 *
 * ── 万一还是错位了会怎样 ──────────────────────────────────────────────────
 * 每一句都**同时**带着编号和名字（`… <Image_2> … feature the AeroBottle …`），所以
 * 编号错位时模型手里仍有名字→角色这一层映射，退化成今天这版没编号的措辞，而不是
 * 得到一条自信的错指令。这是刻意的兜底，不是编号可以不准的借口。
 */
export function numberedReferenceClauses(
  refs: PromptRef[],
  opts: { baseImage?: boolean } = {},
): string[] {
  const clauses: string[] = [];
  if (opts.baseImage) clauses.push("<Image_1> is the image being edited.");
  const offset = opts.baseImage ? 2 : 1;
  const lock: Record<Role, (n: string, s: string) => string> = {
    character: (n, s) => `Define the person in <Image_${s}> as <Subject_${s}>: keep ${n} identical to that reference — same face, hairstyle, and build.`,
    product: (n, s) => `Define the product in <Image_${s}> as <Subject_${s}>: feature ${n} exactly as in that reference — same shape, color, and label.`,
    location: (n, s) => `Define the setting in <Image_${s}> as <Subject_${s}>: match the environment to ${n} as in that reference.`,
    brandmark: (n, s) => `Define the logo in <Image_${s}> as <Subject_${s}>: reproduce the ${n} logo exactly as in that reference, unaltered.`,
  };
  refs.forEach((r, idx) => {
    const slot = String(idx + offset);
    clauses.push(
      r.lock
        ? lock[r.role](r.name, slot)
        : `Draw stylistic inspiration from <Image_${slot}> (${r.name}); do not copy its subject.`,
    );
  });
  return clauses;
}

/**
 * U8 —— 官方的素材建议，一律**只提醒不强收**（商家的 data 商家的权利）。
 * 返回给 Otto 转述的英文人话；没什么可说时返回空数组。
 */
export function referenceAdvice(refs: PromptRef[]): string[] {
  const notes: string[] = [];
  const people = refs.filter((r) => r.role === "character").length;
  if (people > 4) {
    notes.push(
      "More than four people in one reference set usually costs facial detail — splitting this into separate shots keeps every face sharp.",
    );
  }
  if (refs.length > 5) {
    notes.push(
      "Around four or five references works best; beyond that the extra ones tend to pull the result in too many directions.",
    );
  }
  return notes;
}
