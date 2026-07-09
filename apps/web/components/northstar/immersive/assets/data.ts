/**
 * 沉浸式 · 资产区(Z9)—— WHATPASS 七章候选的派生数据。
 *
 * 单一源纪律:图片只从 NS_IMAGES 取(nsImage),品牌事实从 ../../_mock 与
 * ../../assets/_data 派生,不新造品牌真相。确定性字面量,零随机、零 Date.now。
 * 本文件只承载「资产区原生页新增候选」需要的示例结构;区外事实(credits/events/
 * brandPreferences/cast 训练)一律经 _store.ts。
 */

import { nsImage } from "@/components/northstar/_mock";
import { GEN_RECORDS, type GenRecord } from "@/components/northstar/assets/_data";

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
