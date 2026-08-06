/**
 * Shot/session generation contract (redesign — Gen space "Generate").
 *
 * Unlike refgen (which produces an entity's ReferenceImages), this produces a
 * Generation (a candidate/shot result) the way uploadCandidates does — same
 * Generation row, source GENERATED, optionally bound to a shot. Conditioning
 * is the @mentioned entities' reference images, resolved server-side from
 * entityIds (D19 trust boundary — no client URLs).
 *
 * v1 = image (t2i / ref-conditioned edit) via the shared GenerationProvider.
 * Video (i2v) lands as a follow-up slice on this same skeleton.
 */
import { z } from "zod";

export const GEN_MODELS = ["seedream"] as const;
export type GenModel = (typeof GEN_MODELS)[number];
/** Video model menu (fal) — mirrors LTX Studio's lineup. Kling 2.5 is the silent,
 *  cheap default; every other model generates native audio. Order = picker order
 *  (silent default first, then sound models roughly cheapest→priciest). */
export const GEN_VIDEO_MODELS = [
  "kling", "veo3.1-lite", "ltx-2", "kling-2.6", "kling-3", "veo3.1-fast", "seedance-2-fast", "veo3.1",
  // added popular fal models (cheapest→priciest among the new ones)
  "pixverse-v6", "grok-imagine", "wan-2.5", "hailuo-02", "seedance-2",
] as const;
export type GenVideoModel = (typeof GEN_VIDEO_MODELS)[number];

export const GEN_KINDS = ["image", "video"] as const;
export type GenKind = (typeof GEN_KINDS)[number];

/** The prompt-research FAMILIES the knowledge base keys on. Version-specific
 *  model ids (kling-2.6, kling-3) collapse to one family so the founder tunes
 *  one directive per family, not one per model. */
