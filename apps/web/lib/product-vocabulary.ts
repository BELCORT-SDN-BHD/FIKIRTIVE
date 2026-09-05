/**
 * product-vocabulary.ts —— 商家读到的**产品名词**的单一源头（global 法 §7.3）。
 *
 * 五个词是产品自己的专有名词，不是普通名词：`Canvas` / `Library` / `Elements` /
 * `Otto IQ` / `Workspace`。它们散在 beta 六面（Home / Create / Library / Brand /
 * Settings / Otto 面板）的界面文案里，每处一份字面量的写法已经漂过一次——`Canvas`
 * 那一个词在 2026-09-04 才刚由 `canvas-title.ts` 收成单源，另外四个仍是手抄。这个
 * 文件把五个词收在一处，`canvas-title.ts` 的画布名也从这里取词。
 *
 * **词的权威**是设计侧的 IA 变更登记
 * （`apps/web/design-system/information-architecture/README.md` §6 Change register，
 * Founder 2026-08-30 逐条裁决）与 Founder 2026-08-22 的 `Brand → Otto IQ` 裁决；
 * 本文件只是把那些裁决抄成机器读得到的形状，不自己造词。改词要先改那份 IA 登记。
 *
 * **不做的事**：这里不管普通名词。`asset`、`project id`、`campaign`（Home 分析里
 * 商家自己在 Meta／TikTok 上跑的广告 campaign）都是真实存在的普通词，不在收口范围；
 * 收口的只有「本该说 A 却说了 B」的那几个被裁掉的**产品名**。
 *
 * 纯常量，无 React／Prisma／server-only —— server component 与 client component 都能用。
 */

/** 商家读到的五个产品名词。写界面文案时引用它，不要手抄字面量。 */
export const PRODUCT_VOCABULARY = {
  /** 创作工作区。数据库模型仍叫 `Project`，但商家面前它永远是 Canvas
   *  （IA README 2026-08-30：「任何内部 legacy Project record 都不能成为 UI concept」）。 */
  canvas: "Canvas",
  /** 找回、整理、重用作品的那一面（IA README 2026-08-30 定的 Library taxonomy）。 */
  library: "Library",
  /** Library 里 Products／Characters／Official avatars／Clothes／Locations 那一支
   *  （IA README 2026-08-30：Reference categories 改称 Elements）。 */
  elements: "Elements",
  /** 产品事实的 canonical owner（Founder 2026-08-22 裁决：Brand IQ → Otto IQ）。 */
  ottoIq: "Otto IQ",
  /** Settings 的两个 scope 之一，也是「这家店」在商家面前的名字
   *  （IA README 2026-08-30：Settings 以 Personal / Workspace 分 scope，
   *  且「不得呈现两套 settings language」）。 */
  workspace: "Workspace",
} as const;

export type ProductWord = keyof typeof PRODUCT_VOCABULARY;

/**
 * 被裁掉的旧产品名。围栏（`__tests__/product-vocabulary-fence.test.ts`）拿这张表去扫
 * beta 六面的界面文案；每一条都要写清**谁在什么时候裁的**，否则它就是某个 agent 的口味。
 *
 * `pattern` 只用整词匹配，所以 `projectId`、`activeProject`、`AssetLineage` 这类标识符
 * 不会命中——围栏管的是商家读到的字，不是变量名。
 */
export const RETIRED_PRODUCT_WORDS: readonly {
  readonly retired: string;
  readonly pattern: RegExp;
  readonly replacedBy: ProductWord;
  readonly ruling: string;
}[] = [
  {
    retired: "Project",
    // 整词的 project / projects / Project / Projects（大小写不敏感）。
    pattern: /\bprojects?\b/i,
    replacedBy: "canvas",
    ruling:
      "IA README §6 Change register，Founder 2026-08-30：「Founder-facing product 不建立 Project 或 Project Brief……任何内部 legacy Project record 都不能成为 UI concept。」",
  },
  {
    retired: "Assets（作为面／分区的名字）",
    // 只拦**大写起头**的分区名形状，不拦普通名词 asset：IA 裁掉的是「一个 Assets surface」，
    // 不是「一件 asset」——那个词在同一份 IA 里自己还在用。
    pattern: /\bAssets\b/,
    replacedBy: "library",
    ruling:
      "IA README §6 Change register，Founder 2026-08-30 Superseded taxonomy：早期的单一 Assets surface 已由 Generation history / Uploads / Favorites / Collections / Elements 取代。",
  },
  {
    retired: "Reference categories",
    pattern: /\breference categor(y|ies)\b/i,
    replacedBy: "elements",
    ruling:
      "IA README §6 Change register，Founder 2026-08-30 Superseded label：Reference categories 后续改称 Library `Elements`。",
  },
  {
    retired: "Brand IQ",
    pattern: /\bbrand\s+iq\b/i,
    replacedBy: "ottoIq",
    ruling: "Founder 2026-08-22 裁决：Brand → Otto IQ。",
  },
];

/** 一段界面文案里命中的旧词（围栏用；命中零条就是干净的）。 */
export function retiredProductWordsIn(copy: string): readonly string[] {
  return RETIRED_PRODUCT_WORDS.filter((word) => word.pattern.test(copy)).map((word) => word.retired);
}
