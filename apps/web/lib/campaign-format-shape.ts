/**
 * campaign-format-shape — 战役里的「格式名」到底会交付**什么东西、什么形状**。
 *
 * 一张表，两个读者：`campaign-generation-confirm` 用它决定每个条目发出去的 kind + 形状，
 * 确认页用它把同一件事显示给商家看。分成两份手抄副本正是本仓库反复重学的那类缺陷
 * （#642 修复轮 r1 P1 就是投影清单被抄成两份），所以这里只有一份。
 *
 * PURE：无 DB、无 spend、无 I/O。它不是价格 —— 图片按张计价、不分形状，所以这张表
 * 一格都不影响钱（`gen.ts` 的 `GEN_IMAGE_ASPECTS` 注释与 `spend.test.ts` 的同价断言）。
 *
 * 为什么必须有它（#643 T2）：商家在计划里写下 "story"，产品就该给他竖版。在这张表之前，
 * 每一个图片格式 —— story 也好、feed 也好 —— 都交付同一张方图，商家看见的格式名和
 * 实际拿到的东西对不上，而且全程没有一句话解释。
 */

import { GEN_IMAGE_ASPECTS, GEN_IMAGE_DEFAULT_ASPECT, type GenImageAspect } from "@fikirtive/core";

export type CampaignGenKind = "image" | "video";

/** Formats that generate a video clip rather than a still image. Everything else (image,
 *  post, carousel, story, …) prices and generates as an image. The confirm page shows the
 *  resolved kind + unit price for every entry BEFORE the owner confirms, so this mapping is
 *  reviewed, never a hidden charge. NOT a price — the price comes from pricedGenCredits. */
export const VIDEO_FORMATS = new Set(["video", "reel", "reels", "short", "shorts", "clip", "animation", "gif"]);

/**
 * 图片格式 → 交付形状。**只收录形状本身就写在格式名里的那些**；名字没说形状的
 * （post、image、ad、banner…）一律走默认方图，不去猜商家的意图。
 *
 * 竖版 9:16：story / stories —— 平台上的「快拍」位就是整屏竖版；vertical / portrait 是
 *   商家直接把形状写进了格式名。
 * 竖版 4:5 ——**故意不收**：引擎菜单上没有这一格，不为一个平台惯例发明一个给不了的形状。
 * 横版 16:9：banner / cover / landscape。
 * 方图 1:1：feed / post / carousel / square —— feed 位的默认形状（也是全表的默认值，
 *   显式写出来是为了让这张表本身就是那份被复核过的产品决定）。
 */
const FORMAT_ASPECTS: Record<string, GenImageAspect> = {
  // 竖版
  story: "9:16",
  stories: "9:16",
  vertical: "9:16",
  portrait: "9:16",
  // 横版
  banner: "16:9",
  cover: "16:9",
  landscape: "16:9",
  // 方图
  feed: "1:1",
  "feed-image": "1:1",
  post: "1:1",
  carousel: "1:1",
  square: "1:1",
};

function normalizeFormat(format: string): string {
  return format.trim().toLowerCase();
}

/** 这个格式交付的是片子还是图。 */
export function campaignGenKindForFormat(format: string): CampaignGenKind {
  return VIDEO_FORMATS.has(normalizeFormat(format)) ? "video" : "image";
}

/**
 * 这个图片格式会交付的形状。表上没有的格式 → 默认方图。
 *
 * 视频格式返回 null：视频形状由视频侧的选项表决定（T4/T5），不归这张表管。
 * 返回值恒在 `GEN_IMAGE_ASPECTS` 上，所以它不可能把一个引擎收不下的形状送进付费请求。
 */
export function campaignImageAspectForFormat(format: string): GenImageAspect | null {
  if (campaignGenKindForFormat(format) === "video") return null;
  const mapped = FORMAT_ASPECTS[normalizeFormat(format)];
  const aspect = mapped ?? GEN_IMAGE_DEFAULT_ASPECT;
  // 防御：这张表若被改成一个菜单外的值，宁可回默认，也不把它送进付费请求。
  return (GEN_IMAGE_ASPECTS as readonly string[]).includes(aspect) ? aspect : GEN_IMAGE_DEFAULT_ASPECT;
}

/**
 * 片子格式 → 交付形状(#645 T4)。与上面的图片表同一条原则:**只收录形状本身就写在
 * 格式名里的那些**。
 *
 * 竖版 9:16:reel / reels / short / shorts —— 平台上这几个位就是整屏竖版,商家写下
 *   "reel" 要的就是竖版片子。在这之前视频侧根本没有形状映射,战役里的每一条片子都按
 *   默认 16:9 交付 —— 商家看见的格式名和真拿到的东西对不上,而且全程没有一句话解释。
 * 其余片子格式(video / clip / animation / gif)名字没说形状,走视频模型的默认形状,
 *   不去猜商家的意图。
 */
const VIDEO_FORMAT_ASPECTS: Record<string, string> = {
  reel: "9:16",
  reels: "9:16",
  short: "9:16",
  shorts: "9:16",
};

/**
 * 这个片子格式会交付的形状;名字没说形状 ⇒ null(由视频侧的默认档决定,这张表不发明值)。
 * 图片格式同样返回 null —— 形状归上面那张表管,两张表互不越权。
 *
 * `menu` = 视频模型真能给的形状清单(`GEN_VIDEO_MODEL_OPTIONS[...].aspectRatios`)。
 * 映射出的形状若不在菜单上,返回 null 而不是硬送 —— 绝不把一个引擎收不下的形状塞进付费请求。
 */
export function campaignVideoAspectForFormat(format: string, menu: readonly string[]): string | null {
  if (campaignGenKindForFormat(format) !== "video") return null;
  const mapped = VIDEO_FORMAT_ASPECTS[normalizeFormat(format)];
  if (!mapped) return null;
  return menu.includes(mapped) ? mapped : null;
}
