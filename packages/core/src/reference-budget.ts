/**
 * reference-budget —— 「这一趟引擎真会收到几张参考图」的**唯一**算法。
 *
 * 为什么要有这个模块:卡面必须在**批准前**告诉商家有多少张参考照真会上车(#619 E-5),
 * 而真相住在 worker 里。两处各算各的,就是这个仓库反复重学的「说的与做的失同步」。
 * 所以这里把 worker 的选片规则抽成一个纯函数,卡面调它,worker 侧的等价测试
 * (`apps/worker/src/jobs/gen-reference-budget.test.ts`)再拿真 `handleGen` 发出去的
 * `inputImageUrls` / `refImageUrls` 长度跟它逐例对表 —— 规则一旦漂移,那条测试当场红。
 *
 * **真相出处**(`apps/worker/src/jobs/gen.ts`):
 *   - 元素参考照 round-robin,聚合上限 = `conditioningCap(...)` —— worker 与本模块调的是
 *     **同一个函数**,所以「上限是多少」结构上不可能长成两套;
 *   - image 分支把编辑底图 `unshift` 到第 0 位 —— **在上限之外再加一张**,
 *     所以带底图时引擎收到的是「截断后的元素图 + 1」;
 *   - video 分支(#785)把同一批截断后的元素图作为 `refImageUrls` 交给适配器,发成
 *     role:"reference_image" 部件 —— 只在纯文生视频那一档(见 `videoReferencesRide`)。
 *
 * 本模块不 reserve、不 settle、不定价、不调 provider:它只数数。
 */
import { MAX_CONDITIONING_IMAGES } from "./refgen.js";
import { MAX_VIDEO_IMAGE_PARTS } from "./gen.js";

export type ReferenceBudget = {
  /** 引擎这一趟**真会收到**的参考图张数(截断后的元素图 + 编辑底图)。 */
  used: number;
  /** 商家这一轮**提供**的参考照总数(元素活图 + 全部挂图)。 */
  total: number;
  /** 元素参考照被引擎上限截掉了(卡面必须在花钱前说)。 */
  truncated: boolean;
};

/** video 这一单的场景形状 —— 决定元素参考照能不能上车,以及还剩几个名额。 */
export type VideoReferenceShape = {
  /** 这一单有没有首帧(i2v 起始帧 / 分镜首帧)。 */
  hasVideoStartFrame?: boolean;
  /** 这一单有没有末帧。 */
  hasVideoTailFrame?: boolean;
  /** 这一单有没有整段参考视频。 */
  hasReferenceVideo?: boolean;
};

export type ReferenceBudgetInput = VideoReferenceShape & {
  kind: "image" | "video";
  /** 每个 @元素在 worker 口径下的活参考照数量,顺序 = `GenJob.entityIds` 顺序。
   *  worker 的口径:被 @ 的变体数该变体的图,否则数 base 图(`variantSel[id] ?? null`)。 */
  perEntityLiveCounts: number[];
  /** 这张卡带走了编辑底图吗(image 卡的 `sourceGenerationId`)。 */
  hasBaseImage: boolean;
  /** 商家这一轮挂进来的图片总数 —— 只有第一张会成为底图,其余只参与理解。 */
  attachedImageCount: number;
};

/**
 * #785 —— @元素参考照**这一档视频能不能带**。
 *
 * 引擎把首帧(i2v)、首+末帧、整段参考视频当成**互斥的场景**(见
 * `packages/generation/src/byteplus.ts` 的场景闸;那条互斥是 #646 T5 实测得来的)。
 * 多素材参考是**第四个**场景 —— 官方叫 reference-to-video:一段文字 + 一组参考素材。
 * 把它和首帧混在一趟里,我们没有任何一手证据说引擎接受,而这个仓库的规矩是没核过的
 * 组合不许发。所以判据只有一条:**纯文生视频**(没有首帧、没有末帧、没有参考视频)
 * 才带元素参考照。
 *
 * 判据必须住在一处:卡面(批准前说几张)、worker(真送几张)、适配器(付费前的互斥闸)
 * 读的都是这个函数。
 */
export function videoReferencesRide(shape: VideoReferenceShape): boolean {
  return !shape.hasVideoStartFrame && !shape.hasVideoTailFrame && !shape.hasReferenceVideo;
}

/**
 * 这一趟 round-robin 选片的**聚合上限**。
 *
 * image:引擎收 ≤14 张,worker 历来定 `MAX_CONDITIONING_IMAGES`(10),编辑底图另算。
 * video(#785):`image_url` 部件总共只有 `MAX_VIDEO_IMAGE_PARTS`(9)个名额,而首帧/末帧
 *   占的是同一批名额 —— 所以元素照的名额是「9 减去这一单要用的帧数」。带帧的档现在一张
 *   元素照都不带(`videoReferencesRide` 为 false ⇒ 0),减法照写不省:哪天场景组合被官方
 *   核实成可混,只改 `videoReferencesRide` 一处,名额自动对得上。
 */
export function conditioningCap(input: VideoReferenceShape & { kind: "image" | "video" }): number {
  if (input.kind !== "video") return MAX_CONDITIONING_IMAGES;
  if (!videoReferencesRide(input)) return 0;
  const frames = (input.hasVideoStartFrame ? 1 : 0) + (input.hasVideoTailFrame ? 1 : 0);
  return Math.max(0, MAX_VIDEO_IMAGE_PARTS - frames);
}

export function referenceBudget(input: ReferenceBudgetInput): ReferenceBudget {
  const cap = conditioningCap(input);

  // round-robin,逐条镜像 worker 的 `pickRoundRobin` —— 早到的元素带很多图时,不能把
  // 后面 @ 到的元素挤掉(那等于花钱做出来的东西少了一个它)。
  let taken = 0;
  for (let round = 0; taken < cap; round++) {
    let progressed = false;
    for (const liveCount of input.perEntityLiveCounts) {
      if (round >= liveCount) continue;
      taken += 1;
      progressed = true;
      if (taken >= cap) break;
    }
    if (!progressed) break;
  }

  const elementTotal = input.perEntityLiveCounts.reduce((sum, n) => sum + n, 0);

  if (input.kind === "video") {
    // 视频这一支没有「编辑底图」这回事:首帧走 `sourceGenerationId` 那条独立的路,它是
    // **帧**不是参考照,卡面另有一句话说它(`videoAspectChip`)。所以 total 只数元素照。
    // 带帧的档 cap=0 ⇒ used=0、truncated=(商家给了照片却一张都上不了车)—— 卡面于是照实
    // 说出来,而不是像 #785 之前那样连数字都不给。
    return { used: taken, total: elementTotal, truncated: taken < elementTotal };
  }

  // 底图是 unshift 进去的,不占元素的上限名额。
  const base = input.hasBaseImage ? 1 : 0;
  return {
    used: taken + base,
    total: elementTotal + Math.max(input.attachedImageCount, base),
    truncated: taken < elementTotal,
  };
}