export const MODEL_FAMILIES = ["seedream", "kling", "veo", "seedance", "ltx", "wan", "pixverse", "grok", "hailuo"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** The generation MODES the knowledge base keys on alongside family. */
export const GEN_MODES = ["t2i", "i2i", "t2v", "i2v", "i2v-tail"] as const;
export type GenMode = (typeof GEN_MODES)[number];

/** Map a (version-specific) model id → its research family, by prefix so a
 *  future version bump (kling-4) inherits the family automatically. An unknown
 *  id returns undefined (the skill falls back to a family-neutral base prompt) —
 *  NEVER throws. seedream/seedance both start "seed" but the full prefixes
 *  disambiguate. */
export function modelFamily(modelId: string): ModelFamily | undefined {
  if (modelId.startsWith("seedream")) return "seedream";
  if (modelId.startsWith("kling")) return "kling";
  if (modelId.startsWith("veo")) return "veo";
  if (modelId.startsWith("seedance")) return "seedance";
  if (modelId.startsWith("ltx")) return "ltx";
  if (modelId.startsWith("wan")) return "wan";
  if (modelId.startsWith("pixverse")) return "pixverse";
  if (modelId.startsWith("grok")) return "grok";
  if (modelId.startsWith("hailuo")) return "hailuo";
  return undefined;
}

/** Derive the generation MODE from a server-resolved request shape — the other
 *  axis the knowledge base keys on. PURE: the caller resolves the booleans from
 *  owned DB state first (R3 — the server is authoritative, never a client mode
 *  string). Mirrors the worker's branching: image + conditioning refs → i2i
 *  (edit), image alone → t2i; video + start frame → i2v (+ end frame → i2v-tail),
 *  video alone → t2v. (An end frame without a start is meaningless → t2v.) */
export function deriveMode(input: {
  kind: GenKind;
  conditioned?: boolean;
  hasSourceImage?: boolean;
  hasTailImage?: boolean;
}): GenMode {
  if (input.kind === "image") return input.conditioned ? "i2i" : "t2i";
  if (input.hasSourceImage) return input.hasTailImage ? "i2v-tail" : "i2v";
  return "t2v";
}

export const MAX_GEN_COUNT = 4;
export const MAX_GEN_PROMPT = 2000;
export const MAX_GEN_ENTITIES = 8;
export const GEN_VIDEO_SECONDS = 5;
export const REFERENCE_VIDEO_MODEL: GenVideoModel = "seedance-2-fast";
/** Whole-clip reference video window: Seedance needs ≥2s; the upper bound protects COGS
 *  (BytePlus bills by input duration, our charge is flat per resolution). Enforced in the
 *  composer AND server-side in the worker (via Asset.durationS from ingest's ffprobe). */
export const REF_VIDEO_MIN_SECONDS = 2;
export const REF_VIDEO_MAX_SECONDS = 6;
/** Image price is flat per image; video price is dynamic — see videoPriceUsd
 *  (scales with duration × resolution × audio × count). */
/**
 * RECORD-ONLY 图片成本记账基准(GenJob.spentUsd + 毛利报表)—— **不是收费**。图片一律按
 * `pricedGenCredits` 收 1 credit/张,与这个数无关(`spend.test.ts` 有钉子测试守着)。
 *
 * $0.035/张:官方按张计价,不分尺寸与比例(所以 #642 补齐八个画幅没有新价格档)。
 * 来源 https://docs.byteplus.com/en/docs/ModelArk/Pricing(2026-08-05 核);同值另有
 * 2026-06 真实账单佐证(docs/design/2026-07-03-harmony-04-costing-model.md §二)。
 *
 * 旧值 $0.04 是 fal 基数占位 —— F39 的注释自认「pending the founder's actual Ark
 * per-image rate」,高记约 14%。#644 改真。
 */
export const GEN_PRICE_USD_PER_IMAGE = 0.035;

/* ---------------- image shape (#642) ---------------- */

/** 图片画幅菜单，**default-first**（照视频侧的选项表写法）。图像引擎**按张计价、不分
 *  尺寸比例**，所以补齐画幅没有新价格档、没有 COGS 压力 —— 价格路径一行都不用改。 */
export const GEN_IMAGE_ASPECTS = ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
export type GenImageAspect = (typeof GEN_IMAGE_ASPECTS)[number];
/** 菜单第一项 = 未指定画幅时的默认（t2i 默认方图，与 2026-06-29 起的既有行为一致）。 */
export const GEN_IMAGE_DEFAULT_ASPECT: GenImageAspect = GEN_IMAGE_ASPECTS[0];

/** 引擎对「宽×高」写法的硬约束：总像素必须落在这个闭区间内，比例必须在 [1/16, 16]。
 *  下表每一档都由 `gen.test.ts` 逐档验过这三条 —— 加档位时测试会替你把关。 */
export const GEN_IMAGE_MIN_PIXELS = 3_686_400;
export const GEN_IMAGE_MAX_PIXELS = 16_777_216;

/**
 * 画幅 → 执行层真正发出去的**确切** WxH（2K 档）。
 *
 * 这是「说的」与「做的」共用的**同一份**数据：图像适配器按它拼 `size`
 * （`packages/generation/src/byteplus.ts`），卡面文案按它报尺寸
 * （`EXECUTED_SPEC.image.outputSizes` 直接引用这张表）。改这里一处，两边同时改口。
 *
 * 取值口径：
 *  - 1:1 保持 2048×2048，与今日逐字节一致（补齐画幅不改变既有方图行为）；
 *  - 其余各档取 2K 档格点，并且**每一档都 ≥ GEN_IMAGE_MIN_PIXELS**（引擎下限）；
 *  - **每一档都精确约分为它自称的比例**（零容差，`gen.test.ts` 用整数约分逐档比对）。
 *    这不是洁癖：商家买的是 9:16，一个「差不多的 9:16」就是一次没说出口的降级。
 *    上一版 9:16 取 1600×2848，约分是 50:89（偏 0.125%），已按判官 r1 P2 改为精确格点。
 */
export const GEN_IMAGE_SIZES: Record<GenImageAspect, { width: number; height: number }> = {
  "1:1":  { width: 2048, height: 2048 }, // 4,194,304 px — 精确 1:1
  "9:16": { width: 1620, height: 2880 }, // 4,665,600 px — 精确 9:16（1620 = 9×180, 2880 = 16×180）
  "16:9": { width: 2880, height: 1620 }, // 4,665,600 px — 精确 16:9
  "4:3":  { width: 2304, height: 1728 }, // 3,981,312 px — 精确 4:3
  "3:4":  { width: 1728, height: 2304 }, // 3,981,312 px — 精确 3:4
  "3:2":  { width: 2496, height: 1664 }, // 4,153,344 px — 精确 3:2
  "2:3":  { width: 1664, height: 2496 }, // 4,153,344 px — 精确 2:3
  "21:9": { width: 3136, height: 1344 }, // 4,214,784 px — 精确 21:9（约分 7:3）
};

/** Per-model image controls — mirrors `VideoModelOptions`. Lists are default-first;
 *  `maxCount` = batch ceiling (the image engine takes one request per image). */
export type ImageModelOptions = {
  aspectRatios: string[];
  maxCount: number;
};
export const GEN_IMAGE_MODEL_OPTIONS: Record<GenModel, ImageModelOptions> = {
  "seedream": { aspectRatios: [...GEN_IMAGE_ASPECTS], maxCount: MAX_GEN_COUNT },
};

/** A model's default image selections (first of each list) — mirrors `videoDefaults`.
 *  Never throws on an unknown id: an unmapped model falls back to the default aspect. */
export function imageDefaults(model: GenModel): { aspectRatio: string } {
  const o = GEN_IMAGE_MODEL_OPTIONS[model] as ImageModelOptions | undefined;
  return { aspectRatio: o?.aspectRatios[0] ?? GEN_IMAGE_DEFAULT_ASPECT };
}

/** 画幅 → 执行层真会产出的像素尺寸。缺省/未知一律回落默认画幅（纯函数，永不抛）——
 *  历史行（迁移前没有画幅快照）走的就是这一条，产出与它们当年一致的方图。 */
export function imageOutputSize(aspectRatio?: string | null): { width: number; height: number } {
  const size = GEN_IMAGE_SIZES[(aspectRatio ?? "") as GenImageAspect];
  return size ?? GEN_IMAGE_SIZES[GEN_IMAGE_DEFAULT_ASPECT];
}

/**
 * #643 T2 —— 商家说的形状 → 菜单上的那一格。认不出来就 `null`，**绝不猜**。
 *
 * 为什么需要它：商家的原话经 Otto 落到 `desiredAspect` 上时，可能写成 `9x16`、`portrait`，
 * 也可能写成 `9:16`。严格逐字比对会把前两种当成「菜单外的值」，于是静默掉成方图 ——
 * 商家要竖版、拿到方图，而且没人说过一句话。这里只做**写法归一 + 三个明确的人话别名**，
 * 不做模糊猜测：认不出来返回 null，由调用方走「如实披露的降级」那条路。
 *
 * 别名口径（只收敛到菜单上确实存在的一格）：
 *   portrait / vertical → 9:16；landscape / horizontal → 16:9；square → 1:1。
 * 「portrait」在设计上也可以是 3:4 或 2:3 —— 这里取最常用的一格，而这个选择**会被说出口**
 * （卡面/选择器显示的就是真会交付的那一格），不是一次静默替商家做主。
 */
const IMAGE_ASPECT_ALIASES: Record<string, GenImageAspect> = {
  portrait: "9:16",
  vertical: "9:16",
  landscape: "16:9",
  horizontal: "16:9",
  square: "1:1",
};

export function normalizeImageAspect(raw?: string | null): GenImageAspect | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const alias = IMAGE_ASPECT_ALIASES[trimmed];
  if (alias) return alias;
  // 写法归一：`9 x 16` / `9×16` / `9 : 16` 都是同一个形状。
  const canonical = trimmed.replace(/[x×:：\s]+/gu, ":");
  return (GEN_IMAGE_ASPECTS as readonly string[]).includes(canonical)
    ? (canonical as GenImageAspect)
    : null;
}

