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
 * ── 判据的两个等级(复审 P2-1 / P2-2,2026-09-15)────────────────────────────────
 *
 * 一句话要绑住「这条对话正在做的那张图」,只有两条路,而这两条路**分量不同**:
 *
 *   ① **明确指着那张图**(`EXPLICIT_IMAGE_DEICTICS`)—— "this photo" / "edit this" /
 *      「这张」/ "gambar ni"。他把手指按在那张图上了,再没有第二种读法。
 *   ② **接续副词 + 指向已有东西的动词**(`CONTINUATION_ADVERBS`)—— "now i want" /
 *      "now add" / "now change"。走查原话就在这一档,但它本身**不**说明对象是哪一件:
 *      「now i want a poster for the raya sale」同样长这个样子。
 *
 * 分量不同,是因为它们与「我要一张新的」这句否决票相遇时该有不同的结果(P2-1):
 * 「add a new hat to this photo」里的 new 修饰的是帽子,不是交付物 —— 第 ① 类压得过
 * **软**否决(形态规则、光秃秃的「新的」/「baru」)。但压不过**硬**否决
 * (`IMAGE_FRESH_START_SIGNALS`:"brand new" / "start over" / 「全新」…):那几句是他
 * 明说要另一件交付物,而绑一张他刚说了不要的底图,钱已经花掉了。
 *
 * 第 ② 类反过来要**多一道闸**(P2-2):它得真的指着已有的东西(it / this / that /
 * the same / 这张…),或者至少没在同一句里点名一件新交付物(a poster / a flyer /
 * three banners…)。否则「now i want a poster for the raya sale」会把上一张猫图绑进
 * 一次付费生成 —— 与 FC-2 同一类错,方向相反。
 *
 * 马来语与中文按本地商家真会打出来的写法收,不做词形还原:`includes` 命中的是子串。
 */
export const EXPLICIT_IMAGE_DEICTICS: Record<string, readonly string[]> = {
  en: [
    "this image", "this picture", "this photo",
    "that image", "that picture", "that photo",
    "same image", "same picture", "same photo",
    "edit this", "change this",
    "add to this", "add to it",
  ],
  zh: ["这张", "那张", "同一张", "在这基础上", "改这"],
  ms: ["gambar ni", "gambar ini", "gambar tadi", "yang ini"],
};

/**
 * 第 ② 类:接续副词。只收指向已有东西的动词(要 / 加 / 改),不收 "now make" / "now put"
 * ——「now make a poster」「now put together a carousel」都是一次全新的请求。
 * 只有英文有这一档:中文与马来语那几条剩下的全是指代(「这张」「gambar ni」)。
 */
export const CONTINUATION_ADVERBS: readonly string[] = [
  "now i want", "now i wan", "now add", "now change",
];

/** 两类合起来 —— 「这句话里有没有任何继承信号」。判定次序见 `decideImageContinuation`。 */
export const IMAGE_CONTINUATION_SIGNALS: Record<string, readonly string[]> = {
  ...EXPLICIT_IMAGE_DEICTICS,
  adverbs: CONTINUATION_ADVERBS,
};

/**
 * ── 硬否决:他要的是**另一件东西**(编排者 2026-09-16 裁定的两类)──────────────────
 *
 * 两类,合起来压过一切,包括明确指代:
 *   (a) **点名另一件交付物** —— 「a new poster」「another one」「一张新的海报」「poster baru」。
 *   (b) **否掉手上这一张** —— 「这张不行」「重做」「forget this」「next one」「buat yang lain」。
 *
 * 判交付物**只认交付物名词**,元素名词永不在列:logo / sticker / hat / menu / cover /
 * frame / background 是图**里**的东西。「add a logo to this photo」是在这张图上加个 logo,
 * 不是另起一张;把 logo 当交付物,就会把普通修图判成重做 —— 这一版修的正是那个。
 */
const DELIVERABLE_EN = "poster|flyer|banner|carousel|ad|design|video|clip|picture|image|photo|pic";
const DELIVERABLE_ZH = "海报|横幅|广告|设计|视频|图";
const DELIVERABLE_MS = "poster|banner|iklan|video|gambar";

