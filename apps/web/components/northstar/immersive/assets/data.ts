/**
 * 沉浸式 · 资产区(Z9)—— WHATPASS 七章候选的派生数据。
 *
 * 单一源纪律:图片只从 NS_IMAGES 取(nsImage),品牌事实从 ../../_mock 与
 * ../../assets/_data 派生,不新造品牌真相。确定性字面量,零随机、零 Date.now。
 * 本文件只承载「资产区原生页新增候选」需要的示例结构;区外事实(credits/events/
 * brandPreferences/cast 训练)一律经 _store.ts。
 */

import { nsImage } from "@/components/northstar/_mock";
import { BRAND_KIT, GEN_RECORDS, type GenRecord } from "@/components/northstar/assets/_data";

/* ── B-06 资产库自动打标:每条生成物的 AI 标签(内容/颜色/用途) ──────────────
 * 确定性派生自 kind + prompt 关键词,演示「旧图直接搜标签复用省 credits」。 */
export const LIBRARY_TAGS = [
  "Product",
  "Reel",
  "Storyboard",
  "Festive",
  "Menu",
  "Warm tones",
  "Close-up",
  "Behind the scenes",
] as const;
export type LibraryTag = (typeof LIBRARY_TAGS)[number];

export function autoTagsFor(rec: GenRecord): LibraryTag[] {
  const tags: LibraryTag[] = [];
  if (rec.kind === "video") tags.push("Reel");
  if (rec.kind === "storyboard") tags.push("Storyboard");
  if (rec.kind === "image") tags.push("Product");
  const p = `${rec.title} ${rec.prompt}`.toLowerCase();
  if (/box|raya|merdeka|festive|gift/.test(p)) tags.push("Festive");
  if (/menu|card|price/.test(p)) tags.push("Menu");
  if (/macro|close|slice|cross-section/.test(p)) tags.push("Close-up");
  if (/pack|fold|hands|counter|b-roll/.test(p)) tags.push("Behind the scenes");
  tags.push("Warm tones"); // 品牌调性:全城暖调(brand memory「Look & feel」)
  // 去重、保序
  return Array.from(new Set(tags));
}

