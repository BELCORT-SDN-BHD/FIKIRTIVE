/**
 * image-continuation —— 「这张图接着刚才那张改」还是「重开一张新的」,以及由此而来的
 * **输入绑定**。纯函数,零 I/O(与 `video-intent.ts` 同一条纪律)。
 *
 * ── 为什么这个模块存在(FC-2,staging 2026-09-14 Founder 自己的画布)───────────────
 * 对话里刚交付了一张猫 + 杯子的图,商家紧接着打:
 *   「now i wan @Xinyi hold the cat and pet it while the cat is drinking with the product」
 * 铸出来的图片卡 `entityIds=[Xinyi]`、`sourceGenerationId=null` —— **刚才那张图根本
 * 不是这一单的输入**。商家读到的结果是「the cat and the product is wrong from the
 * original」;他把原图重新挂一次之后,同一句话铸出来的卡才同时带上原图与演员。
 *
 * 根因不在模型的措辞,而在**结构**:这一轮的图片槽(`ctx.sourceGenerationIds`)只装
 * 「商家这一轮自己挂的 / `@` 到的」那几件(`apps/web/app/api/otto/stream/route.ts` 的
 * `validateOttoTurnReferences` 入参),而 `proposeInput` 里**一个媒体字段都没有** ——
 * 于是「这条对话此刻正在做的那张图」没有任何一条路进得了提案。缺的不是一句提示词,
 * 是一条绑定。
 *
 * ── 三条纪律(照抄 `video-intent.ts`,理由相同)──────────────────────────────────
 *   ① **不预判商家**。读不出信号 ⇒ 逐字维持今天的行为(不继承)。新绑定只在商家
 *      自己的话里能读出「接着刚才那张」时才发生。
 *   ② **不静默做对也不静默做错**。继承发生时,那张图带着它的回执(`mediaReferences`,
 *      角色 `Base image`)出现在确认卡上 —— 商家在按下 `Generate · N credits`
 *      **之前**就看得见「正在改的是这一张」,读错了当场就能说「不,重开一张」。
 *      钱在批准之后才动,所以一次误判的代价是一句话,不是一次付费运行。
 *   ③ **id 永远不来自模型**。模型碰不到 `ctx.currentImage`,它由服务端按
 *      owner + thread 查出来(`apps/web/lib/otto-actions.ts` 的
 *      `loadCurrentThreadImage`),与 `turnEntityIds`(FSE-210)同一条信任边界。
 *
 * 商家自己这一轮挂了图 ⇒ 一律以他挂的为准,这里一格不动:他亲手挂的东西比我们替他
 * 记得的那一张更该上车。
 */
import type { OttoContext } from "../context.js";

/**
 * 「接着屏幕上那张做」的信号。
 *
 * 收的是**泛用的指代与接续标记**(定冠词式的回指、「现在…」这种接续副词、直接点名
 * 「这张图」),不是任何一次走查里的具体名词 —— 按内容词收信号,换一个商家就失效。
 *
 * 马来语与中文按本地商家真会打出来的写法收,不做词形还原:`includes` 命中的是子串。
 */
export const IMAGE_CONTINUATION_SIGNALS: Record<string, readonly string[]> = {
  en: [
    // 「现在…」这一档只收**指向已有东西**的动词(加 / 放 / 改),不收 "now make" ——
    // 「now make a poster for the sale」是一次全新的请求,不是接着这张图改。
    "now i want", "now i wan", "now add", "now put", "now change",
    "this image", "this picture", "this photo", "this one",
    "that image", "that picture", "that photo",
    "same image", "same picture", "same photo",
    "edit this", "edit the", "change this", "change the", "keep the",
    "add to this", "add to it", "instead of",
  ],
  zh: ["这张", "那张", "同一张", "在这基础上", "改这", "现在我要", "现在要", "保留"],
  ms: ["gambar ni", "gambar ini", "gambar tadi", "yang ini", "kekalkan"],
};