/** (a) 点名另一件交付物 —— 三种语言同一份名词表(「decide alike」)。 */
export const HARD_NEW_DELIVERABLE_PATTERNS: readonly RegExp[] = [
  // 「a new poster」「two new clips」「a new one」
  new RegExp(`\\b(?:a|an|another|one|two|three|four|five|six|\\d+)\\s+new\\s+(?:[a-z-]+\\s+){0,1}(?:${DELIVERABLE_EN}|one)s?\\b`),
  // 「another poster」「another one」
  new RegExp(`\\banother\\s+(?:[a-z-]+\\s+){0,1}(?:${DELIVERABLE_EN}|one)s?\\b`),
  // 中文闭合说法
  new RegExp(`一张新的(?:${DELIVERABLE_ZH})`),
  /做一张新的|另做一张|再做一张|再来一张|全新|重新做一张|重新来一张|从头做/,
  // 马来语
  new RegExp(`(?:${DELIVERABLE_MS})\\s+baru`),
  /gambar baharu|mula semula|buat yang lain/,
];

/**
 * (b) 否掉手上这一张 —— 他先说「这张不行 / 够了 / 算了」,再说下一句。
 *
 * 这一类是上一版最贵的漏网:没有它,「这张不行,重做」里的「这张」被当成指代,
 * 于是把**他刚否掉的那张**绑成编辑底图,而这一单是要花钱的。
 */
export const DISMISSAL_SIGNALS: Record<string, readonly string[]> = {
  en: [
    "forget this", "scrap this", "skip this", "next one",
    "start over", "start fresh", "from scratch", "brand new",
  ],
  zh: ["不行", "不好", "不要了", "重做", "重来"],
  ms: ["tak jadi", "lupakan"],
};

/**
 * 两个**带条件**的闭合说法 —— 同一串字在「另起一张」和「图里换一件东西」两种句子里都出现,
 * 所以它们各自带一条紧邻上下文的判据,而不是靠再堆几个词组。
 *
 * ·「换一张」:紧挨在前面是名词就不是闭合说法 ——「这张图的背景换一张」是换背景,
 *   「换一张试试」才是另起一张。用「句首或标点/空白之后」近似「前面没有名词」。
 * ·「satu lagi」:前面是 tambah/tambahkan 就是「再加一只」——
 *   「tambah satu lagi kucing dalam gambar ni」是往图里加只猫,不是再来一张。
 */
function hitsConditionalHardForms(text: string): boolean {
  if (/(?:^|[，,。.！!？?；;：:\s])换一张/.test(text)) return true;
  if (/\bsatu lagi\b/.test(text) && !/\btambah\w*\s+satu lagi\b/.test(text)) return true;
  return false;
}

/**
 * **软**否决 —— 「新的 / baru / a new …」这一档:认不出 new 在修饰什么。
 *
 * 认不出来时默认投 fresh(= 这条修改之前的行为);可一旦同一句里他已经明确指着那张图,
 * 那个歧义就消失 —— 指代赢(它排在软否决之前)。
 */
export const SOFT_FRESH_START_SIGNALS: Record<string, readonly string[]> = {
  zh: ["新的"],
  ms: ["baru"],
};

/** 软否决的形态判据:不定冠词 / 数词 + new + 任意名词。只对英文建。 */
export const IMAGE_FRESH_START_PATTERNS: readonly RegExp[] = [
  /\b(?:a|an|another|one|two|three|four|five|six|\d+)\s+(?:brand[\s-]*)?new\b/,
];

/**
 * 「这句话点名了一件新交付物吗」—— **只在第 ② 类(接续副词)里问**(编排者裁定:
 * 从全局位置搬回来)。
 *
 * 放回来的理由是它在全局位置会杀掉普通修图:「make this photo into a poster」
 * 「add a logo to this photo」都点着交付物名词,可它们是拿**这张图**去做那件东西 ——
 * 指代已经说明了底图是哪一张,卡上也会把它作为 Base image 亮出来。
 * 只有在没有指代、单靠一个「now …」起手时,点名交付物才说明他要的是另一件。
 *
 * 名词表与硬否决共用同一份(三种语言并列),元素名词永不在列。
 */