/** Per-model facts: `label` for the picker, `sound` = generates native audio,
 *  `tail` = supports an end frame. Controls + price live in the two helpers below. */
export const GEN_VIDEO_MODEL_INFO: Record<GenVideoModel, { label: string; sound: boolean; tail: boolean }> = {
  "kling":           { label: "Kling 2.5",         sound: false, tail: true },
  "veo3.1-lite":     { label: "Veo 3.1 Lite",      sound: true, tail: false },
  "ltx-2":           { label: "LTX-2",             sound: true, tail: false },
  "kling-2.6":       { label: "Kling 2.6 Pro",     sound: true, tail: true },
  "kling-3":         { label: "Kling 3.0 Pro",     sound: true, tail: true },
  "veo3.1-fast":     { label: "Veo 3.1 Fast",      sound: true, tail: true },
  "seedance-2-fast": { label: "Seedance 2.0 Fast", sound: true, tail: true }, // #646 T5: first+last frames ARE supported (two role-tagged frames in one task)
  "veo3.1":          { label: "Veo 3.1",           sound: true, tail: true },
  "pixverse-v6":     { label: "PixVerse V6",       sound: true,  tail: false }, // /transition end-frame deferred (params unverified)
  "grok-imagine":    { label: "Grok Imagine",      sound: false, tail: false },
  "wan-2.5":         { label: "Wan 2.5",           sound: true,  tail: false }, // native audio (not toggleable)
  "hailuo-02":       { label: "Hailuo 02 Pro",     sound: false, tail: true },
  "seedance-2":      { label: "Seedance 2.0",      sound: true,  tail: true },
};

/** Per-model controls — each exposes exactly what its fal endpoint accepts (i2v
 *  limits; aspect is t2v-only on some models, deriving from the source image in
 *  i2v). Empty array = no such control. `audioToggle` false = always silent
 *  (Kling 2.5). Lists are default-first. `maxCount` = batch ceiling (we enqueue N
 *  one-clip jobs — fal video has no num_videos param). Add a model: one entry
 *  here + one in @fikirtive/generation's VIDEO_CFG. */
export type VideoModelOptions = {
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  fps: number[];
  audioToggle: boolean;
  maxCount: number;
  /** EXPLICIT defaults (#645 T4). Absent ⇒ first of each list, the pre-#645 rule.
   *  Present ⇒ list order is free to be the PICKER's order without moving what a
   *  merchant gets when they choose nothing. Every value here must be in its list
   *  (pinned by video-tiers.test.ts) — a default off the menu is a default the
   *  contract gate would reject. */
  defaults?: { seconds?: number; resolution?: string; aspectRatio?: string };
  /** i2v-only shape default (#645 T4): with a source frame the engine matches the
   *  frame instead of being told a ratio. Mirrors the image side's「改这张图不变形状」. */
  i2vAspectRatio?: string;
};

