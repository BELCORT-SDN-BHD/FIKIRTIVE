/**
 * #775 —— 变体政策:三个「方向」到底有没有分开。
 *
 * 只提醒,不是硬拦截:三个「方向」如果都在同一条轴上摆,商家看到的是同一个想法说了
 * 三遍,那不是选择。这里只**提醒**,永远不改写、不拒绝、不替商家砍掉一个方向 ——
 * Otto 用人话把提醒转述过去,要不要改是商家的事。
 */

/**
 * 变体轴 —— 两个方向真正「不同」是指它们在**哪一件事**上不同。
 * 一个轴一次只该被一个方向占用。
 */
export const VARIANT_AXES = ["composition", "mood", "motion", "setting"] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

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
