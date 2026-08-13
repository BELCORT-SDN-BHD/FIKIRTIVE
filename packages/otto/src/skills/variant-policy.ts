/**
 * #775 —— 变体政策:一次给商家几个**方向**,以及那几个方向到底有没有分开。
 *
 * 两件事,都不是硬拦截:
 *
 *   ① **几个**。数字取自铸卡那一侧真做得到的那个数,不是我们希望的那个数 ——
 *      视频恒为 1(`buildProposeCard` 只对图片读 `count`,视频永远单条片),图片收进
 *      `MAX_GEN_COUNT`。抄一个自己的上限就是「说的」与「做的」分家。
 *
 *   ② **分没分开**。三个「方向」如果都在同一条轴上摆,商家看到的是同一个想法说了三遍,
 *      那不是选择。这里只**提醒**,永远不改写、不拒绝、不替商家砍掉一个方向 ——
 *      Otto 用人话把提醒转述过去,要不要改是商家的事。
 */
import { MAX_GEN_COUNT } from "@fikirtive/core";

/**
 * 变体轴 —— 两个方向真正「不同」是指它们在**哪一件事**上不同。
 * 一个轴一次只该被一个方向占用。
 */
export const VARIANT_AXES = ["composition", "mood", "motion", "setting"] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

/** 商家没说要几个时给几个方向。落在菜单里(测试钉着)。 */
export const DEFAULT_VARIANT_COUNT = 3;

/**
 * 这一趟真能给几个方向。
 *
 * 视频那一格不是政策选择,是事实:`buildProposeCard` 只在 `kind === "image"` 时读
 * `count`,视频卡的 `params.count` 恒为 1。这里回 1,与卡面永远说同一句话。
 */
export function variantCountFor(kind: "image" | "video", asked?: number): number {
  if (kind === "video") return 1;
  if (typeof asked !== "number" || !Number.isFinite(asked)) return DEFAULT_VARIANT_COUNT;
  return Math.min(Math.max(Math.trunc(asked), 1), MAX_GEN_COUNT);
}

export type VariantItem = { axis?: VariantAxis; prompt: string };

/**
 * 这一组方向有没有真的分开。回的是**提醒**,不是判决 —— 空数组 = 没什么可说的。
 * 永不抛:一个提醒函数把整轮对话弄崩,比不提醒糟得多。
 */
export function checkVariantSet(items: readonly VariantItem[]): string[] {
  const notes: string[] = [];
  if (items.length < 2) return notes;

  // 同一条轴上摆了两个方向 —— 它们会读起来像同一个想法。
  const seenAxis = new Set<VariantAxis>();
  const repeated = new Set<VariantAxis>();
  for (const it of items) {
    if (!it.axis) continue;
    if (seenAxis.has(it.axis)) repeated.add(it.axis);
    seenAxis.add(it.axis);
  }
  for (const axis of repeated) {
    notes.push(
      `Two of these options only differ in ${axis} — they will read as the same idea twice. Move one of them onto a different axis (${VARIANT_AXES.filter((a) => a !== axis).join(", ")}).`,
    );
  }

  // 逐字相同 —— 那不是两个方向。
  const seenPrompt = new Set<string>();
  let duplicated = false;
  for (const it of items) {
    const key = it.prompt.trim().toLowerCase();
    if (!key) continue;
    if (seenPrompt.has(key)) duplicated = true;
    seenPrompt.add(key);
  }
  if (duplicated) {
    notes.push("Two of these options say exactly the same thing — that is one idea offered twice, not a choice.");
  }

  return notes;
}