/** 「跟着首帧走」——引擎自选比例。**不是一个具体形状**:卡面必须如实显示 Adaptive,
 *  不许翻译成 16:9 之类的具体值(那就是又一次替商家做主还不说话)。 */
export const VIDEO_ASPECT_ADAPTIVE = "adaptive";
export const GEN_VIDEO_MODEL_OPTIONS: Record<GenVideoModel, VideoModelOptions> = {
  "kling":           { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: false, maxCount: 4 },
  "veo3.1-lite":     { durations: [4, 6, 8],  resolutions: ["720p"],                    aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "ltx-2":           { durations: [6, 8, 10], resolutions: ["1080p", "1440p", "2160p"], aspectRatios: [],               fps: [],       audioToggle: true,  maxCount: 4 },
  "kling-2.6":       { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: true,  maxCount: 4 },
  "kling-3":         { durations: [5, 10],   resolutions: [],                           aspectRatios: [],               fps: [],       audioToggle: true,  maxCount: 4 },
  // #645 T4:引擎真能给的每一档都开出来 —— duration 整数 [4,15]、480p/720p(Fast 无 1080p)、
  // 六比例 + adaptive。列表顺序 = picker 顺序;默认值显式写在 `defaults` 里,与今日逐字一致。
  "seedance-2-fast": {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "480p"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", VIDEO_ASPECT_ADAPTIVE],
    fps: [], audioToggle: true, maxCount: 4,
    defaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vAspectRatio: VIDEO_ASPECT_ADAPTIVE,
  },
  "veo3.1-fast":     { durations: [4, 6, 8],  resolutions: ["720p", "1080p"],           aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "veo3.1":          { durations: [4, 6, 8],  resolutions: ["720p", "1080p", "4k"],     aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
  "pixverse-v6":     { durations: [5, 8],    resolutions: ["360p", "540p", "720p", "1080p"], aspectRatios: [], fps: [], audioToggle: true,  maxCount: 4 }, // i2v schema has no aspect_ratio
  "grok-imagine":    { durations: [6],       resolutions: ["480p", "720p"],            aspectRatios: [],               fps: [],       audioToggle: false, maxCount: 4 },
  "wan-2.5":         { durations: [5, 10],   resolutions: ["480p", "720p", "1080p"],   aspectRatios: [],               fps: [],       audioToggle: false, maxCount: 4 }, // audio always on
  "hailuo-02":       { durations: [6],       resolutions: [],                          aspectRatios: [],               fps: [],       audioToggle: false, maxCount: 4 }, // fixed 6s @ 1080p
  "seedance-2":      { durations: [5, 10],   resolutions: ["480p", "720p", "1080p"],   aspectRatios: ["16:9", "9:16"], fps: [],       audioToggle: true,  maxCount: 4 },
};

/**
 * A model's default selections — explicit `defaults` where the model declares them,
 * else first of each list (audio on for sound models).
 *
 * #645 T4:`hasSourceImage` 分开 t2v 与 i2v 的**形状**默认。i2v(动这张图/接首帧)默认
 * 走模型的 `i2vAspectRatio`(Seedance = adaptive):有首帧时形状该跟着首帧走,而不是被
 * 一个默认值悄悄改成别的画幅 —— 与图片侧「改这张图不变形状」同一条原则。其余三项
 * (时长/分辨率/声音)两条路一致。
 */
export function videoDefaults(
  model: GenVideoModel,
  opts?: { hasSourceImage?: boolean },
): { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } {
  const o = GEN_VIDEO_MODEL_OPTIONS[model];
  const t2vAspect = o.defaults?.aspectRatio ?? o.aspectRatios[0] ?? "";
  const i2vAspect = opts?.hasSourceImage && o.i2vAspectRatio && o.aspectRatios.includes(o.i2vAspectRatio)
    ? o.i2vAspectRatio
    : t2vAspect;
  return {
    seconds: o.defaults?.seconds ?? o.durations[0]!,
    resolution: o.defaults?.resolution ?? o.resolutions[0] ?? "",
    aspectRatio: i2vAspect,
    fps: o.fps[0] ?? 0,
    audio: o.audioToggle,
  };
}

/* ---------------- 视频引擎官方 token 计价(#644 记账真相) ---------------- */

/**
 * 视频引擎按 **token** 计价,不是按秒:
 *
 *   tokens = (输入视频秒数 + 输出秒数) × 宽 × 高 × fps / 1024
 *
 * 来源:https://docs.byteplus.com/en/docs/ModelArk/Pricing(2026-08-05 核)。
 * 720p 16:9 @24fps ⇒ 1280 × 720 × 24 / 1024 = 21,600 tokens/秒(720p 9:16 像素数相同,
 * 同值;同档不同比例的像素差 ~1%,不另立档)。
 *
 * 用官方成品价反向校验本公式(三条全中):
 *   720p 5s  无视频输入 = 108,000 tok × $5.60/M = $0.6048  → 官方 $0.60  ✓
 *   720p 10s 无视频输入 = 216,000 tok × $5.60/M = $1.2096  → 官方 $1.21  ✓
 *   720p 5s  含参考视频 = (4…15 + 5)s × 21,600 × $3.30/M = $0.64…$1.43 → 官方区间 ✓
 *
 * 只覆盖**现役 720p 档**。480p 等新档随 T4(档位扩容)带各自的官方核验一起进来 ——
 * 这里不给没核过的档位编数字。
 */
export const BYTEPLUS_720P_TOKENS_PER_SECOND = 21_600;
/** 官方 token 公式里的帧率(Seedance 2.0 系列输出恒 24fps)。 */
export const BYTEPLUS_VIDEO_FPS = 24;

/**
 * Seedance 2.0 系列**官方输出像素表**(Create-task 文档
 * https://docs.byteplus.com/en/docs/ModelArk/1520757,2026-07-31 核,Seedance 2.0 系列列)。
 *
 * 为什么必须有这张表(#645 T4):同一个分辨率档,不同比例的像素数**差得很远** ——
 * 720p 的 4:3 是 927,408px,比 16:9 的 921,600px 多 0.6%;成本按 token 走,token 按像素走,
 * 所以「720p 一个价」的成本其实是一段区间。毛利地板只有按**最差比例**建模才算数,
 * 否则商家挑了最贵的比例,我们就在自己不知情的情况下卖到地板下面去。
 */
export const SEEDANCE_VIDEO_PIXELS: Record<"480p" | "720p", Record<string, readonly [number, number]>> = {
  "480p": { "16:9": [864, 496], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [496, 864], "21:9": [992, 432] },
  "720p": { "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630] },
};

/** 某一分辨率档下**最贵**那个比例的 tokens/秒(= 最大像素 × 24fps / 1024)。纯函数。
 *  720p ⇒ 4:3/3:4 的 927,408px ⇒ 21,736.125 tok/s;480p ⇒ 21:9 的 428,544px ⇒ 10,044 tok/s。 */
export function seedanceWorstRatioTokensPerSecond(resolution: "480p" | "720p"): number {
  const widest = Math.max(...Object.values(SEEDANCE_VIDEO_PIXELS[resolution]).map(([w, h]) => w * h));
  return (widest * BYTEPLUS_VIDEO_FPS) / 1024;
}
/** 无视频输入(t2v / i2v)牌价,$/M tokens。 */
export const BYTEPLUS_USD_PER_MTOKEN = 5.6;
/** 含视频输入(整段参考视频)牌价,$/M tokens —— 比无视频输入那档更便宜。 */
export const BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT = 3.3;
/**
 * 参考视频输入的**最低计费秒数**(token 地板)。官方「含参考视频 720p 5s」区间下限
 * $0.64 恰好 = (4 + 5) 秒 × 21,600 × $3.30/M,即输入不足 4 秒也按 4 秒计 —— 与引擎
 * 自身 4 秒最短时长一致。我们的参考片窗口是 2–6 秒(REF_VIDEO_MIN/MAX_SECONDS),
 * 所以这条地板会真的咬到 2–3 秒的参考片。
 */
export const BYTEPLUS_MIN_BILLED_INPUT_SECONDS = 4;

/** 按官方 token 公式算 COGS(USD)。纯函数,RECORD-ONLY —— 收费在 spend.ts。
 *  `tokensPerSecond` 缺省 = 720p 16:9 那一档(整段参考视频沿用它,见下)。 */
export function byteplusVideoCogsUsd(opts: {
  outputSeconds: number;
  referenceInputSeconds?: number;
  tokensPerSecond?: number;
}): number {
  const rawInput = opts.referenceInputSeconds ?? 0;
  const hasVideoInput = rawInput > 0;
  const billedInput = hasVideoInput ? Math.max(rawInput, BYTEPLUS_MIN_BILLED_INPUT_SECONDS) : 0;
  const tokens = (opts.outputSeconds + billedInput) * (opts.tokensPerSecond ?? BYTEPLUS_720P_TOKENS_PER_SECOND);
  const usdPerMToken = hasVideoInput ? BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT : BYTEPLUS_USD_PER_MTOKEN;
  return (tokens * usdPerMToken) / 1_000_000;
}

/** 现役视频档(seedance-2-fast @720p 16:9)每秒等效记账成本 = **$0.12096/s**。RECORD-ONLY。
 *  #645 后它不再是收费/毛利的基准(那条路按最差比例走,见下),只留给整段参考视频那一档。 */
export const SEEDANCE_720P_COGS_USD_PER_SECOND = byteplusVideoCogsUsd({ outputSeconds: 1 });

/**
 * **每秒记账成本,按各档的最差比例**(#645 T4)。RECORD-ONLY。
 *   720p = 21,736.125 tok/s × $5.60/M = **$0.1217223/s**(4:3 / 3:4)
 *   480p = 10,044     tok/s × $5.60/M = **$0.0562464/s**(21:9)
 *
 * 为什么按最差比例记而不是按这一单真实的比例:收费是**按档**的(同一档六个比例一个价),
 * 所以毛利也只能按档判 —— 判据必须是这一档里最贵的那个比例,否则「平均起来是够的」会
 * 掩盖掉真正卖亏的那几个比例。同一条保守原则下,记账宁可高估:与
 * `REFERENCE_VIDEO_COGS_USD` 取参考片窗口上限是同一个理由(「记上限,永不低估成本」)。
 * 代价是 16:9 这类便宜比例被高记 ≤0.6%,方向永远安全。
 */
export const SEEDANCE_COGS_USD_PER_SECOND: Record<"480p" | "720p", number> = {
  "480p": byteplusVideoCogsUsd({ outputSeconds: 1, tokensPerSecond: seedanceWorstRatioTokensPerSecond("480p") }),
  "720p": byteplusVideoCogsUsd({ outputSeconds: 1, tokensPerSecond: seedanceWorstRatioTokensPerSecond("720p") }),
};

/**
 * 整段参考视频的记账成本 = **$0.78408**,按我们参考片窗口的**上限**保守记
 * (6s 参考输入 + 5s 出片,含视频输入档 $3.30/M)。真实区间 $0.6415(≤4s 参考,吃地板)
 * … $0.78408(6s 参考);记上限,永不低估成本。
 *
 * RECORD-ONLY —— 收费是 spend.ts 的 `REFERENCE_VIDEO_CREDITS`(16cr),与本值无关。
 * 旧值 $0.85 用的是 2026-06 资源包折后价 $3.564/M;牌价里含视频输入那档更便宜,
 * 所以这一档修正后成本反而**降**了。
 */
export const REFERENCE_VIDEO_COGS_USD = byteplusVideoCogsUsd({
  outputSeconds: GEN_VIDEO_SECONDS,
  referenceInputSeconds: REF_VIDEO_MAX_SECONDS,
});

/** Per-second rate ($/s) by model/resolution/audio — basis for the live price hint.
 *  fal models: verified against each model's fal pricing page. seedance-2-fast (the one
 *  in-service BytePlus model): the official token price per tier's worst ratio, see
 *  SEEDANCE_COGS_USD_PER_SECOND. */
function videoRateUsdPerSec(model: GenVideoModel, resolution: string, audio: boolean): number {
  switch (model) {
    case "kling": return 0.07;                                             // always silent
    case "kling-2.6": return audio ? 0.14 : 0.07;
    case "kling-3": return audio ? 0.168 : 0.112;
    // #644 官方牌价 token 公式;#645 T4 起按**档 × 最差比例**分开(480p 是真的半价档,
    // 记成 720p 会把它的毛利算错)。未知/缺省分辨率一律回落到更贵的 720p —— 记账宁可高估。
    // 声音开关不影响 2.0 系列价格,所以这一档不看 audio。RECORD-ONLY;收费在 spend.ts。
    case "seedance-2-fast":
      return SEEDANCE_COGS_USD_PER_SECOND[resolution as "480p" | "720p"] ?? SEEDANCE_COGS_USD_PER_SECOND["720p"];
    case "ltx-2": return resolution === "2160p" ? 0.24 : resolution === "1440p" ? 0.12 : 0.06;
    case "veo3.1-lite": return resolution === "1080p" ? (audio ? 0.08 : 0.05) : (audio ? 0.05 : 0.03);
    case "veo3.1-fast": return audio ? 0.15 : 0.10;
    case "veo3.1": return resolution === "4k" ? (audio ? 0.60 : 0.40) : (audio ? 0.40 : 0.20);
    case "pixverse-v6":
      return resolution === "1080p" ? (audio ? 0.115 : 0.090)
        : resolution === "720p" ? (audio ? 0.060 : 0.045)
        : resolution === "540p" ? (audio ? 0.045 : 0.035)
        : (audio ? 0.035 : 0.025);                                            // 360p
    case "grok-imagine": return resolution === "720p" ? 0.07 : 0.05;          // 480p; +$0.002/img input fee not in the estimate
    case "wan-2.5": return resolution === "1080p" ? 0.15 : resolution === "720p" ? 0.10 : 0.05; // 480p; native audio same price
    case "hailuo-02": return 0.08;                                            // fixed 6s @ 1080p, single rate
    case "seedance-2": return resolution === "1080p" ? 0.682 : resolution === "720p" ? 0.3024 : 0.134; // 480p≈; token-priced, per-sec est at 16:9
  }
}

/** Live total for a batch: count × seconds × per-second rate. */
export function videoPriceUsd(model: GenVideoModel, opts: { seconds: number; resolution: string; audio: boolean; count: number }): number {
  return opts.count * opts.seconds * videoRateUsdPerSec(model, opts.resolution, opts.audio);
}

export const genRequest = z
  .object({
    projectId: z.string().min(1).max(64),
    // when set, the result attaches to this shot; else it lands unattached
    shotId: z.string().min(1).max(64).nullish(),
    // i2v source: a specific owned Generation's image to animate (Gen space
    // upload→animate). Server-validated owner+project; not a client URL (D19).
    sourceGenerationId: z.string().min(1).max(64).nullish(),
    // optional end frame for i2v (interpolate source→tail). Same trust boundary.
    tailGenerationId: z.string().min(1).max(64).nullish(),
    // whole-clip reference video (Seedance 2.0 reference_video). Server-validated
    // owner+project+video-ext, like sourceGenerationId. Only used by video plans.
    referenceVideoGenerationId: z.string().min(1).max(64).nullish(),
    prompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
    entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
    // Phase C: { [entityId]: variantId } — which named variant each @mention
    // selected. Absent → all mentions condition on the entity's base refs
    // (backward-compat). Both key and value are bounded so a malformed id can
    // never reach the worker and silently spend on a degraded generation.
    variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),
    count: z.number().int().min(1).max(MAX_GEN_COUNT),
    kind: z.enum(GEN_KINDS).default("image"),
    model: z.string().min(1).max(40).default("seedream"),
    // REQUIRED double-submit key — every spend request must carry one so it ALWAYS
    // flows through the dedup machinery (startGen pre-check + the partial-unique index);
    // a keyless request could otherwise bypass dedup and double-charge. Callers use
    // tpl:<templateId>:<runId>, per-click keys for direct Studio actions, cowork:<cardId>
    // (exactly-once-ever), or batch:<logical hash>:attempt:<attempt hash>. Never omit it.
    idempotencyKey: z.string().min(1).max(80),
    // cowork tag: when set, this gen belongs to a Cowork thread — startGen persists it
    // onto GenJob.threadId so the worker can tag the Generation and the studio views can
    // filter cowork drafts out. Bounded like the other ids.
    threadId: z.string().min(1).max(64).nullish(),
    // video controls (optional overrides; absent → the model's videoDefaults).
    // Each is validated against the chosen model's option set in the refine below.
    durationSeconds: z.number().int().min(1).max(60).nullish(),
    resolution: z.string().max(12).nullish(),
    // shape. Shared by BOTH kinds (#642): video validates against the video model's
    // aspectRatios, image against GEN_IMAGE_MODEL_OPTIONS. Absent → the kind's default
    // (image: 1:1, unchanged from the pre-#642 fixed square).
    aspectRatio: z.string().max(12).nullish(),
    fps: z.number().int().min(1).max(120).nullish(),
    audio: z.boolean().nullish(),
  })
  .strict()
  // model must match the kind's menu — an unknown video model must never reach
  // the worker and silently spend on a fallback (money safety).
  .superRefine((v, ctx) => {
    // Phase C: every variantSel key must be an @mentioned entity. A selection for an
    // entity not in entityIds is an inconsistent request the worker would ignore — and
    // with an empty entityIds it could still spend as unconditioned t2i. Reject it
    // before it can be persisted or spent (validate-before-spend).
    if (v.variantSel) {
      for (const k of Object.keys(v.variantSel)) {
        if (!v.entityIds.includes(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variantSel"], message: "variantSel references an entity that isn't @mentioned" });
      }
    }
    const menu: readonly string[] = v.kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
    if (!menu.includes(v.model)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: `model "${v.model}" is not valid for ${v.kind}` });
    }
    // an end frame (tail) is only valid for a video model that supports it — never
    // enqueue (and later pay for) a clip whose model would silently ignore it.
    if (v.tailGenerationId) {
      const supportsTail = v.kind === "video" && GEN_VIDEO_MODEL_INFO[v.model as GenVideoModel]?.tail === true;
      if (!supportsTail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "this model doesn't support an end frame" });
      // #646: an end frame is meaningless without a start frame, and the worker resolves the
      // start frame from EXACTLY two places (apps/worker/src/jobs/gen.ts:641-663): an explicit
      // sourceGenerationId, else the shot's latest still via shotId. With neither, the worker
      // short-circuits the tail lookup — the end frame vanishes and the merchant pays for an
      // ordinary clip. Reject the shape here, before anything is reserved.
      if (!v.sourceGenerationId && !v.shotId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "an end frame needs a start frame — pick a source image, or a shot that has one" });
      }
      // first+last frames and whole-clip reference video are mutually exclusive scenarios for
      // the engine (same rule the provider enforces pre-spend).
      if (v.referenceVideoGenerationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "an end frame can't be combined with a reference video" });
      }
    }
    // every chosen video control must be in the model's option set — a value the
    // fal endpoint would reject (or a more expensive one than priced) must never
    // reach the worker and spend.
    if (v.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(v.model)) {
      const o = GEN_VIDEO_MODEL_OPTIONS[v.model as GenVideoModel];
      const bad = (path: string, msg: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg });
      if (v.durationSeconds != null && !o.durations.includes(v.durationSeconds)) bad("durationSeconds", "duration not available for this model");
      if (v.resolution && !o.resolutions.includes(v.resolution)) bad("resolution", "resolution not available for this model");
      if (v.aspectRatio && !o.aspectRatios.includes(v.aspectRatio)) bad("aspectRatio", "aspect ratio not available for this model");
      if (v.fps != null && !o.fps.includes(v.fps)) bad("fps", "fps not available for this model");
      if (v.audio === false && !o.audioToggle) bad("audio", "this model can't turn audio off");
      if (v.count > o.maxCount) bad("count", "too many clips for this model");
    }
    // #642: same gate on the image side — a shape the image engine can't produce must
    // never reach the worker and spend. (Price is unaffected: the image engine bills per
    // image regardless of shape, so every option below costs exactly the same.)
    if (v.kind === "image" && (GEN_MODELS as readonly string[]).includes(v.model)) {
      const o = GEN_IMAGE_MODEL_OPTIONS[v.model as GenModel];
      if (v.aspectRatio && !o.aspectRatios.includes(v.aspectRatio)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aspectRatio"], message: "aspect ratio not available for this model" });
      }
      if (v.count > o.maxCount) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "too many images for this model" });
      }
    }
    if (v.referenceVideoGenerationId) {
      if (v.kind !== "video") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceVideoGenerationId"], message: "reference video is only valid for video generation" });
      if (v.model !== REFERENCE_VIDEO_MODEL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "reference video requires Seedance 2.0 Fast" });
      if (v.durationSeconds != null && v.durationSeconds !== GEN_VIDEO_SECONDS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "reference video output is fixed at 5 seconds" });
      }
    }
  });