/** 全库标签频次(筛选条读它,只显示真的有内容的标签)。 */
export function libraryTagCounts(): { tag: LibraryTag; count: number }[] {
  const counts = new Map<LibraryTag, number>();
  for (const rec of GEN_RECORDS) {
    for (const t of autoTagsFor(rec)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return LIBRARY_TAGS.filter((t) => counts.has(t)).map((tag) => ({ tag, count: counts.get(tag)! }));
}

/* ── B-07 受众档案(卖给谁):生成时可带入的目标客群卡 ──────────────────────── */
export interface AudienceProfile {
  id: string;
  name: string;
  who: string;
  cares: string;
  usedIn: number;
}

export const AUDIENCE_PROFILES: AudienceProfile[] = [
  { id: "aud-01", name: "Office orderers", who: "Admins around Bangsar and Mid Valley ordering 15-30 pastries for meetings.", cares: "On-time delivery and easy invoicing.", usedIn: 4 },
  { id: "aud-02", name: "Weekend families", who: "Parents picking up cakes on Saturday mornings.", cares: "Photos of kids' favourites and bundle deals.", usedIn: 2 },
  { id: "aud-03", name: "Festive gifters", who: "Buying Raya and Merdeka boxes for clients and relatives.", cares: "Premium packaging, order early.", usedIn: 3 },
];

/* ── B-01 品牌用法说明(Guidelines):每条「怎么用」规则 + 例子 ─────────────── */
export interface BrandGuideline {
  id: string;
  rule: string;
  example: string;
}

export const BRAND_GUIDELINES: BrandGuideline[] = [
  { id: "gl-01", rule: "Pandan green is an accent only", example: "Use it for highlights and ribbons, never as a full background." },
  { id: "gl-02", rule: "Gula melaka is for promo headlines", example: "Only on sale or festive posts — keeps everyday posts calm." },
  { id: "gl-03", rule: "Always keep the logo clear space", example: "Leave at least the width of the moon mark around the wordmark." },
  { id: "gl-04", rule: "Photos are warm and film-grain", example: "Natural morning light on the rattan tray or marble counter — never studio-flat." },
];

/* ── B-08 数据驱动批量变体:一张表 → 每行一张促销图(先出总价确认闸) ──────────
 * 原型只画「读表 → 逐行成品 → 总价确认」的形态;永不真的花钱(缝 7 铁律)。 */
export interface BulkRow {
  sku: string;
  product: string;
  priceMyr: number;
  thumb: string;
}

export const BULK_CREDITS_PER_ROW = 8;

export const BULK_SAMPLE_ROWS: BulkRow[] = [
  { sku: "PGM-01", product: "Pandan gula melaka cake", priceMyr: 88, thumb: nsImage("bakery", 5) },
  { sku: "KBC-02", product: "Kaya butter croissant", priceMyr: 8.5, thumb: nsImage("bakery", 1) },
  { sku: "MDC-03", product: "Milo dinosaur cookie", priceMyr: 6, thumb: nsImage("bakery", 7) },
  { sku: "OCP-04", product: "Onde-onde cream puff", priceMyr: 7.5, thumb: nsImage("bakery", 12) },
  { sku: "KTC-05", product: "Kopi-O tiramisu cup", priceMyr: 14, thumb: nsImage("bakery", 10) },
  { sku: "RGB-06", product: "Raya cookie gift box", priceMyr: 68, thumb: nsImage("bakery", 20) },
];

/* ── B-15 品牌风格参考(轻量):用参考图匹配风格,不训练新模型 ─────────────── */
export interface ReferenceStyle {
  id: string;
  name: string;
  note: string;
  thumb: string;
}

export const REFERENCE_STYLES: ReferenceStyle[] = [
  { id: "rs-01", name: "Warm kopitiam", note: "Golden light, marble, film grain", thumb: nsImage("storefront", 3) },
  { id: "rs-02", name: "Festive gifting", note: "Ribbon, flags, premium box", thumb: nsImage("bakery", 20) },
  { id: "rs-03", name: "Clean menu flat lay", note: "Cream background, top-down", thumb: nsImage("bakery", 14) },
];

/* ── B-13 多品牌 / Agency:品牌切换器上下文(原型层只切 UI 上下文) ─────────── */
export interface BrandContext {
  id: string;
  name: string;
  kind: "own" | "client";
  mark: string; // 首字母底色用 secondary
}

export const BRAND_CONTEXTS: BrandContext[] = [
  { id: "brand-01", name: "Roti Bulan Bakery", kind: "own", mark: "RB" },
  { id: "brand-02", name: "Kopi Kravers KL", kind: "client", mark: "KK" },
  { id: "brand-03", name: "Nyonya Nook", kind: "client", mark: "NN" },
];

/* ══════════════════════════════════════════════════════════════════════════
 * B-06/B-04 · 品牌语气 + 视觉提取器(「Research my site」升级)
 * ──────────────────────────────────────────────────────────────────────────
 * 法源:GOOSEWORKS-MAP §二 B4/B6 —— 抄 `brand-voice-extractor`(6 维语气 +
 * Do/Don't 块 + 爱用/忌用词表)+ `visual-brand-extractor`(色源优先级 + 吐一个
 * {primary_color, accent_color, font_heading, font_body...} JSON)。提取一次 → 一个
 * 持久「品牌记忆」对象 → 每次生成自动按品牌(治「产品盲/通用句」病根)。
 *
 * 判断层自铸(GOOSEWORKS §五 硬标准):每维语气不给光秃的进度点,给「读数 +
 * 证据句」(证据来自本店真实文案),满足「结论必须挂证据」这条。色板/字体的每个值
 * 标「从哪儿抽到的」(色源优先级),满足「代理指标须标来源」。全部从 BRAND_KIT +
 * MEMORY_FACTS 单源派生 —— 不新造品牌真相,提取器只是把已知真相结构化吐出来喂生成。
 *
 * 诚实标注:这是「读你自己的网站」得来的(合法一手数据源),不是行业默认套话;
 * 原型层无真爬虫,mock 演示完整流,面板明说「read from rotibulan.my」。
 * ════════════════════════════════════════════════════════════════════════ */

/** 一条语气维度:读数 + 证据句(证据挂 §五 硬标准)。 */
export interface VoiceDimension {
  key: string;
  /** 维度人话名(sentence case) */
  label: string;
  /** 读数(High / Medium / Low 三档) */
  reading: "High" | "Medium" | "Low";
  /** 支撑这条读数的本店真实文案证据(不是拍脑袋) */
  evidence: string;
}

/** 视觉 token:值 + 从哪个来源抽到的(色源优先级 = visual-brand-extractor 方法)。 */
export interface VisualToken {
  key: string;
  label: string;
  /** hex 或字体名(用户品牌数据,数据级豁免) */
  value: string;
  /** 抽取来源(色源优先级:logo SVG → theme-color meta → 显式 CSS → 计算样式) */
  source: string;
}

export interface BrandExtract {
  /** 抽取源(诚实标注:读的是商家自己的站) */
  sourceUrl: string;
  /** 6 维语气读数(带证据) */
  voice: VoiceDimension[];
  /** Do 规则(生成时正向遵循) */
  dos: string[];
  /** Don't 规则(生成时硬避开) */
  donts: string[];
  /** 爱用词(生成默认往这些词靠) */
  favouriteWords: string[];
  /** 忌用词(生成默认避开) */
  avoidWords: string[];
  /** 视觉 token(色板 + 字体,带来源) */
  visual: VisualToken[];
  /** 治「产品盲/通用句」的对照证据:同一条 caption,喂品牌前 vs 后 */
  beforeAfter: { before: string; after: string };
}

/* palette/fonts 全部指向 BRAND_KIT 单源(用户品牌数据),提取器只补「从哪抽到的」。 */
export const BRAND_EXTRACT: BrandExtract = {
  sourceUrl: "rotibulan.my",
  voice: [
    { key: "warmth", label: "Warmth", reading: "High", evidence: "“Family-run bakery in Bangsar, baking since 2019.”" },
    { key: "formality", label: "Formality", reading: "Low", evidence: "Greets in mixed English and Malay — never “Dear customer”." },
    { key: "playfulness", label: "Playfulness", reading: "Medium", evidence: "Light and a little cheeky, but never gimmicky." },
    { key: "directness", label: "Directness", reading: "High", evidence: "Prices stated plainly in RM, short sentences." },
    { key: "enthusiasm", label: "Enthusiasm", reading: "Medium", evidence: "Warm, but never salesy or shouty (no “!!!”)." },
    { key: "locality", label: "Local voice", reading: "High", evidence: "KL code-switching, kopitiam and pasar references." },
  ],
  dos: [
    "Mix English and Malay the way KL actually talks.",
    "Keep sentences short. State prices plainly in RM.",
    "Reply in the language the customer used.",
    "Lead with fresh, morning-batch, pickup or Lalamove.",
  ],
  donts: [
    "Don't sound salesy or use “limited time only!!!”.",
    "Don't say “Dear customer” — it's cold for a KL bakery.",
    "Don't promise same-day custom cakes (min 3 days).",
    "Don't claim JAKIM-certified — say pork-free and alcohol-free instead.",
  ],
  favouriteWords: ["fresh", "morning batch", "pickup", "Lalamove", "pre-order", "kaya", "pandan"],
  avoidWords: ["cheap", "limited time only", "guaranteed", "Dear customer", "world-class"],
  visual: [
    { key: "primary_color", label: "Primary", value: BRAND_KIT.colours[0].hex, source: "logo SVG fill" },
    { key: "accent_color", label: "Accent", value: BRAND_KIT.colours[2].hex, source: "headline CSS colour" },
    { key: "surface_color", label: "Surface", value: BRAND_KIT.colours[1].hex, source: "<meta theme-color>" },
    { key: "ink_color", label: "Ink", value: BRAND_KIT.colours[3].hex, source: "computed body colour" },
    { key: "font_heading", label: "Heading font", value: BRAND_KIT.fonts[0].family, source: "computed CSS · h1" },
    { key: "font_body", label: "Body font", value: BRAND_KIT.fonts[1].family, source: "computed CSS · body" },
  ],
  beforeAfter: {
    before: "Delicious pastries available now! Order today! 🎉 Best in town!!!",
    after: "Fresh kaya croissants, morning batch. Pickup or Lalamove around KL 🥐 RM8.50.",
  },
};

/** 提取器的叙述步(读站 → 读语气 → 抽色板字体 → 存成品牌记忆)。 */
export const EXTRACT_STEPS = [
  "Reading rotibulan.my…",
  "Listening for your voice…",
  "Pulling colours and fonts…",
  "Saving it as brand memory…",
] as const;

/** 提取器落地的「品牌记忆对象」(生成侧单一源;persisted 到 store 后每次生成读它)。 */
export interface BrandProfile {
  sourceUrl: string;
  extractedAt: string;
  voice: VoiceDimension[];
  dos: string[];
  donts: string[];
  favouriteWords: string[];
  avoidWords: string[];
  visual: VisualToken[];
}