/**
 * 「重开一张全新的」的信号 —— **否决票**,压过上面每一条。
 *
 * 为什么否决优先:两边同时命中(「now i want a brand new picture of…」)时,唯一不含糊
 * 的那一半是他明说的「brand new」。继承一张他刚说了不要的底图,做出来的东西与他要的
 * 无关,而这一单已经付过钱了。
 */
export const IMAGE_FRESH_START_SIGNALS: Record<string, readonly string[]> = {
  en: [
    "brand new", "brand-new", "a new picture", "a new image", "a new photo",
    "new picture of", "new image of", "new photo of",
    "another picture of", "another image of", "another photo of",
    "different picture", "separate picture", "start over", "start fresh", "from scratch",
  ],
  zh: ["全新", "重新做一张", "重新来一张", "另做一张", "新的一张", "从头做"],
  ms: ["gambar baru", "gambar baharu", "mula semula"],
};

export type ImageContinuationDecision = "continue" | "fresh";

function hits(table: Record<string, readonly string[]>, text: string): boolean {
  for (const phrases of Object.values(table)) {
    for (const phrase of phrases) if (text.includes(phrase)) return true;
  }
  return false;
}

/**
 * 这一张图片提案,要不要把「这条对话此刻正在做的那张图」当成编辑底图。
 *
 * 判据次序即优先级,每一层都有它自己的理由:
 *   1. 没有「正在做的那张图」 ⇒ 无从继承;
 *   2. 商家这一轮自己挂了图 ⇒ 以他挂的为准(既有行为逐字不动);
 *   3. 他明说要一张**全新**的 ⇒ 不继承(否决票);
 *   4. 他的话里读得出「接着那张」⇒ 继承;
 *   5. 读不出任何信号 ⇒ 不继承(今天的行为)。
 */
export function decideImageContinuation(input: {
  /** 商家这一轮自己打的那句话(`ctx.turnText`)。服务端原样带进来,绝不来自模型。 */
  text?: string | null;
  /** 这一轮他自己挂了图 / `@` 了图吗。 */
  hasAttachedImage: boolean;
  /** 这条对话此刻有没有一张「正在做的图」。 */
  hasCurrentImage: boolean;
}): ImageContinuationDecision {
  if (!input.hasCurrentImage) return "fresh";
  if (input.hasAttachedImage) return "fresh";
  const text = (input.text ?? "").toLowerCase();
  if (!text) return "fresh";
  if (hits(IMAGE_FRESH_START_SIGNALS, text)) return "fresh";
  return hits(IMAGE_CONTINUATION_SIGNALS, text) ? "continue" : "fresh";
}

/**
 * 绑定本体 —— 决定「继承」时,把那张图放进**这一轮的图片槽**,回执一起放进去。
 *
 * 放进 ctx 而不是放进卡,是因为这一路上读图片槽的不止铸卡一处:名额计算
 * (`propose.ts` 的 `referenceBudget`)、卡面披露、付费前的尺寸闸读的都是同一组字段。
 * 在入口把 ctx 归一化一次,下游每一处看到的就是同一份事实 —— 「说的」与「做的」
 * 不可能分家。
 *
 * 视频提案一格不动:FC-2 是图片这一支的缺口,而视频侧挂图的角色另有一套判据
 * (`videoAttachmentRole`),顺手把一张历史图塞进去会改掉付费行为。
 */
export function withContinuedImage<T extends OttoContext>(
  ctx: T,
  input: { kind: "image" | "video" },
): T {
  if (input.kind !== "image") return ctx;
  const current = ctx.currentImage;
  if (!current) return ctx;
  const hasAttachedImage = (ctx.sourceGenerationIds?.length ?? 0) > 0 || !!ctx.sourceGenerationId;
  const decision = decideImageContinuation({
    text: ctx.turnText,
    hasAttachedImage,
    hasCurrentImage: true,
  });
  if (decision !== "continue") return ctx;
  const already = (ctx.mediaReferences ?? []).some((r) => r.generationId === current.generationId);
  return {
    ...ctx,
    sourceGenerationId: current.generationId,
    sourceGenerationIds: [current.generationId],
    mediaReferences: already ? ctx.mediaReferences : [...(ctx.mediaReferences ?? []), current],
  };
}