export type GenRequest = z.infer<typeof genRequest>;

export const genJobData = z.object({ genJobId: z.string().min(1).max(64) }).strict();
export type GenJobData = z.infer<typeof genJobData>;

export const GEN_QUEUE = "gen";
export const GEN_DLQ = `${GEN_QUEUE}.dlq`;

/** Otto 深度研究队列名（研究 S3）。approve 动作把 { jobId } 发到这个队列;worker
 *  注册消费者 handleResearch。 */
export const RESEARCH_QUEUE = "research";
export const RESEARCH_DLQ = `${RESEARCH_QUEUE}.dlq`;

/** Research queue job payload — just the ResearchJob id; the worker owner-scopes everything off it. */
export const researchJobData = z.object({ jobId: z.string().min(1).max(64) }).strict();
export type ResearchJobData = z.infer<typeof researchJobData>;

/**
 * RESEARCH_QUEUE_POLICY — **retryLimit: 0 is a MONEY-SAFETY decision** (Otto research S3).
 *
 * A research run spends real credits (LLM tokens, metered by withLlmBudget in the worker). If a
 * run fails, it must NOT auto-retry — a retry could re-enter the spend path. Instead the card is
 * marked "failed" and the user re-approves (a fresh card → a fresh refId), so a human is always in
 * the loop before credits are spent again. The worker also CAS-gates status QUEUED→RUNNING so any
 * pg-boss redelivery is a no-op; retryLimit:0 is belt-and-suspenders on top of that.
 *
 * expireInSeconds is generous — a deep research run does many sequential LLM turns + page reads.
 */
export const RESEARCH_QUEUE_POLICY = {
  retryLimit: 0,
  expireInSeconds: 60 * 30,
  deadLetter: RESEARCH_DLQ,
} as const;
export const GEN_RETRY_LIMIT = 2;
export const GEN_QUEUE_POLICY = {
  retryLimit: GEN_RETRY_LIMIT,
  retryBackoff: true,
  // base seconds for the retry backoff. WITHOUT this, pg-boss defaults retry_delay=0, which
  // makes `retryBackoff` a silent no-op (start_after = now()) — a failed paid gen would retry
  // INSTANTLY (hammering fal on a transient 5xx). With it, retries are spaced (30s, then grows).
  retryDelay: 30,
  // > the longest realistic fal call so a still-running gen is never expired +
  // redelivered (which would let the duplicate-delivery fail-closed wrongly FAIL an
  // active paid job). Both web (dispatch) and worker (consumer) create the queue
  // with THIS policy, so boot order can't leave them split.
  expireInSeconds: 60 * 20,
  deadLetter: GEN_DLQ,
} as const;
