/**
 * reference-budget —— 「这一趟引擎真会收到几张参考图」的**唯一**算法。
 *
 * 为什么要有这个模块:卡面必须在**批准前**告诉商家有多少张参考照真会上车(#619 E-5),
 * 而真相住在 worker 里。两处各算各的,就是这个仓库反复重学的「说的与做的失同步」。
 * 所以这里把 worker 的选片规则抽成一个纯函数,卡面调它,worker 侧的等价测试
 * (`apps/worker/src/jobs/gen-reference-budget.test.ts`)再拿真 `handleGen` 发出去的
 * `inputImageUrls` 长度跟它逐例对表 —— 规则一旦漂移,那条测试当场红。
 *
 * **真相出处**(main @ 6b6c537c,`apps/worker/src/jobs/gen.ts`):
 *   - `:519-532` 元素参考照 round-robin,聚合上限 `MAX_CONDITIONING_IMAGES`;
 *   - `:650-659` image 分支把编辑底图 `unshift` 到第 0 位 —— **在上限之外再加一张**,
 *     所以带底图时引擎收到的是「截断后的元素图 + 1」;
 *   - `:636-644` video 分支的 `provider.generateVideo` 只吃 `imageUrl` /
 *     `tailImageUrl` / `refVideoUrl`,**根本不收** `inputImageUrls` —— 元素参考照一张
 *     都到不了视频引擎。
 *
 * 本模块不 reserve、不 settle、不定价、不调 provider:它只数数。
 */
import { MAX_CONDITIONING_IMAGES } from "./refgen.js";

export type ReferenceBudget = {
  /** 引擎这一趟**真会收到**的参考图张数(截断后的元素图 + 编辑底图)。 */
  used: number;
  /** 商家这一轮**提供**的参考照总数(元素活图 + 全部挂图)。 */
  total: number;
  /** 元素参考照被引擎上限截掉了(卡面必须在花钱前说)。 */
  truncated: boolean;
};

export type ReferenceBudgetInput = {
  kind: "image" | "video";
  /** 每个 @元素在 worker 口径下的活参考照数量,顺序 = `GenJob.entityIds` 顺序。
   *  worker 的口径:被 @ 的变体数该变体的图,否则数 base 图(`variantSel[id] ?? null`)。 */
  perEntityLiveCounts: number[];
  /** 这张卡带走了编辑底图吗(image 卡的 `sourceGenerationId`)。 */
  hasBaseImage: boolean;
  /** 商家这一轮挂进来的图片总数 —— 只有第一张会成为底图,其余只参与理解。 */
  attachedImageCount: number;
};

export function referenceBudget(input: ReferenceBudgetInput): ReferenceBudget {
  // video:元素参考照进不了 generateVideo(gen.ts:636-644),不替它编数字。
  if (input.kind !== "image") return { used: 0, total: 0, truncated: false };

  // round-robin,逐条镜像 gen.ts:521-532 —— 早到的元素带很多图时,不能把后面
  // @ 到的元素挤掉(那等于花钱做出来的东西少了一个它)。
  let taken = 0;
  for (let round = 0; taken < MAX_CONDITIONING_IMAGES; round++) {
    let progressed = false;
    for (const liveCount of input.perEntityLiveCounts) {
      if (round >= liveCount) continue;
      taken += 1;
      progressed = true;
      if (taken >= MAX_CONDITIONING_IMAGES) break;
    }
    if (!progressed) break;
  }

  const elementTotal = input.perEntityLiveCounts.reduce((sum, n) => sum + n, 0);
  // 底图是 unshift 进去的,不占元素的上限名额(gen.ts:658)。
  const base = input.hasBaseImage ? 1 : 0;
  return {
    used: taken + base,
    total: elementTotal + Math.max(input.attachedImageCount, base),
    truncated: taken < elementTotal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #774 U2 —— 参考图编号(官方句式 `Define … in <Image_N> as <Subject_N>`)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 引擎输入数组里的**一个槽位** —— 与 `inputImageUrls` 的下标一一对应,
 * 第 i 项就是 `<Image_{i+1}>`。
 *
 * 这个类型是编号的**唯一入口**:调用方只能交出「引擎真收到的那个数组」,
 * 没有第二条路可以凭猜测编号。
 */
export type ReferenceSlot =
  | { kind: "baseImage" }
  | { kind: "entity"; entityId: string; type: "CHARACTER" | "LOCATION" | "PRODUCT" | "BRANDMARK"; name: string };

/** 元素类型 → 官方句式里那个名词(商家看不到这句,它是给引擎的)。 */
const SLOT_NOUN: Record<Extract<ReferenceSlot, { kind: "entity" }>["type"], string> = {
  CHARACTER: "the person",
  LOCATION: "the setting",
  PRODUCT: "the product",
  BRANDMARK: "the logo",
};

/**
 * 纯:把「引擎这一趟真收到的那个数组」翻成官方编号句。
 *
 * ── 为什么编号只能长在这里 ────────────────────────────────────────────────
 * 编错位比不编号更糟:模型会照着编号去认人,`<Image_2>` 一旦指的不是它以为的那张,
 * 串脸串产品就从「可能」变成「必然」,而这条错指令一路走到商家批准后的付费调用。
 *
 * 所以编号**不由**写提示词的一方推算 —— 写提示词的时候,谁有几张活参考照、商家挂没挂
 * 底图、镜头后来被改成了别的元素,统统还不知道。编号只由**真正装那个数组的那段代码**
 * 顺手产出(`apps/worker/src/jobs/gen.ts`,与 `inputImageUrls` 同一个循环),两者
 * 结构上不可能漂移。`apps/worker/src/jobs/gen-reference-budget.test.ts` 跑真的
 * `handleGen`,逐例把这些句子和真发出去的 URL 次序对表。
 *
 * 同一个元素的第二张往后的照片不再重复定义,只挂回它自己的 `<Subject_N>`。
 */
export function referenceMapLines(slots: ReferenceSlot[]): string[] {
  const firstSlotOf = new Map<string, number>();
  return slots.map((slot, idx) => {
    const n = idx + 1;
    if (slot.kind === "baseImage") return `<Image_${n}> is the image being edited.`;
    const first = firstSlotOf.get(slot.entityId);
    if (first === undefined) {
      firstSlotOf.set(slot.entityId, n);
      return `Define ${SLOT_NOUN[slot.type]} in <Image_${n}> as <Subject_${n}>: ${slot.name}.`;
    }
    return `<Image_${n}> is another photo of <Subject_${first}> (${slot.name}).`;
  });
}

/** 纯:把编号句放在商家那段提示词**之前**(官方要求先定义再描述)。空槽位 → 原样返回。 */
export function withReferenceMap(prompt: string, slots: ReferenceSlot[]): string {
  const lines = referenceMapLines(slots);
  return lines.length === 0 ? prompt : `${lines.join(" ")}\n${prompt}`;
}