export const NEW_DELIVERABLE_PATTERN = new RegExp(
  `(?:\\b(?:a|an|another|some|one|two|three|four|five|six|\\d+)\\s+(?:[a-z][a-z-]*\\s+){0,2}(?:${DELIVERABLE_EN})s?\\b)` +
    `|(?:一[张个幅]?(?:[^，,。.！!？?]{0,4})?(?:${DELIVERABLE_ZH}))` +
    `|(?:\\b(?:${DELIVERABLE_MS})\\b)`,
);

export type ImageContinuationDecision = "continue" | "fresh";

function hits(table: Record<string, readonly string[]>, text: string): boolean {
  for (const phrases of Object.values(table)) {
    for (const phrase of phrases) if (text.includes(phrase)) return true;
  }
  return false;
}

/** 明确指着那张图(第 ① 类)。 */
function hitsExplicitDeictic(text: string): boolean {
  return hits(EXPLICIT_IMAGE_DEICTICS, text);
}

/** 硬否决:(a) 点名另一件交付物,或 (b) 否掉手上这一张。压过一切,包括明确指代。 */
function hitsHardFreshStart(text: string): boolean {
  if (hits(DISMISSAL_SIGNALS, text)) return true;
  if (HARD_NEW_DELIVERABLE_PATTERNS.some((re) => re.test(text))) return true;
  return hitsConditionalHardForms(text);
}

/** 软否决:认不出 new 在修饰什么。 */
function hitsSoftFreshStart(text: string): boolean {
  if (hits(SOFT_FRESH_START_SIGNALS, text)) return true;
  return IMAGE_FRESH_START_PATTERNS.some((re) => re.test(text));
}

/** 第 ② 类:接续副词出现了吗。 */
function hitsContinuationAdverb(text: string): boolean {
  return CONTINUATION_ADVERBS.some((p) => text.includes(p));
}

/** 他在这句话里点名了一件新交付物吗。 */
function namesNewDeliverable(text: string): boolean {
  return NEW_DELIVERABLE_PATTERN.test(text);
}

/**
 * 这一张图片提案,要不要把「这条对话此刻正在做的那张图」当成编辑底图。
 *
 * 判据次序即优先级,每一层都有它自己的理由:
 *   1. 没有「正在做的那张图」 ⇒ 无从继承;
 *   2. 商家这一轮自己挂了图 ⇒ 以他挂的为准(既有行为逐字不动);
 *   3. **硬**否决 ⇒ 不继承(连指代都压得过):(a) 点名另一件交付物,或 (b) 否掉手上这一张;
 *   4. **明确指代** ⇒ 继承 —— 同一句里出现交付物名词也照样继承:
 *      「make this photo into a poster」是拿**这张**去做海报,底图是哪一张他已经说了,
 *      而卡上还会把它作为 Base image 亮出来;
 *   5. **软**否决:认不出 new 在修饰什么 ⇒ 不继承(投向今天的行为);
 *   6. 第 ② 类:接续副词 —— 只有在**没点名新交付物**时才继承;
 *   7. 读不出任何信号 ⇒ 不继承(今天的行为)。
 *
 * ── 这条阶梯的已知上限(编排者 2026-09-16 裁定,不再逐句加词)────────────────────
 * 词组阶梯覆盖不了三种语言的意图。**完全没有指代**的句子(「same but blue」
 * 「背景太暗了」「ok, tukar background」)读不出来,一律落到 fresh —— 那正是这条修改
 * 之前主干的行为,不是新风险。反过来判错成 continue 的那一侧,代价被卡面兜住:
 * 底图带着回执(Base image)出现在确认卡上,商家在付钱之前看得见、改得掉。
 * 后续候选做法:让模型判「是不是接着这张改」,并把判断回显到卡上。
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
  if (hitsHardFreshStart(text)) return "fresh";
  if (hitsExplicitDeictic(text)) return "continue";
  if (hitsSoftFreshStart(text)) return "fresh";
  if (!hitsContinuationAdverb(text)) return "fresh";
  return namesNewDeliverable(text) ? "fresh" : "continue";
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
