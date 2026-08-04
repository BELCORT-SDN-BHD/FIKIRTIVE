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
